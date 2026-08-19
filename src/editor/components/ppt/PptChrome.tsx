"use client";

/**
 * PowerPoint風UIのクローム。macOS版PowerPointの構造に合わせた3段構成:
 *   1段目 タイトルバー … 自動保存ピル・保存・元に戻す/やり直し・中央にファイル名・検索
 *   2段目 タブ帯       … ホーム/挿入/描画/…/表示 + 右端に共有(オレンジ)=書き出し
 *   3段目 リボン       … タブごとのコントロール群(縦罫線で区切るmac流。グループ名は出さない)
 * 左はスライドサムネイル、下はステータスバー(ズームスライダー)。
 * ライト/ダークの両テーマ(初期値はOS設定に追従、切替は記憶)。
 *
 * 【設計の約束】ここは**見た目の殻だけ**。編集エンジン(EditorCanvasのiframe・
 * 選択・ドラッグ・保存・原本TSXへの書き戻し)はFigma風UIと完全に共通。
 * エンジンに新しい操作を足すときはFigma風UI側に実装し、ここからは参照する。
 * 実機に無い独自ボタンを足さない。実機にあるが未対応の機能はタブごと無効表示にする。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PEN_PRESETS, inkStyle, setInkPreset, setInkColor } from '../../utils/ink-style';
import { generateElementId, updateSelectionBox } from '../../utils/dom-utils';
import { alignElements, distributeElements, type AlignMode, type DistributeAxis } from '../../utils/align-elements';
import { isEyeDropperSupported, pickScreenColor } from '../../utils/eyedropper';
import { applyTextHighlight, applyTextColor } from '../../utils/text-highlight';
import { SHAPE_GROUPS, setPendingShape, pendingShape, shapeStyles, type ShapeDef } from '../../utils/shape-library';
import { applyShadowPreset, paintTarget } from '../../utils/element-effects';
import {
  Undo2, Redo2, Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight,
  Type, Square, Circle, Minus, MoveUpRight, Image as ImageIcon, LayoutGrid,
  Boxes, Trash2, Copy, X, Save, PenTool, Loader2, ZoomIn, ZoomOut, Maximize,
  Search, Sun, Moon, ChevronDown, Plus, MousePointer2, Pencil, Play,
  Palette, Sparkles, EyeOff, ArrowUp, ArrowDown, Film,
  MessageSquare, ChevronLeft, ChevronRight, Crop, Monitor, MonitorUp,
  PaintBucket, PenLine, Eraser, Highlighter, Table, Shapes, Sticker, Wand2,
  AArrowUp, AArrowDown, RemoveFormatting, Strikethrough, Superscript, Subscript,
  List, ListOrdered, IndentIncrease, IndentDecrease, AlignJustify, Baseline, RotateCw,
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround, Pipette,
} from 'lucide-react';
import { useEditorContext } from '../../EditorContext';
import { flushAutoSave } from '../../autosave';
import { useDeck, refreshDeck } from '../../../components/viewer/useDeck';
import { moveSlide, deleteSlide, duplicateSlide, updateSlideMeta } from '../../../lib/deck';
import { startCleanup } from '../../../components/SaveNote';
import { unresolvedCount } from './PptComments';
import { enterCropMode, type CropSession } from '../../utils/crop-mode';
import { useGoogleFonts } from '../../hooks/useGoogleFonts';
import { DeckSlideRender } from '../../../components/DeckSlideRender';
import { PptDesignProposals } from './PptDesignProposals';
import { EditorTopBar } from '../shell/EditorTopBar';

/**
 * サムネイルのスライド描画はメモ化する。ズームのコミット等で親が再レンダーしても、
 * (page, template, edited) が同じ150枚のReactツリーを組み直さないため
 */
const MemoSlideRender = memo(DeckSlideRender);
import type { EditorTool } from '../../../types/editor';

export type PptTheme = 'light' | 'dark';

/** OS設定に追従した初期テーマ(切替後はlocalStorageを優先) */
export function initialPptTheme(): PptTheme {
  try {
    const saved = localStorage.getItem('gg-editor:ppt-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* 記憶が読めなくても続行 */ }
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/** FVE(FrontendVisualEditor)のスコープから借りる操作群 */
export type PptActions = {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  deleteElement?: () => void;
  duplicateElement?: () => void;
  bringToFront?: () => void;
  bringForward?: () => void;
  sendBackward?: () => void;
  sendToBack?: () => void;
  groupElements?: () => void;
  ungroupElements?: () => void;
  openFilePicker: () => void;
  openMediaLibrary: () => void;
  openComponents: () => void;
  openVariables: () => void;
  activeTool: EditorTool;
  setActiveTool: (t: EditorTool) => void;
  /** 右ペイン「図の書式設定」の開閉 */
  toggleFormatPane?: () => void;
  formatPaneOpen?: boolean;
};

/* ============================ テーマ ============================ */

const PPT_ACCENT = '#ED6C47'; // PowerPointのブランド橙赤(選択枠・タブ下線)

type Palette = {
  chrome: string; text: string; sub: string; border: string;
  hover: string; activeBg: string; control: string; rail: string;
  canvas: string; disabled: string;
};

const PALETTES: Record<PptTheme, Palette> = {
  light: {
    chrome: '#f6f5f4', text: '#252423', sub: '#8a8886', border: '#e1dfdd',
    hover: '#e6e4e2', activeBg: '#dedcda', control: '#ffffff', rail: '#f0efee',
    canvas: '#e9e7e6', disabled: '#b8b6b4',
  },
  dark: {
    chrome: '#282828', text: '#e8e6e3', sub: '#9d9b99', border: '#3d3b39',
    hover: '#3a3a3a', activeBg: '#4a4a4a', control: '#333333', rail: '#222222',
    canvas: '#3f3f3f', disabled: '#5f5d5b',
  },
};

export const PPT_PALETTES = PALETTES;

/* ============================ 小物 ============================ */

/** リボンの大ボタン(アイコン上・ラベル下。実機の「新しいスライド」等の形) */
function BigButton({
  icon: Icon, label, onClick, disabled, active, title, caret, pal,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
  caret?: boolean;
  pal: Palette;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className="flex h-[64px] min-w-[52px] flex-col items-center justify-center gap-1 rounded px-2 text-[11px] leading-tight transition-colors"
      style={{
        color: disabled ? pal.disabled : pal.text,
        backgroundColor: active ? pal.activeBg : undefined,
      }}
      onMouseEnter={(e) => { if (!disabled && !active) e.currentTarget.style.backgroundColor = pal.hover; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = ''; }}
    >
      <Icon className="h-[22px] w-[22px]" />
      <span className="flex items-center gap-0.5 whitespace-pre-line text-center">
        {label}
        {caret && <ChevronDown className="h-3 w-3" />}
      </span>
    </button>
  );
}

/** リボンの小ボタン(正方形アイコン) */
function SmallButton({
  icon: Icon, onClick, disabled, active, title, pal, label, chevron,
}: {
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  title: string;
  pal: Palette;
  /** アイコン横に出すラベル(塗りつぶし等、ドロップダウンのトリガー用) */
  label?: string;
  chevron?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-6 items-center justify-center gap-1 rounded transition-colors ${label ? 'px-1.5' : 'w-6'}`}
      style={{
        color: disabled ? pal.disabled : pal.text,
        backgroundColor: active ? pal.activeBg : undefined,
      }}
      onMouseEnter={(e) => { if (!disabled && !active) e.currentTarget.style.backgroundColor = pal.hover; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = ''; }}
    >
      <Icon className="h-4 w-4" />
      {label && <span className="text-[11px]">{label}</span>}
      {chevron && <ChevronDown className="h-3 w-3" />}
    </button>
  );
}

/** 縦書きボタン用(Typeを90度回して代用) */
function TypeVertical({ className }: { className?: string }) {
  return <Type className={`${className ?? ''} rotate-90`} />;
}

/** グループ区切り(mac版はラベルなしの縦罫線) */
function Sep({ pal }: { pal: Palette }) {
  return <div className="mx-1.5 h-[56px] w-px self-center" style={{ backgroundColor: pal.border }} />;
}

/**
 * 開いているメニューを閉じる判定に使う文書。
 * リボンは親ページ、編集面はiframeの中にあり、iframe内の mousedown は親ページまで
 * 上がってこない。両方に外側クリックを張らないと、キャンバスを触っても閉じない。
 */
function listenDocs(): Document[] {
  const docs: Document[] = [document];
  for (const f of Array.from(document.querySelectorAll('iframe'))) {
    try {
      if (f.contentDocument) docs.push(f.contentDocument);
    } catch {
      /* 別オリジンのiframeは触れないので無視 */
    }
  }
  return docs;
}

/** 簡易ドロップダウン */
function Dropdown({
  trigger, items, content, pal, align = 'left',
}: {
  trigger: React.ReactNode;
  items?: { label: string; onClick?: () => void; disabled?: boolean }[];
  /** items の代わりに任意のパネルを出す(色や太さの選択UIなど) */
  content?: (close: () => void) => React.ReactNode;
  pal: Palette;
  /** 画面右端のトリガーは right にしないとメニューがはみ出す */
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 閉じるのは「外側クリック」と Esc だけ。色を選ぶたびに閉じると連続調整ができない
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const t = e.target as Node;
      // iframe内のクリックは親ページのノードを含まないので、そのまま外側扱いになる
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: Event) => {
      if ((e as KeyboardEvent).key === 'Escape') setOpen(false);
    };
    const docs = listenDocs();
    for (const d of docs) {
      d.addEventListener('mousedown', onDown);
      d.addEventListener('keydown', onKey);
    }
    return () => {
      for (const d of docs) {
        d.removeEventListener('mousedown', onDown);
        d.removeEventListener('keydown', onKey);
      }
    };
  }, [open]);

  const toggle = () => {
    if (!open && ref.current) {
      // リボン帯は overflow-x-auto でメニューがクリップされるため、
      // body直下へポータルし fixed で出す(iframeにも隠れない)
      const r = ref.current.getBoundingClientRect();
      setPos({
        left: align === 'right' ? Math.max(8, r.right - 176) : r.left,
        top: r.bottom + 4,
      });
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={ref} className="relative">
      <div onClick={toggle}>{trigger}</div>
      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            data-ppt-menu="1"
            className="fixed z-[10000] min-w-[176px] rounded-md border py-1 shadow-xl"
            style={{ left: pos.left, top: pos.top, backgroundColor: pal.control, borderColor: pal.border }}
          >
            {content && content(() => setOpen(false))}
            {(items ?? []).map((it, i) => (
              <button
                key={i}
                disabled={it.disabled}
                onClick={() => { setOpen(false); it.onClick?.(); }}
                className="block w-full px-3 py-1.5 text-left text-[12px] transition-colors"
                style={{ color: it.disabled ? pal.disabled : pal.text }}
                onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.backgroundColor = pal.hover; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
              >
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ============================ 選択要素へのスタイル適用 ============================ */

/**
 * リボンの書式ボタンが使う、選択中要素への直接スタイル適用。
 * Figma風UIの右パネルと同じ入口 notifyIframeChange() を通すので、
 * 履歴・HTML同期・保存時のdirty検出は完全に共通で効く。
 */
/** 図形本体(枠ではなく中身)へ当てるスタイル */
const PAINT_PROPS = new Set([
  'backgroundColor', 'background', 'backgroundImage', 'clipPath', 'borderRadius',
  'border', 'borderColor', 'borderWidth', 'borderStyle',
  'borderTopWidth', 'borderTopStyle', 'borderTopColor',
]);

function useSelectionStyle() {
  const { getIframeDoc, selectedElement, selectedElementIds, notifyIframeChange } =
    useEditorContext();

  const targets = useCallback((): HTMLElement[] => {
    const doc = getIframeDoc();
    if (!doc) return [];
    const ids = selectedElementIds.length
      ? selectedElementIds
      : selectedElement
        ? [selectedElement.id]
        : [];
    return ids
      .map((id) => doc.querySelector(`[data-element-id="${id}"]`) as HTMLElement | null)
      .filter((el): el is HTMLElement => !!el);
  }, [getIframeDoc, selectedElement, selectedElementIds]);

  const apply = useCallback(
    (styles: Record<string, string>) => {
      const els = targets();
      if (!els.length) return;
      for (const el of els) {
        for (const [k, v] of Object.entries(styles)) {
          // 効果用の枠が選択されている場合、塗り・枠線・切り抜きは中身の図形へ、
          // 位置や大きさは枠へ当てる(枠に塗ると矩形が出てしまうため)
          const target = PAINT_PROPS.has(k) ? paintTarget(el) : el;
          (target.style as unknown as Record<string, string>)[k] = v;
        }
      }
      notifyIframeChange();
    },
    [targets, notifyIframeChange],
  );

  const readComputed = useCallback(
    (prop: string): string => {
      const els = targets();
      if (!els.length) return '';
      const camel = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      const el = PAINT_PROPS.has(camel) ? paintTarget(els[0]) : els[0];
      const win = el.ownerDocument.defaultView;
      return win ? win.getComputedStyle(el).getPropertyValue(prop) : '';
    },
    [targets],
  );

  /** 属性の付け外し(アニメーション data-anim 等)。null で除去 */
  const applyAttr = useCallback(
    (name: string, value: string | null) => {
      const els = targets();
      if (!els.length) return;
      for (const el of els) {
        if (value === null) el.removeAttribute(name);
        else el.setAttribute(name, value);
      }
      notifyIframeChange();
    },
    [targets, notifyIframeChange],
  );

  const readAttr = useCallback(
    (name: string): string | null => {
      const els = targets();
      return els.length ? els[0].getAttribute(name) : null;
    },
    [targets],
  );

  return { apply, applyAttr, readAttr, readComputed, targets, hasSelection: targets().length > 0 };
}

/* ============================ 1段目: タイトルバー ============================ */

export function PptTitleBar({
  title, page, theme, onToggleTheme, search, onSearch, onSave, onClose, onSwitchUi, saveStatus = 'saved', actions,
}: {
  title?: string;
  /** 編集中スライドの番号(1始まり) */
  page?: number;
  theme: PptTheme;
  onToggleTheme: () => void;
  search: string;
  onSearch: (v: string) => void;
  onSave: (html: string) => Promise<void> | void;
  onClose: () => void;
  onSwitchUi: () => void;
  /**
   * 自動保存の状態。エディタ本体(FrontendVisualEditor)が算出したものを表示するだけ。
   * dirty=このあと自動保存される / saving=保存中 / saved=保存済み / error=自動保存に失敗
   */
  saveStatus?: 'saved' | 'dirty' | 'saving' | 'error';
  actions: PptActions;
}) {
  const pal = PALETTES[theme];
  const { getIframeDoc } = useEditorContext();

  // テーマに合わせてiframe内のキャンバス背景も塗り替える(中身はUI共通生成のため殻側から)
  useEffect(() => {
    let tries = 0;
    const paint = () => {
      const doc = getIframeDoc();
      const container = doc?.getElementById('canvas-container');
      if (container) {
        container.style.backgroundColor = pal.canvas;
        doc!.body.style.backgroundColor = pal.canvas;
        return true;
      }
      return false;
    };
    const timer = setInterval(() => {
      if (paint() || ++tries > 20) clearInterval(timer);
    }, 300);
    paint();
    return () => {
      clearInterval(timer);
      const doc = getIframeDoc();
      const container = doc?.getElementById('canvas-container');
      if (container) {
        container.style.backgroundColor = '#1a1a1a';
        doc!.body.style.backgroundColor = '#1a1a1a';
      }
    };
  }, [getIframeDoc, pal.canvas]);

  // 1段目の中身はFigma風UIと共通(EditorTopBar)。
  // 保存・共有・プレビュー・UI切替・閉じるの並びを両UIで揃えるため、
  // ここが持つのは PowerPoint 固有の操作(元に戻す/やり直し・検索・テーマ)だけ
  return (
    <EditorTopBar
      variant="ppt"
      palette={pal}
      title={title}
      pageNumber={page}
      saveStatus={saveStatus}
      onSave={onSave}
      onClose={onClose}
      onSwitchUi={onSwitchUi}
      leftExtra={
        <>
          <SmallButton icon={Undo2} title="元に戻す" onClick={actions.undo} disabled={!actions.canUndo} pal={pal} />
          <SmallButton icon={Redo2} title="やり直し" onClick={actions.redo} disabled={!actions.canRedo} pal={pal} />
        </>
      }
      rightExtra={
        <>
          <label
            className="flex h-6 items-center gap-1.5 rounded-md border px-2"
            style={{ borderColor: pal.border, backgroundColor: pal.control }}
          >
            <Search className="h-3 w-3" style={{ color: pal.sub }} />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="スライドを検索"
              className="w-28 bg-transparent text-[11px] outline-none"
              style={{ color: pal.text }}
            />
          </label>
          <SmallButton
            icon={theme === 'dark' ? Sun : Moon}
            title={theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
            onClick={onToggleTheme}
            pal={pal}
          />
        </>
      }
    />
  );
}

/* ============================ 2〜3段目: タブ帯+リボン ============================ */

type TabId = 'home' | 'insert' | 'draw' | 'design' | 'transition' | 'animation' | 'slideshow' | 'review' | 'view' | 'shapeformat' | 'pictureformat';

/** 図のスタイル ギャラリー(実機の「図のスタイル」相当) */
const PICTURE_STYLES: { label: string; styles: Record<string, string> }[] = [
  { label: 'なし', styles: { border: '', borderRadius: '', boxShadow: '', clipPath: '', padding: '', backgroundColor: '', WebkitBoxReflect: '', filter: '' } },
  { label: '枠線(細)', styles: { border: '1px solid var(--color-rule)', borderRadius: '', boxShadow: '', clipPath: '', padding: '', backgroundColor: '' } },
  { label: '枠線(太)', styles: { border: '8px solid var(--color-ink)', borderRadius: '', boxShadow: '', clipPath: '', padding: '', backgroundColor: '' } },
  { label: '角丸', styles: { borderRadius: '24px', border: '', boxShadow: '', clipPath: '', padding: '', backgroundColor: '' } },
  { label: '楕円', styles: { borderRadius: '50%', border: '', boxShadow: '', clipPath: '', padding: '', backgroundColor: '' } },
  { label: '影付き', styles: { filter: 'drop-shadow(0 10px 20px rgba(0,0,0,0.35))', boxShadow: '', border: '', borderRadius: '', clipPath: '', padding: '', backgroundColor: '' } },
  { label: '白枠+影', styles: { border: '', padding: '12px', backgroundColor: '#ffffff', filter: 'drop-shadow(0 10px 20px rgba(0,0,0,0.28))', boxShadow: '', borderRadius: '2px', clipPath: '' } },
  { label: '角丸+影', styles: { borderRadius: '20px', filter: 'drop-shadow(0 14px 24px rgba(0,0,0,0.3))', boxShadow: '', border: '', clipPath: '', padding: '', backgroundColor: '' } },
  { label: '反射付き', styles: { WebkitBoxReflect: 'below 4px linear-gradient(transparent 62%, rgba(255,255,255,0.45))', border: '', borderRadius: '', boxShadow: '', clipPath: '', padding: '' } },
];

/** 修整・色・アート効果(CSS filter で表現する) */
const PICTURE_FILTERS: { group: string; items: { label: string; value: string }[] }[] = [
  {
    group: '修整',
    items: [
      { label: '標準', value: '' },
      { label: '明るく +20%', value: 'brightness(1.2)' },
      { label: '暗く -20%', value: 'brightness(0.8)' },
      { label: 'コントラスト +30%', value: 'contrast(1.3)' },
      { label: 'コントラスト -30%', value: 'contrast(0.75)' },
      { label: 'くっきり', value: 'contrast(1.15) saturate(1.1)' },
    ],
  },
  {
    group: '色',
    items: [
      { label: '彩度 +40%', value: 'saturate(1.4)' },
      { label: '彩度 -40%', value: 'saturate(0.6)' },
      { label: 'グレースケール', value: 'grayscale(1)' },
      { label: 'セピア', value: 'sepia(0.75)' },
      { label: '寒色(色相 -20°)', value: 'hue-rotate(-20deg)' },
      { label: '暖色(色相 +20°)', value: 'hue-rotate(20deg)' },
    ],
  },
  {
    group: 'アート効果',
    items: [
      { label: 'ぼかし', value: 'blur(3px)' },
      { label: 'モノクロ+高コントラスト', value: 'grayscale(1) contrast(1.4)' },
      { label: '淡色(下敷き向け)', value: 'grayscale(0.4) brightness(1.15) opacity(0.85)' },
    ],
  },
];

/** 塗り・枠線のスウォッチ。デザイントークン(CSS変数)を優先し、書き戻してもトークン参照が残る */
const SWATCHES: { label: string; value: string }[] = [
  { label: '墨', value: 'var(--color-ink)' },
  { label: '墨70', value: 'var(--color-ink-70)' },
  { label: '墨45', value: 'var(--color-ink-45)' },
  { label: '罫線', value: 'var(--color-rule)' },
  { label: '地', value: 'var(--color-paper)' },
  { label: '面', value: 'var(--color-surface)' },
  { label: '白', value: '#ffffff' },
  { label: '緑', value: 'var(--color-gg-green)' },
  { label: '緑200', value: 'var(--color-gg-green-200)' },
  { label: '緑50', value: 'var(--color-gg-green-50)' },
  { label: '赤', value: 'var(--color-gg-red)' },
];

/** 挿入できるアイコン(Material Symbolsのリガチャ名 + 日本語検索語) */
const MATERIAL_ICONS: { name: string; ja: string }[] = [
  { name: 'home', ja: '家 ホーム' }, { name: 'search', ja: '検索 虫眼鏡' }, { name: 'settings', ja: '設定 歯車' },
  { name: 'favorite', ja: 'ハート お気に入り' }, { name: 'star', ja: '星 評価' }, { name: 'check_circle', ja: 'チェック 完了 OK' },
  { name: 'cancel', ja: 'バツ 中止 NG' }, { name: 'warning', ja: '警告 注意' }, { name: 'info', ja: '情報' },
  { name: 'help', ja: 'ヘルプ 質問' }, { name: 'person', ja: '人 ユーザー' }, { name: 'group', ja: '二人 チーム' },
  { name: 'groups', ja: '組織 集団 人々' }, { name: 'business_center', ja: '仕事 カバン' }, { name: 'apartment', ja: 'ビル 会社 建物' },
  { name: 'factory', ja: '工場 製造' }, { name: 'storefront', ja: '店舗 店' }, { name: 'school', ja: '学校 教育 帽子' },
  { name: 'badge', ja: '社員証 名札 採用' }, { name: 'handshake', ja: '握手 提携 契約' }, { name: 'diversity_3', ja: '多様性 チーム 輪' },
  { name: 'trending_up', ja: '上昇 グラフ 成長' }, { name: 'trending_down', ja: '下降 減少' }, { name: 'bar_chart', ja: '棒グラフ' },
  { name: 'pie_chart', ja: '円グラフ' }, { name: 'monitoring', ja: '分析 折れ線' }, { name: 'query_stats', ja: '統計 分析 虫眼鏡' },
  { name: 'payments', ja: '支払い お金 紙幣' }, { name: 'savings', ja: '貯金 豚 コスト' }, { name: 'account_balance', ja: '銀行 行政 神殿' },
  { name: 'shopping_cart', ja: 'カート 購入 EC' }, { name: 'sell', ja: '値札 販売 タグ' }, { name: 'campaign', ja: 'メガホン 宣伝 広報' },
  { name: 'lightbulb', ja: '電球 アイデア' }, { name: 'rocket_launch', ja: 'ロケット 立ち上げ 開始' }, { name: 'flag', ja: '旗 目標 ゴール' },
  { name: 'verified', ja: '認証 保証 バッジ' }, { name: 'thumb_up', ja: 'いいね 賛成' }, { name: 'schedule', ja: '時計 時間 スケジュール' },
  { name: 'calendar_month', ja: 'カレンダー 日程' }, { name: 'mail', ja: 'メール 封筒' }, { name: 'call', ja: '電話' },
  { name: 'chat', ja: 'チャット 会話 吹き出し' }, { name: 'forum', ja: '掲示板 対話' }, { name: 'notifications', ja: 'ベル 通知' },
  { name: 'description', ja: '書類 文書 資料' }, { name: 'folder', ja: 'フォルダ' }, { name: 'edit', ja: '鉛筆 編集' },
  { name: 'delete', ja: 'ゴミ箱 削除' }, { name: 'download', ja: 'ダウンロード' }, { name: 'upload', ja: 'アップロード' },
  { name: 'share', ja: '共有 シェア' }, { name: 'link', ja: 'リンク 鎖' }, { name: 'attach_file', ja: '添付 クリップ' },
  { name: 'visibility', ja: '目 閲覧 表示' }, { name: 'lock', ja: '鍵 セキュリティ' }, { name: 'shield', ja: '盾 保護 安全' },
  { name: 'key', ja: '鍵 キー' }, { name: 'security', ja: 'セキュリティ 盾' }, { name: 'cloud', ja: 'クラウド 雲' },
  { name: 'database', ja: 'データベース' }, { name: 'devices', ja: 'デバイス PC スマホ' }, { name: 'smartphone', ja: 'スマホ 携帯' },
  { name: 'computer', ja: 'パソコン PC' }, { name: 'language', ja: '地球 Web 言語' }, { name: 'public', ja: '地球 グローバル' },
  { name: 'code', ja: 'コード 開発' }, { name: 'terminal', ja: 'ターミナル 開発' }, { name: 'build', ja: 'スパナ 構築 工具' },
  { name: 'construction', ja: '工事 整備 工具' }, { name: 'bolt', ja: '稲妻 高速 電力' }, { name: 'speed', ja: 'スピード メーター' },
  { name: 'eco', ja: '葉 エコ 環境' }, { name: 'recycling', ja: 'リサイクル 循環' }, { name: 'local_shipping', ja: 'トラック 配送 物流' },
  { name: 'train', ja: '電車 鉄道' }, { name: 'flight', ja: '飛行機 出張' }, { name: 'map', ja: '地図' },
  { name: 'location_on', ja: 'ピン 場所 位置' }, { name: 'emoji_events', ja: 'トロフィー 優勝 実績' }, { name: 'military_tech', ja: 'メダル 表彰' },
  { name: 'auto_awesome', ja: 'キラキラ AI 生成' }, { name: 'psychology', ja: '頭脳 思考 心理' }, { name: 'science', ja: 'フラスコ 研究 実験' },
  { name: 'health_and_safety', ja: '医療 健康 安全' }, { name: 'volunteer_activism', ja: '支援 寄付 手とハート' }, { name: 'support_agent', ja: 'サポート オペレーター' },
  { name: 'touch_app', ja: 'タップ 操作 指' }, { name: 'ads_click', ja: 'クリック 的' }, { name: 'open_in_new', ja: '外部リンク 別窓' },
  { name: 'arrow_forward', ja: '矢印 右' }, { name: 'arrow_back', ja: '矢印 左' }, { name: 'expand_more', ja: '矢印 下 開く' },
  { name: 'add_circle', ja: 'プラス 追加' }, { name: 'remove_circle', ja: 'マイナス 削除' }, { name: 'sync', ja: '同期 更新 循環' },
];

/**
 * リストマーカーの語彙(実機の箇条書き/段落番号ギャラリー相当)。
 * 文字列マーカー(list-style-type: "・ ")は全行同じ記号、
 * キーワード(decimal等)は自動で連番になる。
 */
const BULLET_MARKS: { label: string; value: string }[] = [
  { label: '●', value: 'disc' },
  { label: '○', value: 'circle' },
  { label: '■', value: 'square' },
  { label: '・', value: '"・ "' },
  { label: '–', value: '"– "' },
  { label: '✓', value: '"✓ "' },
  { label: '▶', value: '"▶ "' },
  { label: '※', value: '"※ "' },
];
const NUMBER_MARKS: { label: string; value: string }[] = [
  { label: '1.', value: 'decimal' },
  { label: '01.', value: 'decimal-leading-zero' },
  { label: 'a.', value: 'lower-alpha' },
  { label: 'A.', value: 'upper-alpha' },
  { label: 'i.', value: 'lower-roman' },
  { label: 'I.', value: 'upper-roman' },
  { label: '一', value: 'cjk-ideographic' },
  { label: 'イ', value: 'katakana-iroha' },
];

const SHADOWS: { label: string; preset: 'none' | 'sm' | 'md' | 'lg' }[] = [
  { label: '影なし', preset: 'none' },
  { label: '弱', preset: 'sm' },
  { label: '中', preset: 'md' },
  { label: '強', preset: 'lg' },
];

/** リストマーカーのギャラリー(箇条書き/段落番号の▾) */
function MarkGallery({
  pal, marks, onPick, onNone,
}: {
  pal: Palette;
  marks: { label: string; value: string }[];
  onPick: (v: string) => void;
  onNone: () => void;
}) {
  return (
    <div className="px-2 py-1.5">
      <div className="grid grid-cols-4 gap-1">
        {marks.map((m) => (
          <button
            key={m.value}
            title={m.value}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(m.value)}
            className="flex h-8 w-9 items-center justify-center rounded border text-[13px]"
            style={{ borderColor: pal.border, color: pal.text }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = pal.hover; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
          >
            {m.label}
          </button>
        ))}
      </div>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={onNone}
        className="mt-1.5 w-full rounded px-2 py-1 text-left text-[12px]"
        style={{ color: pal.text }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = pal.hover; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
      >
        リストを解除
      </button>
    </div>
  );
}

/** 蛍光ペンの色(実機と同じ、彩度の高い蛍光色) */
const HIGHLIGHT_SWATCHES: { label: string; value: string }[] = [
  { label: '黄', value: '#FFF176' },
  { label: '緑', value: '#B9F6A6' },
  { label: '水', value: '#A5E7FF' },
  { label: '桃', value: '#FFB3D1' },
  { label: '橙', value: '#FFD08A' },
  { label: '紫', value: '#D7BCFF' },
  { label: '灰', value: '#E0E0E0' },
  { label: 'マーカー緑', value: 'var(--color-mark-green)' },
  { label: 'マーカー赤', value: 'var(--color-mark-red)' },
];

/**
 * スポイト。画面のどこからでも色を1点拾う(Figma風UIの色ピッカーと同じ入口)。
 * 未対応ブラウザ(Safari/Firefox)ではボタン自体を出さない。
 */
function EyeDropperButton({ pal, onPick, title }: { pal: Palette; onPick: (v: string) => void; title?: string }) {
  if (!isEyeDropperSupported()) return null;
  return (
    <button
      title={title ?? 'スポイト(画面から色を取得)'}
      data-eyedropper="1"
      // 押した瞬間に iframe 内の選択が捨てられないよう mousedown を止める。
      // EyeDropper はクリック(=ユーザー操作)から直接開くので、これでも起動できる
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => { void pickScreenColor().then((hex) => { if (hex) onPick(hex); }); }}
      className="flex h-5 w-5 items-center justify-center rounded-[3px] border"
      style={{ borderColor: pal.border, color: pal.text }}
    >
      <Pipette className="h-3 w-3" />
    </button>
  );
}

/** スウォッチ+任意色+なし、の色選択パネル(塗り/枠線色/蛍光ペンの共用) */
function ColorPanel({
  pal, onPick, onNone, noneLabel, swatches,
}: {
  pal: Palette;
  onPick: (v: string) => void;
  onNone?: () => void;
  noneLabel?: string;
  swatches?: { label: string; value: string }[];
}) {
  return (
    <div className="px-2 py-1.5">
      <div className="grid grid-cols-6 gap-1">
        {(swatches ?? SWATCHES).map((sw) => (
          <button
            key={sw.label}
            title={sw.label}
            // mousedown を止めないと、押した瞬間に iframe 内の範囲選択が捨てられる
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(sw.value)}
            className="h-5 w-5 rounded-[3px] border"
            style={{ backgroundColor: sw.value, borderColor: pal.border }}
          />
        ))}
        <label className="relative h-5 w-5 cursor-pointer rounded-[3px] border" title="任意の色"
          style={{ borderColor: pal.border, background: 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)' }}>
          <input type="color" className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(e) => onPick(e.target.value)} />
        </label>
        <EyeDropperButton pal={pal} onPick={onPick} />
      </div>
      {onNone && (
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={onNone}
          className="mt-1.5 w-full rounded px-2 py-1 text-left text-[12px]"
          style={{ color: pal.text }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = pal.hover; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
        >
          {noneLabel ?? 'なし'}
        </button>
      )}
    </div>
  );
}

/**
 * グラデーションのプリセット。デッキのトークンを参照しつつ既定色を添えている。
 * linear-gradient() は中に未定義の var() が1つでもあると宣言ごと無効になり、
 * 「選んだのに何も起きない」になるため、フォールバックは必須。
 */
const GRADIENT_PRESETS: { label: string; value: string }[] = [
  { label: '緑(濃)', value: 'linear-gradient(180deg, var(--color-gg-green,#316a40) 0%, var(--color-gg-green-900,#1e4227) 100%)' },
  { label: '緑(淡)', value: 'linear-gradient(180deg, var(--color-gg-green-50,#eaf1ec) 0%, var(--color-gg-green-200,#c2d5c8) 100%)' },
  { label: '白→グレー', value: 'linear-gradient(180deg, #ffffff 0%, var(--color-rule-weak,#e8ebe8) 100%)' },
  { label: '墨', value: 'linear-gradient(135deg, var(--color-ink-70,#3a3a3a) 0%, var(--color-ink-900,#1c1c1c) 100%)' },
  { label: '暖色', value: 'linear-gradient(135deg, var(--color-gg-red-600,#d64426) 0%, var(--color-gg-red-900,#7a1000) 100%)' },
  { label: '寒色', value: 'linear-gradient(135deg, #5b8db8 0%, #1e3a5f 100%)' },
];

/** カスタムグラデーションの向き(CSSの角度は 0deg=上へ, 90deg=右へ) */
const GRADIENT_DIRS: { label: string; deg: number; title: string }[] = [
  { label: '↑', deg: 0, title: '下から上へ' },
  { label: '↗', deg: 45, title: '左下から右上へ' },
  { label: '→', deg: 90, title: '左から右へ' },
  { label: '↘', deg: 135, title: '左上から右下へ' },
  { label: '↓', deg: 180, title: '上から下へ' },
];

/**
 * グラデーション塗り(プリセット6種 + 2色カスタム)。
 * 単色に戻す・塗りを消すのは呼び出し側(背景画像と背景色の打ち消し合いを1箇所で見る)。
 */
function GradientPanel({ pal, onPick }: { pal: Palette; onPick: (css: string) => void }) {
  const [from, setFrom] = useState('#4c8a5c');
  const [to, setTo] = useState('#1e4227');
  const [deg, setDeg] = useState(180);
  const css = (f: string, t: string, d: number) => `linear-gradient(${d}deg, ${f} 0%, ${t} 100%)`;

  return (
    <div className="px-2 py-1.5">
      <div className="mb-1 text-[11px]" style={{ color: pal.sub }}>グラデーション</div>
      <div className="grid grid-cols-6 gap-1">
        {GRADIENT_PRESETS.map((g) => (
          <button
            key={g.label}
            title={g.label}
            data-gradient-preset={g.label}
            // 押した瞬間に iframe 内の選択が捨てられないよう mousedown を止める
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(g.value)}
            className="h-5 w-5 rounded-[3px] border"
            style={{ backgroundImage: g.value, borderColor: pal.border }}
          />
        ))}
      </div>
      {/* カスタム: 2色。色ピッカーは preventDefault するとネイティブUIが開かないので素通し。
          スポイトはどちらの色に入るか迷わないよう、色ごとに1つずつ置く */}
      <div className="mt-1.5 flex items-center gap-1 text-[11px]" style={{ color: pal.sub }}>
        <span className="w-6">開始</span>
        <input
          type="color" value={from} title="開始色" data-gradient-from="1"
          onChange={(e) => { setFrom(e.target.value); onPick(css(e.target.value, to, deg)); }}
          className="h-5 w-7 cursor-pointer rounded-[3px] border bg-transparent p-0"
          style={{ borderColor: pal.border }}
        />
        <EyeDropperButton pal={pal} title="スポイトで開始色を取得"
          onPick={(hex) => { setFrom(hex); onPick(css(hex, to, deg)); }} />
        <span className="ml-1 w-6">終了</span>
        <input
          type="color" value={to} title="終了色" data-gradient-to="1"
          onChange={(e) => { setTo(e.target.value); onPick(css(from, e.target.value, deg)); }}
          className="h-5 w-7 cursor-pointer rounded-[3px] border bg-transparent p-0"
          style={{ borderColor: pal.border }}
        />
        <EyeDropperButton pal={pal} title="スポイトで終了色を取得"
          onPick={(hex) => { setTo(hex); onPick(css(from, hex, deg)); }} />
      </div>
      <div className="mt-1 flex items-center gap-1">
        {GRADIENT_DIRS.map((d) => (
          <button
            key={d.deg}
            title={d.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setDeg(d.deg); onPick(css(from, to, d.deg)); }}
            className="h-5 w-5 rounded-[3px] border text-[11px] leading-none"
            style={{
              borderColor: deg === d.deg ? PPT_ACCENT : pal.border,
              color: pal.text,
              backgroundColor: deg === d.deg ? pal.activeBg : undefined,
            }}
          >
            {d.label}
          </button>
        ))}
      </div>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onPick(css(from, to, deg))}
        title="このグラデーションを適用"
        className="mt-1 block h-4 w-full rounded-[3px] border"
        style={{ backgroundImage: css(from, to, deg), borderColor: pal.border }}
      />
    </div>
  );
}

/* ============================ 配置(整列) ============================ */

/** 整列ドロップダウンの1行 */
function AlignRow({
  pal, icon: Icon, label, disabled, onClick,
}: {
  pal: Palette;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      // 押した瞬間に iframe 内の選択が捨てられると、整列する相手が居なくなる
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors"
      style={{ color: disabled ? pal.disabled : pal.text }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.backgroundColor = pal.hover; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </button>
  );
}

/**
 * 整列ドロップダウンの「配置」セクション。ホームタブと図の書式タブで共用する。
 * 複数選択なら選択群、単一選択ならアートボードが基準(align-elements.ts)。
 */
function AlignSection({
  pal, count, tailLabel, onAlign, onDistribute,
}: {
  pal: Palette;
  /** 選択中の要素数。0なら全無効、3未満なら等間隔を無効(PowerPointと同じ) */
  count: number;
  /** 下に続く既存セクション(重ね順など)の見出し */
  tailLabel: string;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: DistributeAxis) => void;
}) {
  const none = count === 0;
  return (
    <div className="pb-1">
      <div className="px-3 py-1 text-[11px]" style={{ color: pal.sub }}>配置</div>
      <AlignRow pal={pal} icon={AlignHorizontalJustifyStart} label="左揃え" disabled={none} onClick={() => onAlign('left')} />
      <AlignRow pal={pal} icon={AlignHorizontalJustifyCenter} label="左右中央揃え" disabled={none} onClick={() => onAlign('hcenter')} />
      <AlignRow pal={pal} icon={AlignHorizontalJustifyEnd} label="右揃え" disabled={none} onClick={() => onAlign('right')} />
      <AlignRow pal={pal} icon={AlignVerticalJustifyStart} label="上揃え" disabled={none} onClick={() => onAlign('top')} />
      <AlignRow pal={pal} icon={AlignVerticalJustifyCenter} label="上下中央揃え" disabled={none} onClick={() => onAlign('vcenter')} />
      <AlignRow pal={pal} icon={AlignVerticalJustifyEnd} label="下揃え" disabled={none} onClick={() => onAlign('bottom')} />
      <AlignRow pal={pal} icon={AlignHorizontalSpaceAround} label="左右に整列" disabled={count < 3} onClick={() => onDistribute('h')} />
      <AlignRow pal={pal} icon={AlignVerticalSpaceAround} label="上下に整列" disabled={count < 3} onClick={() => onDistribute('v')} />
      <div className="mx-2 my-1 border-t" style={{ borderColor: pal.border }} />
      <div className="px-3 py-1 text-[11px]" style={{ color: pal.sub }}>{tailLabel}</div>
    </div>
  );
}

/** 表の行×列を選ぶグリッド(実機の「表の挿入」) */
function TableGridPicker({ pal, onPick }: { pal: Palette; onPick: (rows: number, cols: number) => void }) {
  const [hover, setHover] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  return (
    <div className="px-2 py-1.5">
      <div className="mb-1 text-[11px]" style={{ color: pal.sub }}>
        {hover.r > 0 ? `${hover.c} 列 × ${hover.r} 行の表` : '表のサイズを選択'}
      </div>
      <div className="grid grid-cols-8 gap-[3px]" onMouseLeave={() => setHover({ r: 0, c: 0 })}>
        {Array.from({ length: 64 }, (_, i) => {
          const r = Math.floor(i / 8) + 1;
          const c = (i % 8) + 1;
          const on = r <= hover.r && c <= hover.c;
          return (
            <button
              key={i}
              onMouseEnter={() => setHover({ r, c })}
              onClick={() => onPick(r, c)}
              className="h-4 w-4 rounded-[2px] border"
              style={{
                borderColor: on ? '#0F6CBD' : pal.border,
                backgroundColor: on ? 'rgba(15,108,189,0.25)' : pal.control,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/** アイコン検索ピッカー(Material Symbols)。glyph表示は index.css のフォント読込に依存 */
function IconPicker({ pal, onPick }: { pal: Palette; onPick: (name: string) => void }) {
  const [q, setQ] = useState('');
  const kw = q.trim().toLowerCase();
  const list = MATERIAL_ICONS.filter((it) => !kw || it.name.includes(kw) || it.ja.includes(q.trim()));
  return (
    <div className="w-[264px] px-2 py-1.5">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="検索(例: グラフ, home)…"
        autoFocus
        className="mb-1.5 w-full rounded border px-2 py-1 text-[12px] outline-none"
        style={{ backgroundColor: pal.control, borderColor: pal.border, color: pal.text }}
      />
      <div className="grid max-h-[240px] grid-cols-7 gap-0.5 overflow-y-auto">
        {list.map((it) => (
          <button
            key={it.name}
            title={`${it.ja} (${it.name})`}
            onClick={() => onPick(it.name)}
            className="flex h-8 w-8 items-center justify-center rounded"
            style={{ color: pal.text }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = pal.hover; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>{it.name}</span>
          </button>
        ))}
        {list.length === 0 && (
          <div className="col-span-7 py-3 text-center text-[11px]" style={{ color: pal.sub }}>見つかりません</div>
        )}
      </div>
    </div>
  );
}

/** 図形のサムネイル(実際のclip-pathで描くので見た目と結果が一致する) */
function ShapeThumb({ def, color }: { def: ShapeDef; color: string }) {
  const st = shapeStyles(def);
  const w = 26;
  const h = Math.max(10, Math.min(26, Math.round(26 * (def.h / def.w))));
  return (
    <span
      style={{
        display: 'block',
        width: w,
        height: h,
        backgroundColor: st.backgroundColor === 'transparent' ? 'transparent' : color,
        opacity: 0.9,
        clipPath: st.clipPath,
        borderRadius: st.borderRadius,
        border: st.border ? `3px solid ${color}` : undefined,
        boxSizing: 'border-box',
      }}
    />
  );
}

/**
 * 図形ギャラリー(実機の「図形」メニュー)。
 * 図形を選ぶとキャンバスがドラッグ待ちになり、
 * ドラッグすればその大きさ、クリックだけなら既定サイズで作られる。
 */
function ShapeMenuContent({
  pal, close, setTool, pickShape, activeShapeId,
}: {
  pal: Palette;
  close: () => void;
  setTool: (t: EditorTool) => void;
  pickShape: (def: ShapeDef) => void;
  activeShapeId?: string;
}) {
  const lines: { icon: React.ComponentType<{ className?: string }>; label: string; tool: EditorTool }[] = [
    { icon: Minus, label: '直線', tool: 'line' },
    { icon: MoveUpRight, label: '矢印', tool: 'arrow' },
    { icon: PenTool, label: 'ペン(曲線)', tool: 'pen' },
    { icon: Pencil, label: 'フリーハンド', tool: 'pencil' },
    { icon: Type, label: 'テキストボックス', tool: 'text' },
  ];
  return (
    <div className="max-h-[420px] w-[300px] overflow-y-auto">
      <div className="px-2 pt-1.5 text-[10px]" style={{ color: pal.sub }}>
        図形を選んでからキャンバスをドラッグ(クリックだけなら既定サイズ)
      </div>
      <div className="px-2 pb-1 pt-2 text-[10.5px] font-semibold" style={{ color: pal.sub }}>線</div>
      <div className="flex items-center gap-1 px-2">
        {lines.map((t) => (
          <button
            key={t.tool}
            title={t.label}
            onClick={() => { setTool(t.tool); close(); }}
            className="flex h-8 w-8 items-center justify-center rounded"
            style={{ color: pal.text }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = pal.hover; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
          >
            <t.icon className="h-4 w-4" />
          </button>
        ))}
      </div>
      {SHAPE_GROUPS.map((g) => (
        <div key={g.group}>
          <div className="px-2 pb-1 pt-2 text-[10.5px] font-semibold" style={{ color: pal.sub }}>{g.group}</div>
          <div className="grid grid-cols-8 gap-0.5 px-2">
            {g.shapes.map((sh) => (
              <button
                key={sh.id}
                title={sh.label}
                onClick={() => { pickShape(sh); close(); }}
                className="flex h-8 w-8 items-center justify-center rounded"
                style={{ backgroundColor: activeShapeId === sh.id ? pal.activeBg : undefined }}
                onMouseEnter={(e) => { if (activeShapeId !== sh.id) e.currentTarget.style.backgroundColor = pal.hover; }}
                onMouseLeave={(e) => { if (activeShapeId !== sh.id) e.currentTarget.style.backgroundColor = ''; }}
              >
                <ShapeThumb def={sh} color={pal.text} />
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="h-2" />
    </div>
  );
}

const TABS: { id: TabId; label: string; enabled: boolean }[] = [
  { id: 'home', label: 'ホーム', enabled: true },
  { id: 'insert', label: '挿入', enabled: true },
  { id: 'draw', label: '描画', enabled: true },
  { id: 'design', label: 'デザイン', enabled: true },
  { id: 'transition', label: '画面切り替え', enabled: true },
  { id: 'animation', label: 'アニメーション', enabled: true },
  { id: 'slideshow', label: 'スライド ショー', enabled: true },
  { id: 'review', label: '校閲', enabled: true },
  { id: 'view', label: '表示', enabled: true },
];

export function PptRibbon({
  actions, theme, onToggleTheme, onSwitchUi, page, deckTitle, comments,
}: {
  actions: PptActions;
  theme: PptTheme;
  onToggleTheme: () => void;
  onSwitchUi: () => void;
  page: number;
  deckTitle?: string;
  comments: { open: boolean; toggle: () => void; newComment: () => void };
}) {
  const pal = PALETTES[theme];
  const [tab, setTab] = useState<TabId>('home');
  /** デザイン提案パネル(生成〜適用は数分かかるのでモーダルで進捗を出す) */
  const [designOpen, setDesignOpen] = useState(false);
  const { apply: applyRaw, applyAttr, readAttr, readComputed, targets, hasSelection } = useSelectionStyle();
  const { getIframeDoc, notifyIframeChange, iframeReady } = useEditorContext();
  const deck = useDeck();
  const currentEntry = deck.slides[page - 1];
  const { selectedElement, selectedElementIds, zoom, setZoom, fitZoom } = useEditorContext();
  const [rev, setRev] = useState(0);
  // フォント一覧(デバイスフォント + Google Fonts)。Figma風UIの右パネルと同じフック
  const { fonts, systemFonts, loadFontInIframe } = useGoogleFonts();
  const cropRef = useRef<CropSession | null>(null);
  const [cropping, setCropping] = useState(false);

  /** 選択中の<img>(トリミング対象)。ラッパー(.gg-crop)選択時は中の画像 */
  const selectedImage = useMemo((): HTMLImageElement | null => {
    const doc = getIframeDoc();
    if (!doc || !selectedElement) return null;
    const el = doc.querySelector<HTMLElement>(`[data-element-id="${selectedElement.id}"]`);
    if (!el) return null;
    if (el.tagName === 'IMG') return el as HTMLImageElement;
    if (el.classList.contains('gg-crop')) return el.querySelector('img');
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElement, getIframeDoc, rev]);

  const toggleCrop = useCallback(() => {
    if (cropRef.current?.active) {
      cropRef.current.commit();
      return;
    }
    const doc = getIframeDoc();
    if (!doc || !selectedImage) return;
    cropRef.current = enterCropMode(doc, selectedImage, (changed) => {
      setCropping(false);
      cropRef.current = null;
      if (changed) notifyIframeChange();
    });
    if (cropRef.current) setCropping(true);
  }, [getIframeDoc, selectedImage, notifyIframeChange]);

  /**
   * 実機PowerPointの挙動: 画像をダブルクリックすると「図の書式設定」タブが開き、
   * タブが開いた状態でもう一度ダブルクリックするとトリミングに入る。
   *
   * 選択状態(selectedImage)はダブルクリック時点ではまだReactに伝播していない
   * ことがあるため、クロップはイベントの対象画像から直接開始する。
   */
  const tabRef = useRef(tab);
  useEffect(() => { tabRef.current = tab; }, [tab]);

  const startCropOn = useCallback(
    (img: HTMLImageElement) => {
      if (cropRef.current?.active) return;
      const doc = getIframeDoc();
      if (!doc) return;
      cropRef.current = enterCropMode(doc, img, (changed) => {
        setCropping(false);
        cropRef.current = null;
        if (changed) notifyIframeChange();
      });
      if (cropRef.current) setCropping(true);
    },
    [getIframeDoc, notifyIframeChange],
  );

  useEffect(() => {
    const doc = getIframeDoc();
    if (!doc) return;
    const onDblClick = (e: MouseEvent) => {
      if (doc.body.classList.contains('gg-cropping')) return; // クロップ中はそちらに任せる
      const t = e.target as HTMLElement;
      const img =
        t.tagName === 'IMG'
          ? (t as HTMLImageElement)
          : t.closest?.('.gg-crop, [data-gg-fx-host]')?.querySelector('img') ?? null;
      if (!img) return;
      if (tabRef.current !== 'pictureformat') {
        setTab('pictureformat');
      } else {
        startCropOn(img);
      }
    };
    doc.addEventListener('dblclick', onDblClick);
    return () => doc.removeEventListener('dblclick', onDblClick);
  }, [getIframeDoc, iframeReady, startCropOn]);


  const apply = useCallback(
    (styles: Record<string, string>) => {
      applyRaw(styles);
      setRev((n) => n + 1);
    },
    [applyRaw],
  );

  /**
   * 図形の塗り。background-image は background-color の上に描かれるので、
   * 単色を選んだらグラデーションを消し、グラデーションを選んだら下の色は残さない
   * (打ち消し合いを1箇所で見ないと「選んだのに変わらない」が起きる)。
   * '' ではなく 'none' を書くのは、クラス由来のグラデーションにも勝つため。
   */
  const setFill = useCallback((color: string) => {
    apply({ backgroundColor: color, backgroundImage: 'none' });
  }, [apply]);

  const setGradientFill = useCallback((css: string) => {
    apply({ backgroundImage: css });
  }, [apply]);

  const clearFill = useCallback(() => {
    apply({ backgroundColor: 'transparent', backgroundImage: 'none' });
  }, [apply]);

  /** 位置を書き換えたあとの後始末(履歴へ積み、選択枠を描き直す) */
  const afterMove = useCallback((moved: HTMLElement[]) => {
    if (!moved.length) return;
    notifyIframeChange();
    const doc = getIframeDoc();
    if (doc) {
      requestAnimationFrame(() => {
        for (const el of moved) updateSelectionBox(doc, el);
      });
    }
    setRev((n) => n + 1);
  }, [notifyIframeChange, getIframeDoc]);

  const runAlign = useCallback((mode: AlignMode) => {
    afterMove(alignElements(targets(), mode));
  }, [targets, afterMove]);

  const runDistribute = useCallback((axis: DistributeAxis) => {
    afterMove(distributeElements(targets(), axis));
  }, [targets, afterMove]);

  /** 蛍光ペン: 箱ではなく文字に効かせる(範囲選択があればその範囲だけ) */
  const highlight = useCallback(
    (color: string | null) => {
      const doc = getIframeDoc();
      if (!doc) return;
      if (applyTextHighlight(doc, targets(), color)) notifyIframeChange();
      setRev((n) => n + 1);
    },
    [getIframeDoc, targets, notifyIframeChange],
  );

  /** 文字色: 範囲選択があればその範囲だけ、無ければ要素へ */
  const textColor = useCallback(
    (color: string) => {
      const doc = getIframeDoc();
      if (!doc) return;
      if (applyTextColor(doc, targets(), color)) notifyIframeChange();
      setRev((n) => n + 1);
    },
    [getIframeDoc, targets, notifyIframeChange],
  );
  // 実機同様、選択が無くなったらコンテキストタブを閉じる
  useEffect(() => {
    if (tab === 'shapeformat' && !hasSelection) setTab('home');
    if (tab === 'pictureformat' && !selectedImage) {
      // ダブルクリック直後は選択がまだReactへ伝播していないことがある。
      // DOM上の選択(.selected)に画像が居るなら閉じない
      const doc = getIframeDoc();
      const sel = doc?.querySelector('.selected');
      const imgSelected =
        !!sel && (sel.tagName === 'IMG' || !!(sel as HTMLElement).querySelector?.('img'));
      if (!imgSelected) setTab('home');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, hasSelection, selectedImage]);

  /** 画像へスタイルを当てる(.gg-cropで包まれている場合も中の<img>に効かせる) */
  const applyToImage = useCallback(
    (styles: Record<string, string>) => {
      if (!selectedImage) return;
      for (const [k, v] of Object.entries(styles)) {
        (selectedImage.style as unknown as Record<string, string>)[k] = v;
      }
      notifyIframeChange();
      setRev((n) => n + 1);
    },
    [selectedImage, notifyIframeChange],
  );

  /** 回転・反転(transform をまとめて置き換える) */
  const transformImage = useCallback(
    (kind: 'cw' | 'ccw' | 'flipH' | 'flipV' | 'reset') => {
      if (!selectedImage) return;
      const cur = selectedImage.style.transform || '';
      const deg = Number(/rotate\((-?\d+)deg\)/.exec(cur)?.[1] ?? 0);
      const flipH = /scaleX\(-1\)/.test(cur);
      const flipV = /scaleY\(-1\)/.test(cur);
      let next = '';
      if (kind === 'reset') next = '';
      else {
        const d = kind === 'cw' ? deg + 90 : kind === 'ccw' ? deg - 90 : deg;
        const h = kind === 'flipH' ? !flipH : flipH;
        const v = kind === 'flipV' ? !flipV : flipV;
        next = [d % 360 !== 0 ? `rotate(${d % 360}deg)` : '', h ? 'scaleX(-1)' : '', v ? 'scaleY(-1)' : '']
          .filter(Boolean)
          .join(' ');
      }
      applyToImage({ transform: next });
    },
    [selectedImage, applyToImage],
  );

  /** 枠線の色/太さを変えるとき、枠線が無ければ実線を立てる(PowerPointの挙動) */
  const ensureBorder = useCallback((styles: Record<string, string>) => {
    const w = parseFloat(readComputed('border-top-width'));
    const st = readComputed('border-top-style');
    const out = { ...styles };
    if (!('borderWidth' in out) && (!Number.isFinite(w) || w === 0)) out.borderWidth = '2px';
    if (!('borderStyle' in out) && (st === 'none' || st === '')) out.borderStyle = 'solid';
    apply(out);
  }, [readComputed, apply]);

  const borderRadiusPx = useMemo(() => {
    const v = parseFloat(readComputed('border-radius'));
    return Number.isFinite(v) ? Math.round(v) : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElement, selectedElementIds, readComputed, rev]);

  const opacityPct = useMemo(() => {
    const v = parseFloat(readComputed('opacity'));
    return Number.isFinite(v) ? Math.round(v * 100) : 100;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElement, selectedElementIds, readComputed, rev]);

  const sizeWH = useMemo(() => {
    const w = parseFloat(readComputed('width'));
    const h = parseFloat(readComputed('height'));
    return {
      w: Number.isFinite(w) ? Math.round(w) : '',
      h: Number.isFinite(h) ? Math.round(h) : '',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElement, selectedElementIds, readComputed, rev]);

  const fontSize = useMemo(() => {
    const v = parseFloat(readComputed('font-size'));
    return Number.isFinite(v) ? Math.round(v) : '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElement, selectedElementIds, readComputed, rev]);

  const isBold = useMemo(() => {
    const w = parseInt(readComputed('font-weight'), 10);
    return Number.isFinite(w) && w >= 600;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElement, selectedElementIds, readComputed, rev]);

  /** 図形・表・アイコンをアートボード中央へ挿入する共通処理 */
  const insertAtCenter = useCallback(
    (w: number, build: (doc: Document, el: HTMLDivElement) => void) => {
      const doc = getIframeDoc();
      const artboard = doc?.getElementById('artboard');
      if (!doc || !artboard) return;
      const el = doc.createElement('div');
      el.setAttribute('data-element-id', generateElementId('shape'));
      el.setAttribute('data-editable', 'true');
      el.style.position = 'absolute';
      el.style.left = `${Math.round((1920 - w) / 2)}px`;
      el.style.width = `${w}px`;
      build(doc, el);
      const h = parseFloat(el.style.height) || 200;
      el.style.top = `${Math.round((1080 - h) / 2)}px`;
      artboard.appendChild(el);
      notifyIframeChange(true);
    },
    [getIframeDoc, notifyIframeChange],
  );

  /** 図形ギャラリーで選ぶ = 次のドラッグ/クリックでその図形を作る */
  const pickShape = useCallback((def: ShapeDef) => {
    setPendingShape(def);
    actions.setActiveTool('shape');
    setRev((n) => n + 1);
  }, [actions]);

  const insertTable = useCallback((rows: number, cols: number) => {
    const w = Math.min(1600, Math.max(560, cols * 200));
    insertAtCenter(w, (_doc, el) => {
      el.setAttribute('data-shape-type', 'table');
      const th = (i: number) =>
        `<th style="border:1px solid var(--color-rule); padding:12px 16px; background:var(--color-surface); font-weight:700; text-align:left;">項目${i + 1}</th>`;
      const td = '<td style="border:1px solid var(--color-rule); padding:12px 16px;">テキスト</td>';
      const head = Array.from({ length: cols }, (_, i) => th(i)).join('');
      const body = Array.from({ length: Math.max(0, rows - 1) }, () => `<tr>${Array.from({ length: cols }, () => td).join('')}</tr>`).join('');
      el.innerHTML =
        `<table style="width:100%; border-collapse:collapse; background:var(--color-paper); font-size:22px; line-height:1.5; color:var(--color-ink);">` +
        `<thead><tr>${head}</tr></thead>${body ? `<tbody>${body}</tbody>` : ''}</table>`;
    });
  }, [insertAtCenter]);

  const insertIcon = useCallback((name: string) => {
    insertAtCenter(96, (_doc, el) => {
      el.setAttribute('data-shape-type', 'icon');
      el.style.height = '96px';
      el.innerHTML = `<span class="material-symbols-outlined" style="font-size:96px; color:var(--color-ink);">${name}</span>`;
    });
  }, [insertAtCenter]);

  /** 新しいスライド = 白紙をこのページの直後に挿入して移動 */
  const insertBlank = async () => {
    // 未保存があれば黙って保存してから移る。保存できなかったときだけ従来の確認に落とす
    if (!(await flushAutoSave())) {
      if (!window.confirm('保存に失敗しました。変更を破棄して新しいスライドへ移動しますか?')) return;
    }
    await fetch('/__deck/insert', {
      method: 'POST',
      body: JSON.stringify({ template: 'lib:Slide000', at: page }),
    });
    await refreshDeck().catch(() => undefined);
    window.location.hash = `#/edit/${page + 1}`;
  };

  const openSlideshow = () => {
    window.open(`${window.location.origin}${window.location.pathname}#/${page}?clean`, '_blank');
  };

  const inputCls = 'rounded border px-1 text-[12px] outline-none';
  const inputStyle = { backgroundColor: pal.control, borderColor: pal.border, color: pal.text } as const;

  return (
    <div style={{ backgroundColor: pal.chrome, color: pal.text }}>
      {/* タブ帯 */}
      <div className="flex items-center gap-0.5 border-b px-2" style={{ borderColor: pal.border }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            disabled={!t.enabled}
            onClick={() => setTab(t.id)}
            title={t.enabled ? undefined : 'Web版では未対応の機能です'}
            className="relative whitespace-nowrap px-2.5 py-1.5 text-[12px] transition-colors"
            style={{ color: !t.enabled ? pal.disabled : tab === t.id ? pal.text : pal.sub }}
          >
            {t.label}
            {tab === t.id && t.enabled && (
              <span
                className="absolute bottom-0 left-2 right-2 h-[2.5px] rounded-full"
                style={{ backgroundColor: theme === 'dark' ? '#ffffff' : PPT_ACCENT }}
              />
            )}
          </button>
        ))}
        {selectedImage && (
          <button
            onClick={() => setTab('pictureformat')}
            className="relative whitespace-nowrap px-2.5 py-1.5 text-[12px] transition-colors"
            style={{ color: tab === 'pictureformat' ? PPT_ACCENT : pal.sub, fontWeight: 500 }}
            title="選択中の画像の書式(実機のコンテキストタブ相当)"
          >
            図の書式設定
            {tab === 'pictureformat' && (
              <span className="absolute bottom-0 left-2 right-2 h-[2.5px] rounded-full" style={{ backgroundColor: PPT_ACCENT }} />
            )}
          </button>
        )}
        {hasSelection && (
          <button
            onClick={() => setTab('shapeformat')}
            className="relative whitespace-nowrap px-2.5 py-1.5 text-[12px] transition-colors"
            style={{ color: tab === 'shapeformat' ? PPT_ACCENT : pal.sub, fontWeight: 500 }}
            title="選択中の図形・要素の書式(実機のコンテキストタブ相当)"
          >
            図形の書式
            {tab === 'shapeformat' && (
              <span className="absolute bottom-0 left-2 right-2 h-[2.5px] rounded-full" style={{ backgroundColor: PPT_ACCENT }} />
            )}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5 py-1">
          <button
            onClick={comments.toggle}
            title="コメントパネルの表示/非表示"
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-[12px]"
            style={{
              borderColor: pal.border,
              color: comments.open ? '#0F6CBD' : pal.sub,
              backgroundColor: comments.open ? pal.activeBg : 'transparent',
            }}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            コメント
            {unresolvedCount(currentEntry?.comments) > 0 && (
              <span className="rounded-full bg-[#0F6CBD] px-1.5 text-[10px] font-bold text-white">
                {unresolvedCount(currentEntry?.comments)}
              </span>
            )}
          </button>
          {/* 共有(書き出し)は共通トップバー(EditorTopBar)に一本化した。
              ここに置くとタイトルバーと二重になる */}
        </div>
      </div>

      {/* リボン本体 */}
      <div
        className="flex h-[80px] shrink-0 items-center gap-0 overflow-x-auto overflow-y-hidden border-b px-2"
        style={{ borderColor: pal.border }}
      >
        {tab === 'home' && (
          <>
            <BigButton icon={Plus} label={'新しい\nスライド'} onClick={() => void insertBlank()} title="白紙スライドをこの後ろに挿入" pal={pal} />
            <Sep pal={pal} />
            <div className="flex flex-col justify-center gap-1 px-1">
              <div className="flex items-center gap-1">
                <select
                  disabled={!hasSelection}
                  className={`${inputCls} h-6 w-[136px] disabled:opacity-40`}
                  style={inputStyle}
                  value=""
                  onChange={(e) => {
                    const family = e.target.value;
                    if (!family) return;
                    const font = fonts.find((f) => f.family === family);
                    const doc = getIframeDoc();
                    // Googleフォントはiframeへ読み込んでから適用する
                    if (doc) loadFontInIframe(family, doc);
                    const stack =
                      font?.stack ??
                      `"${family}", ${font?.category === 'serif' ? 'serif' : font?.category === 'monospace' ? 'monospace' : 'sans-serif'}`;
                    apply({ fontFamily: stack });
                  }}
                >
                  <option value="">フォント</option>
                  <optgroup label="デバイスフォント">
                    {systemFonts.map((f) => (
                      <option key={f.family} value={f.family}>{f.family}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Google Fonts">
                    {fonts.filter((f) => !systemFonts.some((sf) => sf.family === f.family)).map((f) => (
                      <option key={f.family} value={f.family}>{f.family}</option>
                    ))}
                  </optgroup>
                </select>
                <input
                  type="number"
                  list="gg-ppt-font-sizes"
                  disabled={!hasSelection}
                  className={`${inputCls} h-6 w-[56px] disabled:opacity-40`}
                  style={inputStyle}
                  value={fontSize}
                  placeholder="pt"
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (Number.isFinite(n) && n >= 6 && n <= 400) apply({ fontSize: `${n}px` });
                  }}
                />
                <datalist id="gg-ppt-font-sizes">
                  {[12, 14, 16, 18, 20, 24, 28, 32, 36, 44, 52, 64, 80, 96].map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                <SmallButton icon={AArrowUp} title="フォントサイズを大きく" disabled={!hasSelection}
                  onClick={() => { const n = Number(fontSize) || 16; apply({ fontSize: `${Math.min(400, n + 2)}px` }); }} pal={pal} />
                <SmallButton icon={AArrowDown} title="フォントサイズを小さく" disabled={!hasSelection}
                  onClick={() => { const n = Number(fontSize) || 16; apply({ fontSize: `${Math.max(6, n - 2)}px` }); }} pal={pal} />
                <SmallButton icon={RemoveFormatting} title="書式のクリア(文字の装飾を既定に戻す)" disabled={!hasSelection}
                  onClick={() => apply({ fontWeight: '', fontStyle: '', textDecoration: '', letterSpacing: '', color: '', backgroundColor: '', verticalAlign: '' })} pal={pal} />
              </div>
              <div className="flex items-center gap-0.5">
                <SmallButton icon={Bold} title="太字" active={isBold} disabled={!hasSelection}
                  onClick={() => apply({ fontWeight: isBold ? '400' : '700' })} pal={pal} />
                <SmallButton icon={Italic} title="斜体" disabled={!hasSelection}
                  onClick={() => apply({ fontStyle: readComputed('font-style') === 'italic' ? 'normal' : 'italic' })} pal={pal} />
                <SmallButton icon={Underline} title="下線" disabled={!hasSelection}
                  onClick={() => apply({ textDecoration: readComputed('text-decoration-line').includes('underline') ? 'none' : 'underline' })} pal={pal} />
                <SmallButton icon={Strikethrough} title="取り消し線" disabled={!hasSelection}
                  onClick={() => apply({ textDecoration: readComputed('text-decoration-line').includes('line-through') ? 'none' : 'line-through' })} pal={pal} />
                <SmallButton icon={Superscript} title="上付き" disabled={!hasSelection}
                  onClick={() => { const on = readComputed('vertical-align') === 'super'; apply({ verticalAlign: on ? 'baseline' : 'super', fontSize: on ? '' : '0.65em' }); }} pal={pal} />
                <SmallButton icon={Subscript} title="下付き" disabled={!hasSelection}
                  onClick={() => { const on = readComputed('vertical-align') === 'sub'; apply({ verticalAlign: on ? 'baseline' : 'sub', fontSize: on ? '' : '0.65em' }); }} pal={pal} />
                <Dropdown
                  pal={pal}
                  trigger={<SmallButton icon={Baseline} title="文字の間隔" chevron pal={pal} />}
                  items={[
                    { label: '狭く (-0.02em)', onClick: () => apply({ letterSpacing: '-0.02em' }) },
                    { label: '標準', onClick: () => apply({ letterSpacing: '0' }) },
                    { label: '広く (0.06em)', onClick: () => apply({ letterSpacing: '0.06em' }) },
                    { label: 'より広く (0.12em)', onClick: () => apply({ letterSpacing: '0.12em' }) },
                  ]}
                />
                <Dropdown
                  pal={pal}
                  trigger={
                    <span className="relative inline-flex h-6 w-7 cursor-pointer items-center justify-center rounded" title="蛍光ペン(文字の背景色)" style={{ color: pal.text }}>
                      <Highlighter className="h-4 w-4" />
                      <span className="absolute bottom-0.5 left-1 right-1 h-[3px]" style={{ backgroundColor: '#FFF176' }} />
                    </span>
                  }
                  content={(close) => (
                    <ColorPanel
                      pal={pal}
                      swatches={HIGHLIGHT_SWATCHES}
                      onPick={(v) => { highlight(v); close(); }}
                      onNone={() => { highlight(null); close(); }}
                      noneLabel="色なし(蛍光ペンを消す)"
                    />
                  )}
                />
                <label
                  className={`relative flex h-6 w-6 items-center justify-center rounded ${hasSelection ? 'cursor-pointer' : 'opacity-40'}`}
                  title="文字色"
                  style={{ color: pal.text }}
                >
                  <Type className="h-4 w-4" />
                  <span className="absolute bottom-0.5 left-1 right-1 h-[3px]" style={{ backgroundColor: PPT_ACCENT }} />
                  <input type="color" disabled={!hasSelection} className="absolute inset-0 cursor-pointer opacity-0"
                    onChange={(e) => textColor(e.target.value)} />
                </label>
              </div>
            </div>
            <Sep pal={pal} />
            {/* 段落グループ(実機の2段構成) */}
            <div className="flex flex-col justify-center gap-1">
              <div className="flex items-center gap-0.5">
                <SmallButton icon={List} title="箇条書き(▾で行頭記号を選択)" disabled={!hasSelection}
                  onClick={() => { const on = readComputed('display') === 'list-item'; apply({ display: on ? '' : 'list-item', listStyleType: on ? '' : 'disc', listStylePosition: on ? '' : 'inside' }); }} pal={pal} />
                <Dropdown
                  pal={pal}
                  trigger={
                    <button className="flex h-6 w-3 items-center justify-center rounded" title="行頭記号を選択" style={{ color: pal.sub }}>
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  }
                  content={(close) => (
                    <MarkGallery pal={pal} marks={BULLET_MARKS}
                      onPick={(v) => { apply({ display: 'list-item', listStyleType: v, listStylePosition: 'inside' }); close(); }}
                      onNone={() => { apply({ display: '', listStyleType: '', listStylePosition: '' }); close(); }} />
                  )}
                />
                <SmallButton icon={ListOrdered} title="段落番号(▾で番号の種類を選択)" disabled={!hasSelection}
                  onClick={() => { const on = readComputed('list-style-type') === 'decimal'; apply({ display: on ? '' : 'list-item', listStyleType: on ? '' : 'decimal', listStylePosition: on ? '' : 'inside' }); }} pal={pal} />
                <Dropdown
                  pal={pal}
                  trigger={
                    <button className="flex h-6 w-3 items-center justify-center rounded" title="番号の種類を選択" style={{ color: pal.sub }}>
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  }
                  content={(close) => (
                    <MarkGallery pal={pal} marks={NUMBER_MARKS}
                      onPick={(v) => { apply({ display: 'list-item', listStyleType: v, listStylePosition: 'inside' }); close(); }}
                      onNone={() => { apply({ display: '', listStyleType: '', listStylePosition: '' }); close(); }} />
                  )}
                />
                <SmallButton icon={IndentDecrease} title="インデントを減らす" disabled={!hasSelection}
                  onClick={() => { const cur = parseFloat(readComputed('padding-left')) || 0; apply({ paddingLeft: `${Math.max(0, cur - 24)}px` }); }} pal={pal} />
                <SmallButton icon={IndentIncrease} title="インデントを増やす" disabled={!hasSelection}
                  onClick={() => { const cur = parseFloat(readComputed('padding-left')) || 0; apply({ paddingLeft: `${cur + 24}px` }); }} pal={pal} />
                <Dropdown
                  pal={pal}
                  trigger={<SmallButton icon={AlignJustify} title="行間" chevron pal={pal} />}
                  items={['1.0', '1.15', '1.3', '1.5', '1.8', '2.0'].map((v) => ({
                    label: `行間 ${v}`,
                    onClick: () => apply({ lineHeight: v }),
                  }))}
                />
              </div>
              <div className="flex items-center gap-0.5">
                <SmallButton icon={AlignLeft} title="左揃え" disabled={!hasSelection} onClick={() => apply({ textAlign: 'left' })} pal={pal} />
                <SmallButton icon={AlignCenter} title="中央揃え" disabled={!hasSelection} onClick={() => apply({ textAlign: 'center' })} pal={pal} />
                <SmallButton icon={AlignRight} title="右揃え" disabled={!hasSelection} onClick={() => apply({ textAlign: 'right' })} pal={pal} />
                <SmallButton icon={AlignJustify} title="両端揃え" disabled={!hasSelection} onClick={() => apply({ textAlign: 'justify' })} pal={pal} />
                <SmallButton icon={TypeVertical} title="縦書き(もう一度で解除)" disabled={!hasSelection}
                  onClick={() => { const on = readComputed('writing-mode') === 'vertical-rl'; apply({ writingMode: on ? '' : 'vertical-rl' }); }} pal={pal} />
              </div>
            </div>
            <Sep pal={pal} />
            <div className="flex flex-col justify-center gap-1">
              <div className="flex items-center gap-0.5">
                <SmallButton icon={Copy} title="複製" disabled={!actions.duplicateElement} onClick={actions.duplicateElement} pal={pal} />
                <SmallButton icon={Trash2} title="削除" disabled={!actions.deleteElement} onClick={actions.deleteElement} pal={pal} />
                <SmallButton
                  icon={Crop}
                  title={cropping ? 'トリミングを確定 (Enter)' : '画像をトリミング'}
                  disabled={!selectedImage && !cropping}
                  active={cropping}
                  onClick={toggleCrop}
                  pal={pal}
                />
              </div>
            </div>
            <Sep pal={pal} />
            <BigButton icon={ImageIcon} label="画像" onClick={actions.openFilePicker} pal={pal} />
            <Dropdown
              pal={pal}
              trigger={<BigButton icon={Square} label="図形" caret pal={pal} />}
              content={(close) => (
                <ShapeMenuContent pal={pal} close={close} setTool={actions.setActiveTool} pickShape={pickShape}
                  activeShapeId={actions.activeTool === 'shape' ? pendingShape.id : undefined} />
              )}
            />
            <BigButton
              icon={Type}
              label={'テキスト\nボックス'}
              active={actions.activeTool === 'text'}
              onClick={() => actions.setActiveTool(actions.activeTool === 'text' ? 'select' : 'text')}
              pal={pal}
            />
            <Sep pal={pal} />
            <Dropdown
              pal={pal}
              trigger={<BigButton icon={LayoutGrid} label="整列" caret pal={pal} />}
              content={() => (
                <AlignSection
                  pal={pal}
                  count={targets().length}
                  tailLabel="重ね順・グループ"
                  onAlign={runAlign}
                  onDistribute={runDistribute}
                />
              )}
              items={[
                { label: '最前面へ移動', onClick: actions.bringToFront, disabled: !actions.bringToFront },
                { label: '前面へ移動', onClick: actions.bringForward, disabled: !actions.bringForward },
                { label: '背面へ移動', onClick: actions.sendBackward, disabled: !actions.sendBackward },
                { label: '最背面へ移動', onClick: actions.sendToBack, disabled: !actions.sendToBack },
                { label: 'グループ化', onClick: actions.groupElements, disabled: !actions.groupElements },
                { label: 'グループ解除', onClick: actions.ungroupElements, disabled: !actions.ungroupElements },
              ]}
            />
          </>
        )}

        {tab === 'insert' && (
          <>
            <BigButton icon={Plus} label={'新しい\nスライド'} onClick={() => void insertBlank()} pal={pal} />
            <Sep pal={pal} />
            <Dropdown
              pal={pal}
              trigger={<BigButton icon={Table} label="表" caret pal={pal} />}
              content={(close) => (
                <TableGridPicker pal={pal} onPick={(r, c) => { insertTable(r, c); close(); }} />
              )}
            />
            <Sep pal={pal} />
            <BigButton icon={ImageIcon} label="画像" onClick={actions.openFilePicker} pal={pal} />
            <BigButton icon={LayoutGrid} label="メディア" onClick={actions.openMediaLibrary} title="メディアライブラリ" pal={pal} />
            <Sep pal={pal} />
            <Dropdown
              pal={pal}
              trigger={<BigButton icon={Shapes} label="図形" caret pal={pal} />}
              content={(close) => (
                <ShapeMenuContent pal={pal} close={close} setTool={actions.setActiveTool} pickShape={pickShape}
                  activeShapeId={actions.activeTool === 'shape' ? pendingShape.id : undefined} />
              )}
            />
            <Dropdown
              pal={pal}
              trigger={<BigButton icon={Sticker} label="アイコン" caret pal={pal} />}
              content={(close) => (
                <IconPicker pal={pal} onPick={(name) => { insertIcon(name); close(); }} />
              )}
            />
            <Sep pal={pal} />
            <BigButton
              icon={Type}
              label={'テキスト\nボックス'}
              active={actions.activeTool === 'text'}
              onClick={() => actions.setActiveTool(actions.activeTool === 'text' ? 'select' : 'text')}
              pal={pal}
            />
            <BigButton icon={Boxes} label={'コンポー\nネント'} onClick={actions.openComponents} pal={pal} />
          </>
        )}

        {tab === 'draw' && (
          <>
            <BigButton icon={MousePointer2} label="選択" active={actions.activeTool === 'select'} onClick={() => actions.setActiveTool('select')} pal={pal} />
            <BigButton icon={Eraser} label={'消し\nゴム'} active={actions.activeTool === 'eraser'} onClick={() => actions.setActiveTool('eraser')} title="ペンのストロークをクリック/なぞって消す (E)" pal={pal} />
            <Sep pal={pal} />
            {/* 実機のペンギャラリー相当。選ぶとそのインクで描き始める(Escで終了) */}
            <div className="flex items-center gap-1 self-center rounded-md border px-1.5 py-1" style={{ borderColor: pal.border, backgroundColor: pal.control }}>
              {PEN_PRESETS.map((p) => {
                const active =
                  inkStyle.presetId === p.id &&
                  (actions.activeTool === 'pen' || actions.activeTool === 'pencil');
                return (
                  <button
                    key={p.id}
                    title={`${p.label} — クリックで描画開始`}
                    onClick={() => { setInkPreset(p); actions.setActiveTool(p.tool); setRev((n) => n + 1); }}
                    className="flex h-11 w-9 flex-col items-center justify-end gap-0.5 rounded pb-1 transition-transform"
                    style={{
                      backgroundColor: active ? pal.activeBg : 'transparent',
                      transform: active ? 'translateY(-3px)' : undefined,
                    }}
                  >
                    {p.cap === 'butt'
                      ? <Highlighter className="h-5 w-5" style={{ color: p.color }} />
                      : p.tool === 'pencil'
                        ? <Pencil className="h-5 w-5" style={{ color: p.color }} />
                        : <PenTool className="h-5 w-5" style={{ color: p.color }} />}
                    <span className="h-[4px] w-6 rounded-full" style={{ backgroundColor: p.color, opacity: p.opacity }} />
                  </button>
                );
              })}
              {/* 任意色(太さはプリセット維持) */}
              <label className="relative flex h-11 w-7 cursor-pointer items-center justify-center" title="ペンの色を変更">
                <span className="h-5 w-5 rounded-full border" style={{ borderColor: pal.border, background: 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)' }} />
                <input type="color" className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={(e) => { setInkColor(e.target.value); if (actions.activeTool !== 'pen' && actions.activeTool !== 'pencil') actions.setActiveTool('pen'); setRev((n) => n + 1); }} />
              </label>
            </div>
            <div className="ml-2 self-center text-[11px]" style={{ color: pal.sub }}>
              続けて描けます。Escまたは「選択」で終了
            </div>
          </>
        )}

        {tab === 'design' && (
          <>
            <BigButton icon={Palette} label={'バリア\nブル'} onClick={actions.openVariables} title="デザイントークン(CSS変数)を編集" pal={pal} />
            <Sep pal={pal} />
            <BigButton
              icon={Sparkles}
              label={'デザイ\nナー'}
              onClick={() => {
                if (window.confirm('このスライドの下書き(編集内容)をAIがデザインシステムに則って清書し、独立したTSXにします。実行しますか?(1〜3分)')) {
                  startCleanup(page);
                }
              }}
              title="AIで清書(TSX化)"
              pal={pal}
            />
            <BigButton
              icon={Wand2}
              label={'デザイン\n提案'}
              onClick={() => setDesignOpen(true)}
              title="デザイン案を画像で提案し、選んだ案でスライドを書き直す"
              pal={pal}
            />
            <Sep pal={pal} />
            <div className="flex flex-col justify-center px-2 text-[11px]" style={{ color: pal.sub }}>
              <span>スライドのサイズ</span>
              <span className="mt-1 font-medium" style={{ color: pal.text }}>16:9 (1920 × 1080)</span>
            </div>
          </>
        )}

        {tab === 'transition' && (
          <>
            {([
              ['none', 'なし', X],
              ['fade', 'フェード', Film],
              ['push', 'プッシュ', MoveUpRight],
              ['zoom', 'ズーム', ZoomIn],
            ] as const).map(([val, label, Icon]) => (
              <BigButton
                key={val}
                icon={Icon}
                label={label}
                active={(currentEntry?.transition ?? 'none') === val}
                onClick={() => {
                  void updateSlideMeta(page, { transition: val === 'none' ? null : val }).then(() => refreshDeck());
                }}
                title={`このスライドの切り替え効果: ${label}`}
                pal={pal}
              />
            ))}
            <Sep pal={pal} />
            <BigButton icon={Play} label={'プレ\nビュー'} onClick={openSlideshow} title="表示モードで再生して確認" pal={pal} />
            <div className="ml-1 flex items-center px-1 text-[11px]" style={{ color: pal.sub }}>
              表示モード(スライドショー)で再生されます
            </div>
          </>
        )}

        {tab === 'animation' && (
          <>
            {([
              [null, 'なし', X],
              ['fade', 'フェード', Film],
              ['up', '下から', ArrowUp],
              ['left', '左から', MoveUpRight],
              ['zoom', 'ズーム', ZoomIn],
            ] as const).map(([val, label, Icon]) => (
              <BigButton
                key={label}
                icon={Icon}
                label={label}
                disabled={!hasSelection}
                active={hasSelection && readAttr('data-anim') === val}
                onClick={() => applyAttr('data-anim', val)}
                title={val ? `選択要素に「${label}」の出現アニメーション` : '出現アニメーションを外す'}
                pal={pal}
              />
            ))}
            <Sep pal={pal} />
            <BigButton icon={Play} label={'プレ\nビュー'} onClick={openSlideshow} title="表示モードで再生して確認" pal={pal} />
            <div className="ml-1 flex items-center px-1 text-[11px]" style={{ color: pal.sub }}>
              {hasSelection ? '文書順に少しずつ遅れて出現します' : '要素を選択してください'}
            </div>
          </>
        )}

        {tab === 'review' && (
          <>
            <BigButton icon={MessageSquare} label={'新しい\nコメント'} onClick={comments.newComment}
              title="コメントを追加(要素を選択していればその要素に添付)" pal={pal} />
            <BigButton icon={MessageSquare} label={'コメント\nの表示'} active={comments.open} onClick={comments.toggle} pal={pal} />
            <Sep pal={pal} />
            {(() => {
              const withComments = deck.slides
                .map((sl, i) => ({ n: i + 1, c: unresolvedCount(sl.comments) }))
                .filter((x) => x.c > 0)
                .map((x) => x.n);
              const prev = [...withComments].reverse().find((n) => n < page);
              const next = withComments.find((n) => n > page);
              const goToPage = (n?: number) => {
                if (!n) return;
                window.location.hash = `#/edit/${n}`;
              };
              return (
                <>
                  <BigButton icon={ChevronLeft} label={'前の\nコメント'} disabled={!prev} onClick={() => goToPage(prev)}
                    title="未解決コメントのある前のスライドへ" pal={pal} />
                  <BigButton icon={ChevronRight} label={'次の\nコメント'} disabled={!next} onClick={() => goToPage(next)}
                    title="未解決コメントのある次のスライドへ" pal={pal} />
                  <div className="ml-1 flex items-center px-1 text-[11px]" style={{ color: pal.sub }}>
                    {withComments.length
                      ? `未解決コメントのあるスライド: ${withComments.slice(0, 8).join(', ')}${withComments.length > 8 ? '…' : ''}`
                      : '未解決のコメントはありません'}
                  </div>
                </>
              );
            })()}
          </>
        )}

        {tab === 'slideshow' && (
          <>
            <BigButton icon={Play} label={'最初から\n再生'} onClick={() => window.open(`${window.location.origin}${window.location.pathname}#/1?clean`, '_blank')} pal={pal} />
            <BigButton icon={Play} label={'この\nスライドから'} onClick={openSlideshow} pal={pal} />
            <Sep pal={pal} />
            <BigButton
              icon={Monitor}
              label={'発表者\nビュー'}
              onClick={() => window.open(`${window.location.origin}/presenter.html`, '_blank')}
              title="原稿・タイマー・次スライド付きのコンソール(トークスクリプトを表示)"
              pal={pal}
            />
            <BigButton
              icon={MonitorUp}
              label={'画面共有用\nウィンドウ'}
              onClick={() => window.open(`${window.location.origin}/audience.html`, '_blank')}
              title="共有・投影するスライドだけの画面。発表者ビューと自動で同期します"
              pal={pal}
            />
            <div className="ml-1 flex items-center px-1 text-[11px]" style={{ color: pal.sub }}>
              発表者ビューでページを送ると、画面共有用ウィンドウが同じブラウザ内で自動同期します
            </div>
          </>
        )}

        {tab === 'shapeformat' && (
          <>
            {/* 塗りつぶし・枠線・効果 = PowerPointの図形スタイル群 */}
            <div className="flex items-center gap-0.5 px-1">
              <Dropdown
                pal={pal}
                trigger={
                  <SmallButton icon={PaintBucket} title="図形の塗りつぶし" label="塗りつぶし" chevron pal={pal} />
                }
                content={() => (
                  // 色を選んでも閉じない(連続調整のため)。閉じるのは外側クリックとEscだけ
                  <div className="w-[212px]">
                    <ColorPanel
                      pal={pal}
                      onPick={setFill}
                      onNone={clearFill}
                      noneLabel="塗りつぶしなし"
                    />
                    <div className="mx-2 my-1 border-t" style={{ borderColor: pal.border }} />
                    <GradientPanel pal={pal} onPick={setGradientFill} />
                  </div>
                )}
              />
              <Dropdown
                pal={pal}
                trigger={<SmallButton icon={PenLine} title="図形の枠線" label="枠線" chevron pal={pal} />}
                content={() => (
                  // 色・太さ・種類を続けて試せるよう、選んでも閉じない
                  <div>
                    <ColorPanel
                      pal={pal}
                      onPick={(v) => ensureBorder({ borderColor: v })}
                      onNone={() => apply({ borderStyle: 'none' })}
                      noneLabel="枠線なし"
                    />
                    <div className="mx-2 my-1 border-t" style={{ borderColor: pal.border }} />
                    <div className="flex items-center gap-1 px-2 pb-1 text-[11px]" style={{ color: pal.sub }}>
                      太さ
                      {[1, 2, 3, 4, 6].map((w) => (
                        <button key={w}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => ensureBorder({ borderWidth: `${w}px` })}
                          className="rounded border px-1.5 py-0.5"
                          style={{ borderColor: pal.border, color: pal.text }}>
                          {w}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1 px-2 pb-1.5 text-[11px]" style={{ color: pal.sub }}>
                      種類
                      {([['実線', 'solid'], ['破線', 'dashed'], ['点線', 'dotted']] as const).map(([lb, v]) => (
                        <button key={v}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => ensureBorder({ borderStyle: v })}
                          className="rounded border px-1.5 py-0.5"
                          style={{ borderColor: pal.border, color: pal.text }}>
                          {lb}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              />
              <Dropdown
                pal={pal}
                trigger={<SmallButton icon={Sparkles} title="図形の効果(影)" label="効果" chevron pal={pal} />}
                items={[
                  ...SHADOWS.map((sh) => ({
                    label: `影: ${sh.label}`,
                    // 切り抜いた図形は box-shadow が clip-path に切られるので drop-shadow を使う
                    onClick: () => { for (const el of targets()) applyShadowPreset(el, sh.preset); notifyIframeChange(); setRev((n) => n + 1); },
                  })),
                  { label: '書式ウィンドウで細かく調整…', onClick: actions.toggleFormatPane },
                ]}
              />
            </div>
            <Sep pal={pal} />
            {/* 角丸・透明度 */}
            <div className="flex flex-col justify-center gap-1 px-1.5">
              <label className="flex items-center justify-between gap-1.5 text-[11px]" style={{ color: pal.sub }}>
                角丸
                <input type="number" min={0} value={borderRadiusPx}
                  onChange={(e) => apply({ borderRadius: `${Math.max(0, Number(e.target.value) || 0)}px` })}
                  className={`${inputCls} h-6 w-[56px]`} style={inputStyle} />
              </label>
              <label className="flex items-center justify-between gap-1.5 text-[11px]" style={{ color: pal.sub }}>
                透明度
                <input type="number" min={0} max={100} value={100 - opacityPct}
                  onChange={(e) => apply({ opacity: String(Math.min(100, Math.max(0, 100 - (Number(e.target.value) || 0))) / 100) })}
                  className={`${inputCls} h-6 w-[56px]`} style={inputStyle} />
              </label>
            </div>
            <Sep pal={pal} />
            {/* サイズ(実機の「サイズ」グループ) */}
            <div className="flex flex-col justify-center gap-1 px-1.5">
              <label className="flex items-center justify-between gap-1.5 text-[11px]" style={{ color: pal.sub }}>
                幅
                <input type="number" min={1} value={sizeWH.w}
                  onChange={(e) => apply({ width: `${Math.max(1, Number(e.target.value) || 1)}px` })}
                  className={`${inputCls} h-6 w-[64px]`} style={inputStyle} />
              </label>
              <label className="flex items-center justify-between gap-1.5 text-[11px]" style={{ color: pal.sub }}>
                高さ
                <input type="number" min={1} value={sizeWH.h}
                  onChange={(e) => apply({ height: `${Math.max(1, Number(e.target.value) || 1)}px` })}
                  className={`${inputCls} h-6 w-[64px]`} style={inputStyle} />
              </label>
            </div>
            <Sep pal={pal} />
            {/* 実機の図形の書式タブにも配置グループがある(グラデ適用→整列でホームへ戻らせない) */}
            <Dropdown
              pal={pal}
              trigger={<BigButton icon={LayoutGrid} label="整列" caret pal={pal} />}
              content={() => (
                <AlignSection
                  pal={pal}
                  count={targets().length}
                  tailLabel="重ね順"
                  onAlign={runAlign}
                  onDistribute={runDistribute}
                />
              )}
              items={[
                { label: '最前面へ移動', onClick: actions.bringToFront, disabled: !actions.bringToFront },
                { label: '前面へ移動', onClick: actions.bringForward, disabled: !actions.bringForward },
                { label: '背面へ移動', onClick: actions.sendBackward, disabled: !actions.sendBackward },
                { label: '最背面へ移動', onClick: actions.sendToBack, disabled: !actions.sendToBack },
              ]}
            />
          </>
        )}
        {tab === 'pictureformat' && (
          <>
            {/* 修整・色・アート効果(CSS filter) */}
            <div className="flex items-center gap-0.5 px-1">
              {PICTURE_FILTERS.map((g) => (
                <Dropdown
                  key={g.group}
                  pal={pal}
                  trigger={
                    <BigButton
                      icon={g.group === '修整' ? Sun : g.group === '色' ? Palette : Sparkles}
                      label={g.group === 'アート効果' ? 'アート\n効果' : g.group}
                      caret
                      pal={pal}
                    />
                  }
                  items={g.items.map((it) => ({
                    label: it.label,
                    onClick: () => applyToImage({ filter: it.value }),
                  }))}
                />
              ))}
              <div className="flex flex-col justify-center gap-1 px-1.5">
                <label className="flex items-center justify-between gap-1.5 text-[11px]" style={{ color: pal.sub }}>
                  透明度
                  <input type="number" min={0} max={100} value={100 - opacityPct}
                    onChange={(e) => applyToImage({ opacity: String(Math.min(100, Math.max(0, 100 - (Number(e.target.value) || 0))) / 100) })}
                    className={`${inputCls} h-6 w-[56px]`} style={inputStyle} />
                </label>
                <button
                  onClick={() => applyToImage({ filter: '', opacity: '', border: '', borderRadius: '', boxShadow: '', clipPath: '', padding: '', backgroundColor: '', transform: '', WebkitBoxReflect: '', WebkitMaskImage: '', maskImage: '' })}
                  className="rounded border px-1.5 py-0.5 text-[11px]"
                  style={{ borderColor: pal.border, color: pal.text }}
                >
                  図のリセット
                </button>
              </div>
            </div>
            <Sep pal={pal} />
            {/* 図のスタイル ギャラリー */}
            <div className="flex max-w-[420px] items-center gap-1 overflow-x-auto px-1">
              {PICTURE_STYLES.map((st) => (
                <button
                  key={st.label}
                  title={st.label}
                  onClick={() => applyToImage(st.styles)}
                  className="flex h-[58px] w-[62px] shrink-0 flex-col items-center justify-center gap-1 rounded"
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = pal.hover; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
                >
                  {/* 実機と同じく、効果を当てたサムネイルで見せる */}
                  <span
                    className="block h-[26px] w-[38px]"
                    style={{
                      backgroundColor: st.styles.backgroundColor || '#9aa7b1',
                      backgroundImage: 'linear-gradient(135deg,#8fa6b8 40%,#c3d0d9 40%)',
                      border: st.styles.border ? '2px solid currentColor' : undefined,
                      borderRadius: st.styles.borderRadius === '50%' ? '50%' : st.styles.borderRadius ? 6 : undefined,
                      boxShadow: st.styles.boxShadow ? '0 3px 6px rgba(0,0,0,0.45)' : undefined,
                      color: pal.text,
                    }}
                  />
                  <span className="text-[9.5px]" style={{ color: pal.sub }}>{st.label}</span>
                </button>
              ))}
            </div>
            <Sep pal={pal} />
            {/* 図の枠線・図の効果・書式ウィンドウ */}
            <div className="flex items-center gap-0.5 px-1">
              <Dropdown
                pal={pal}
                trigger={<SmallButton icon={PenLine} title="図の枠線" label="図の枠線" chevron pal={pal} />}
                content={() => (
                  <div>
                    <ColorPanel
                      pal={pal}
                      onPick={(v) => applyToImage({ borderColor: v, borderStyle: 'solid', borderWidth: selectedImage?.style.borderWidth || '4px' })}
                      onNone={() => applyToImage({ border: '' })}
                      noneLabel="枠線なし"
                    />
                    <div className="flex items-center gap-1 px-2 pb-1.5 text-[11px]" style={{ color: pal.sub }}>
                      太さ
                      {[1, 2, 4, 8, 12].map((w) => (
                        <button key={w}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => applyToImage({ borderWidth: `${w}px`, borderStyle: 'solid', borderColor: selectedImage?.style.borderColor || 'var(--color-ink)' })}
                          className="rounded border px-1.5 py-0.5" style={{ borderColor: pal.border, color: pal.text }}>
                          {w}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              />
              <SmallButton
                icon={Sparkles}
                title="図の効果(影・反射・光彩・ぼかしを書式ウィンドウで調整)"
                label="図の効果"
                onClick={actions.toggleFormatPane}
                active={actions.formatPaneOpen}
                pal={pal}
              />
            </div>
            <Sep pal={pal} />
            {/* トリミング・回転・サイズ */}
            <div className="flex items-center gap-0.5 px-1">
              <BigButton
                icon={Crop}
                label={cropping ? 'トリミング\n確定' : 'トリミング'}
                active={cropping}
                onClick={toggleCrop}
                title={cropping ? 'Enterで確定 / Escで取り消し' : '表示範囲を切り抜く'}
                pal={pal}
              />
              <Dropdown
                pal={pal}
                trigger={<BigButton icon={RotateCw} label="回転" caret pal={pal} />}
                items={[
                  { label: '右へ90°回転', onClick: () => transformImage('cw') },
                  { label: '左へ90°回転', onClick: () => transformImage('ccw') },
                  { label: '左右反転', onClick: () => transformImage('flipH') },
                  { label: '上下反転', onClick: () => transformImage('flipV') },
                  { label: '回転をリセット', onClick: () => transformImage('reset') },
                ]}
              />
            </div>
            <Sep pal={pal} />
            <div className="flex flex-col justify-center gap-1 px-1.5">
              <label className="flex items-center justify-between gap-1.5 text-[11px]" style={{ color: pal.sub }}>
                高さ
                <input type="number" min={1} value={sizeWH.h}
                  onChange={(e) => applyToImage({ height: `${Math.max(1, Number(e.target.value) || 1)}px` })}
                  className={`${inputCls} h-6 w-[64px]`} style={inputStyle} />
              </label>
              <label className="flex items-center justify-between gap-1.5 text-[11px]" style={{ color: pal.sub }}>
                幅
                <input type="number" min={1} value={sizeWH.w}
                  onChange={(e) => applyToImage({ width: `${Math.max(1, Number(e.target.value) || 1)}px` })}
                  className={`${inputCls} h-6 w-[64px]`} style={inputStyle} />
              </label>
            </div>
            <Sep pal={pal} />
            <Dropdown
              pal={pal}
              trigger={<BigButton icon={LayoutGrid} label="整列" caret pal={pal} />}
              content={() => (
                <AlignSection
                  pal={pal}
                  count={targets().length}
                  tailLabel="重ね順"
                  onAlign={runAlign}
                  onDistribute={runDistribute}
                />
              )}
              items={[
                { label: '最前面へ移動', onClick: actions.bringToFront, disabled: !actions.bringToFront },
                { label: '前面へ移動', onClick: actions.bringForward, disabled: !actions.bringForward },
                { label: '背面へ移動', onClick: actions.sendBackward, disabled: !actions.sendBackward },
                { label: '最背面へ移動', onClick: actions.sendToBack, disabled: !actions.sendToBack },
              ]}
            />
          </>
        )}

        {tab === 'view' && (
          <>
            <BigButton icon={ZoomIn} label="拡大" onClick={() => setZoom(Math.min(300, zoom + 10))} pal={pal} />
            <BigButton icon={ZoomOut} label="縮小" onClick={() => setZoom(Math.max(10, zoom - 10))} pal={pal} />
            <BigButton icon={Maximize} label={'画面に\n合わせる'} onClick={() => setZoom(fitZoom)} pal={pal} />
            <Sep pal={pal} />
            <BigButton icon={theme === 'dark' ? Sun : Moon} label={theme === 'dark' ? 'ライト' : 'ダーク'} onClick={onToggleTheme} pal={pal} />
            <BigButton icon={PenTool} label={'Figma風\nUIへ'} onClick={onSwitchUi} pal={pal} />
            <Sep pal={pal} />
            <BigButton icon={Play} label={'スライド\nショー'} onClick={openSlideshow} title={`${deckTitle ?? ''} を表示モードで開く`} pal={pal} />
          </>
        )}
      </div>
      {designOpen && (
        <PptDesignProposals page={page} pal={pal} onClose={() => setDesignOpen(false)} />
      )}
    </div>
  );
}

/* ============================ 左: サムネイル ============================ */

export function PptThumbnails({ page, theme, search }: { page: number; theme: PptTheme; search: string }) {
  const pal = PALETTES[theme];
  const deck = useDeck();
  const currentRef = useRef<HTMLButtonElement>(null);
  /** 右クリックメニュー(PowerPointと同じ操作面) */
  const [menu, setMenu] = useState<{ page: number; x: number; y: number } | null>(null);
  /** ドラッグ並び替えの状態 */
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [page]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const goto = async (n: number) => {
    if (n === page) return;
    // 未保存があれば黙って保存してから移る。保存できなかったときだけ従来の確認に落とす
    if (!(await flushAutoSave())) {
      if (!window.confirm('保存に失敗しました。変更を破棄して移動しますか?')) return;
    }
    window.location.hash = `#/edit/${n}`;
  };

  /** デッキ操作の共通処理。操作後にページ番号のずれを追随する */
  const run = async (fn: () => Promise<unknown>, nextPage?: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await refreshDeck();
      if (nextPage && nextPage !== page) {
        window.location.hash = `#/edit/${nextPage}`;
      } else {
        // 番号は同じでも中身が別のスライドになっている(現在ページの削除や
        // 手前の複製)。エディタに現在ページの読み直しを頼む
        window.dispatchEvent(new CustomEvent('gg:deck-mutated'));
      }
    } catch (e) {
      window.alert(`操作に失敗しました: ${String(e).slice(0, 120)}`);
    } finally {
      setBusy(false);
    }
  };

  const doMove = (from: number, to: number) => {
    if (to < 1 || to > deck.slides.length || from === to) return;
    // 編集中のページ自身を動かしたら追随、他ページの移動で自分の番号がずれたら補正
    let next = page;
    if (from === page) next = to;
    else if (from < page && to >= page) next = page - 1;
    else if (from > page && to <= page) next = page + 1;
    void run(() => moveSlide(from, to), next);
  };

  const doDelete = (n: number) => {
    if (!window.confirm(`${n}枚目「${deck.slides[n - 1]?.title ?? ''}」を削除しますか?`)) return;
    const next = n === page ? Math.max(1, Math.min(page, deck.slides.length - 1)) : n < page ? page - 1 : page;
    void run(() => deleteSlide(n), next);
  };

  const doDuplicate = (n: number) => {
    const next = n < page ? page + 1 : page;
    void run(() => duplicateSlide(n), next);
  };

  const doToggleHidden = (n: number) => {
    const hidden = !deck.slides[n - 1]?.hidden;
    void run(() => updateSlideMeta(n, { hidden }));
  };

  const q = search.trim();
  const menuEntry = menu ? deck.slides[menu.page - 1] : null;

  return (
    <div
      className="relative w-[176px] shrink-0 overflow-y-auto border-r py-1.5"
      style={{ backgroundColor: pal.rail, borderColor: pal.border, opacity: busy ? 0.6 : 1 }}
    >
      {deck.slides.map((s, i) => {
        const n = i + 1;
        if (q && !(s.title ?? '').includes(q) && String(n) !== q) return null;
        const current = n === page;
        return (
          <button
            key={s.id}
            ref={current ? currentRef : undefined}
            draggable
            onDragStart={(e) => {
              setDragFrom(n);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              e.preventDefault();
              // カーソルが項目の上半分なら手前、下半分なら後ろへ挿す
              const r = e.currentTarget.getBoundingClientRect();
              setDropAt(e.clientY < r.top + r.height / 2 ? n : n + 1);
            }}
            onDragEnd={() => {
              if (dragFrom !== null && dropAt !== null) {
                const to = dropAt > dragFrom ? dropAt - 1 : dropAt;
                doMove(dragFrom, to);
              }
              setDragFrom(null);
              setDropAt(null);
            }}
            onClick={() => void goto(n)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ page: n, x: e.clientX, y: e.clientY });
            }}
            className="relative flex w-full items-start gap-1.5 px-2 py-1 text-left"
            style={{ opacity: dragFrom === n ? 0.4 : 1 }}
            title={s.title ?? `${n}枚目`}
          >
            {/* 挿入位置インジケータ */}
            {dropAt === n && dragFrom !== null && (
              <span className="absolute left-2 right-2 top-0 h-[2px] rounded-full" style={{ backgroundColor: PPT_ACCENT }} />
            )}
            {dropAt === n + 1 && dragFrom !== null && (
              <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full" style={{ backgroundColor: PPT_ACCENT }} />
            )}
            <span
              className="mt-0.5 w-4 shrink-0 text-right text-[10px] tabular-nums"
              style={{ color: current ? PPT_ACCENT : pal.sub, fontWeight: current ? 700 : 400 }}
            >
              {n}
            </span>
            <span
              className="relative block aspect-video w-full overflow-hidden rounded-[3px] bg-white"
              style={{
                boxShadow: current ? `0 0 0 2px ${PPT_ACCENT}` : `0 0 0 1px ${pal.border}`,
                opacity: s.hidden ? 0.45 : 1,
              }}
            >
              {/* 枠の実効幅にぴったり合わせて縮小する。
                  レール176 − ボタン左右padding16 − 番号列16 − 間隔6 = 138px。
                  ここがずれると右・下に隙間が出る(レール幅を変えたら要追従) */}
              <span
                className="pointer-events-none absolute left-0 top-0 origin-top-left"
                style={{ width: 1920, height: 1080, transform: `scale(${138 / 1920})` }}
              >
                <MemoSlideRender page={n} template={s.template} edited={s.edited} />
              </span>
              {unresolvedCount(s.comments) > 0 && (
                <span
                  className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0F6CBD] px-1 text-[9px] font-bold text-white"
                  title={`未解決コメント ${unresolvedCount(s.comments)}件`}
                >
                  {unresolvedCount(s.comments)}
                </span>
              )}
              {s.hidden && (
                <span
                  className="absolute inset-0 flex items-center justify-center"
                  title="非表示スライド(スライドショー・書き出しから除外)"
                >
                  <span className="rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">
                    <EyeOff className="mr-0.5 inline h-2.5 w-2.5 align-[-2px]" />
                    非表示
                  </span>
                </span>
              )}
            </span>
          </button>
        );
      })}

      {/* 右クリックメニュー */}
      {menu && (
        <div
          className="fixed z-[100] min-w-[176px] rounded-md border py-1 shadow-xl"
          style={{ left: menu.x, top: menu.y, backgroundColor: pal.control, borderColor: pal.border }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {([
            ['上へ移動', ArrowUp, () => doMove(menu.page, menu.page - 1), menu.page <= 1],
            ['下へ移動', ArrowDown, () => doMove(menu.page, menu.page + 1), menu.page >= deck.slides.length],
            ['複製', Copy, () => doDuplicate(menu.page), false],
            [menuEntry?.hidden ? '表示する' : '非表示スライドに設定', EyeOff, () => doToggleHidden(menu.page), false],
            ['削除', Trash2, () => doDelete(menu.page), deck.slides.length <= 1],
          ] as const).map(([label, Icon, fn, disabled], i) => (
            <button
              key={i}
              disabled={disabled}
              onClick={() => { setMenu(null); fn(); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]"
              style={{ color: disabled ? pal.disabled : label === '削除' ? '#e5534b' : pal.text }}
              onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.backgroundColor = pal.hover; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================ 下: ステータスバー ============================ */

export function PptStatusBar({ page, total, theme }: { page: number; total: number; theme: PptTheme }) {
  const pal = PALETTES[theme];
  const { zoom, setZoom, fitZoom } = useEditorContext();
  return (
    <div
      className="flex h-7 items-center gap-3 border-t px-3 text-[11px]"
      style={{ backgroundColor: pal.rail, borderColor: pal.border, color: pal.sub }}
    >
      <span>スライド {page} / {total}</span>
      <span className="ml-auto" />
      <button onClick={() => setZoom(Math.max(10, zoom - 10))} className="rounded p-0.5" title="縮小" style={{ color: pal.sub }}>
        <ZoomOut className="h-3.5 w-3.5" />
      </button>
      <input
        type="range"
        min={10}
        max={400}
        value={zoom}
        onChange={(e) => setZoom(parseInt(e.target.value, 10))}
        className="w-28"
        style={{ accentColor: PPT_ACCENT }}
      />
      <button onClick={() => setZoom(Math.min(300, zoom + 10))} className="rounded p-0.5" title="拡大" style={{ color: pal.sub }}>
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
      <span className="w-9 text-right tabular-nums">{Math.round(zoom)}%</span>
      <button onClick={() => setZoom(fitZoom)} className="rounded p-0.5" title="画面に合わせる" style={{ color: pal.sub }}>
        <Maximize className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
