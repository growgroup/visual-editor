/**
 * キャンバス(iframe)側のキーボード関連ユーティリティ
 *
 * [移植時の修正]
 * このフックは以前 iframeDoc に独自の keydown ハンドラを張り、
 * ツール切替 / Cmd+A / Cmd+G / Undo / Copy / Delete / Duplicate を
 * 自前の if 羅列で判定していた。同じキーを親 window 側でも見ていたため、
 *  - Cmd+D で複製が2個できる（親フォーカス時に二重発火）
 *  - Cmd+A や矢印キーはフォーカス位置によって効いたり効かなかったりする
 * という状態だった。
 *
 * キー判定は KEYBOARD_SHORTCUTS を読む唯一のディスパッチャ
 * （src/hooks/useEditorShortcuts.ts）に集約し、ここには
 * ディスパッチャから呼ばれる「キャンバス側の実処理」だけを残している。
 * postMessage（SHORTCUT_COPY 等）による親への迂回も廃止した。
 */

import { useCallback } from 'react';
import { refreshSelectionOverlay, getArtboardContent } from '../utils/dom-utils';
import { useEditorContext } from '../EditorContext';
import { COALESCE_WINDOW_MS } from '../utils/history-timing';
import { alignElements, distributeElements, mirrorPositions, type AlignMode, type DistributeAxis } from '../utils/align-elements';
import { applyTailwindStyles } from '../utils/tailwind-utils';
import { extractElementInfo } from '../utils/style-utils';
import type { ShortcutCallbacks } from '../../types/editor';
import { LOCK_ATTR, isLockedEl, withoutLocked } from '../utils/lock';

interface UseKeyboardShortcutsOptions {
  /** グループ化関数 */
  groupElements?: () => void;
  /** グループ解除関数 */
  ungroupElements?: () => void;
  /** スタイルコピー関数 */
  copyStyle?: () => boolean;
  /** スタイルペースト関数 */
  pasteStyle?: () => boolean;
  /** Figma形式でコピー関数 */
  copyToFigma?: () => Promise<{ success: boolean; error?: string; nodeCount?: number }>;
}

interface UseKeyboardShortcutsReturn {
  /**
   * 以前は iframe に keydown を張っていた。
   * 現在はディスパッチャ側が iframe document にも直接張るため、ここでは何もしない。
   * （EditorCanvas 側の呼び出し構造を変えずに済むよう、空のクリーンアップを返す）
   */
  setupKeyboardShortcuts: (iframeDoc: Document) => () => void;
}

/**
 * ドラッグ中断関数(useDragResize の cancelDrag)への参照レジストリ。
 *
 * ドラッグ状態は EditorCanvas 内の ref が持っているため、
 * 別コンポーネントにあるキーボードディスパッチャからは直接呼べない。
 * EditorRefsContext の globalStyleClipboardRef と同じ「モジュールレベルのref」方式で橋渡しする。
 */
export const editorCancelDragRef: {
  current: ((iframeDoc?: Document | null) => boolean) | null;
} = { current: null };

/**
 * Cmd/Ctrl + A の実処理。
 *
 * - 何か選択されていれば「その要素の兄弟をすべて選択」
 * - 何も選択されていなければ「紙面直下のトップレベル要素をすべて選択」
 *   （以前は無選択だと無反応で、既定フォーカスでは Cmd+A が完全に死んでいた）
 *
 * @returns 選択した要素のID配列
 */
export function selectAllSiblingsIn(
  iframeDoc: Document,
  currentIds: string[]
): { ids: string[]; elements: HTMLElement[] } {
  const artboard = iframeDoc.getElementById('artboard');

  // 起点となる親を決める
  let parent: HTMLElement | null = null;
  if (currentIds.length > 0) {
    const first = iframeDoc.querySelector<HTMLElement>(
      `[data-element-id="${currentIds[0]}"]`
    );
    parent = first?.parentElement ?? null;
  }
  // 無選択時は「紙面のトップレベル要素」を全部選ぶ。
  // artboard 直下は data-editable でないラッパー div のことがあるため、
  // 「編集可能な祖先を持たない data-editable 要素」を最上位とみなす。
  let siblings: HTMLElement[];
  if (parent) {
    siblings = Array.from(parent.children).filter(
      (child) => child.getAttribute('data-editable') === 'true'
    ) as HTMLElement[];
  } else {
    if (!artboard) return { ids: [], elements: [] };
    siblings = Array.from(
      artboard.querySelectorAll<HTMLElement>('[data-editable="true"]')
    ).filter((el) => {
      const ancestor = el.parentElement?.closest('[data-editable="true"]');
      return !ancestor || !artboard.contains(ancestor);
    });
  }
  // ロック中の要素は紙面からは選ばない(⌘A。Figma の Select all もロック中を飛ばす。記憶)
  siblings = siblings.filter((el) => !isLockedEl(el));
  if (siblings.length === 0) return { ids: [], elements: [] };

  iframeDoc.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
  iframeDoc.querySelectorAll('.selection-box').forEach((box) => box.remove());

  const ids: string[] = [];
  siblings.forEach((el) => {
    const id = el.getAttribute('data-element-id');
    if (id) {
      ids.push(id);
      el.classList.add('selected');
    }
  });

  // 枠は選択セット全体から作り直す（複数選択時は群バウンディングボックスも描かれる）
  refreshSelectionOverlay(iframeDoc);

  return { ids, elements: siblings };
}

/**
 * Tab / Shift+Tab の実処理。兄弟要素を順に1つずつ選び直す(Figma準拠)。
 *
 * - 選択中なら その要素の兄弟(編集可能なもの)を並び順に1つ進む/戻る。端は巻き戻る
 * - 無選択なら 紙面のトップレベル要素の先頭(Shift+Tabなら末尾)を選ぶ
 * - 複数選択中は先頭の要素を起点にして単独選択へ畳む(Figmaと同じ)
 *
 * 兄弟の集合は Cmd+A と同じ規則(selectAllSiblingsIn)で数える。
 * 別々の規則で数えると「Cmd+Aで6個選ばれるのにTabは4個しか巡らない」がすぐ起きるため。
 *
 * @returns 選択した要素(選べなければ null)
 */
export function selectSiblingIn(
  iframeDoc: Document,
  currentIds: string[],
  direction: 1 | -1
): HTMLElement | null {
  const artboard = iframeDoc.getElementById('artboard');
  if (!artboard) return null;

  const current = currentIds.length
    ? iframeDoc.querySelector<HTMLElement>(`[data-element-id="${currentIds[0]}"]`)
    : null;

  // 巡回する集合。選択中はその兄弟、無選択なら紙面のトップレベル
  let siblings: HTMLElement[];
  const parent = current?.parentElement ?? null;
  if (parent) {
    siblings = Array.from(parent.children).filter(
      (child): child is HTMLElement =>
        child.getAttribute('data-editable') === 'true' &&
        !!child.getAttribute('data-element-id')
    );
  } else {
    siblings = Array.from(
      artboard.querySelectorAll<HTMLElement>('[data-editable="true"][data-element-id]')
    ).filter((el) => {
      const ancestor = el.parentElement?.closest('[data-editable="true"]');
      return !ancestor || !artboard.contains(ancestor);
    });
  }
  // Tab の巡回もロック中の要素を飛ばす
  siblings = siblings.filter((el) => !isLockedEl(el));
  if (siblings.length === 0) return null;

  const index = current ? siblings.indexOf(current) : -1;
  // 無選択(index=-1)からは Tab で先頭、Shift+Tab で末尾に入る
  const next =
    index === -1
      ? siblings[direction === 1 ? 0 : siblings.length - 1]
      : siblings[(index + direction + siblings.length) % siblings.length];
  if (!next) return null;

  iframeDoc.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
  iframeDoc.querySelectorAll('.selection-box').forEach((box) => box.remove());
  next.classList.add('selected');
  refreshSelectionOverlay(iframeDoc);
  return next;
}

/**
 * iframe 内で編集中のテキストを確定して抜ける
 */
export function exitTextEditingIn(iframeDoc: Document): boolean {
  const editingElements = iframeDoc.querySelectorAll('[contenteditable="true"]');
  if (editingElements.length === 0) return false;

  editingElements.forEach((el) => {
    el.removeAttribute('contenteditable');
    el.classList.remove('editing');
  });

  const selection = iframeDoc.getSelection();
  if (selection) selection.removeAllRanges();

  // 選択ボックスを再表示（1要素ずつ作り直すと他の枠を巻き込んで壊すため全体を再構築）
  refreshSelectionOverlay(iframeDoc);

  // [確定を履歴に積む]
  // フォーカスが外れて確定する経路(EditorCanvas の focusout)は、contenteditable が
  // まだ付いている要素からのイベントでだけ内容変更を通知する。ここは先に属性を
  // 外すので focusout 経路が黙り、Escape で確定した編集が履歴にも自動保存にも
  // 乗らなかった(Cmd+Z で戻らない・保存されないまま閉じられる)。
  // 同じ内容なら履歴側で重複扱いになるので、変わっていなくても送ってよい
  window.postMessage(
    { type: 'SLIDE_CONTENT_CHANGED', html: getArtboardContent(iframeDoc) },
    '*',
  );
  return true;
}

/**
 * キャンバス側キーボード処理フック（現在はリスナーを張らない）
 */
export function useKeyboardShortcuts(
  _options: UseKeyboardShortcutsOptions = {}
): UseKeyboardShortcutsReturn {
  const setupKeyboardShortcuts = useCallback((_iframeDoc: Document) => {
    // キー判定は useEditorShortcuts（唯一のディスパッチャ）に集約済み。
    // ここで listener を張ると同じキーが二重に発火するので、何も張らない。
    return () => {};
  }, []);

  return { setupKeyboardShortcuts };
}

// ============================================================
// Figma の作法に合わせたキャンバス操作(Enter / Shift+Enter / 整列 / 表示・ロック / 不透明度 / 書式)
// ============================================================

/** 選択枠などオーバーレイの中の要素は「紙面の要素」として数えない */
function isOverlayNode(el: Element): boolean {
  return !!el.closest('.selection-box, #gg-smart-guides, #gg-measure-layer');
}

/**
 * el の「1段内側」の要素。編集できない包み(レイアウト用の div 等)は透過して、
 * 枝ごとに最初に当たる編集可能な要素を拾う(Figma のレイヤーパネルの1段下と同じ見え方)
 */
export function editableChildrenOf(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (isOverlayNode(child)) continue;
      if (child.getAttribute('data-editable') === 'true' && child.getAttribute('data-element-id')) {
        out.push(child as HTMLElement);
      } else {
        walk(child);
      }
    }
  };
  walk(el);
  return out;
}

/** el の1段外側の編集可能な要素。紙面(#artboard)の外へは出ない */
export function editableParentOf(el: HTMLElement): HTMLElement | null {
  const artboard = el.ownerDocument.getElementById('artboard');
  const parent = el.parentElement?.closest<HTMLElement>('[data-editable="true"][data-element-id]') ?? null;
  if (!parent || !artboard || parent === artboard || !artboard.contains(parent)) return null;
  // 紙面いっぱいのルート(スライドの面)は「親」として選ばない。
  // 選べても全体が青くなるだけで、最上位の要素から Esc で抜けられなくなる
  if (
    parent.parentElement === artboard &&
    parent.offsetWidth >= artboard.offsetWidth &&
    parent.offsetHeight >= artboard.offsetHeight
  ) {
    return null;
  }
  return parent;
}

/**
 * 文字を直に持つ要素か(Enter で「子を選ぶ」ではなく「文字の編集に入る」対象)。
 * <p>本文<span>強調</span></p> のような段落は、中の span を子として選ぶより
 * 文字の編集に入るほうが Figma のテキストレイヤーの感覚に近い
 */
function hasOwnText(el: HTMLElement): boolean {
  return Array.from(el.childNodes).some(
    (n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0,
  );
}

function selectedEls(doc: Document, ids: string[]): HTMLElement[] {
  return ids
    .map((id) => doc.querySelector<HTMLElement>(`[data-element-id="${id}"]`))
    .filter((el): el is HTMLElement => !!el && !isOverlayNode(el));
}

/** DOM の選択表示を els に揃える(クラスと枠)。React 側の状態は呼び出し側で合わせる */
function markSelected(doc: Document, els: HTMLElement[]): void {
  doc.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
  els.forEach((el) => el.classList.add('selected'));
  refreshSelectionOverlay(doc);
}

/** 文字の編集に入る。既存のダブルクリック処理(選択済み+文字要素→編集)をそのまま通す */
function startTextEditingViaDblClick(el: HTMLElement): void {
  const view = el.ownerDocument.defaultView;
  if (!view) return;
  const r = el.getBoundingClientRect();
  el.dispatchEvent(
    new view.MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      clientX: r.left + Math.min(8, r.width / 2),
      clientY: r.top + r.height / 2,
      detail: 2,
    }),
  );
}

/**
 * 数字を2つ続けて押したとみなす間隔(ms)。Figma の「4→5 で 45%」(記憶にもとづく・未確認)。
 * 履歴が同じ要素への続けての変更を1つにまとめる間隔と揃える。こうすると2打目が1打目の履歴を
 * 置き換え、⌘Z 1回で「押す前」に戻る(間隔がずれると1打目だけが別の履歴として残る)
 */
const OPACITY_TWO_DIGIT_MS = COALESCE_WINDOW_MS;
let lastOpacityDigit: { digit: number; at: number } | null = null;

/**
 * transform の中の scaleX(-1) / scaleY(-1) を付け外しする。rotate など他の関数は順序ごと残す。
 * 回転のドラッグ(useDragResize の setTransformFn)は scaleX / scaleY を消さないので両立する
 */
export function toggleFlipIn(transform: string, axis: 'x' | 'y'): string {
  const fn = axis === 'x' ? 'scaleX(-1)' : 'scaleY(-1)';
  const pattern = axis === 'x' ? /\s*scaleX\(-1\)/g : /\s*scaleY\(-1\)/g;
  // 回転している要素は、画面の軸で鏡写しにする(Figma と同じ見え方)。
  // 鏡写し × rotate(a) = rotate(-a) × 鏡写し なので、角度の符号を反転してから反転を付け外しする
  const mirrored = transform.replace(/rotate\((-?[\d.]+)deg\)/, (_, deg: string) => {
    const next = -Number(deg);
    return `rotate(${Object.is(next, -0) ? 0 : next}deg)`;
  });
  const cleaned = mirrored.replace(pattern, '').trim();
  if (cleaned !== mirrored.trim()) return cleaned;
  return cleaned ? `${cleaned} ${fn}` : fn;
}

/** ⌘R でレイヤー名の入力を開く合図。レイヤーパネル(と左パネルのタブ)が受け取る */
export const RENAME_LAYER_EVENT = 'gg:rename-layer';

/** ⌘\ で UI を隠すときにエディタの外枠に付けるクラス(skin.css が見る) */
const UI_HIDDEN_CLASS = 'gg-ui-hidden';

/** 文字を直に持つ要素(テキストノードの子がある要素)。⌘⇧> / ⌘⇧< の対象 */
function textBearers(root: HTMLElement): HTMLElement[] {
  const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  return all.filter(
    (el) =>
      !el.closest('.selection-box') &&
      Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim()),
  );
}

/**
 * ⌘\: エディタの外枠(.gg-editor-ui)にクラスを付け外しして、上の帯・左右のパネル・下の帯・道具箱を隠す。
 * 紙面(キャンバス)だけが残る。もう一度 ⌘\ で戻る(Figma の Hide/Show UI)
 */
function toggleEditorUi(): void {
  const shell = document.querySelector('.gg-editor-ui');
  if (!shell) return;
  shell.classList.toggle(UI_HIDDEN_CLASS);
}

/** ⌘⇧O のアウトライン表示。iframe の <html> にクラスを付ける(保存は #artboard の中身だけなので本文には残らない) */
const OUTLINE_CLASS = 'gg-outline-mode';
const OUTLINE_STYLE_ID = 'gg-outline-mode-style';
/**
 * 輪郭表示でも消さないエディタの飾り(選択枠・ハンドル・寸法・吸着ガイド・計測など)。
 * #artboard の中に描かれているので、除外しないと一緒に透明になって選択枠や寸法が見えなくなる
 */
const OUTLINE_KEEP =
  '.selection-box,.marquee-selection-box,.resize-handle,.rotation-handle,.size-label,.element-breadcrumb,' +
  '#gg-smart-guides,#gg-measure-layer,.gg-comment-layer,.gg-collab-layer,.gg-crop-ui';
const OUTLINE_TARGET = `html.${OUTLINE_CLASS} #artboard *:not(:is(${OUTLINE_KEEP})):not(:is(${OUTLINE_KEEP}) *)`;
const OUTLINE_CSS = `
html.${OUTLINE_CLASS} #artboard {
  background: #fff !important;
}
${OUTLINE_TARGET} {
  background: transparent !important;
  box-shadow: none !important;
  border-color: transparent !important;
  outline: 1px solid rgba(0, 0, 0, 0.55) !important;
  outline-offset: -1px;
  -webkit-text-fill-color: transparent !important;
  -webkit-text-stroke: 0.8px #222 !important;
}
${OUTLINE_TARGET}:is(img, video), ${OUTLINE_TARGET}:is(svg *) {
  opacity: 0 !important;
}
`;

/**
 * ⌘⇧O: 紙面の塗り・画像を消して、各要素の枠と文字の輪郭だけを見せる(Figma の Show outlines)。
 * 重なって見えない要素や、透明な器の大きさを確かめるのに使う。もう一度押すと戻る
 */
function toggleOutlineIn(doc: Document): void {
  if (!doc.getElementById(OUTLINE_STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = OUTLINE_STYLE_ID;
    style.textContent = OUTLINE_CSS;
    doc.head.appendChild(style);
  }
  doc.documentElement.classList.toggle(OUTLINE_CLASS);
}

const OPACITY_KEYS = ['opacity1', 'opacity2', 'opacity3', 'opacity4', 'opacity5', 'opacity6', 'opacity7', 'opacity8', 'opacity9', 'opacity0'] as const;

/**
 * Figma 準拠のキャンバス操作をショートカットのコールバック表として返す。
 * FrontendVisualEditor の shortcutCallbacks に展開して使う。
 * 選択が無いときは undefined を返し、キーをブラウザ既定に通す(何も奪わない)。
 */
export function useCanvasShortcutActions(): ShortcutCallbacks {
  const {
    getIframeDoc,
    selectedElement,
    selectedElementIds,
    setSelectedElement,
    setSelectedElementIds,
    notifyIframeChange,
    restoreFocus,
  } = useEditorContext();

  const ids = selectedElementIds.length ? selectedElementIds : selectedElement ? [selectedElement.id] : [];
  const hasSelection = ids.length > 0;

  /** DOM の選択を React 側へ反映する(右パネル・レイヤーパネルが追従する) */
  const commit = useCallback(
    (doc: Document, els: HTMLElement[]) => {
      markSelected(doc, els);
      setSelectedElementIds(els.map((el) => el.getAttribute('data-element-id') || '').filter(Boolean));
      const info = els[0] ? extractElementInfo(els[0], doc) : null;
      setSelectedElement(info ?? null);
      restoreFocus();
    },
    [setSelectedElementIds, setSelectedElement, restoreFocus],
  );

  /** 書き換えたあとの後始末(履歴へ積み、枠と右パネルを描き直す) */
  const afterChange = useCallback(
    (doc: Document, changed: HTMLElement[]) => {
      if (!changed.length) return;
      notifyIframeChange();
      requestAnimationFrame(() => refreshSelectionOverlay(doc));
      const first = selectedEls(doc, ids)[0];
      const info = first ? extractElementInfo(first, doc) : null;
      if (info) setSelectedElement(info);
    },
    // ids は毎レンダー作り直すので文字列で比べる
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notifyIframeChange, setSelectedElement, ids.join(',')],
  );

  /** Enter: 子を選ぶ。文字を直に持つ要素なら文字の編集に入る */
  const selectChildren = useCallback(() => {
    const doc = getIframeDoc();
    if (!doc) return;
    const els = selectedEls(doc, ids);
    if (els.length === 1 && hasOwnText(els[0])) {
      startTextEditingViaDblClick(els[0]);
      return;
    }
    const children = els.flatMap(editableChildrenOf);
    if (children.length === 0) {
      // 子が無い葉(画像・図形・文字だけの要素)。文字を持つなら編集に入る
      if (els.length === 1 && (els[0].textContent ?? '').trim()) startTextEditingViaDblClick(els[0]);
      return;
    }
    commit(doc, children);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getIframeDoc, commit, ids.join(',')]);

  /** Shift+Enter: 親を選ぶ(複数選択なら各要素の親をまとめて)。最上位では何もしない */
  const selectParent = useCallback(() => {
    const doc = getIframeDoc();
    if (!doc) return;
    const parents = Array.from(
      new Set(selectedEls(doc, ids).map(editableParentOf).filter((p): p is HTMLElement => !!p)),
    );
    if (parents.length === 0) return;
    commit(doc, parents);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getIframeDoc, commit, ids.join(',')]);

  const runAlign = useCallback(
    (mode: AlignMode) => {
      const doc = getIframeDoc();
      if (!doc) return;
      afterChange(doc, alignElements(withoutLocked(selectedEls(doc, ids)), mode));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getIframeDoc, afterChange, ids.join(',')],
  );

  const runDistribute = useCallback(
    (axis: DistributeAxis) => {
      const doc = getIframeDoc();
      if (!doc) return;
      afterChange(doc, distributeElements(withoutLocked(selectedEls(doc, ids)), axis));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getIframeDoc, afterChange, ids.join(',')],
  );

  /**
   * ⌘⇧H: 隠す/表示する。書き方はレイヤーパネルの目のアイコンと同じ
   * (visibility:hidden + opacity:0)にそろえる。違う書き方にすると、
   * 片方で隠したものがもう片方で「表示中」に見える
   */
  const toggleHidden = useCallback(() => {
    const doc = getIframeDoc();
    if (!doc) return;
    const els = selectedEls(doc, ids);
    const allHidden = els.length > 0 && els.every((el) => el.style.visibility === 'hidden');
    els.forEach((el) => {
      el.style.visibility = allHidden ? '' : 'hidden';
      el.style.opacity = allHidden ? '' : '0';
    });
    afterChange(doc, els);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getIframeDoc, afterChange, ids.join(',')]);

  /**
   * ⌘⇧L: ロック/解除。data-gg-locked="true" を付けると、紙面のクリックが下の要素へ
   * 素通りする(constants.ts の EDITOR_STYLES)。選択はレイヤーパネルから行える(Figma と同じ)
   */
  const toggleLocked = useCallback(() => {
    const doc = getIframeDoc();
    if (!doc) return;
    const els = selectedEls(doc, ids);
    const allLocked = els.length > 0 && els.every((el) => el.getAttribute(LOCK_ATTR) === 'true');
    els.forEach((el) => {
      if (allLocked) el.removeAttribute(LOCK_ATTR);
      else el.setAttribute(LOCK_ATTR, 'true');
    });
    afterChange(doc, els);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getIframeDoc, afterChange, ids.join(',')]);

  /** 数字キー: 不透明度(1=10% … 9=90%, 0=100%) */
  const setOpacity = useCallback(
    (digit: number) => {
      const doc = getIframeDoc();
      if (!doc) return;
      const els = withoutLocked(selectedEls(doc, ids));
      // 素早く2つ続けたら2桁(4→5 で 45%、0→0 で 0%)。1つだけなら 1=10% … 9=90%、0=100%
      const now = Date.now();
      const prev = lastOpacityDigit && now - lastOpacityDigit.at < OPACITY_TWO_DIGIT_MS ? lastOpacityDigit : null;
      let value: string;
      if (prev) {
        value = String((prev.digit * 10 + digit) / 100);
        lastOpacityDigit = null;
      } else {
        value = digit === 0 ? '1' : String(digit / 10);
        lastOpacityDigit = { digit, at: now };
      }
      els.forEach((el) => applyTailwindStyles(el, { opacity: value }));
      afterChange(doc, els);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getIframeDoc, afterChange, ids.join(',')],
  );

  /**
   * ⇧H / ⇧V: 左右反転・上下反転(help.figma.com「Adjust alignment, rotation, position, and dimensions」の
   * Flip layers と同じキー)。複数選択は Figma と同じく選択全体を 1 つの塊として反転する
   * (各要素の位置を選択群の中心で鏡写しにし、各要素にも反転を付ける)。履歴は 1 回分
   */
  const flip = useCallback(
    (axis: 'x' | 'y') => {
      const doc = getIframeDoc();
      if (!doc) return;
      const els = withoutLocked(selectedEls(doc, ids));
      // 複数選択は塊として鏡写し: 位置を選択群の中心で反転してから、各要素にも反転を付ける
      if (els.length > 1) mirrorPositions(els, axis);
      els.forEach((el) => {
        const next = toggleFlipIn(el.style.transform || '', axis);
        if (next) el.style.transform = next;
        else el.style.removeProperty('transform');
      });
      afterChange(doc, els);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getIframeDoc, afterChange, ids.join(',')],
  );

  /**
   * ⌘⇧> / ⌘⇧<: 文字の大きさを 1px 上げる/下げる。
   * 刻みは記憶にもとづく(help.figma.com「Explore text properties」はキーだけで刻みを書いていない)。
   * 選んだ要素の中で文字を直に持つ要素それぞれを、今の大きさから同じ量だけ動かす
   * (見出しと本文の大きさの差は保つ)。複数選択でも1回の変更 = ⌘Z 1回で戻る。
   */
  const stepFontSize = useCallback(
    (delta: number) => {
      const doc = getIframeDoc();
      const view = doc?.defaultView;
      if (!doc || !view) return;
      const els = withoutLocked(selectedEls(doc, ids));
      const targets = Array.from(new Set(els.flatMap(textBearers)));
      if (!targets.length) return;
      // 先に全部の今の大きさを読む(親を書き換えてから子を読むと継承で値が変わる)
      const sizes = targets.map((el) => parseFloat(view.getComputedStyle(el).fontSize));
      targets.forEach((el, i) => {
        if (!Number.isFinite(sizes[i])) return;
        const next = Math.max(1, Math.round(sizes[i]) + delta);
        // tailwind-merge は text-[Npx] を入れると leading-* を消す(文字の大きさが行の高さも決めるため)。
        // 行の高さは変えたくないので、付いていた leading-* を戻す
        const leading = Array.from(el.classList).filter((c) => /^leading-/.test(c));
        applyTailwindStyles(el, { fontSize: `${next}px` });
        leading.forEach((c) => el.classList.add(c));
      });
      afterChange(doc, els);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getIframeDoc, afterChange, ids.join(',')],
  );

  /**
   * ⌘B / ⌘I / ⌘U: 要素の文字全体の書式を切り替える。
   * 複数選択なら「全部が ON なら OFF、それ以外は全部 ON」(Figma と同じ揃え方)
   */
  const toggleTextStyle = useCallback(
    (kind: 'bold' | 'italic' | 'underline') => {
      const doc = getIframeDoc();
      const view = doc?.defaultView;
      if (!doc || !view) return;
      const els = withoutLocked(selectedEls(doc, ids)).filter((el) => (el.textContent ?? '').trim());
      if (!els.length) return;
      // ホバー中の文字要素にはエディタが青い下線(.text-editable-hover)を引いている。
      // そのまま測ると「下線あり」と読んで ⌘U が毎回 OFF 側に倒れるので、外して測る
      const HOVER_CLASSES = ['text-editable-hover', 'hover-preview'];
      const isOn = (el: HTMLElement) => {
        const had = HOVER_CLASSES.filter((c) => el.classList.contains(c));
        el.classList.remove(...had);
        const cs = view.getComputedStyle(el);
        const on =
          kind === 'bold'
            ? (parseInt(cs.fontWeight, 10) || 400) >= 600
            : kind === 'italic'
              ? cs.fontStyle === 'italic'
              : cs.textDecorationLine.includes('underline');
        el.classList.add(...had);
        return on;
      };
      const turnOn = !els.every(isOn);
      const styles: Record<string, string> =
        kind === 'bold'
          ? { fontWeight: turnOn ? '700' : '400' }
          : kind === 'italic'
            ? { fontStyle: turnOn ? 'italic' : 'normal' }
            : { textDecoration: turnOn ? 'underline' : 'none' };
      els.forEach((el) => applyTailwindStyles(el, styles));
      afterChange(doc, els);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getIframeDoc, afterChange, ids.join(',')],
  );

  // ⌘\ は選択が無くても効く(UI を隠したまま選択を外しても戻せるように)
  const always: ShortcutCallbacks = {
    toggleUi: toggleEditorUi,
    toggleOutline: () => {
      const doc = getIframeDoc();
      if (doc) toggleOutlineIn(doc);
    },
  };
  if (!hasSelection) return always;

  const callbacks: ShortcutCallbacks = {
    ...always,
    flipH: () => flip('x'),
    flipV: () => flip('y'),
    renameLayer: () => {
      const id = ids[0] ?? selectedElement?.id;
      if (id) window.dispatchEvent(new CustomEvent(RENAME_LAYER_EVENT, { detail: { id } }));
    },
    selectChildren,
    selectParent,
    alignLeft: () => runAlign('left'),
    alignRight: () => runAlign('right'),
    alignTop: () => runAlign('top'),
    alignBottom: () => runAlign('bottom'),
    alignHCenter: () => runAlign('hcenter'),
    alignVCenter: () => runAlign('vcenter'),
    distributeH: () => runDistribute('h'),
    distributeV: () => runDistribute('v'),
    toggleHidden,
    toggleLocked,
    toggleBold: () => toggleTextStyle('bold'),
    toggleItalic: () => toggleTextStyle('italic'),
    toggleUnderline: () => toggleTextStyle('underline'),
    fontSizeUp: () => stepFontSize(1),
    fontSizeDown: () => stepFontSize(-1),
  };
  OPACITY_KEYS.forEach((key, i) => {
    callbacks[key] = () => setOpacity(i === 9 ? 0 : i + 1);
  });
  return callbacks;
}
