'use client';

/**
 * EditorHistoryContext
 *
 * エディタの履歴（Undo/Redo）を管理するContext。
 *
 * ここが担保する操作感（Figma基準）:
 *   1. 1回の操作（ドラッグ/リサイズ/キーリピート移動/連続入力）= 1回の取り消し
 *      → 途中経過や「見た目が何も変わらない取り消し」を履歴に溜めない
 *   2. Cmd+Z で戻したとき、その操作の対象だった要素が選択された状態で復元される
 *
 * ■ なぜ履歴スタックを自前で持つのか
 *   以前は useEditorHistory(hooks/useEditorHistory.ts) に委譲していたが、
 *   - past/present を state だけで持つため、同じtick内に2回 push されると
 *     古い present を掴んで「同じ状態」を二重に積んでしまう（= 何も起きないUndoが挟まる）
 *   - 1操作を1エントリにまとめる（連続変更の吸収）ができない
 *   - どのエントリがどの要素を対象にした操作なのかを保持していないため選択復元ができない
 *   という3点が構造的に解決できない。よってスタックはこのファイルで保持し、
 *   「現在値はrefが正、stateは描画用のミラー」という形にして同一tickの多重pushでも壊れないようにした。
 *
 * ■ 保存するHTMLの正規化について
 *   #artboard.innerHTML には選択枠(.selection-box)やホバー/選択の一時クラスがそのまま入る。
 *   これを素で履歴に積むと
 *   - 選択が変わっただけで別状態と見なされ、見た目が変わらないUndoステップが増える
 *   - Undoで復元したHTMLに古い選択枠が焼き付いたまま挿入され、Reactの選択状態と食い違う
 *     （実測: 2回操作して1回Undoすると、状態は未選択なのに .selection-box が紙面に残る）
 *   ため、push時にエディタUIの痕跡を落としてから積む。
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { MAX_HISTORY_SIZE } from '../../types/editor';
import { useEditorRefs } from './EditorRefsContext';

export interface EditorHistoryContextValue {
  // HTML状態（履歴と連動）
  html: string;
  setHtml: (html: string) => void;

  // 履歴操作
  pushHistory: (html: string, selectedId?: string | null) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  clearHistory: () => void;

  // Undo/Redo実行検知用（他のContextから参照）
  isUndoRedoRef: React.MutableRefObject<boolean>;
}

const EditorHistoryContext = createContext<EditorHistoryContextValue | null>(null);

export function useEditorHistory(): EditorHistoryContextValue {
  const context = useContext(EditorHistoryContext);
  if (!context) {
    throw new Error('useEditorHistory must be used within EditorHistoryProvider');
  }
  return context;
}

// ============================================================
// 定数
// ============================================================

/**
 * 連続変更をまとめる時間窓(ms)。
 * この間に届いた「構造も対象も同じ変更」は直前のエントリを置き換える。
 * - 矢印キーのキーリピート(約30ms間隔)・テキスト入力・プロパティ入力が1エントリにまとまる
 * - 意図的に間を空けた操作(400ms超)は別エントリのまま残る
 * ドラッグ/リサイズはmouseupで1回しかpushされないため、この窓に依存せず元から1エントリ。
 */
const COALESCE_WINDOW_MS = 400;

/**
 * 履歴に残してはいけないエディタUIのノード。
 * （紙面の中身ではなく、エディタが一時的に差し込んでいる装飾）
 */
const EDITOR_CHROME_SELECTOR = [
  '.selection-box',
  '.marquee-selection-box',
  '.drag-ghost',
  '.flex-drop-indicator',
  '.nesting-drop-indicator',
  '.auto-layout-drop-indicator',
].join(',');

/**
 * 履歴に残してはいけない一時クラス。
 * 選択やホバーの状態はReact側が持つべきもので、HTMLに焼き付けない。
 * （同時進行で選択まわりを直しているため、確実に一時的だと分かるものだけに絞る）
 */
const TRANSIENT_CLASSES = ['selected', 'hover-preview', 'dragging', 'editing'];

/** Undo/Redo後に選択を復元するまでの再試行タイミング(ms) */
const SELECTION_RESTORE_DELAYS = [30, 90, 200, 360, 560];

// ============================================================
// 履歴エントリ
// ============================================================

interface HistoryEntry {
  /** 正規化済みHTML（エディタUIの痕跡を除いたもの） */
  html: string;
  /** この状態を作った操作の対象要素（Undo時にこれを選び直す） */
  selectionIds: string[];
  /** 構造シグネチャ。要素の増減・並び替えを検出して連続吸収を打ち切るために使う */
  signature: string;
  /** 直前に積まれた時刻 */
  timestamp: number;
  /** 次の変更をこのエントリに吸収してよいか（初期状態・Undo直後は不可） */
  coalescable: boolean;
}

interface HistoryStacks {
  past: HistoryEntry[];
  present: HistoryEntry;
  future: HistoryEntry[];
}

// ============================================================
// HTMLの正規化
// ============================================================

/**
 * エディタUIの痕跡を落としたHTMLと、構造シグネチャを作る。
 * DOMParserではなく <template> を使うのは、内容がinertで画像読み込み等の副作用が無いため。
 */
function normalizeSnapshot(rawHtml: string): { html: string; signature: string } {
  if (typeof document === 'undefined') {
    return { html: rawHtml, signature: rawHtml.length.toString() };
  }

  try {
    const template = document.createElement('template');
    template.innerHTML = rawHtml;

    // 1) エディタが差し込んだ装飾ノードを取り除く
    template.content.querySelectorAll(EDITOR_CHROME_SELECTOR).forEach((node) => {
      node.remove();
    });

    // 2) 一時クラスを落とす
    TRANSIENT_CLASSES.forEach((cls) => {
      template.content.querySelectorAll(`.${cls}`).forEach((node) => {
        node.classList.remove(cls);
      });
    });
    // 空になったclass属性は落とす。
    // 「元から空」と「剥がして空になった」が同じ表記になるようにして、
    // 見た目が同じなのに別状態と判定される（＝何も起きないUndoが増える）のを防ぐ。
    template.content.querySelectorAll('[class=""]').forEach((node) => {
      node.removeAttribute('class');
    });

    // 3) 構造シグネチャ（要素idの並び）。装飾ノード除去後に取るので、
    //    ハンドル等に付いているidは混ざらない。
    const ids: string[] = [];
    template.content.querySelectorAll('[data-element-id]').forEach((node) => {
      ids.push(node.getAttribute('data-element-id') || '');
    });

    return { html: template.innerHTML, signature: ids.join(',') };
  } catch {
    // パースに失敗しても履歴自体は止めない
    return { html: rawHtml, signature: rawHtml.length.toString() };
  }
}

function sameSelection(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

/** 指定idが復元先のHTMLに実在するか */
function existsInHtml(html: string, id: string): boolean {
  return html.includes(`data-element-id="${id}"`);
}

// ============================================================
// Provider
// ============================================================

interface EditorHistoryProviderProps {
  initialHtml: string;
  children: React.ReactNode;
}

export function EditorHistoryProvider({
  initialHtml,
  children,
}: EditorHistoryProviderProps) {
  // Undo/Redo実行中フラグ（iframe同期側が参照する）
  const isUndoRedoRef = useRef<boolean>(false);

  // EditorRefsProviderはこのProviderの外側にあるので参照できる。
  // - getIframeDoc: 選択を戻す対象のiframeを取り違えないため
  // - iframeHtmlRef: Undo/Redoの反映漏れを防ぐため（詳細は applyEntry のコメント）
  const { getIframeDoc, iframeHtmlRef } = useEditorRefs();

  const createInitialStacks = (): HistoryStacks => ({
    past: [],
    // 初期状態は coalescable: false。
    // ここを吸収可能にすると最初の1操作が初期状態を上書きして戻せなくなる。
    present: {
      html: initialHtml,
      selectionIds: [],
      signature: '',
      timestamp: 0,
      coalescable: false,
    },
    future: [],
  });

  const [stacks, setStacks] = useState<HistoryStacks>(createInitialStacks);

  // 現在値の正はref側。stateは描画用のミラー。
  // こうしないと、同じtickに複数回pushが来たとき古いpresentを二重に積んでしまう
  // （＝何も起きないUndoが1回挟まる）。
  const stacksRef = useRef<HistoryStacks>(stacks);

  const commit = useCallback((next: HistoryStacks) => {
    stacksRef.current = next;
    setStacks(next);
  }, []);

  // 最後に分かっている選択（削除など、push時点では選択が消えている操作の保険）
  const lastSelectionRef = useRef<string[]>([]);
  // 選択復元の世代。新しい操作が入ったら古い復元処理は諦める
  const restoreTokenRef = useRef<number>(0);

  // --- 選択の解決 ---------------------------------------------------------
  // 呼び出し側が渡す selectedId が最も確度が高い（削除時も、React stateの更新前に
  // 呼ばれるため削除対象のidが入っている）。無い場合のみ直近の選択にフォールバックする。
  const resolveSelectionIds = useCallback((selectedId?: string | null): string[] => {
    if (selectedId) {
      lastSelectionRef.current = [selectedId];
      return [selectedId];
    }
    return lastSelectionRef.current;
  }, []);

  // --- 選択復元 -----------------------------------------------------------
  /**
   * Undo/Redo後に対象要素を選び直す。
   *
   * 復元後は EditorContext 側の同期処理が選択を明示的にクリアするため、
   * こちらは「クリアされた後」に選び直す必要がある。タイミングを決め打ちできないので
   * 数回に分けて試し、成功したら止める。
   * 選択のセットには既存の 'breadcrumb-select' メッセージ経路を使う
   * （クラス付与・選択枠・React stateの更新が1か所で揃うため）。
   *
   * [制限] この経路は setSelectedElementIds([id]) と単一選択しか組み立てられないため、
   * 複数要素をまとめて動かした操作のUndoでは代表1件だけが選択された状態に戻る。
   * 複数件を戻すには受け側(useEditorMessages)に複数選択用のメッセージが必要で、
   * それは今回の担当ファイル外なのでここでは踏み込まない。
   * 半端に .selected だけ付けるとReact側の選択状態と食い違うため、DOM直接操作はしない。
   */
  const scheduleSelectionRestore = useCallback((ids: string[], targetHtml: string) => {
    const id = ids.find((candidate) => candidate && existsInHtml(targetHtml, candidate));
    if (!id) return;

    const token = ++restoreTokenRef.current;

    const findDoc = (): Document | null => {
      // 編集中のiframeが正。対象要素がまだ入っていない間は「復元待ち」として扱う
      const doc = getIframeDoc();
      if (doc && doc.querySelector(`[data-element-id="${id}"]`)) return doc;
      return null;
    };

    // 1回でも選択を投げたか。
    // 投げる前のDOMは「まだ差し替わっていない直前の状態」の可能性があり、
    // そこには操作中の .selected が残っている。これを「復元済み」「ユーザーが選び直した」と
    // 誤読して打ち切ると、差し替え後に選択が消えたまま二度と戻らなくなる。
    // よって打ち切り判定は「1回投げた後」だけ効かせる。
    let posted = false;

    const attempt = () => {
      if (restoreTokenRef.current !== token) return; // 新しい操作が入った
      const doc = findDoc();
      if (!doc) return; // まだ差し替わっていない → 次の試行へ

      const target = doc.querySelector(`[data-element-id="${id}"]`) as HTMLElement | null;
      if (!target) return;

      if (posted && target.classList.contains('selected')) {
        restoreTokenRef.current++; // 復元済み。以降の試行は打ち切る
        return;
      }

      // ユーザーが別の要素を選び直していたら邪魔しない
      const otherSelected = Array.from(doc.querySelectorAll('.selected')).some(
        (el) => !el.closest('.selection-box') && el !== target
      );
      if (posted && otherSelected) {
        restoreTokenRef.current++;
        return;
      }

      window.postMessage({ type: 'breadcrumb-select', elementId: id }, '*');
      posted = true;
    };

    SELECTION_RESTORE_DELAYS.forEach((delay) => setTimeout(attempt, delay));
  }, [getIframeDoc]);

  /**
   * Undo/Redoで状態を適用する共通処理。
   *
   * iframeへの反映は他Context側のeffectが
   *   「isUndoRedoRef が立っている」かつ「history.html !== iframeHtmlRef.current」
   * のときだけ行う。iframeHtmlRefは変更経路によっては更新されない（notifyIframeChange経由の
   * 削除・整列など）ため、"Undo → 別の編集 → Undo" で戻り先が前回と同じHTMLになると
   * 一致してしまい、Cmd+Zが完全に無反応になる（旧実装でも同じ現象を実測）。
   * ここで「いま画面に出ているのは離れる側の状態」と記録し直しておけば、
   * 履歴は重複を積まないので必ず不一致になり、反映が飛ばされることがなくなる。
   */
  const applyEntry = useCallback(
    (leaving: HistoryEntry, next: HistoryStacks) => {
      isUndoRedoRef.current = true;
      iframeHtmlRef.current = leaving.html;
      commit(next);
    },
    [commit, iframeHtmlRef]
  );

  // --- 履歴追加 -----------------------------------------------------------
  const pushHistory = useCallback(
    (rawHtml: string, selectedId?: string | null) => {
      const { html, signature } = normalizeSnapshot(rawHtml);
      const current = stacksRef.current;

      // 実質的な変化が無いものは積まない
      // （選択枠や一時クラスの差はここまでで消えているので、選択操作では履歴が増えない）
      if (html === current.present.html) return;

      const selectionIds = resolveSelectionIds(selectedId);
      const now = Date.now();

      // 直前のエントリに吸収するか（= 1操作1エントリにまとめる）
      const merge =
        current.present.coalescable &&
        now - current.present.timestamp <= COALESCE_WINDOW_MS &&
        current.present.signature === signature && // 要素の増減・並び替えがあれば別操作
        sameSelection(current.present.selectionIds, selectionIds); // 対象が違えば別操作

      const nextEntry: HistoryEntry = {
        html,
        selectionIds,
        signature,
        timestamp: now,
        coalescable: true,
      };

      if (merge) {
        // pastには積まず、現在エントリを更新するだけ
        commit({ past: current.past, present: nextEntry, future: [] });
        restoreTokenRef.current++;
        return;
      }

      const past = [...current.past, current.present];
      commit({
        past: past.length > MAX_HISTORY_SIZE ? past.slice(past.length - MAX_HISTORY_SIZE) : past,
        present: nextEntry,
        future: [], // 新しい操作でRedoは無効化
      });
      restoreTokenRef.current++;
    },
    [commit, resolveSelectionIds]
  );

  // --- 履歴に残さないHTML更新 --------------------------------------------
  const setHtml = useCallback(
    (rawHtml: string) => {
      const { html, signature } = normalizeSnapshot(rawHtml);
      const current = stacksRef.current;
      if (html === current.present.html) return;

      commit({
        ...current,
        present: {
          ...current.present,
          html,
          signature,
          // 履歴段を作らない更新なので、次のpushはここに吸収させず新しい段にする
          coalescable: false,
          timestamp: Date.now(),
        },
      });
    },
    [commit]
  );

  // --- Undo ---------------------------------------------------------------
  const undo = useCallback(() => {
    const current = stacksRef.current;
    if (current.past.length === 0) return;

    const previous = current.past[current.past.length - 1];
    const leaving = current.present;

    applyEntry(leaving, {
      past: current.past.slice(0, -1),
      // 戻した直後の状態には吸収させない（次の操作は必ず新しい段になる）
      present: { ...previous, coalescable: false },
      future: [leaving, ...current.future],
    });

    // 取り消した操作の対象要素を選び直す。
    // 対象が消えている場合（挿入のUndoなど）は、戻した先が対象にしていた要素を試す。
    scheduleSelectionRestore(
      [...leaving.selectionIds, ...previous.selectionIds],
      previous.html
    );
  }, [applyEntry, scheduleSelectionRestore]);

  // --- Redo ---------------------------------------------------------------
  const redo = useCallback(() => {
    const current = stacksRef.current;
    if (current.future.length === 0) return;

    const next = current.future[0];

    applyEntry(current.present, {
      past: [...current.past, current.present],
      present: { ...next, coalescable: false },
      future: current.future.slice(1),
    });

    scheduleSelectionRestore(
      [...next.selectionIds, ...current.present.selectionIds],
      next.html
    );
  }, [applyEntry, scheduleSelectionRestore]);

  // --- 履歴クリア ---------------------------------------------------------
  const clearHistory = useCallback(() => {
    const current = stacksRef.current;
    commit({
      past: [],
      present: { ...current.present, coalescable: false },
      future: [],
    });
    restoreTokenRef.current++;
  }, [commit]);

  // --- スライド切り替え時のリセット ---------------------------------------
  // 履歴が空のまま初期HTMLだけ差し替わった場合（別スライドを開いた等）は現在値を追従させる。
  // 旧実装(useEditorHistory)と同じ条件・同じ依存配列を維持している。
  useEffect(() => {
    const current = stacksRef.current;
    if (
      current.past.length === 0 &&
      current.future.length === 0 &&
      current.present.html !== initialHtml
    ) {
      commit({
        past: [],
        present: {
          html: initialHtml,
          selectionIds: [],
          signature: '',
          timestamp: 0,
          coalescable: false,
        },
        future: [],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml]);

  // --- 開発時の確認用 -----------------------------------------------------
  // 「1操作=1エントリ」を実機で数えるために、スタックの深さだけ公開する。
  useEffect(() => {
    // [パッケージ化での変更] バンドラ固有の env に依存しない
    if (process.env.NODE_ENV !== 'development') return;
    (window as unknown as Record<string, unknown>).__editorHistoryDebug = {
      past: stacks.past.length,
      future: stacks.future.length,
      selectionIds: stacks.present.selectionIds,
      timestamp: stacks.present.timestamp,
      htmlLength: stacks.present.html.length,
    };
  }, [stacks]);

  const value = useMemo<EditorHistoryContextValue>(
    () => ({
      html: stacks.present.html,
      setHtml,
      pushHistory,
      undo,
      redo,
      canUndo: stacks.past.length > 0,
      canRedo: stacks.future.length > 0,
      clearHistory,
      isUndoRedoRef,
    }),
    [stacks, setHtml, pushHistory, undo, redo, clearHistory]
  );

  return (
    <EditorHistoryContext.Provider value={value}>
      {children}
    </EditorHistoryContext.Provider>
  );
}
