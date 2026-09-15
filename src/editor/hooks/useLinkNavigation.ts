/**
 * ⌘ / Ctrl + クリックでリンク先へ移る(utils/link-navigation.ts)の、エディタ側の行き先。
 *
 * ページの切替は、ページ一覧で切り替えるときと同じ経路を通す
 * (未保存の変更は FrontendVisualEditor.handleContentChange が保存してから移る):
 * - キャンバス   … focusPage で視点を寄せ、activatePage で編集中のページにする
 * - 1 ページ表示 … onContentChange(= handleContentChange。保存 → 読み込み → 利用側へ通知)
 */
import { useCallback, useRef } from 'react';
import { useEditorContext } from '../EditorContext';
import { RULER_SIZE, useMultiPageCanvasOptional } from '../contexts/MultiPageCanvasContext';
import {
  attachLinkNavigation,
  clearPendingAnchor,
  findAnchorTarget,
  peekPendingAnchor,
  resolveLinkTarget,
  setPendingAnchor,
  type LinkTarget,
} from '../utils/link-navigation';

/** アンカーの要素を、画面の上端からこれだけ下に置く(定規・フレーム名に隠れないように) */
const ANCHOR_MARGIN = 48;
/** 別のページのアンカーへ移ってきたとき、紙面の高さ・初期位置が落ち着くのを待つ */
const PENDING_ANCHOR_DELAY_MS = 500;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function useLinkNavigation() {
  const { contentList, currentContentId, onContentChange } = useEditorContext();
  const canvas = useMultiPageCanvasOptional();
  const stateRef = useRef({ contentList, currentContentId, onContentChange, canvas });
  stateRef.current = { contentList, currentContentId, onContentChange, canvas };

  /** 紙面の中の要素(`'top'` なら先頭)が見える位置へ紙面を移す。見つからなければ false */
  const revealAnchor = useCallback((iframeDoc: Document, hash: string): boolean => {
    const found = findAnchorTarget(iframeDoc, hash);
    const el = found === 'top' ? iframeDoc.getElementById('artboard') : found;
    if (!el) return false;
    const c = stateRef.current.canvas;

    if (c?.isEnabled) {
      // キャンバス: 紙面(iframe)は伸びきっていてスクロールしない。キャンバスの位置を動かす
      const frameEl = iframeDoc.defaultView?.frameElement as HTMLElement | null;
      const container = c.containerRef.current;
      if (!frameEl || !container) return false;
      const fr = frameEl.getBoundingClientRect();
      const scale = fr.width / (frameEl.clientWidth || fr.width) || 1;
      const er = el.getBoundingClientRect();
      const cr = container.getBoundingClientRect();
      const inset = c.rulersVisible ? RULER_SIZE : 0;
      const left = fr.left + er.left * scale;
      const top = fr.top + er.top * scale;
      const width = Math.min(er.width * scale, cr.width - inset);
      const dy = cr.top + inset + ANCHOR_MARGIN - top;
      const fitsX = left >= cr.left + inset && left + width <= cr.right;
      const dx = fitsX ? 0 : cr.left + inset + ANCHOR_MARGIN - left;
      const { canvasZoom, canvasOffset } = c.viewStore.get();
      c.setView({ zoom: canvasZoom, offset: { x: canvasOffset.x + dx, y: canvasOffset.y + dy } }, { animate: true });
      return true;
    }

    // 1 ページ表示: 紙面の中の #canvas-container がスクロールする
    const container = iframeDoc.getElementById('canvas-container');
    if (!container) {
      el.scrollIntoView({ block: 'start' });
      return true;
    }
    const cr = container.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const fitsX = er.left >= cr.left && er.left + Math.min(er.width, cr.width) <= cr.right;
    container.scrollTo({
      top: container.scrollTop + er.top - cr.top - ANCHOR_MARGIN,
      left: fitsX ? container.scrollLeft : container.scrollLeft + er.left - cr.left - ANCHOR_MARGIN,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
    return true;
  }, []);

  const navigate = useCallback(
    (target: LinkTarget, iframeDoc: Document): string | void => {
      const { currentContentId: currentId, onContentChange: change, canvas: c } = stateRef.current;
      const missingAnchor = (hash: string) => `このページに #${hash} の場所がありません`;
      switch (target.kind) {
        case 'ignore':
          return;
        case 'unresolved':
          return 'このリンク先はページ一覧にありません';
        case 'external':
          // 紙面の iframe は sandbox(allow-popups 無し)なので、親のウィンドウで開く
          window.open(target.url, '_blank', 'noopener,noreferrer');
          return;
        case 'anchor':
          return revealAnchor(iframeDoc, target.hash) ? undefined : missingAnchor(target.hash);
        case 'page': {
          if (target.id === currentId) {
            if (target.hash) return revealAnchor(iframeDoc, target.hash) ? undefined : missingAnchor(target.hash);
            if (c?.isEnabled) c.focusPage(target.id);
            else revealAnchor(iframeDoc, '');
            return;
          }
          setPendingAnchor(target.id, target.hash);
          if (c?.isEnabled) {
            c.focusPage(target.id);
            void c.activatePage(target.id).then((ok) => {
              if (!ok) clearPendingAnchor(target.id);
            });
            return;
          }
          if (!change) {
            clearPendingAnchor(target.id);
            return 'このエディタではページを移れません';
          }
          void Promise.resolve(change(target.id)).then((ok) => {
            if (ok === false) clearPendingAnchor(target.id);
          });
          return;
        }
      }
    },
    [revealAnchor],
  );

  /** 紙面に ⌘ / Ctrl + クリックの移動を付ける。戻り値は後始末 */
  const setupLinkNavigation = useCallback(
    (iframeDoc: Document) => {
      const detach = attachLinkNavigation(iframeDoc, {
        resolve: (href) => {
          const s = stateRef.current;
          return resolveLinkTarget(href, {
            pages: s.contentList,
            currentId: s.currentContentId,
            origin: window.location.origin,
          });
        },
        navigate,
      });
      // 別のページのアンカー(`/company#access`)で移ってきた
      let timer: ReturnType<typeof setTimeout> | null = null;
      if (peekPendingAnchor(stateRef.current.currentContentId)) {
        timer = setTimeout(() => {
          timer = null;
          const hash = peekPendingAnchor(stateRef.current.currentContentId);
          // 作り直される途中のエディタ(1 ページ表示で利用側が読み直す前の 1 枚)なら次に任せる
          if (!hash || !iframeDoc.defaultView?.frameElement?.isConnected) return;
          clearPendingAnchor();
          revealAnchor(iframeDoc, hash);
        }, PENDING_ANCHOR_DELAY_MS);
      }
      return () => {
        detach();
        if (timer) clearTimeout(timer);
      };
    },
    [navigate, revealAnchor],
  );

  return { setupLinkNavigation };
}
