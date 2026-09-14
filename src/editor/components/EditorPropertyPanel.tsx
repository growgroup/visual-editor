"use client";

/**
 * エディタプロパティパネル
 *
 * Phase 2: パフォーマンス最適化
 * - React.memoでラップして不要な再レンダリングを防止
 */

import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  useContext,
  createContext,
  memo,
  type ReactNode,
  type MutableRefObject,
} from "react";
import { useEditorComponents } from "../EditorContext";
import { InstanceOverrideSection } from "./property-panel/InstanceOverrideSection";
import { Component as PartIcon } from "lucide-react";
import { detachPart, partInfoOf, unlockPartDescendants } from "../parts";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Slider } from "../../components/ui/slider";
import { ScrollArea } from "../../components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";
import {
  MousePointer2,
  ChevronRight,
  Square,
  Type,
  Palette,
  Circle,
  Trash2,
  Copy,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Bold,
  Italic,
  Underline,
  Sparkles,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  Link2,
  Link2Off,
  Move,
  LayoutGrid,
} from "lucide-react";
import { Checkbox } from "../../components/ui/checkbox";
import { buildFilterString, buildTransformString } from "../utils/style-utils";
import { useEditorContext } from "../EditorContext";
import { useElementActions, useEditorColors } from "../hooks";
import { FONT_WEIGHTS } from "../constants";
import type { PanelSections, SelectedElementInfo } from "../types";
import {
  FigmaColorPicker,
  FillConfig,
  parseCssToFillConfig,
  fillConfigToCss,
  extractOpacity,
} from "./FigmaColorPicker";
import { ScalePanel } from "./property-panel/ScalePanel";
import { AlignmentPanel } from "./property-panel/AlignmentPanel";
import { AutoLayoutPanel } from "./property-panel/AutoLayoutPanel";
import { CompactNumberInput } from "./property-panel/CompactNumberInput";
import { CompactSizeInput, SizeMode } from "./property-panel/CompactSizeInput";
import { VariableAwareSizeInput } from "./property-panel/VariableAwareSizeInput";
import { LinkSection } from "./property-panel/LinkSection";
import { ImgSrcSection } from "./property-panel/ImgSrcSection";
import { GoogleFontPicker } from "./property-panel/GoogleFontPicker";
import { VariableAwareInput } from "./property-panel/VariableAwareInput";
import { VariableAwareUnitInput, FONT_SIZE_UNITS, SPACING_UNITS, BORDER_RADIUS_UNITS, LINE_HEIGHT_UNITS, LETTER_SPACING_UNITS, BORDER_WIDTH_UNITS, POSITION_UNITS, type UnitConversionContext } from "./property-panel";
import { VariableAwareColorInput } from "./property-panel/VariableAwareColorInput";
import { isVariableReference } from "../../types/css-variables";
import { cn } from "../../lib/utils";
import { ScrubbableLabel } from "../../components/ui/scrubbable-label";
import { useResizablePanel } from "../hooks/useResizablePanel";
import {
  getIframeElement,
  getOverlayRect,
  refreshSelectionOverlay,
} from "../utils/dom-utils";
import {
  isOutOfFlowPosition,
  roundPx,
  pxValue,
  MIN_ELEMENT_SIZE,
} from "../utils/geometry";
import { convertInlineStylesToTailwind } from "../utils/tailwind-utils";
import {
  isAspectRatioLocked,
  setAspectRatioLocked,
  useAspectRatioLock,
} from "../utils/aspect-lock";

// RGB を HEX に変換
const rgbToHex = (rgb: string): string => {
  if (!rgb || rgb === "transparent" || rgb === "none") return "#ffffff";
  if (rgb.startsWith("#")) return rgb.slice(0, 7);
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return "#ffffff";
  const r = parseInt(match[1]).toString(16).padStart(2, "0");
  const g = parseInt(match[2]).toString(16).padStart(2, "0");
  const b = parseInt(match[3]).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
};

// デフォルトのプリセットカラー
const DEFAULT_PRESETS = [
  "#000000",
  "#333333",
  "#666666",
  "#999999",
  "#cccccc",
  "#ffffff",
  "#ff0000",
  "#ff6600",
  "#ffcc00",
  "#00ff00",
  "#00ccff",
  "#0066ff",
  "#6600ff",
  "#ff00ff",
  "#ff0066",
];

// テキスト関連のタグ名（テキストセクションを表示すべきタグ）
const TEXT_RELATED_TAGS = new Set([
  "SPAN",
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LABEL",
  "A",
  "BUTTON",
  "SMALL",
  "STRONG",
  "EM",
  "I",
  "B",
  "U",
  "LI",
  "BLOCKQUOTE",
  "CITE",
  "CODE",
  "PRE",
  "TIME",
  "MARK",
  "ABBR",
  "TD",
  "TH",
  "CAPTION",
  "FIGCAPTION",
  "LEGEND",
  "DT",
  "DD",
]);

/**
 * テキストセクションを表示すべきかどうかを判定
 * - テキスト関連のタグである
 * - または直接テキストコンテンツを持っている
 */
const shouldShowTypographySection = (element: SelectedElementInfo): boolean => {
  // テキスト関連のタグなら表示
  if (TEXT_RELATED_TAGS.has(element.tagName.toUpperCase())) {
    return true;
  }
  // 直接テキストコンテンツを持っている場合も表示
  if (element.text && element.text.trim().length > 0) {
    return true;
  }
  return false;
};

// ============================================================
// ライブ計測（群対応 + ドラッグ/リサイズ中のリアルタイム追従）
// ============================================================

/**
 * [なぜパネル側で実測するのか]
 * ドラッグ・リサイズ中、useDragResize は iframe 内の要素の style を直接書き換えるだけで、
 * React 側の selectedElement を更新する ELEMENT_SELECTED は mouseup まで飛んでこない。
 * そのため selectedElement の値をそのまま出すと、操作中は数値が固まって見える。
 * ここでは iframe の DOM を MutationObserver で監視し、変化のあったフレームだけ実測して
 * パネルへ流す。「表示値 = 画面上の実物」を常に一致させるのが目的。
 *
 * [座標系]
 * 群のバウンディングボックスは getOverlayRect（選択枠の描画に使うのと同じ関数）で求める。
 * 選択枠と同じ式で出しているので、パネルの X/Y/W/H と画面の群枠は定義上ズレない。
 * 単一要素の X/Y は extractElementInfo と同じく computed の left/top を使う
 * （回転している要素では描画矩形と style.left が食い違うため、書き戻せる値のほうを出す）。
 */
interface LiveMemberGeometry {
  id: string;
  /** 群バウンディングボックス算出用: アートボード座標の描画矩形（スケール前 CSS px） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 単一表示用: computed の left/top（auto 等で数値にならない場合は null） */
  styleLeft: number | null;
  styleTop: number | null;
  /** left/top を書いて動かせるか（absolute / fixed のみ true） */
  canMove: boolean;
}

interface LiveGeometry {
  members: LiveMemberGeometry[];
  /** 選択全体のバウンディングボックス（アートボード座標） */
  bbox: { x: number; y: number; w: number; h: number } | null;
  /** メンバー間で値が異なる項目（Mixed 表示用） */
  mixed: { x: boolean; y: boolean; w: boolean; h: boolean };
  /** left/top を書き換えられるメンバーが 1 つ以上あるか */
  canMove: boolean;
}

/** 小数の揺れで無駄な再レンダリングが起きないよう、計測値は小数2桁で丸める */
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** 選択中の要素をまとめて実測する */
function measureSelection(doc: Document, ids: string[]): LiveGeometry | null {
  const members: LiveMemberGeometry[] = [];

  for (const id of ids) {
    const el = getIframeElement(doc, id);
    if (!el || !el.isConnected) continue;

    const rect = getOverlayRect(doc, el);
    const cs = doc.defaultView?.getComputedStyle(el);
    const rawLeft = cs ? parseFloat(cs.left) : NaN;
    const rawTop = cs ? parseFloat(cs.top) : NaN;

    members.push({
      id,
      x: round2(rect.left),
      y: round2(rect.top),
      w: round2(rect.width),
      h: round2(rect.height),
      styleLeft: Number.isFinite(rawLeft) ? round2(rawLeft) : null,
      styleTop: Number.isFinite(rawTop) ? round2(rawTop) : null,
      canMove: isOutOfFlowPosition(cs?.position),
    });
  }

  if (members.length === 0) return null;

  const left = Math.min(...members.map((m) => m.x));
  const top = Math.min(...members.map((m) => m.y));
  const right = Math.max(...members.map((m) => m.x + m.w));
  const bottom = Math.max(...members.map((m) => m.y + m.h));

  // 1px 未満の差は「同じ」とみなす。丸め比較だと 0.5px の差で Mixed が点灯し、
  // 見た目が同じなのに警告が出てノイズになるため。
  const allSame = (pick: (m: LiveMemberGeometry) => number): boolean =>
    members.every((m) => Math.abs(pick(m) - pick(members[0])) < 1);

  return {
    members,
    bbox: {
      x: round2(left),
      y: round2(top),
      w: round2(right - left),
      h: round2(bottom - top),
    },
    mixed: {
      x: !allSame((m) => m.styleLeft ?? m.x),
      y: !allSame((m) => m.styleTop ?? m.y),
      w: !allSame((m) => m.w),
      h: !allSame((m) => m.h),
    },
    canMove: members.some((m) => m.canMove),
  };
}

/** 実測結果が実質同じか（同じなら state を更新せず再レンダリングを避ける） */
function sameGeometry(a: LiveGeometry | null, b: LiveGeometry | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.members.length !== b.members.length) return false;
  for (let i = 0; i < a.members.length; i++) {
    const m = a.members[i];
    const n = b.members[i];
    if (
      m.id !== n.id ||
      m.x !== n.x ||
      m.y !== n.y ||
      m.w !== n.w ||
      m.h !== n.h ||
      m.styleLeft !== n.styleLeft ||
      m.styleTop !== n.styleTop ||
      m.canMove !== n.canMove
    ) {
      return false;
    }
  }
  return true;
}

const LiveGeometryContext = createContext<LiveGeometry | null>(null);

/**
 * ライブ計測をパネル配下に配信する Provider
 *
 * [なぜ Provider にするか]
 * ドラッグ中は毎フレーム値が変わる。パネル本体（2000行超・カラーピッカー込み）を
 * 毎フレーム再レンダリングするとドラッグ自体が重くなり、直そうとしている操作感を逆に壊す。
 * children を props としてそのまま流すことで、state 更新時に React が子ツリーを
 * バイパスし、実際に値を使うコンシューマ（数値入力と群セクション）だけが更新される。
 */
function LiveGeometryProvider({
  ids,
  iframeRef,
  iframeReady,
  children,
}: {
  ids: string[];
  iframeRef: MutableRefObject<HTMLIFrameElement | null>;
  iframeReady: boolean;
  children: ReactNode;
}) {
  const [geometry, setGeometry] = useState<LiveGeometry | null>(null);
  // 依存配列を安定させるため id 配列は文字列化して比較する
  const idsKey = ids.join(",");

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument ?? null;
    const targetIds = idsKey ? idsKey.split(",") : [];
    if (!doc || targetIds.length === 0) {
      setGeometry(null);
      return;
    }

    let rafId = 0;
    const measure = () => {
      rafId = 0;
      const next = measureSelection(doc, targetIds);
      setGeometry((prev) => (sameGeometry(prev, next) ? prev : next));
    };
    // 1フレームに1回へ間引く（ドラッグ中は複数の style 変更が同一フレームに届くため）
    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(measure);
    };

    measure();

    // ドラッグ/リサイズは style を、確定時の Tailwind 変換は class を書き換える。
    // 親のリフローで矩形が変わる場合もあるので artboard 全体を subtree で監視する。
    const target = doc.getElementById("artboard") || doc.body;
    // 読み込み中の文書(body 無し)には付けない。準備できたら iframeReady で張り直る
    if (!target) return;
    const observer = new MutationObserver(schedule);
    observer.observe(target, {
      attributes: true,
      attributeFilter: ["style", "class"],
      subtree: true,
      childList: true,
    });

    // 画像の遅延読み込みなどでレイアウトが動くこともあるので、リサイズも拾う
    const win = doc.defaultView;
    win?.addEventListener("resize", schedule);

    return () => {
      observer.disconnect();
      win?.removeEventListener("resize", schedule);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [idsKey, iframeRef, iframeReady]);

  return (
    <LiveGeometryContext.Provider value={geometry}>
      {children}
    </LiveGeometryContext.Provider>
  );
}

/**
 * ライブ計測値を「使う場所だけ」で購読するための描画プロップコンポーネント
 * これで囲んだ範囲だけが毎フレーム再レンダリングされる
 */
function LiveGeom({
  children,
}: {
  children: (geometry: LiveGeometry | null) => ReactNode;
}) {
  const geometry = useContext(LiveGeometryContext);
  return <>{children(geometry)}</>;
}

/** 単一の px 数値（"120px" / "-8px"）か判定する */
const isPlainPxValue = (raw: string | number | undefined | null): boolean => {
  if (raw === undefined || raw === null || raw === "") return true;
  if (typeof raw === "number") return true;
  return /^-?\d+(\.\d+)?px$/.test(raw.trim());
};

/** サイズ欄の最小・最大。raw は SelectedElementInfo の読み戻し先 */
const SIZE_LIMIT_FIELDS = [
  { id: "min-w", prop: "minWidth", raw: "rawMinWidth", label: "最小W", title: "最小幅(min-width)", dimension: "width" },
  { id: "max-w", prop: "maxWidth", raw: "rawMaxWidth", label: "最大W", title: "最大幅(max-width)", dimension: "width" },
  { id: "min-h", prop: "minHeight", raw: "rawMinHeight", label: "最小H", title: "最小の高さ(min-height)", dimension: "height" },
  { id: "max-h", prop: "maxHeight", raw: "rawMaxHeight", label: "最大H", title: "最大の高さ(max-height)", dimension: "height" },
] as const;

/**
 * 表示値の決定
 * raw が var(--x) / % / vw など「px 以外の指定」なら、実測 px で上書きせず raw をそのまま返す。
 * これをしないと変数参照や % 指定が数値に潰れてバインドが静かに壊れる。
 */
function liveOrRaw(
  raw: string | undefined,
  live: number | null | undefined,
  fallback: number,
): string {
  if (!isPlainPxValue(raw)) return raw as string;
  if (live !== null && live !== undefined) return `${Math.round(live)}px`;
  return raw && raw !== "" ? raw : `${Math.round(fallback)}px`;
}

/** 群操作の対象要素（入れ子の子は親に含まれるので除外する） */
function resolveGroupTargets(doc: Document, ids: string[]): HTMLElement[] {
  const els = ids
    .map((id) => getIframeElement(doc, id))
    .filter((el): el is HTMLElement => !!el && el.isConnected);
  return els.filter((el) => !els.some((other) => other !== el && other.contains(el)));
}

/**
 * 群をまとめて平行移動する
 *
 * [なぜ updateElementStyle を使わないか]
 * updateElementStyle は「同じスタイルを全選択要素へ配る」ので、
 * left: 100px を配ると全要素が同じ x に重なってしまう。
 * 群の X を動かす＝各要素を同じ量だけずらす、なので差分で書く。
 * 書き込み後の Tailwind 変換 → 通知 → 枠再構築の順序は alignElements と揃える。
 */
function translateGroup(doc: Document, ids: string[], dx: number, dy: number): boolean {
  const targets = resolveGroupTargets(doc, ids);
  let changed = false;

  targets.forEach((el) => {
    const cs = doc.defaultView?.getComputedStyle(el);
    if (!isOutOfFlowPosition(cs?.position)) return; // static/relative は left を書いても意味が違う
    if (dx !== 0) {
      el.style.left = pxValue((parseFloat(cs?.left ?? "") || 0) + dx);
    }
    if (dy !== 0) {
      el.style.top = pxValue((parseFloat(cs?.top ?? "") || 0) + dy);
    }
    convertInlineStylesToTailwind(el, ["left", "top"]);
    changed = true;
  });

  return changed;
}

/**
 * 群バウンディングボックスを左上原点で相似拡大縮小する
 *
 * sx / sy は各軸の倍率。1 の軸は「触らない」（W だけ入力したときに H を巻き込まない）。
 * 縦横比ロック時は呼び出し側が sx = sy を渡すので、ここでは軸ごとの一般形だけを持つ。
 *
 * [丸め方] 位置と幅を別々に丸めると対辺が 1px ずれるので、左右（上下）の端をそれぞれ
 * 丸めてから引き算で幅を出す。computeResizeGeometry（item2 側の丸め規則）と同じ考え方。
 */
function scaleGroup(
  doc: Document,
  ids: string[],
  bbox: { x: number; y: number; w: number; h: number },
  sx: number,
  sy: number,
): boolean {
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return false;
  if (sx === 1 && sy === 1) return false;

  const targets = resolveGroupTargets(doc, ids);
  let changed = false;

  targets.forEach((el) => {
    const cs = doc.defaultView?.getComputedStyle(el);
    const rect = getOverlayRect(doc, el);
    const outOfFlow = isOutOfFlowPosition(cs?.position);

    if (sx !== 1) {
      const newLeft = roundPx(bbox.x + (rect.left - bbox.x) * sx);
      const newRight = roundPx(bbox.x + (rect.left + rect.width - bbox.x) * sx);
      const newWidth = Math.max(MIN_ELEMENT_SIZE, newRight - newLeft);
      if (outOfFlow) {
        el.style.left = pxValue((parseFloat(cs?.left ?? "") || 0) + (newLeft - rect.left));
      }
      el.style.width = `${newWidth}px`;
    }

    if (sy !== 1) {
      const newTop = roundPx(bbox.y + (rect.top - bbox.y) * sy);
      const newBottom = roundPx(bbox.y + (rect.top + rect.height - bbox.y) * sy);
      const newHeight = Math.max(MIN_ELEMENT_SIZE, newBottom - newTop);
      if (outOfFlow) {
        el.style.top = pxValue((parseFloat(cs?.top ?? "") || 0) + (newTop - rect.top));
      }
      el.style.height = `${newHeight}px`;
    }

    convertInlineStylesToTailwind(el, ["left", "top", "width", "height"]);
    changed = true;
  });

  return changed;
}

/**
 * 縦横比ロックのトグル
 *
 * [なぜ「Shift 相当」と説明するか]
 * ロック中のリサイズは useDragResize 側で Shift 押下と同じ経路（computeResizeGeometry の
 * shiftKey）を通る。UI 上も別物の機能に見せず、「Shift を押し続けている状態」と伝える。
 * 状態はモジュールスコープのストア（utils/aspect-lock.ts）に持つので、
 * 選択を切り替えてもロックは保たれる（Figma と同じ）。
 */
function AspectRatioLockToggle({ compact = false }: { compact?: boolean }) {
  const locked = useAspectRatioLock();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={locked}
      aria-label="縦横比を固定"
      title={
        locked
          ? "縦横比を固定中：ハンドルのドラッグも W / H の入力も比率を保ちます（クリックで解除）"
          : "縦横比を固定する：ハンドルのドラッグと W / H の入力が Shift を押したときと同じ比率維持になります"
      }
      onClick={() => setAspectRatioLocked(!locked)}
      className={cn(
        "shrink-0 flex items-center justify-center rounded border transition-colors",
        compact ? "h-6 w-6" : "h-7 w-6",
        locked
          ? "text-[#4fb8ff] border-[#0d99ff]/60 bg-[#0d99ff]/15"
          : "text-gray-500 border-[#444444] hover:text-white hover:bg-[#383838]",
      )}
    >
      {locked ? (
        <Link2 className="w-3 h-3" />
      ) : (
        <Link2Off className="w-3 h-3" />
      )}
    </button>
  );
}

/**
 * 群セクション専用の数値入力
 *
 * [なぜ CompactNumberInput を使わないか]
 * CompactNumberInput は1文字打つたびに onChange を発火する。
 * 群の W に「864」と打つと 8 → 86 → 864 の順に適用され、
 * 途中の「8」で群が最小サイズまで潰れてから戻るため、要素同士の比率が壊れる。
 * ここでは Enter / フォーカスアウト / 矢印キーでのみ確定する（Figma と同じ挙動）。
 * 表示値はドラッグ中も追従するが、編集中（フォーカス中）だけは打った文字を優先する。
 */
function GroupNumberInput({
  value,
  onCommit,
  min,
  disabled,
  mixed,
  title,
}: {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  disabled?: boolean;
  /** メンバー間で値が異なる項目（枠色で示す） */
  mixed?: boolean;
  title?: string;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  // Enter で確定した直後に blur が走るため、二重に適用しないための番人
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  const commit = (raw: string) => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed)) {
      setText(String(value));
      return;
    }
    const clamped = min !== undefined ? Math.max(min, parsed) : parsed;
    setText(String(clamped));
    if (Math.round(clamped) !== Math.round(value)) onCommit(clamped);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      // size=1 にしないと input の固有幅（約20文字分）がパネルの内容幅を押し広げる
      size={1}
      title={title}
      value={text}
      disabled={disabled}
      onChange={(e) => {
        dirtyRef.current = true;
        setText(e.target.value);
      }}
      onFocus={(e) => {
        setFocused(true);
        e.currentTarget.select();
      }}
      onBlur={(e) => {
        setFocused(false);
        commit(e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit(e.currentTarget.value);
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          dirtyRef.current = false;
          setText(String(value));
          e.currentTarget.blur();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          // 矢印は1回の操作で確定値が決まるので即時反映してよい
          e.preventDefault();
          const step = (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
          dirtyRef.current = true;
          commit(String((parseFloat(e.currentTarget.value) || 0) + step));
        }
        // Delete / Backspace などがキャンバス側の削除ショートカットに拾われないようにする。
        // ただし Cmd/Ctrl 併用（Undo・Redo・保存など）は入力欄にいても効かせたいので通す。
        if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
      }}
      className={cn(
        "w-[68px] shrink-0 h-6 bg-[#383838] border rounded",
        "text-white text-[10px] text-center px-1 outline-none focus:ring-1 focus:ring-[#0d99ff]",
        mixed ? "border-amber-500/60" : "border-[#444444]",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    />
  );
}

/**
 * 複数選択時の「群」セクション
 *
 * X/Y/W/H は選択範囲全体のバウンディングボックス（選択枠と同じ式で算出）。
 * 値はドラッグ・リサイズ中もリアルタイムに追従する。
 * メンバー間で値が異なる項目は枠を琥珀色にし、下に「Mixed: X / W」と明示する。
 *
 * [幅について] パネル本体はコンテンツ幅（max-content）でレイアウトされるため、
 * ここで input の幅を固定しておかないと行が右へはみ出して読めなくなる。
 */
function GroupGeometrySection({
  count,
  tagSummary,
  onTranslate,
  onScale,
}: {
  count: number;
  tagSummary: string;
  onTranslate: (dx: number, dy: number) => void;
  onScale: (axis: "w" | "h", target: number) => void;
}) {
  return (
    <div className="mb-3 w-fit rounded border border-[#444444] bg-[#2c2c2c] p-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] font-medium text-gray-200 whitespace-nowrap">
          {count}個を選択中
        </span>
        {tagSummary && (
          <span className="text-[10px] text-gray-500 font-mono truncate max-w-[90px]">
            {tagSummary}
          </span>
        )}
      </div>
      <p
        className="text-[10px] text-gray-500 mb-2 whitespace-nowrap"
        title={`このパネルのプロパティを変更すると、選択中の${count}個すべてに同じ値が適用されます`}
      >
        編集は{count}個すべてに適用
      </p>

      <LiveGeom>
        {(geometry) => {
          const bbox = geometry?.bbox;
          if (!bbox) {
            return (
              <p className="text-[10px] text-gray-500 whitespace-nowrap">
                選択範囲を計測中…
              </p>
            );
          }
          const mixed = geometry?.mixed;
          const canMove = !!geometry?.canMove;
          const moveHint = canMove
            ? "選択範囲全体の位置。変更すると全要素が同じ量だけ移動します"
            : "選択要素が絶対配置ではないため、X / Y を直接指定できません";
          const sizeHint =
            "選択範囲全体のサイズ。変更すると範囲の左上を基準に相似で拡大縮小します（縦横比ロック中は W / H が連動します）";
          const mixedLabels = [
            mixed?.x ? "X" : null,
            mixed?.y ? "Y" : null,
            mixed?.w ? "W" : null,
            mixed?.h ? "H" : null,
          ].filter(Boolean) as string[];

          return (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-500 w-3 text-center shrink-0">
                    X
                  </span>
                  <GroupNumberInput
                    value={Math.round(bbox.x)}
                    onCommit={(val) => onTranslate(val - bbox.x, 0)}
                    disabled={!canMove}
                    mixed={!!mixed?.x}
                    title={moveHint}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-500 w-3 text-center shrink-0">
                    Y
                  </span>
                  <GroupNumberInput
                    value={Math.round(bbox.y)}
                    onCommit={(val) => onTranslate(0, val - bbox.y)}
                    disabled={!canMove}
                    mixed={!!mixed?.y}
                    title={moveHint}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-500 w-3 text-center shrink-0">
                    W
                  </span>
                  <GroupNumberInput
                    value={Math.round(bbox.w)}
                    onCommit={(val) => onScale("w", val)}
                    min={MIN_ELEMENT_SIZE}
                    mixed={!!mixed?.w}
                    title={sizeHint}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-500 w-3 text-center shrink-0">
                    H
                  </span>
                  <GroupNumberInput
                    value={Math.round(bbox.h)}
                    onCommit={(val) => onScale("h", val)}
                    min={MIN_ELEMENT_SIZE}
                    mixed={!!mixed?.h}
                    title={sizeHint}
                  />
                </div>
                {/* 縦横比ロック（群のサイズ行にも置く。ロック中は W / H が連動する） */}
                <AspectRatioLockToggle compact />
              </div>
              {mixedLabels.length > 0 && (
                <p
                  className="text-[10px] text-amber-400/90 whitespace-nowrap"
                  title="選択中の要素で値が異なる項目です。入力欄の数値は選択範囲全体（バウンディングボックス）のものです"
                >
                  Mixed: {mixedLabels.join(" / ")}
                </p>
              )}
            </div>
          );
        }}
      </LiveGeom>
    </div>
  );
}

/**
 * 右パネル: プロパティパネル（メモ化）
 *
 * Phase 2 最適化:
 * - React.memoでラップして不要な再レンダリングを防止
 * - selectedElementが変更されない限り再レンダリングしない
 */
export const EditorPropertyPanel = memo(function EditorPropertyPanel() {
  const {
    selectedElement,
    selectedElementIds,
    activeTool,
    restoreFocus,
    iframeRef,
    editorMode,
    viewportWidth: contextViewportWidth,
    getIframeDoc,
    notifyIframeChange,
    iframeReady,
    setSelectedElement,
  } = useEditorContext();
  const {
    updateElementStyle,
    updateLinkAttribute,
    updateElementAttribute,
    deleteElement,
    duplicateElement,
    alignElements,
  } = useElementActions();
  const { colors: editorColors } = useEditorColors();

  // Component instance management
  const {
    getInstanceByDomId,
    getMasterComponent,
    changeVariant,
    removeOverride,
    resetAllOverrides,
    detachInstance,
    navigateToMasterComponent,
    getPartDef,
    updatePartFromElement,
  } = useEditorComponents();

  // Check if selected element is a component instance
  const selectedInstance = useMemo(() => {
    if (!selectedElement?.id) return null;
    return getInstanceByDomId(selectedElement.id);
  }, [selectedElement?.id, getInstanceByDomId]);

  // 部品(data-part)のインスタンスか(DOM の属性で判定)。ルートを選んでいても、中のスロットを選んでいても
  // 「どの部品の中か」を出す(中を編集しているときに、部品だと分からずに直してしまうのを防ぐ)
  const selectedPartRoot = useMemo(() => {
    if (!selectedElement?.id) return null;
    const doc = getIframeDoc();
    const el = doc?.querySelector(`[data-element-id="${selectedElement.id}"]`) as HTMLElement | null;
    if (!el) return null;
    const root = el.hasAttribute("data-part") ? el : (el.parentElement?.closest("[data-part]") as HTMLElement | null) ?? null;
    if (!root) return null;
    const slot = root === el ? null : (el.closest("[data-slot]") as HTMLElement | null);
    return { root, isRoot: root === el, slotName: slot && root.contains(slot) && slot !== root ? slot.getAttribute("data-slot") : null };
  }, [selectedElement, getIframeDoc]);
  const selectedPart = useMemo(() => (selectedPartRoot ? partInfoOf(selectedPartRoot.root) : null), [selectedPartRoot]);
  const selectedPartLabel = useMemo(() => {
    if (!selectedPart) return "";
    const def = getPartDef(selectedPart.id);
    return `${def?.name || selectedPart.id} v${selectedPart.version}`;
  }, [selectedPart, getPartDef]);
  const handleUpdatePartFromPanel = useCallback(async () => {
    const root = selectedPartRoot?.root;
    if (!root) return;
    const def = await updatePartFromElement(root);
    if (def) notifyIframeChange(true);
  }, [selectedPartRoot, updatePartFromElement, notifyIframeChange]);
  const handleDetachPartFromPanel = useCallback(() => {
    const doc = getIframeDoc();
    const root = selectedPartRoot?.root;
    if (!doc || !root || !partInfoOf(root)) return;
    detachPart(root);
    unlockPartDescendants(root);
    notifyIframeChange(true);
    void import("../utils/style-utils").then(({ extractElementInfo }) => {
      const info = extractElementInfo(root, doc);
      if (info) setSelectedElement(info);
    });
  }, [selectedPartRoot, getIframeDoc, notifyIframeChange, setSelectedElement]);
  // 中のスロットを選んでいるとき: 部品のルートを選び直す(移動・削除・「この姿で更新」の対象を部品全体にする)
  const handleSelectPartRoot = useCallback(() => {
    const doc = getIframeDoc();
    const root = selectedPartRoot?.root;
    if (!doc || !root) return;
    void import("../utils/style-utils").then(({ extractElementInfo }) => {
      const info = extractElementInfo(root, doc);
      if (info) setSelectedElement(info);
    });
  }, [selectedPartRoot, getIframeDoc, setSelectedElement]);

  const selectedMaster = useMemo(() => {
    if (!selectedInstance) return null;
    return getMasterComponent(selectedInstance.masterComponentId);
  }, [selectedInstance, getMasterComponent]);

  // Instance override section state
  const [isInstanceSectionOpen, setIsInstanceSectionOpen] = useState(true);

  // Handlers for instance override section
  const handleVariantChange = useCallback((variantId: string) => {
    if (selectedInstance) {
      changeVariant(selectedInstance.id, variantId);
    }
  }, [selectedInstance, changeVariant]);

  const handleResetOverride = useCallback((overrideId: string) => {
    if (selectedInstance) {
      removeOverride(selectedInstance.id, overrideId);
    }
  }, [selectedInstance, removeOverride]);

  const handleResetAllOverrides = useCallback(() => {
    if (selectedInstance) {
      resetAllOverrides(selectedInstance.id);
    }
  }, [selectedInstance, resetAllOverrides]);

  const handleGoToMainComponent = useCallback(() => {
    if (selectedInstance?.masterComponentId) {
      navigateToMasterComponent(selectedInstance.masterComponentId);
    }
  }, [selectedInstance, navigateToMasterComponent]);

  const handleDetachInstance = useCallback(() => {
    if (selectedInstance) {
      detachInstance(selectedInstance.id);
    }
  }, [selectedInstance, detachInstance]);

  // リサイズ可能なパネル
  const { width, isDragging, resizeHandleProps } = useResizablePanel({
    initialWidth: 304,
    minWidth: 280,
    maxWidth: 480,
    direction: 'left', // 左端をドラッグしてリサイズ
    storageKey: 'editor-property-panel-width',
  });

  // サイズ欄の「最小・最大」を開いているか(値が入っている要素では常に出す。これは空の要素で開いたとき)。
  // 別の要素を選んだら閉じる
  const [sizeLimitsOpen, setSizeLimitsOpen] = useState(false);
  useEffect(() => {
    setSizeLimitsOpen(false);
  }, [selectedElement?.id]);

  const [openSections, setOpenSections] = useState<PanelSections>({
    position: editorMode !== "webpage", // 流し込みのページでは詳細操作として畳む
    layout: true, // レイアウトセクション
    appearance: true, // 外見セクション
    image: false, // 塗りに統合されたため非表示
    typography: true,
    link: true, // リンクセクション
    fill: true,
    stroke: false,
    effects: false,
  });

  // パディングのリンクモード（上下・左右をリンク or 個別）
  const [paddingLinked, setPaddingLinked] = useState(true);
  const [radiusLinked, setRadiusLinked] = useState(true);

  // 選択要素が変わったときにリンク状態を初期化
  useEffect(() => {
    if (selectedElement) {
      // 角丸
      const {
        borderRadiusTopLeft,
        borderRadiusTopRight,
        borderRadiusBottomRight,
        borderRadiusBottomLeft,
      } = selectedElement;
      if (
        borderRadiusTopLeft !== undefined &&
        borderRadiusTopRight !== undefined &&
        borderRadiusBottomRight !== undefined &&
        borderRadiusBottomLeft !== undefined
      ) {
        setRadiusLinked(
          borderRadiusTopLeft === borderRadiusTopRight &&
            borderRadiusTopRight === borderRadiusBottomRight &&
            borderRadiusBottomRight === borderRadiusBottomLeft,
        );
      }
    }
  }, [
    selectedElement?.id,
    selectedElement?.borderRadiusTopLeft,
    selectedElement?.borderRadiusTopRight,
    selectedElement?.borderRadiusBottomRight,
    selectedElement?.borderRadiusBottomLeft,
  ]);

  // スライド内の色とデフォルトを組み合わせたプリセット
  const colorPresets = useMemo(() => {
    const combined = [...new Set([...editorColors, ...DEFAULT_PRESETS])];
    return combined.slice(0, 24); // 最大24色
  }, [editorColors]);

  // 背景の塗り設定を取得
  const backgroundFillConfig = useMemo((): FillConfig => {
    if (!selectedElement) return { type: "none" };
    return parseCssToFillConfig(
      selectedElement.backgroundColor,
      selectedElement.backgroundImage,
      selectedElement.backgroundSize,
      selectedElement.rawBackgroundColor,
    );
  }, [selectedElement]);

  // 背景の塗り設定を更新
  const handleBackgroundFillChange = useCallback(
    (config: FillConfig) => {
      const css = fillConfigToCss(config);
      updateElementStyle(css);
    },
    [updateElementStyle],
  );

  // 親要素がFlexコンテナかどうか（flex または inline-flex）
  const isParentFlexContainer = selectedElement
    ? selectedElement.parentDisplay === "flex" ||
      selectedElement.parentDisplay === "inline-flex"
    : false;

  // 単位変換コンテキスト（px ↔ vw/vh/em/rem/% 変換用）
  const conversionContext = useMemo((): UnitConversionContext => {
    const iframeDoc = iframeRef.current?.contentDocument;

    // キャンバス/アートボードの設計寸法をビューポートサイズとして使用
    // slideモード: 1920x1080
    // webpageモード: viewportWidth（選択されたブレークポイント）x アートボードの高さ
    const SLIDE_WIDTH = 1920;
    const SLIDE_HEIGHT = 1080;

    const artboard = iframeDoc?.getElementById('artboard');
    const artboardHeight = artboard?.scrollHeight || SLIDE_HEIGHT;

    // viewport単位の変換に使用するサイズ（ブラウザのビューポートではなくキャンバスサイズ）
    const viewportWidth = editorMode === 'webpage'
      ? (contextViewportWidth || SLIDE_WIDTH)
      : SLIDE_WIDTH;
    const viewportHeight = editorMode === 'webpage'
      ? artboardHeight
      : SLIDE_HEIGHT;

    // 親要素のサイズ（%変換用）- artboardを基準に
    const parentWidth = artboard?.clientWidth || viewportWidth;
    const parentHeight = artboard?.clientHeight || viewportHeight;

    // フォントサイズ
    const fontSize = selectedElement?.fontSize || 16;

    // ルートフォントサイズ（通常は16px）
    const rootFontSize = iframeDoc?.documentElement
      ? parseFloat(getComputedStyle(iframeDoc.documentElement).fontSize) || 16
      : 16;

    return {
      viewportWidth,
      viewportHeight,
      parentWidth,
      parentHeight,
      fontSize,
      rootFontSize,
    };
  }, [iframeRef, selectedElement?.fontSize, editorMode, contextViewportWidth]);

  // ライブ計測の対象 ID
  // 単一選択でも selectedElementIds が空になる経路があるため、selectedElement で補う
  const liveIds = useMemo(() => {
    if (selectedElementIds.length > 0) return selectedElementIds;
    return selectedElement ? [selectedElement.id] : [];
  }, [selectedElementIds, selectedElement]);

  const isMultiSelection = selectedElementIds.length >= 2;

  // 群の選択内容サマリ（何が選ばれているか分かるようにする）
  const groupTagSummary = useMemo(() => {
    if (!isMultiSelection) return "";
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return "";
    const tags = selectedElementIds
      .map((id) => getIframeElement(doc, id)?.tagName.toLowerCase())
      .filter((t): t is string => !!t);
    const uniq = [...new Set(tags)];
    return uniq.length <= 2 ? uniq.join(" / ") : `${uniq.slice(0, 2).join(" / ")} ほか`;
  }, [isMultiSelection, selectedElementIds, iframeRef]);

  /** 群の平行移動（X / Y 入力） */
  const handleGroupTranslate = useCallback(
    (dx: number, dy: number) => {
      const doc = getIframeDoc();
      if (!doc) return;
      const rdx = roundPx(dx);
      const rdy = roundPx(dy);
      if (rdx === 0 && rdy === 0) return;
      if (!translateGroup(doc, selectedElementIds, rdx, rdy)) return;
      notifyIframeChange();
      // Tailwind クラスへの丸め込みで実描画位置が微妙に変わるため、枠は作り直す
      requestAnimationFrame(() => refreshSelectionOverlay(doc));
    },
    [getIframeDoc, selectedElementIds, notifyIframeChange],
  );

  /**
   * 群の相似拡大縮小（W / H 入力）
   *
   * 縦横比ロック中は入力した軸の倍率をもう一方の軸にも掛ける。
   * ロック状態は関数で読む（このコールバックの依存に入れて作り直すより、
   * 押した瞬間の値をそのまま使うほうが確実）。
   */
  const handleGroupScale = useCallback(
    (axis: "w" | "h", target: number) => {
      const doc = getIframeDoc();
      if (!doc) return;
      const current = measureSelection(doc, selectedElementIds);
      if (!current?.bbox) return;
      const base = axis === "w" ? current.bbox.w : current.bbox.h;
      if (base <= 0) return;
      if (Math.round(base) === Math.round(target)) return;
      const factor = Math.max(MIN_ELEMENT_SIZE, target) / base;
      const locked = isAspectRatioLocked();
      const sx = locked || axis === "w" ? factor : 1;
      const sy = locked || axis === "h" ? factor : 1;
      if (!scaleGroup(doc, selectedElementIds, current.bbox, sx, sy)) return;
      notifyIframeChange();
      requestAnimationFrame(() => refreshSelectionOverlay(doc));
    },
    [getIframeDoc, selectedElementIds, notifyIframeChange],
  );

  /**
   * 単一要素のサイズ入力を適用する（縦横比ロック対応）
   *
   * [なぜ px 同士に限るか]
   * ロック中に W を px で打つと H を計算して書き戻すが、H が % / var() / auto（Hug・Fill）の
   * ときにそれを px へ潰すと、変数バインドやレイアウト追従が黙って壊れる。
   * 相手側が「素の px の固定値」のときだけ連動させ、それ以外は打った軸だけを変える。
   *
   * @param liveW / @param liveH ドラッグ直後でも実物と一致させるための実測値
   */
  const applySizeValue = useCallback(
    (
      axis: "width" | "height",
      val: string,
      live?: { w?: number; h?: number },
    ) => {
      const styles: Record<string, string> = {
        [axis]: val,
        flexGrow: "0",
        alignSelf: "auto",
      };

      const el = selectedElement;
      const typed = parseFloat(val);
      const counterpartRaw = axis === "width" ? el?.rawHeight : el?.rawWidth;
      const counterpartAuto = axis === "width" ? el?.heightAuto : el?.widthAuto;
      const w = live?.w ?? el?.width ?? 0;
      const h = live?.h ?? el?.height ?? 0;

      const canLink =
        !!el &&
        isAspectRatioLocked() &&
        isPlainPxValue(val) &&
        Number.isFinite(typed) &&
        w > 0 &&
        h > 0 &&
        !counterpartAuto &&
        isPlainPxValue(counterpartRaw);

      if (canLink) {
        if (axis === "width") {
          styles.height = `${Math.max(MIN_ELEMENT_SIZE, roundPx((typed * h) / w))}px`;
        } else {
          styles.width = `${Math.max(MIN_ELEMENT_SIZE, roundPx((typed * w) / h))}px`;
        }
      }

      updateElementStyle(styles);
    },
    [selectedElement, updateElementStyle],
  );

  if (activeTool === "scale") {
    return <ScalePanel />;
  }

  // selectedElement が無くても選択IDが残っている経路がある（マーキー直後など）。
  // ここで空パネルに落とすと「複数選択したのにパネルが空」になるので、群セクションだけは出す。
  if (!selectedElement) {
    return (
      <LiveGeometryProvider
        ids={liveIds}
        iframeRef={iframeRef}
        iframeReady={iframeReady}
      >
        <div
          data-property-panel
          className="flex-shrink-0 bg-[#2c2c2c] border-l border-[#444444] flex flex-col overflow-hidden relative"
          style={{ width: `${width}px` }}
        >
          <div className="ed-panel-heading">要素の編集</div>
          {/* リサイズハンドル */}
          <div {...resizeHandleProps} />

          {/* ドラッグ中のオーバーレイ */}
          {isDragging && (
            <div className="fixed inset-0 z-50 cursor-col-resize" />
          )}

          {selectedElementIds.length > 0 ? (
            <ScrollArea className="flex-1">
              <div className="p-3">
                <GroupGeometrySection
                  count={selectedElementIds.length}
                  tagSummary={groupTagSummary}
                  onTranslate={handleGroupTranslate}
                  onScale={handleGroupScale}
                />
              </div>
            </ScrollArea>
          ) : (
            <div className="ed-empty">
              <MousePointer2 className="h-8 w-8" />
              <strong>編集する要素を選択</strong>
              <p>紙面の文字や画像をクリックすると、色・大きさ・余白を調整できます。</p>
              <p>文字はダブルクリックで直接編集できます。</p>
              <span className="text-xs">Shift＋クリックで複数選択</span>
            </div>
          )}
        </div>
      </LiveGeometryProvider>
    );
  }

  return (
    <LiveGeometryProvider
      ids={liveIds}
      iframeRef={iframeRef}
      iframeReady={iframeReady}
    >
    <div
      data-property-panel
      className="flex-shrink-0 bg-[#2c2c2c] border-l border-[#444444] flex flex-col overflow-hidden relative"
      style={{ width: `${width}px` }}
    >
      <div className="ed-panel-heading">
        <span>要素の編集</span>
        <span className="ml-auto truncate text-xs font-normal text-gray-400">{isMultiSelection ? `${selectedElementIds.length}個を選択` : selectedElement.text?.trim().slice(0, 28) || selectedElement.tagName.toLowerCase()}</span>
      </div>
      {/* リサイズハンドル */}
      <div {...resizeHandleProps} />

      {/* ドラッグ中のオーバーレイ */}
      {isDragging && (
        <div className="fixed inset-0 z-50 cursor-col-resize" />
      )}
      <ScrollArea className="flex-1">
        <div className="p-3">
          {/* ヘッダー */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 bg-[#383838] px-1.5 py-0.5 rounded font-mono">
                {selectedElement.tagName.toLowerCase()}
              </span>
              {isMultiSelection && (
                <span className="text-[10px] text-[#7cc4ff] bg-[#0d99ff]/15 px-1.5 py-0.5 rounded">
                  {selectedElementIds.length}個選択
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={duplicateElement}
                className="h-6 w-6 text-gray-400 hover:text-white hover:bg-[#4a4a4a]"
                title="複製"
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={deleteElement}
                className="h-6 w-6 text-gray-400 hover:text-red-400 hover:bg-[#4a4a4a]"
                title="削除"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* 群セクション（複数選択時のみ） */}
          {isMultiSelection && (
            <GroupGeometrySection
              count={selectedElementIds.length}
              tagSummary={groupTagSummary}
              onTranslate={handleGroupTranslate}
              onScale={handleGroupScale}
            />
          )}

          {/* 部品(data-part)のインスタンス。紙面の選択枠も紫になる(部品だと一目で分かるように) */}
          {selectedPart && selectedPartRoot && (
            <div className="ed-part-card space-y-2 rounded p-2 text-xs" data-part-card={selectedPart.id} data-part-inside={selectedPartRoot.isRoot ? undefined : "true"}>
              <div className="flex items-center gap-2">
                <PartIcon className="h-3.5 w-3.5 ed-part-accent" />
                <span className="truncate font-medium">部品 {selectedPartLabel}</span>
              </div>
              <p className="text-[10px] leading-snug ed-part-note">
                {selectedPartRoot.isRoot
                  ? "スロット(点線の枠)の中だけ編集できます。外側を直したいときは切り離してください。"
                  : `スロット「${selectedPartRoot.slotName ?? "—"}」の中を編集しています。ここの変更はこのページだけに残ります(定義には入りません)。`}
              </p>
              <div className="flex flex-wrap gap-1">
                {!selectedPartRoot.isRoot && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    title="部品のルート要素を選ぶ(移動・削除・更新の対象を部品全体にする)"
                    onClick={handleSelectPartRoot}
                  >
                    部品全体を選ぶ
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  title="このインスタンスの今の姿を定義にする(版 +1)。他のページの同じ部品もその場で描き直されます"
                  onClick={() => void handleUpdatePartFromPanel()}
                >
                  この姿で更新(全ページ)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  title="部品から切り離して普通の HTML にする(以後、定義の更新が及ばない)"
                  onClick={handleDetachPartFromPanel}
                >
                  切り離す
                </Button>
              </div>
            </div>
          )}

          {/* コンポーネントインスタンスセクション */}
          {selectedInstance && selectedMaster && (
            <InstanceOverrideSection
              instance={selectedInstance}
              master={selectedMaster}
              open={isInstanceSectionOpen}
              onOpenChange={setIsInstanceSectionOpen}
              onResetOverride={handleResetOverride}
              onResetAll={handleResetAllOverrides}
              onVariantChange={handleVariantChange}
              onGoToMainComponent={handleGoToMainComponent}
              onDetachInstance={handleDetachInstance}
            />
          )}

          {/* 位置セクション */}
          <Collapsible
            open={openSections.position}
            onOpenChange={(open) =>
              setOpenSections((prev) => ({ ...prev, position: open }))
            }
          >
            <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-xs font-medium text-gray-300 hover:text-white">
              <span className="flex items-center gap-2">
                <Move className="w-3.5 h-3.5" />
                位置
              </span>
              <ChevronRight
                className={`w-3.5 h-3.5 transition-transform ${openSections.position ? "rotate-90" : ""}`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pb-3">
              {/* 配置 */}
              <AlignmentPanel
                onAlign={alignElements}
                canDistribute={selectedElementIds.length >= 3}
              />

              {/* 位置 X/Y
                  LiveGeom で包むことで、ここだけがドラッグ中のフレーム更新を受ける。
                  raw が var()/% 等の場合は実測 px で上書きしない（liveOrRaw 参照）。 */}
              <div>
                <Label className="text-[10px] text-gray-500 mb-1 block">
                  位置
                </Label>
                <LiveGeom>
                  {(geometry) => {
                    const live = geometry?.members.find(
                      (m) => m.id === selectedElement.id,
                    );
                    return (
                      <div className="grid grid-cols-2 gap-2">
                        <VariableAwareUnitInput
                          value={liveOrRaw(
                            selectedElement.rawLeft,
                            live?.styleLeft,
                            selectedElement.x,
                          )}
                          onChange={(val) => updateElementStyle({ left: val })}
                          units={POSITION_UNITS}
                          defaultUnit="px"
                          category="spacing"
                          label="X"
                          compact
                          hideVariableLink
                          conversionContext={conversionContext}
                        />
                        <VariableAwareUnitInput
                          value={liveOrRaw(
                            selectedElement.rawTop,
                            live?.styleTop,
                            selectedElement.y,
                          )}
                          onChange={(val) => updateElementStyle({ top: val })}
                          units={POSITION_UNITS}
                          defaultUnit="px"
                          category="spacing"
                          label="Y"
                          compact
                          hideVariableLink
                          conversionContext={conversionContext}
                        />
                      </div>
                    );
                  }}
                </LiveGeom>
              </div>

              {/* 回転 + 反転 */}
              <div>
                <Label className="text-[10px] text-gray-500 mb-1 block">
                  回転
                </Label>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 flex-1 bg-[#383838] rounded px-2 h-7">
                    <RotateCw className="w-3 h-3 text-gray-500" />
                    <CompactNumberInput
                      value={Math.round(selectedElement.rotation)}
                      onChange={(val) => {
                        updateElementStyle({
                          transform: buildTransformString({
                            rotation: val || 0,
                            scaleX: selectedElement.scaleX,
                            scaleY: selectedElement.scaleY,
                          }),
                        });
                      }}
                      className="h-5 w-12 border-0"
                    />
                    <span className="text-xs text-gray-500">°</span>
                  </div>
                  <div className="w-px h-5 bg-[#4a4a4a]" />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      const isFlippedX =
                        Math.round(selectedElement.scaleX) === -1;
                      updateElementStyle({
                        transform: buildTransformString({
                          rotation: selectedElement.rotation,
                          scaleX: isFlippedX ? 1 : -1,
                          scaleY: selectedElement.scaleY,
                        }),
                      });
                    }}
                    className={`h-7 w-7 ${Math.round(selectedElement.scaleX) === -1 ? "bg-[#0d99ff] text-white" : "text-gray-400 hover:bg-[#4a4a4a] hover:text-white"}`}
                    title="水平方向に反転"
                  >
                    <FlipHorizontal className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      const isFlippedY =
                        Math.round(selectedElement.scaleY) === -1;
                      updateElementStyle({
                        transform: buildTransformString({
                          rotation: selectedElement.rotation,
                          scaleX: selectedElement.scaleX,
                          scaleY: isFlippedY ? 1 : -1,
                        }),
                      });
                    }}
                    className={`h-7 w-7 ${Math.round(selectedElement.scaleY) === -1 ? "bg-[#0d99ff] text-white" : "text-gray-400 hover:bg-[#4a4a4a] hover:text-white"}`}
                    title="垂直方向に反転"
                  >
                    <FlipVertical className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* レイアウトセクション */}
          <Collapsible
            open={openSections.layout}
            onOpenChange={(open) =>
              setOpenSections((prev) => ({ ...prev, layout: open }))
            }
          >
            <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-xs font-medium text-gray-300 hover:text-white border-t border-[#444444]">
              <span className="flex items-center gap-2">
                <LayoutGrid className="w-3.5 h-3.5" />
                レイアウト
              </span>
              <ChevronRight
                className={`w-3.5 h-3.5 transition-transform ${openSections.layout ? "rotate-90" : ""}`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pb-3">
              {/* オートレイアウトパネル */}
              <AutoLayoutPanel
                element={selectedElement}
                onStyleChange={updateElementStyle}
              />

              {/* サイズ W/H */}
              <div className="relative" data-size-section>
                <Label className="text-[10px] text-gray-500 mb-1 block">
                  サイズ
                </Label>
                {/* W / H + 縦横比ロック。ロックはハンドル操作（Shift 相当）と
                    この入力欄の両方に効く */}
                <div className="flex items-center gap-2">
                <div className="grid grid-cols-2 gap-2 flex-1 min-w-0">
                  {/* Width Input（リサイズ中の実測値に追従させるため LiveGeom で包む） */}
                  <LiveGeom>
                  {(geometry) => {
                    const member = geometry?.members.find(
                      (m) => m.id === selectedElement.id,
                    );
                    const live = selectedElement.widthAuto ? undefined : member?.w;
                    return (
                  <VariableAwareSizeInput
                    value={liveOrRaw(
                      selectedElement.rawWidth,
                      live,
                      selectedElement.width,
                    )}
                    mode={(() => {
                      if (!selectedElement.widthAuto) return "fixed";
                      const isParentRow =
                        isParentFlexContainer &&
                        (selectedElement.parentFlexDirection === "row" ||
                          selectedElement.parentFlexDirection ===
                            "row-reverse");
                      const isParentColumn =
                        isParentFlexContainer &&
                        (selectedElement.parentFlexDirection === "column" ||
                          selectedElement.parentFlexDirection ===
                            "column-reverse");

                      if (isParentRow && selectedElement.flexGrow > 0)
                        return "fill";
                      if (
                        isParentColumn &&
                        selectedElement.alignSelf === "stretch"
                      )
                        return "fill";
                      return "hug";
                    })()}
                    onChangeValue={(val) => {
                      // 値はすでに単位付き (例: "100px", "50%", "var(--xxx)")
                      // 縦横比ロック中は H も連動させる（条件は applySizeValue 参照）
                      applySizeValue("width", val, { w: member?.w, h: member?.h });
                    }}
                    onChangeMode={(mode) => {
                      const isParentRow =
                        isParentFlexContainer &&
                        (selectedElement.parentFlexDirection === "row" ||
                          selectedElement.parentFlexDirection ===
                            "row-reverse");

                      if (mode === "fixed") {
                        updateElementStyle({
                          width: `${Math.round(selectedElement.width)}px`,
                          flexGrow: "0",
                          alignSelf: "auto",
                          flexBasis: "auto",
                        });
                      } else if (mode === "fill") {
                        if (isParentRow) {
                          updateElementStyle({
                            width: "auto",
                            flexGrow: "1",
                            flexBasis: "0",
                            alignSelf: "auto",
                          });
                        } else {
                          updateElementStyle({
                            width: "auto",
                            alignSelf: "stretch",
                            flexGrow: "0",
                          });
                        }
                      } else if (mode === "hug") {
                        updateElementStyle({
                          width: "max-content",
                          flexGrow: "0",
                          alignSelf: "auto",
                        });
                      }
                    }}
                    label={
                      <span className="text-[10px] text-gray-500 w-3 text-center block">
                        W
                      </span>
                    }
                    dimension="width"
                    canFill={isParentFlexContainer}
                    canHug={true}
                    min={0}
                    conversionContext={conversionContext}
                  />
                    );
                  }}
                  </LiveGeom>

                  {/* Height Input（同上） */}
                  <LiveGeom>
                  {(geometry) => {
                    const member = geometry?.members.find(
                      (m) => m.id === selectedElement.id,
                    );
                    const live = selectedElement.heightAuto ? undefined : member?.h;
                    return (
                  <VariableAwareSizeInput
                    value={liveOrRaw(
                      selectedElement.rawHeight,
                      live,
                      selectedElement.height,
                    )}
                    mode={(() => {
                      if (!selectedElement.heightAuto) return "fixed";
                      const isParentRow =
                        isParentFlexContainer &&
                        (selectedElement.parentFlexDirection === "row" ||
                          selectedElement.parentFlexDirection ===
                            "row-reverse");
                      const isParentColumn =
                        isParentFlexContainer &&
                        (selectedElement.parentFlexDirection === "column" ||
                          selectedElement.parentFlexDirection ===
                            "column-reverse");

                      if (isParentColumn && selectedElement.flexGrow > 0)
                        return "fill";
                      if (
                        isParentRow &&
                        selectedElement.alignSelf === "stretch"
                      )
                        return "fill";
                      return "hug";
                    })()}
                    onChangeValue={(val) => {
                      // 値はすでに単位付き (例: "100px", "50vh", "var(--xxx)")
                      // 縦横比ロック中は W も連動させる（条件は applySizeValue 参照）
                      applySizeValue("height", val, { w: member?.w, h: member?.h });
                    }}
                    onChangeMode={(mode) => {
                      const isParentRow =
                        isParentFlexContainer &&
                        (selectedElement.parentFlexDirection === "row" ||
                          selectedElement.parentFlexDirection ===
                            "row-reverse");

                      if (mode === "fixed") {
                        updateElementStyle({
                          height: `${Math.round(selectedElement.height)}px`,
                          flexGrow: "0",
                          alignSelf: "auto",
                          flexBasis: "auto",
                        });
                      } else if (mode === "fill") {
                        if (isParentRow) {
                          updateElementStyle({
                            height: "auto",
                            alignSelf: "stretch",
                            flexGrow: "0",
                          });
                        } else {
                          // Parent Column
                          updateElementStyle({
                            height: "auto",
                            flexGrow: "1",
                            flexBasis: "0",
                            alignSelf: "auto",
                          });
                        }
                      } else if (mode === "hug") {
                        updateElementStyle({
                          height: "max-content",
                          flexGrow: "0",
                          alignSelf: "auto",
                        });
                      }
                    }}
                    label={
                      <span className="text-[10px] text-gray-500 w-3 text-center block">
                        H
                      </span>
                    }
                    dimension="height"
                    canFill={isParentFlexContainer}
                    canHug={true}
                    min={0}
                    conversionContext={conversionContext}
                  />
                    );
                  }}
                  </LiveGeom>
                </div>
              </div>

              {/* 最小・最大の幅と高さ(min-width / max-width / min-height / max-height)。
                  既定では隠し、「+ 最小・最大」で出す。値が入っている要素では最初から出す。
                  適用は W / H と同じ updateElementStyle(複数選択なら全要素に同じ値)。空にすると指定を消す */}
              {(() => {
                // 最小の 0(Tailwind の min-w-0。構成ラフに多い)は「制約なし」と見分けがつかないので、それだけでは開かない
                const hasLimit = SIZE_LIMIT_FIELDS.some((f) => {
                  const v = selectedElement[f.raw];
                  return !!v && !(f.prop.startsWith("min") && /^0(px)?$/.test(v));
                });
                const visible = hasLimit || sizeLimitsOpen;
                return (
                  <>
                    {!hasLimit && (
                      <button
                        type="button"
                        data-size-limits-toggle
                        aria-expanded={visible}
                        onClick={() => setSizeLimitsOpen((v) => !v)}
                        className="absolute right-0 top-0 text-[10px] text-gray-400 hover:text-white"
                        title="最小・最大の幅と高さ"
                      >
                        {visible ? "− 最小・最大" : "+ 最小・最大"}
                      </button>
                    )}
                    {visible && (
                      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 mt-1.5" data-size-limits>
                        {SIZE_LIMIT_FIELDS.map((f) => (
                          <VariableAwareSizeInput
                            key={f.id}
                            fieldId={f.id}
                            variant="limit"
                            value={selectedElement[f.raw] ?? ""}
                            mode="fixed"
                            onChangeMode={() => {}}
                            onChangeValue={(val) => updateElementStyle({ [f.prop]: val })}
                            label={
                              <span className="text-[10px] text-gray-500 block whitespace-nowrap" title={f.title}>
                                {f.label}
                              </span>
                            }
                            placeholder="—"
                            dimension={f.dimension}
                            min={0}
                            conversionContext={conversionContext}
                          />
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
              {/* [修復] 「サイズ」ブロックの閉じタグ。
                  縦横比ロックの追加作業が中断され、この1つが欠けていた */}
              </div>

              {/* コンテンツのクリッピング */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="content-clip"
                  checked={selectedElement.overflow === "hidden"}
                  onCheckedChange={(checked) =>
                    updateElementStyle({
                      overflow: checked ? "hidden" : "visible",
                    })
                  }
                  className="h-4 w-4"
                />
                <Label
                  htmlFor="content-clip"
                  className="text-[10px] text-gray-400 cursor-pointer"
                >
                  コンテンツを隠す
                </Label>
              </div>

              {/* パディング + マージン（十字レイアウト） */}
              <div className="flex gap-4">
                {/* パディング */}
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-[9px] text-gray-600">
                      パディング
                    </Label>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPaddingLinked(!paddingLinked)}
                      className="h-3 w-3 hover:bg-[#4a4a4a]"
                      title={paddingLinked ? "個別設定" : "リンク"}
                    >
                      {paddingLinked ? (
                        <Link2 className="w-2 h-2 text-[#4fb8ff]" />
                      ) : (
                        <Link2Off className="w-2 h-2 text-gray-500" />
                      )}
                    </Button>
                  </div>
                  {/* 十字レイアウト */}
                  <div className="flex flex-col items-center gap-0.5">
                    {/* 上 */}
                    <VariableAwareUnitInput
                      value={selectedElement.rawPaddingTop || `${Math.round(selectedElement.paddingTop)}px`}
                      onChange={(val) => {
                        if (paddingLinked) {
                          updateElementStyle({
                            paddingTop: val,
                            paddingBottom: val,
                          });
                        } else {
                          updateElementStyle({ paddingTop: val });
                        }
                      }}
                      category="spacing"
                      min={0}
                      compact
                      hideVariableLink
                      conversionContext={conversionContext}
                    />
                    {/* 左・中央・右 */}
                    <div className="flex items-center gap-0.5">
                      <VariableAwareUnitInput
                        value={selectedElement.rawPaddingLeft || `${Math.round(selectedElement.paddingLeft)}px`}
                        onChange={(val) => {
                          if (paddingLinked) {
                            updateElementStyle({
                              paddingLeft: val,
                              paddingRight: val,
                            });
                          } else {
                            updateElementStyle({ paddingLeft: val });
                          }
                        }}
                        category="spacing"
                        min={0}
                        compact
                        hideVariableLink
                        conversionContext={conversionContext}
                      />
                      <div className="w-5 h-5 bg-[#2a2a2a] rounded border border-[#444444]" />
                      <VariableAwareUnitInput
                        value={selectedElement.rawPaddingRight || `${Math.round(selectedElement.paddingRight)}px`}
                        onChange={(val) => {
                          if (paddingLinked) {
                            updateElementStyle({
                              paddingLeft: val,
                              paddingRight: val,
                            });
                          } else {
                            updateElementStyle({ paddingRight: val });
                          }
                        }}
                        category="spacing"
                        min={0}
                        compact
                        hideVariableLink
                        conversionContext={conversionContext}
                      />
                    </div>
                    {/* 下 */}
                    <VariableAwareUnitInput
                      value={selectedElement.rawPaddingBottom || `${Math.round(selectedElement.paddingBottom)}px`}
                      onChange={(val) => {
                        if (paddingLinked) {
                          updateElementStyle({
                            paddingTop: val,
                            paddingBottom: val,
                          });
                        } else {
                          updateElementStyle({ paddingBottom: val });
                        }
                      }}
                      category="spacing"
                      min={0}
                      compact
                      hideVariableLink
                      conversionContext={conversionContext}
                    />
                  </div>
                </div>

                {/* マージン */}
                <div className="flex-1">
                  <Label className="text-[9px] text-gray-600 mb-1 block">
                    マージン
                  </Label>
                  {/* 十字レイアウト */}
                  <div className="flex flex-col items-center gap-0.5">
                    {/* 上 */}
                    <VariableAwareUnitInput
                      value={selectedElement.rawMarginTop || `${Math.round(selectedElement.marginTop)}px`}
                      onChange={(val) => updateElementStyle({ marginTop: val })}
                      category="spacing"
                      compact
                      hideVariableLink
                      conversionContext={conversionContext}
                    />
                    {/* 左・中央・右 */}
                    <div className="flex items-center gap-0.5">
                      <VariableAwareUnitInput
                        value={selectedElement.rawMarginLeft || `${Math.round(selectedElement.marginLeft)}px`}
                        onChange={(val) => updateElementStyle({ marginLeft: val })}
                        category="spacing"
                        compact
                        hideVariableLink
                        conversionContext={conversionContext}
                      />
                      <div className="w-5 h-5 bg-[#2a2a2a] rounded border border-[#444444]" />
                      <VariableAwareUnitInput
                        value={selectedElement.rawMarginRight || `${Math.round(selectedElement.marginRight)}px`}
                        onChange={(val) => updateElementStyle({ marginRight: val })}
                        category="spacing"
                        compact
                        hideVariableLink
                        conversionContext={conversionContext}
                      />
                    </div>
                    {/* 下 */}
                    <VariableAwareUnitInput
                      value={selectedElement.rawMarginBottom || `${Math.round(selectedElement.marginBottom)}px`}
                      onChange={(val) => updateElementStyle({ marginBottom: val })}
                      category="spacing"
                      compact
                      hideVariableLink
                      conversionContext={conversionContext}
                    />
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* 外見セクション */}
          <Collapsible
            open={openSections.appearance}
            onOpenChange={(open) =>
              setOpenSections((prev) => ({ ...prev, appearance: open }))
            }
          >
            <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-xs font-medium text-gray-300 hover:text-white border-t border-[#444444]">
              <span className="flex items-center gap-2">
                <Circle className="w-3.5 h-3.5" />
                外見
              </span>
              <ChevronRight
                className={`w-3.5 h-3.5 transition-transform ${openSections.appearance ? "rotate-90" : ""}`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pb-3">
              {/* 不透明度 + 角丸 */}
              {/* ブレンドモード */}
              <div>
                <Label className="text-[10px] text-gray-500 mb-1 block">
                  ブレンドモード
                </Label>
                <select
                  value={selectedElement.mixBlendMode || "normal"}
                  onChange={(e) =>
                    updateElementStyle({ mixBlendMode: e.target.value })
                  }
                  className="h-7 w-full bg-[#383838] border-transparent rounded text-xs px-2 text-white focus:outline-none focus:ring-1 focus:ring-[#0d99ff] appearance-none cursor-pointer"
                >
                  <option value="normal">通常</option>
                  <option value="multiply">乗算</option>
                  <option value="screen">スクリーン</option>
                  <option value="overlay">オーバーレイ</option>
                  <option value="darken">暗く</option>
                  <option value="lighten">明るく</option>
                  <option value="color-dodge">覆い焼きカラー</option>
                  <option value="color-burn">焼き込みカラー</option>
                  <option value="hard-light">ハードライト</option>
                  <option value="soft-light">ソフトライト</option>
                  <option value="difference">差の絶対値</option>
                  <option value="exclusion">除外</option>
                  <option value="hue">色相</option>
                  <option value="saturation">彩度</option>
                  <option value="color">カラー</option>
                  <option value="luminosity">輝度</option>
                </select>
              </div>

              {/* 不透明度 + 角丸 */}
              <div className="grid grid-cols-2 gap-3 overflow-hidden">
                {/* 不透明度 */}
                <div className="min-w-0">
                  <span className="text-[10px] text-gray-500 mb-1 block">
                    不透明度
                  </span>
                  <div className="flex items-center gap-1 min-w-0">
                    <Square className="w-3 h-3 text-gray-500 flex-shrink-0" />
                    <VariableAwareInput
                      value={selectedElement.rawOpacity || Math.round(selectedElement.opacity * 100)}
                      onChange={(val) => {
                        if (val.startsWith('var(')) {
                          updateElementStyle({ opacity: val });
                        } else {
                          const num = parseFloat(val);
                          if (!isNaN(num)) {
                            updateElementStyle({
                              opacity: String(Math.max(0, Math.min(100, num)) / 100),
                            });
                          }
                        }
                      }}
                      category="other"
                      min={0}
                      max={100}
                      suffix="%"
                      compact
                      className="flex-1 min-w-0"
                    />
                  </div>
                </div>

                {/* 角丸 */}
                <div className="min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-gray-500 block">
                      角の半径
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRadiusLinked(!radiusLinked)}
                      className="h-3 w-3 hover:bg-[#4a4a4a] p-0"
                      title={radiusLinked ? "個別設定" : "リンク"}
                    >
                      {radiusLinked ? (
                        <Link2 className="w-2 h-2 text-[#4fb8ff]" />
                      ) : (
                        <Link2Off className="w-2 h-2 text-gray-500" />
                      )}
                    </Button>
                  </div>

                  {/* Linked Mode */}
                  {radiusLinked ? (
                    <div className="flex items-center gap-1 min-w-0">
                      <Circle className="w-3 h-3 text-gray-500 flex-shrink-0" />
                      <VariableAwareUnitInput
                        value={selectedElement.rawBorderRadius || `${Math.round(selectedElement.borderRadius)}px`}
                        onChange={(val) => updateElementStyle({ borderRadius: val })}
                        units={BORDER_RADIUS_UNITS}
                        defaultUnit="px"
                        category="spacing"
                        min={0}
                        compact
                        conversionContext={conversionContext}
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-1 overflow-hidden">
                      {/* Top Left */}
                      <div className="flex items-center gap-0.5 min-w-0" title="左上">
                        <div className="w-2 h-2 border-t border-l border-gray-500 rounded-tl flex-shrink-0" />
                        <VariableAwareUnitInput
                          value={selectedElement.rawBorderTopLeftRadius || `${Math.round(selectedElement.borderRadiusTopLeft || 0)}px`}
                          onChange={(val) => updateElementStyle({ borderTopLeftRadius: val })}
                          units={BORDER_RADIUS_UNITS}
                          defaultUnit="px"
                          category="spacing"
                          min={0}
                          compact
                          hideVariableLink
                          conversionContext={conversionContext}
                        />
                      </div>
                      {/* Top Right */}
                      <div className="flex items-center gap-0.5 min-w-0" title="右上">
                        <VariableAwareUnitInput
                          value={selectedElement.rawBorderTopRightRadius || `${Math.round(selectedElement.borderRadiusTopRight || 0)}px`}
                          onChange={(val) => updateElementStyle({ borderTopRightRadius: val })}
                          units={BORDER_RADIUS_UNITS}
                          defaultUnit="px"
                          category="spacing"
                          min={0}
                          compact
                          hideVariableLink
                          conversionContext={conversionContext}
                        />
                        <div className="w-2 h-2 border-t border-r border-gray-500 rounded-tr flex-shrink-0" />
                      </div>
                      {/* Bottom Left */}
                      <div className="flex items-center gap-0.5 min-w-0" title="左下">
                        <div className="w-2 h-2 border-b border-l border-gray-500 rounded-bl flex-shrink-0" />
                        <VariableAwareUnitInput
                          value={selectedElement.rawBorderBottomLeftRadius || `${Math.round(selectedElement.borderRadiusBottomLeft || 0)}px`}
                          onChange={(val) => updateElementStyle({ borderBottomLeftRadius: val })}
                          units={BORDER_RADIUS_UNITS}
                          defaultUnit="px"
                          category="spacing"
                          min={0}
                          compact
                          hideVariableLink
                          conversionContext={conversionContext}
                        />
                      </div>
                      {/* Bottom Right */}
                      <div className="flex items-center gap-0.5 min-w-0" title="右下">
                        <VariableAwareUnitInput
                          value={selectedElement.rawBorderBottomRightRadius || `${Math.round(selectedElement.borderRadiusBottomRight || 0)}px`}
                          onChange={(val) => updateElementStyle({ borderBottomRightRadius: val })}
                          units={BORDER_RADIUS_UNITS}
                          defaultUnit="px"
                          category="spacing"
                          min={0}
                          compact
                          hideVariableLink
                          conversionContext={conversionContext}
                        />
                        <div className="w-2 h-2 border-b border-r border-gray-500 rounded-br flex-shrink-0" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* テキストセクション（テキスト関連タグまたは直接テキストを持つ要素のみ表示） */}
          {shouldShowTypographySection(selectedElement) && (
            <Collapsible
              open={openSections.typography}
              onOpenChange={(open) =>
                setOpenSections((prev) => ({ ...prev, typography: open }))
              }
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-xs font-medium text-gray-300 hover:text-white border-t border-[#444444]">
                <span className="flex items-center gap-2">
                  <Type className="w-3.5 h-3.5" />
                  テキスト
                </span>
                <ChevronRight
                  className={`w-3.5 h-3.5 transition-transform ${openSections.typography ? "rotate-90" : ""}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 pb-3">
                <div>
                  <Label className="text-[10px] text-gray-500">フォント</Label>
                  <GoogleFontPicker
                    value={selectedElement.fontFamily}
                    onChange={(value) =>
                      updateElementStyle({ fontFamily: value })
                    }
                    iframeDoc={iframeRef.current?.contentDocument || null}
                    className="w-full"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px] text-gray-500">
                      ウェイト
                    </Label>
                    <Select
                      value={selectedElement.fontWeight}
                      onValueChange={(value) =>
                        updateElementStyle({ fontWeight: value })
                      }
                    >
                      <SelectTrigger className="h-7 text-xs bg-[#383838] border-[#444444] text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FONT_WEIGHTS.map((w) => (
                          <SelectItem key={w.value} value={w.value}>
                            {w.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-500 mb-1 block">
                      サイズ
                    </span>
                    <VariableAwareUnitInput
                      value={selectedElement.rawFontSize || `${Math.round(selectedElement.fontSize)}px`}
                      onChange={(val) => updateElementStyle({ fontSize: val })}
                      units={FONT_SIZE_UNITS}
                      defaultUnit="px"
                      category="typography"
                      min={1}
                      compact
                      conversionContext={conversionContext}
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] text-gray-500">配置</Label>
                  <div className="flex gap-1 mt-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => updateElementStyle({ textAlign: "left" })}
                      className={`h-7 w-7 text-gray-400 ${selectedElement.textAlign === "left" ? "bg-[#0d99ff] text-white" : "hover:bg-[#4a4a4a] hover:text-white"}`}
                    >
                      <AlignLeft className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        updateElementStyle({ textAlign: "center" })
                      }
                      className={`h-7 w-7 text-gray-400 ${selectedElement.textAlign === "center" ? "bg-[#0d99ff] text-white" : "hover:bg-[#4a4a4a] hover:text-white"}`}
                    >
                      <AlignCenter className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => updateElementStyle({ textAlign: "right" })}
                      className={`h-7 w-7 text-gray-400 ${selectedElement.textAlign === "right" ? "bg-[#0d99ff] text-white" : "hover:bg-[#4a4a4a] hover:text-white"}`}
                    >
                      <AlignRight className="w-3.5 h-3.5" />
                    </Button>
                    <div className="w-px h-7 bg-[#444444] mx-1" />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        updateElementStyle({
                          fontWeight:
                            selectedElement.fontWeight === "700"
                              ? "400"
                              : "700",
                        })
                      }
                      className={`h-7 w-7 text-gray-400 ${selectedElement.fontWeight === "700" ? "bg-[#0d99ff] text-white" : "hover:bg-[#4a4a4a] hover:text-white"}`}
                    >
                      <Bold className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        updateElementStyle({
                          fontStyle:
                            selectedElement.fontStyle === "italic"
                              ? "normal"
                              : "italic",
                        })
                      }
                      className={`h-7 w-7 text-gray-400 ${selectedElement.fontStyle === "italic" ? "bg-[#0d99ff] text-white" : "hover:bg-[#4a4a4a] hover:text-white"}`}
                    >
                      <Italic className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        updateElementStyle({
                          textDecoration:
                            selectedElement.textDecoration?.includes(
                              "underline",
                            )
                              ? "none"
                              : "underline",
                        })
                      }
                      className={`h-7 w-7 text-gray-400 ${selectedElement.textDecoration?.includes("underline") ? "bg-[#0d99ff] text-white" : "hover:bg-[#4a4a4a] hover:text-white"}`}
                    >
                      <Underline className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <span className="text-[10px] text-gray-500 mb-1 block">
                        行間
                      </span>
                      <VariableAwareUnitInput
                        value={selectedElement.rawLineHeight || (() => {
                          const lh = selectedElement.lineHeight;
                          if (!lh || lh === "normal") return "1.5";
                          // Already has unit or is unitless number
                          return lh;
                        })()}
                        onChange={(val) => updateElementStyle({ lineHeight: val })}
                        units={LINE_HEIGHT_UNITS}
                        defaultUnit=""
                        category="typography"
                        min={0}
                        step={0.1}
                        compact
                        hideVariableLink
                        conversionContext={conversionContext}
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-500 mb-1 block">
                        文字間
                      </span>
                      <VariableAwareUnitInput
                        value={selectedElement.rawLetterSpacing || (() => {
                          const ls = selectedElement.letterSpacing;
                          if (!ls || ls === "normal") return "0em";
                          return ls;
                        })()}
                        onChange={(val) => updateElementStyle({ letterSpacing: val })}
                        units={LETTER_SPACING_UNITS}
                        defaultUnit="em"
                        category="typography"
                        step={0.01}
                        compact
                        hideVariableLink
                        conversionContext={conversionContext}
                      />
                    </div>
                  </div>
                </div>
                <FigmaColorPicker
                  label="文字色"
                  value={parseCssToFillConfig(
                    selectedElement.color,
                    undefined,
                    undefined,
                    selectedElement.rawColor,
                  )}
                  onChange={(config) => {
                    if (config.type === "solid" && config.color) {
                      const opacity = config.opacity ?? 100;
                      if (opacity < 100) {
                        const r = parseInt(config.color.slice(1, 3), 16);
                        const g = parseInt(config.color.slice(3, 5), 16);
                        const b = parseInt(config.color.slice(5, 7), 16);
                        updateElementStyle({
                          color: `rgba(${r}, ${g}, ${b}, ${opacity / 100})`,
                        });
                      } else {
                        updateElementStyle({ color: config.color });
                      }
                    }
                  }}
                  onVariableSelect={(varRef) => {
                    updateElementStyle({ color: varRef });
                  }}
                  presetColors={colorPresets}
                  showImageTab={false}
                  showVariablesTab={true}
                  onClose={restoreFocus}
                />
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* [移植時の追加] 画像差し替え(<img>の場合のみ表示) */}
          {selectedElement.tagName?.toUpperCase() === 'IMG' && (
            <ImgSrcSection
              selectedElement={selectedElement}
              open={openSections.link}
              onOpenChange={(open) =>
                setOpenSections((prev) => ({ ...prev, link: open }))
              }
              onAttributeChange={updateElementAttribute}
              currentSrc={selectedElement.imageSrc || ''}
            />
          )}

          {/* リンクセクション（<a>タグの場合のみ表示） */}
          {selectedElement.isLink && (
            <LinkSection
              selectedElement={selectedElement}
              open={openSections.link}
              onOpenChange={(open) =>
                setOpenSections((prev) => ({ ...prev, link: open }))
              }
              onAttributeChange={updateLinkAttribute}
            />
          )}

          {/* 塗りセクション */}
          <Collapsible
            open={openSections.fill}
            onOpenChange={(open) =>
              setOpenSections((prev) => ({ ...prev, fill: open }))
            }
          >
            <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-xs font-medium text-gray-300 hover:text-white border-t border-[#444444]">
              <span className="flex items-center gap-2">
                <Palette className="w-3.5 h-3.5" />
                塗り
              </span>
              <ChevronRight
                className={`w-3.5 h-3.5 transition-transform ${openSections.fill ? "rotate-90" : ""}`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pb-3">
              <FigmaColorPicker
                label="背景"
                value={backgroundFillConfig}
                onChange={handleBackgroundFillChange}
                onVariableSelect={(varRef) => {
                  updateElementStyle({
                    backgroundColor: varRef,
                    backgroundImage: "none",
                  });
                }}
                presetColors={colorPresets}
                showImageTab={true}
                showVariablesTab={true}
                onClose={restoreFocus}
              />
            </CollapsibleContent>
          </Collapsible>

          {/* 線セクション */}
          <Collapsible
            open={openSections.stroke}
            onOpenChange={(open) =>
              setOpenSections((prev) => ({ ...prev, stroke: open }))
            }
          >
            <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-xs font-medium text-gray-300 hover:text-white border-t border-[#444444]">
              <span className="flex items-center gap-2">
                <Circle className="w-3.5 h-3.5" />線
              </span>
              <ChevronRight
                className={`w-3.5 h-3.5 transition-transform ${openSections.stroke ? "rotate-90" : ""}`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pb-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-gray-500 mb-1 block">
                    線幅
                  </span>
                  <VariableAwareUnitInput
                    value={selectedElement.rawBorderWidth || `${Math.round(selectedElement.borderWidth)}px`}
                    onChange={(val) => {
                      // border-style が none の場合は solid に変更
                      const needsStyleChange = selectedElement.borderStyle === "none" &&
                        !val.startsWith('var(') && parseFloat(val) > 0;
                      updateElementStyle({
                        borderWidth: val,
                        ...(needsStyleChange ? { borderStyle: "solid" } : {}),
                      });
                    }}
                    units={BORDER_WIDTH_UNITS}
                    defaultUnit="px"
                    category="spacing"
                    min={0}
                    compact
                    conversionContext={conversionContext}
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-gray-500">スタイル</Label>
                  <Select
                    value={selectedElement.borderStyle}
                    onValueChange={(value) =>
                      updateElementStyle({ borderStyle: value })
                    }
                  >
                    <SelectTrigger className="h-7 text-xs bg-[#383838] border-[#444444] text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">なし</SelectItem>
                      <SelectItem value="solid">実線</SelectItem>
                      <SelectItem value="dashed">破線</SelectItem>
                      <SelectItem value="dotted">点線</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <FigmaColorPicker
                label="線色"
                value={parseCssToFillConfig(
                  selectedElement.borderColor,
                  undefined,
                  undefined,
                  selectedElement.rawBorderColor,
                )}
                onChange={(config) => {
                  if (config.type === "solid" && config.color) {
                    updateElementStyle({
                      borderColor: config.color,
                      borderStyle:
                        selectedElement.borderStyle === "none"
                          ? "solid"
                          : selectedElement.borderStyle,
                    });
                  } else if (config.type === "none") {
                    updateElementStyle({ borderStyle: "none" });
                  }
                }}
                onVariableSelect={(varRef) => {
                  updateElementStyle({
                    borderColor: varRef,
                    borderStyle:
                      selectedElement.borderStyle === "none"
                        ? "solid"
                        : selectedElement.borderStyle,
                  });
                }}
                presetColors={colorPresets}
                showImageTab={false}
                showVariablesTab={true}
                onClose={restoreFocus}
              />
            </CollapsibleContent>
          </Collapsible>

          {/* エフェクトセクション */}
          <Collapsible
            open={openSections.effects}
            onOpenChange={(open) =>
              setOpenSections((prev) => ({ ...prev, effects: open }))
            }
          >
            <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-xs font-medium text-gray-300 hover:text-white border-t border-[#444444]">
              <span className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5" />
                エフェクト
              </span>
              <ChevronRight
                className={`w-3.5 h-3.5 transition-transform ${openSections.effects ? "rotate-90" : ""}`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pb-3">
              {/* ドロップシャドウ */}
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] text-gray-500">
                    ドロップシャドウ
                  </Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (selectedElement.hasShadow) {
                        updateElementStyle({ boxShadow: "none" });
                      } else {
                        updateElementStyle({
                          boxShadow: "rgba(0, 0, 0, 0.25) 4px 4px 10px 0px",
                        });
                      }
                    }}
                    className="h-5 text-[10px] text-gray-400 hover:text-white"
                  >
                    {selectedElement.hasShadow ? "削除" : "追加"}
                  </Button>
                </div>
                {selectedElement.hasShadow && (
                  <div className="space-y-2 mt-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <ScrubbableLabel
                          value={selectedElement.shadowX}
                          onChange={(val) => {
                            updateElementStyle({
                              boxShadow: `${selectedElement.shadowColor} ${Math.round(val)}px ${selectedElement.shadowY}px ${selectedElement.shadowBlur}px ${selectedElement.shadowSpread}px`,
                            });
                          }}
                          className="text-[10px] text-gray-500 mb-1 block"
                        >
                          X
                        </ScrubbableLabel>
                        <CompactNumberInput
                          value={selectedElement.shadowX}
                          onChange={(val) => {
                            updateElementStyle({
                              boxShadow: `${selectedElement.shadowColor} ${val}px ${selectedElement.shadowY}px ${selectedElement.shadowBlur}px ${selectedElement.shadowSpread}px`,
                            });
                          }}
                          className="h-7 bg-[#383838] border-[#444444]"
                        />
                      </div>
                      <div>
                        <ScrubbableLabel
                          value={selectedElement.shadowY}
                          onChange={(val) => {
                            updateElementStyle({
                              boxShadow: `${selectedElement.shadowColor} ${selectedElement.shadowX}px ${Math.round(val)}px ${selectedElement.shadowBlur}px ${selectedElement.shadowSpread}px`,
                            });
                          }}
                          className="text-[10px] text-gray-500 mb-1 block"
                        >
                          Y
                        </ScrubbableLabel>
                        <CompactNumberInput
                          value={selectedElement.shadowY}
                          onChange={(val) => {
                            updateElementStyle({
                              boxShadow: `${selectedElement.shadowColor} ${selectedElement.shadowX}px ${val}px ${selectedElement.shadowBlur}px ${selectedElement.shadowSpread}px`,
                            });
                          }}
                          className="h-7 bg-[#383838] border-[#444444]"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <ScrubbableLabel
                          value={selectedElement.shadowBlur}
                          onChange={(val) => {
                            updateElementStyle({
                              boxShadow: `${selectedElement.shadowColor} ${selectedElement.shadowX}px ${selectedElement.shadowY}px ${Math.max(0, Math.round(val))}px ${selectedElement.shadowSpread}px`,
                            });
                          }}
                          className="text-[10px] text-gray-500 mb-1 block"
                        >
                          ぼかし
                        </ScrubbableLabel>
                        <CompactNumberInput
                          value={selectedElement.shadowBlur}
                          onChange={(val) => {
                            updateElementStyle({
                              boxShadow: `${selectedElement.shadowColor} ${selectedElement.shadowX}px ${selectedElement.shadowY}px ${val}px ${selectedElement.shadowSpread}px`,
                            });
                          }}
                          min={0}
                          className="h-7 bg-[#383838] border-[#444444]"
                        />
                      </div>
                      <div>
                        <ScrubbableLabel
                          value={selectedElement.shadowSpread}
                          onChange={(val) => {
                            updateElementStyle({
                              boxShadow: `${selectedElement.shadowColor} ${selectedElement.shadowX}px ${selectedElement.shadowY}px ${selectedElement.shadowBlur}px ${Math.round(val)}px`,
                            });
                          }}
                          className="text-[10px] text-gray-500 mb-1 block"
                        >
                          広がり
                        </ScrubbableLabel>
                        <CompactNumberInput
                          value={selectedElement.shadowSpread}
                          onChange={(val) => {
                            updateElementStyle({
                              boxShadow: `${selectedElement.shadowColor} ${selectedElement.shadowX}px ${selectedElement.shadowY}px ${selectedElement.shadowBlur}px ${val}px`,
                            });
                          }}
                          min={0}
                          className="h-7 bg-[#383838] border-[#444444]"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ブラー */}
              <div className="border-t border-[#444444] pt-2">
                <ScrubbableLabel
                  value={selectedElement.filterBlur}
                  onChange={(val) => {
                    updateElementStyle({
                      filter: buildFilterString({
                        blur: Math.max(0, Math.round(val)),
                        brightness: selectedElement.filterBrightness,
                        contrast: selectedElement.filterContrast,
                        grayscale: selectedElement.filterGrayscale,
                        saturate: selectedElement.filterSaturate,
                        sepia: selectedElement.filterSepia,
                        hueRotate: selectedElement.filterHueRotate,
                        invert: selectedElement.filterInvert,
                      }),
                    });
                  }}
                  className="text-[10px] text-gray-500 mb-1 block"
                >
                  ブラー
                </ScrubbableLabel>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[selectedElement.filterBlur]}
                    onValueChange={([value]) => {
                      updateElementStyle({
                        filter: buildFilterString({
                          blur: value,
                          brightness: selectedElement.filterBrightness,
                          contrast: selectedElement.filterContrast,
                          grayscale: selectedElement.filterGrayscale,
                          saturate: selectedElement.filterSaturate,
                          sepia: selectedElement.filterSepia,
                          hueRotate: selectedElement.filterHueRotate,
                          invert: selectedElement.filterInvert,
                        }),
                      });
                    }}
                    min={0}
                    max={50}
                    step={1}
                    className="flex-1"
                  />
                  <CompactNumberInput
                    value={selectedElement.filterBlur}
                    onChange={(val) => {
                      updateElementStyle({
                        filter: buildFilterString({
                          blur: val || 0,
                          brightness: selectedElement.filterBrightness,
                          contrast: selectedElement.filterContrast,
                          grayscale: selectedElement.filterGrayscale,
                          saturate: selectedElement.filterSaturate,
                          sepia: selectedElement.filterSepia,
                          hueRotate: selectedElement.filterHueRotate,
                          invert: selectedElement.filterInvert,
                        }),
                      });
                    }}
                    min={0}
                    max={50}
                    className="w-14 h-7 border-[#444444]"
                  />
                </div>
              </div>

              {/* バックドロップブラー */}
              <div>
                <ScrubbableLabel
                  value={selectedElement.backdropBlur}
                  onChange={(val) => {
                    const value = Math.max(0, Math.round(val));
                    updateElementStyle({
                      backdropFilter: value > 0 ? `blur(${value}px)` : "none",
                      WebkitBackdropFilter:
                        value > 0 ? `blur(${value}px)` : "none",
                    });
                  }}
                  className="text-[10px] text-gray-500 mb-1 block"
                >
                  バックドロップブラー
                </ScrubbableLabel>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[selectedElement.backdropBlur]}
                    onValueChange={([value]) => {
                      updateElementStyle({
                        backdropFilter: value > 0 ? `blur(${value}px)` : "none",
                        WebkitBackdropFilter:
                          value > 0 ? `blur(${value}px)` : "none",
                      });
                    }}
                    min={0}
                    max={50}
                    step={1}
                    className="flex-1"
                  />
                  <CompactNumberInput
                    value={selectedElement.backdropBlur}
                    onChange={(val) => {
                      const value = val || 0;
                      updateElementStyle({
                        backdropFilter: value > 0 ? `blur(${value}px)` : "none",
                        WebkitBackdropFilter:
                          value > 0 ? `blur(${value}px)` : "none",
                      });
                    }}
                    min={0}
                    max={50}
                    className="w-14 h-7 border-[#444444]"
                  />
                </div>
              </div>

              {/* 明度 */}
              <div>
                <ScrubbableLabel
                  value={selectedElement.filterBrightness}
                  onChange={(val) => {
                    updateElementStyle({
                      filter: buildFilterString({
                        blur: selectedElement.filterBlur,
                        brightness: Math.max(0, Math.min(200, Math.round(val))),
                        contrast: selectedElement.filterContrast,
                        grayscale: selectedElement.filterGrayscale,
                        saturate: selectedElement.filterSaturate,
                        sepia: selectedElement.filterSepia,
                        hueRotate: selectedElement.filterHueRotate,
                        invert: selectedElement.filterInvert,
                      }),
                    });
                  }}
                  className="text-[10px] text-gray-500 mb-1 block"
                >
                  明度
                </ScrubbableLabel>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[selectedElement.filterBrightness]}
                    onValueChange={([value]) => {
                      updateElementStyle({
                        filter: buildFilterString({
                          blur: selectedElement.filterBlur,
                          brightness: value,
                          contrast: selectedElement.filterContrast,
                          grayscale: selectedElement.filterGrayscale,
                          saturate: selectedElement.filterSaturate,
                          sepia: selectedElement.filterSepia,
                          hueRotate: selectedElement.filterHueRotate,
                          invert: selectedElement.filterInvert,
                        }),
                      });
                    }}
                    min={0}
                    max={200}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-xs text-gray-400 w-10">
                    {selectedElement.filterBrightness}%
                  </span>
                </div>
              </div>

              {/* コントラスト */}
              <div>
                <ScrubbableLabel
                  value={selectedElement.filterContrast}
                  onChange={(val) => {
                    updateElementStyle({
                      filter: buildFilterString({
                        blur: selectedElement.filterBlur,
                        brightness: selectedElement.filterBrightness,
                        contrast: Math.max(0, Math.min(200, Math.round(val))),
                        grayscale: selectedElement.filterGrayscale,
                        saturate: selectedElement.filterSaturate,
                        sepia: selectedElement.filterSepia,
                        hueRotate: selectedElement.filterHueRotate,
                        invert: selectedElement.filterInvert,
                      }),
                    });
                  }}
                  className="text-[10px] text-gray-500 mb-1 block"
                >
                  コントラスト
                </ScrubbableLabel>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[selectedElement.filterContrast]}
                    onValueChange={([value]) => {
                      updateElementStyle({
                        filter: buildFilterString({
                          blur: selectedElement.filterBlur,
                          brightness: selectedElement.filterBrightness,
                          contrast: value,
                          grayscale: selectedElement.filterGrayscale,
                          saturate: selectedElement.filterSaturate,
                          sepia: selectedElement.filterSepia,
                          hueRotate: selectedElement.filterHueRotate,
                          invert: selectedElement.filterInvert,
                        }),
                      });
                    }}
                    min={0}
                    max={200}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-xs text-gray-400 w-10">
                    {selectedElement.filterContrast}%
                  </span>
                </div>
              </div>

              {/* 彩度 */}
              <div>
                <ScrubbableLabel
                  value={selectedElement.filterSaturate}
                  onChange={(val) => {
                    updateElementStyle({
                      filter: buildFilterString({
                        blur: selectedElement.filterBlur,
                        brightness: selectedElement.filterBrightness,
                        contrast: selectedElement.filterContrast,
                        grayscale: selectedElement.filterGrayscale,
                        saturate: Math.max(0, Math.min(200, Math.round(val))),
                        sepia: selectedElement.filterSepia,
                        hueRotate: selectedElement.filterHueRotate,
                        invert: selectedElement.filterInvert,
                      }),
                    });
                  }}
                  className="text-[10px] text-gray-500 mb-1 block"
                >
                  彩度
                </ScrubbableLabel>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[selectedElement.filterSaturate]}
                    onValueChange={([value]) => {
                      updateElementStyle({
                        filter: buildFilterString({
                          blur: selectedElement.filterBlur,
                          brightness: selectedElement.filterBrightness,
                          contrast: selectedElement.filterContrast,
                          grayscale: selectedElement.filterGrayscale,
                          saturate: value,
                          sepia: selectedElement.filterSepia,
                          hueRotate: selectedElement.filterHueRotate,
                          invert: selectedElement.filterInvert,
                        }),
                      });
                    }}
                    min={0}
                    max={200}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-xs text-gray-400 w-10">
                    {selectedElement.filterSaturate}%
                  </span>
                </div>
              </div>

              {/* グレースケール */}
              <div>
                <ScrubbableLabel
                  value={selectedElement.filterGrayscale}
                  onChange={(val) => {
                    updateElementStyle({
                      filter: buildFilterString({
                        blur: selectedElement.filterBlur,
                        brightness: selectedElement.filterBrightness,
                        contrast: selectedElement.filterContrast,
                        grayscale: Math.max(0, Math.min(100, Math.round(val))),
                        saturate: selectedElement.filterSaturate,
                        sepia: selectedElement.filterSepia,
                        hueRotate: selectedElement.filterHueRotate,
                        invert: selectedElement.filterInvert,
                      }),
                    });
                  }}
                  className="text-[10px] text-gray-500 mb-1 block"
                >
                  グレースケール
                </ScrubbableLabel>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[selectedElement.filterGrayscale]}
                    onValueChange={([value]) => {
                      updateElementStyle({
                        filter: buildFilterString({
                          blur: selectedElement.filterBlur,
                          brightness: selectedElement.filterBrightness,
                          contrast: selectedElement.filterContrast,
                          grayscale: value,
                          saturate: selectedElement.filterSaturate,
                          sepia: selectedElement.filterSepia,
                          hueRotate: selectedElement.filterHueRotate,
                          invert: selectedElement.filterInvert,
                        }),
                      });
                    }}
                    min={0}
                    max={100}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-xs text-gray-400 w-10">
                    {selectedElement.filterGrayscale}%
                  </span>
                </div>
              </div>

              {/* セピア */}
              <div>
                <ScrubbableLabel
                  value={selectedElement.filterSepia}
                  onChange={(val) => {
                    updateElementStyle({
                      filter: buildFilterString({
                        blur: selectedElement.filterBlur,
                        brightness: selectedElement.filterBrightness,
                        contrast: selectedElement.filterContrast,
                        grayscale: selectedElement.filterGrayscale,
                        saturate: selectedElement.filterSaturate,
                        sepia: Math.max(0, Math.min(100, Math.round(val))),
                        hueRotate: selectedElement.filterHueRotate,
                        invert: selectedElement.filterInvert,
                      }),
                    });
                  }}
                  className="text-[10px] text-gray-500 mb-1 block"
                >
                  セピア
                </ScrubbableLabel>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[selectedElement.filterSepia]}
                    onValueChange={([value]) => {
                      updateElementStyle({
                        filter: buildFilterString({
                          blur: selectedElement.filterBlur,
                          brightness: selectedElement.filterBrightness,
                          contrast: selectedElement.filterContrast,
                          grayscale: selectedElement.filterGrayscale,
                          saturate: selectedElement.filterSaturate,
                          sepia: value,
                          hueRotate: selectedElement.filterHueRotate,
                          invert: selectedElement.filterInvert,
                        }),
                      });
                    }}
                    min={0}
                    max={100}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-xs text-gray-400 w-10">
                    {selectedElement.filterSepia}%
                  </span>
                </div>
              </div>

              {/* 色相回転 */}
              <div>
                <ScrubbableLabel
                  value={selectedElement.filterHueRotate}
                  onChange={(val) => {
                    updateElementStyle({
                      filter: buildFilterString({
                        blur: selectedElement.filterBlur,
                        brightness: selectedElement.filterBrightness,
                        contrast: selectedElement.filterContrast,
                        grayscale: selectedElement.filterGrayscale,
                        saturate: selectedElement.filterSaturate,
                        sepia: selectedElement.filterSepia,
                        hueRotate: Math.round(val) % 360,
                        invert: selectedElement.filterInvert,
                      }),
                    });
                  }}
                  className="text-[10px] text-gray-500 mb-1 block"
                >
                  色相回転
                </ScrubbableLabel>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[selectedElement.filterHueRotate]}
                    onValueChange={([value]) => {
                      updateElementStyle({
                        filter: buildFilterString({
                          blur: selectedElement.filterBlur,
                          brightness: selectedElement.filterBrightness,
                          contrast: selectedElement.filterContrast,
                          grayscale: selectedElement.filterGrayscale,
                          saturate: selectedElement.filterSaturate,
                          sepia: selectedElement.filterSepia,
                          hueRotate: value,
                          invert: selectedElement.filterInvert,
                        }),
                      });
                    }}
                    min={0}
                    max={360}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-xs text-gray-400 w-10">
                    {selectedElement.filterHueRotate}°
                  </span>
                </div>
              </div>

              {/* 反転 */}
              <div>
                <ScrubbableLabel
                  value={selectedElement.filterInvert}
                  onChange={(val) => {
                    updateElementStyle({
                      filter: buildFilterString({
                        blur: selectedElement.filterBlur,
                        brightness: selectedElement.filterBrightness,
                        contrast: selectedElement.filterContrast,
                        grayscale: selectedElement.filterGrayscale,
                        saturate: selectedElement.filterSaturate,
                        sepia: selectedElement.filterSepia,
                        hueRotate: selectedElement.filterHueRotate,
                        invert: Math.max(0, Math.min(100, Math.round(val))),
                      }),
                    });
                  }}
                  className="text-[10px] text-gray-500 mb-1 block"
                >
                  反転
                </ScrubbableLabel>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[selectedElement.filterInvert]}
                    onValueChange={([value]) => {
                      updateElementStyle({
                        filter: buildFilterString({
                          blur: selectedElement.filterBlur,
                          brightness: selectedElement.filterBrightness,
                          contrast: selectedElement.filterContrast,
                          grayscale: selectedElement.filterGrayscale,
                          saturate: selectedElement.filterSaturate,
                          sepia: selectedElement.filterSepia,
                          hueRotate: selectedElement.filterHueRotate,
                          invert: value,
                        }),
                      });
                    }}
                    min={0}
                    max={100}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-xs text-gray-400 w-10">
                    {selectedElement.filterInvert}%
                  </span>
                </div>
              </div>

              {/* エフェクトリセットボタン */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  updateElementStyle({
                    filter: "none",
                    backdropFilter: "none",
                    WebkitBackdropFilter: "none",
                  });
                }}
                className="w-full h-6 text-[10px] text-gray-400 hover:text-white hover:bg-[#4a4a4a]"
              >
                エフェクトをリセット
              </Button>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>
    </div>
    </LiveGeometryProvider>
  );
});
