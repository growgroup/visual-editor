'use client';

import { useEffect, useRef } from 'react';
import { ShortcutCallbacks, ShortcutAction, KEYBOARD_SHORTCUTS } from '../types/editor';

interface UseEditorShortcutsOptions {
  enabled?: boolean;
  /**
   * キャンバスの iframe。読み込み（srcdoc の差し替え）のたびに
   * 最新の contentDocument へ同じハンドラを張り直す。
   */
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
}

/**
 * KeyboardEvent からキーマップ検索用の文字列を作る
 */
function buildShortcutKey(event: KeyboardEvent, keyOverride?: string): string {
  const parts: string[] = [];

  // Add modifiers
  if (event.metaKey) parts.push('meta');
  if (event.ctrlKey) parts.push('ctrl');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey) parts.push('alt');

  const raw = keyOverride ?? event.key;
  if (!raw) return parts.join('+');
  const key = raw.toLowerCase();

  // Handle special keys
  if (key !== 'meta' && key !== 'control' && key !== 'shift' && key !== 'alt') {
    parts.push(key);
  }

  return parts.join('+');
}

/**
 * event.code から「素の入力文字」を推定する。
 *
 * macOS で Option(Alt) を併用すると event.key が特殊文字になる（⌥C → "ç"）ため、
 * e.key だけでは Cmd+Alt+C（スタイルコピー）などが引けない。
 * レイアウト差を壊さないように *まず e.key で引き、外れたときだけ* この値で引き直す。
 */
function keyFromCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1].toLowerCase();
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  const bracket = code === 'BracketLeft' ? '[' : code === 'BracketRight' ? ']' : undefined;
  if (bracket) return bracket;
  return undefined;
}

/**
 * このイベントに割り当てられたアクションを引く
 */
function resolveAction(event: KeyboardEvent): ShortcutAction | undefined {
  const direct = KEYBOARD_SHORTCUTS[buildShortcutKey(event)];
  if (direct) return direct;

  const fallbackKey = keyFromCode(event.code);
  if (!fallbackKey) return undefined;
  return KEYBOARD_SHORTCUTS[buildShortcutKey(event, fallbackKey)];
}

/**
 * イベントの発生元がテキスト編集中かどうか
 *
 * [移植時の修正] `target instanceof HTMLElement` で判定してはいけない。
 * iframe 内の要素は *別realm* の HTMLElement なので、親フレームの
 * HTMLElement とは instanceof が一致せず、常に false になっていた。
 * （実測: キャンバスでテキスト編集中に "r" を押すとツールが矩形に切り替わり、
 *   Cmd+A が要素の全選択に化けていた）
 * realm をまたいでも壊れないプロパティ／メソッドだけで判定する。
 */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as (HTMLElement & { closest?: (s: string) => Element | null }) | null;
  if (!el || typeof el !== 'object' || typeof el.tagName !== 'string') return false;

  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;

  if (el.isContentEditable === true) return true;
  if (typeof el.getAttribute === 'function' && el.getAttribute('contenteditable') === 'true') {
    return true;
  }

  if (typeof el.closest === 'function') {
    return !!el.closest('[contenteditable="true"], input, textarea, select');
  }
  return false;
}

/**
 * テキスト編集中でも横取りしてよいアクション。
 *
 * [移植時の修正] 以前は copy / cut / paste / selectAll もここに入っていたため、
 * テキスト編集中の Cmd+C が「要素のコピー」に化け、Cmd+A が兄弟要素の全選択になっていた。
 * 編集中は Undo/Redo と Escape（編集終了）以外はブラウザ既定に通す。
 */
const ALLOWED_IN_EDITABLE: ShortcutAction[] = ['undo', 'redo', 'deselect'];

function isAllowedInEditableContext(action: ShortcutAction | undefined): boolean {
  return action ? ALLOWED_IN_EDITABLE.includes(action) : false;
}

/**
 * エディタのキーボードショートカット・ディスパッチャ（唯一の経路）
 *
 * [設計]
 * - キーマップは KEYBOARD_SHORTCUTS のみ。ここ以外でキー判定をしない。
 * - **同一のハンドラ関数**を親 window と iframe の document の両方に張る。
 *   addEventListener は (関数, capture) が同じなら重複登録を無視するので、
 *   二重登録による二重発火（Cmd+D で複製が2個）が構造的に起こらない。
 * - iframe は srcdoc 差し替えのたびに document が作り直されるため、
 *   load とポーリングで最新の document に張り直す。これでフォーカスが
 *   iframe 内か外かによって効くキーが入れ替わらない。
 * - バブリングフェーズで捕まえる。キャプチャにすると、コンテキストメニューや
 *   AIポップオーバーが document に張っている Escape ハンドラより先に
 *   stopPropagation してしまい、オーバーレイが閉じられなくなるため。
 */
export function useEditorShortcuts(
  callbacks: ShortcutCallbacks,
  options: UseEditorShortcutsOptions = {}
) {
  const { enabled = true, iframeRef } = options;

  // 毎レンダー最新化（ハンドラの識別子は変えない）
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // ハンドラは初回に一度だけ生成し、以降ずっと同じ関数オブジェクトを使う
  const handlerRef = useRef<((event: Event) => void) | null>(null);
  if (!handlerRef.current) {
    handlerRef.current = (event: Event) => {
      if (!enabledRef.current) return;
      const keyboardEvent = event as KeyboardEvent;

      const action = resolveAction(keyboardEvent);
      if (!action) return;

      // イベント発生元 or そのドキュメントのフォーカスがテキスト編集中か
      const doc = (keyboardEvent.target as HTMLElement | null)?.ownerDocument ?? null;
      const inEditableContext =
        isEditableTarget(keyboardEvent.target) || isEditableTarget(doc?.activeElement ?? null);

      if (inEditableContext && !isAllowedInEditableContext(action)) {
        return;
      }

      const callback = callbacksRef.current[action];
      if (!callback) return;

      keyboardEvent.preventDefault();
      keyboardEvent.stopPropagation();
      callback();
    };
  }

  useEffect(() => {
    if (!enabled) return;
    const handler = handlerRef.current;
    if (!handler || typeof window === 'undefined') return;

    // 親ウィンドウ（バブリング）
    window.addEventListener('keydown', handler);

    const attachedDocs = new Set<Document>();
    let watchedIframe: HTMLIFrameElement | null = null;

    // iframe の最新 document へ張り直す。
    // load イベントだけだと「effect 実行時点でまだ iframe が生成されていない」
    // ケースを取りこぼすので、軽いポーリングも併用する。
    const syncIframeListener = () => {
      const el = iframeRef?.current ?? null;
      if (el !== watchedIframe) {
        watchedIframe?.removeEventListener('load', syncIframeListener);
        watchedIframe = el;
        watchedIframe?.addEventListener('load', syncIframeListener);
      }
      let doc: Document | null = null;
      try {
        doc = el?.contentDocument ?? null;
      } catch {
        doc = null;
      }
      if (doc && !attachedDocs.has(doc)) {
        doc.addEventListener('keydown', handler);
        attachedDocs.add(doc);
      }
      // 破棄済み（defaultView が無い）document は保持しない。
      // スライドを切り替えるたびに古い document が溜まるのを防ぐ
      attachedDocs.forEach((d) => {
        if (!d.defaultView) attachedDocs.delete(d);
      });
    };

    syncIframeListener();
    const timer = window.setInterval(syncIframeListener, 400);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', handler);
      watchedIframe?.removeEventListener('load', syncIframeListener);
      attachedDocs.forEach((doc) => {
        try {
          doc.removeEventListener('keydown', handler);
        } catch {
          /* すでに破棄された document は無視 */
        }
      });
      attachedDocs.clear();
    };
  }, [enabled, iframeRef]);
}

/**
 * Get display string for a shortcut
 */
export function getShortcutDisplay(action: ShortcutAction): string {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

  // Find the shortcut key for this action
  for (const [key, mappedAction] of Object.entries(KEYBOARD_SHORTCUTS)) {
    if (mappedAction === action) {
      // Transform key to display format
      let display = key
        .replace('meta+', isMac ? '⌘' : 'Ctrl+')
        .replace('ctrl+', 'Ctrl+')
        .replace('shift+', isMac ? '⇧' : 'Shift+')
        .replace('alt+', isMac ? '⌥' : 'Alt+');

      // Capitalize single letter keys
      if (display.length === 1) {
        display = display.toUpperCase();
      }

      // Format arrow keys
      display = display
        .replace('arrowup', '↑')
        .replace('arrowdown', '↓')
        .replace('arrowleft', '←')
        .replace('arrowright', '→')
        .replace('delete', '⌫')
        .replace('backspace', '⌫')
        .replace('escape', 'Esc');

      return display;
    }
  }

  return '';
}

export default useEditorShortcuts;
