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
import { refreshSelectionOverlay } from '../utils/dom-utils';

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
