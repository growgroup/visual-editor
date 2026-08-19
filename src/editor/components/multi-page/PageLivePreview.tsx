'use client';

import { memo, useRef, useEffect } from 'react';

interface PageLivePreviewProps {
  html: string;
  pageId: string;
  /** iframe読み込み完了時にiframe要素を親に通知 */
  onIframeLoad?: (pageId: string, iframe: HTMLIFrameElement) => void;
}

/**
 * Multi-page canvas用のシンプルHTML生成
 * body > #artboard > content のフラット構造
 */
function generateCanvasPageHtml(content: string): string {
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const scriptUrl = baseUrl
    ? `${baseUrl}/vendor/tailwindcss-browser.js`
    : 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0">
  <script src="${scriptUrl}"></script>
  <style type="text/tailwindcss">
    @layer base {}
    @theme { --font-sans: 'Noto Sans JP', system-ui, sans-serif; }
  </style>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100..900&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    html { margin: 0; padding: 0; touch-action: none; }
    body { margin: 0; padding: 0; width: 100%; background: white; font-family: 'Noto Sans JP', system-ui, sans-serif; overflow: hidden; touch-action: none; }
    #artboard { position: relative; }
  </style>
</head>
<body>
  <div id="artboard">${content}</div>
</body>
</html>`;
}

/**
 * 全ページ同時編集可能なライブiframeプレビュー
 * - シンプルHTML構造（ラッパーなし）
 * - コンテンツ高さ自動測定 → 親にpostMessage
 * - 編集ロジックは親(MultiPageCanvasView)が管理
 */
export const PageLivePreview = memo(function PageLivePreview({
  html,
  pageId,
  onIframeLoad,
}: PageLivePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isLoadedRef = useRef(false);

  // HTML初回読み込み（一度だけ）
  // 初回ロード後はDOM操作で直接編集されるため、html prop変更でのiframe再読込は不要
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    if (!html?.trim()) return;
    if (isLoadedRef.current) return;

    isLoadedRef.current = true;
    const fullHtml = generateCanvasPageHtml(html);
    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    iframe.src = url;

    return () => URL.revokeObjectURL(url);
  }, [html]);

  // 最小限のスクリプト注入（ID付与・高さ測定・イベント転送のみ）
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const injectMinimalScripts = (doc: Document) => {
      if (doc.querySelector('[data-canvas-init]')) return;

      const script = doc.createElement('script');
      script.setAttribute('data-canvas-init', 'true');
      script.textContent = `(function(){
        var PAGE_ID = ${JSON.stringify(pageId)};
        var artboard = document.getElementById('artboard');
        if (!artboard) return;

        // === Assign data-element-id + data-editable to ALL elements ===
        var idCounter = 0;
        function assignElementIds(parent, isArtboardChild) {
          for (var i = 0; i < parent.children.length; i++) {
            var child = parent.children[i];
            if (child.nodeType !== 1) continue;
            if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
            if (!child.getAttribute('data-element-id')) {
              child.setAttribute('data-element-id', 'el-' + (idCounter++));
            }
            // artboard直下の子要素にdata-editableを付与（レイアウトモード変換で必要）
            if (isArtboardChild && !child.hasAttribute('data-editable')) {
              child.setAttribute('data-editable', 'true');
            }
            assignElementIds(child, false);
          }
        }
        assignElementIds(artboard, true);

        // === Height measurement (one-shot) ===
        var heightReported = false;
        function reportHeight() {
          if (heightReported) return;
          var h = artboard.scrollHeight || document.body.scrollHeight;
          if (h > 0) {
            h = Math.min(h, 8000);
            heightReported = true;
            window.parent.postMessage({ type: 'PAGE_CONTENT_HEIGHT', pageId: PAGE_ID, height: h }, '*');
          }
        }
        setTimeout(reportHeight, 500);
        setTimeout(reportHeight, 1500);

        // === Disable trackpad/keyboard zoom natively ===
        var preventZoom = function(e) {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
          }
        };
        window.addEventListener('wheel', preventZoom, { passive: false, capture: true });
        document.addEventListener('wheel', preventZoom, { passive: false, capture: true });

        var preventShortcuts = function(e) {
          if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '0')) {
            e.preventDefault();
          }
        };
        window.addEventListener('keydown', preventShortcuts, { passive: false, capture: true });
        document.addEventListener('keydown', preventShortcuts, { passive: false, capture: true });

        // === Prevent Safari gesture event native behavior ===
        var preventGesture = function(e) {
          e.preventDefault();
        };
        window.addEventListener('gesturestart', preventGesture, { passive: false, capture: true });
        window.addEventListener('gesturechange', preventGesture, { passive: false, capture: true });
        window.addEventListener('gestureend', preventGesture, { passive: false, capture: true });
        document.addEventListener('gesturestart', preventGesture, { passive: false, capture: true });
        document.addEventListener('gesturechange', preventGesture, { passive: false, capture: true });
        document.addEventListener('gestureend', preventGesture, { passive: false, capture: true });

        // === Wheel forwarding ===
        window.addEventListener('wheel', function(e) {
          window.parent.postMessage({
            type: 'PAGE_PREVIEW_WHEEL',
            deltaX: e.deltaX, deltaY: e.deltaY,
            ctrlKey: e.ctrlKey, metaKey: e.metaKey
          }, '*');
        }, { passive: false });

        // === Touch forwarding for pinch zoom ===
        var lastTouches = null;
        document.addEventListener('touchstart', function(e) {
          if (e.touches.length >= 2) {
            e.preventDefault();
            lastTouches = [];
            for (var i = 0; i < e.touches.length; i++) {
              lastTouches.push({ clientX: e.touches[i].clientX, clientY: e.touches[i].clientY });
            }
          }
        }, { passive: false });

        document.addEventListener('touchmove', function(e) {
          if (e.touches.length >= 2) {
            e.preventDefault();
            var touches = [];
            for (var i = 0; i < e.touches.length; i++) {
              touches.push({ clientX: e.touches[i].clientX, clientY: e.touches[i].clientY });
            }
            window.parent.postMessage({
              type: 'PAGE_PREVIEW_TOUCH',
              touchType: 'move',
              touches: touches,
              prevTouches: lastTouches
            }, '*');
            lastTouches = touches;
          }
        }, { passive: false });
        
        document.addEventListener('touchend', function() {
          lastTouches = null;
        });
        document.addEventListener('touchcancel', function() {
          lastTouches = null;
        });

        // === Prevent link navigation ===
        document.addEventListener('click', function(e) {
          var a = e.target.closest('a');
          if (a) e.preventDefault();
        }, true);
      })();`;
      doc.body.appendChild(script);
    };

    try {
      const doc = iframe.contentDocument;
      if (doc && doc.readyState === 'complete' && doc.body) injectMinimalScripts(doc);
    } catch { /* cross-origin */ }

    const handleLoad = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc) injectMinimalScripts(doc);
      } catch { /* cross-origin */ }
      if (onIframeLoad && iframe) onIframeLoad(pageId, iframe);
    };
    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, [pageId, onIframeLoad]);

  if (!html?.trim()) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100">
        <span className="text-gray-400 text-sm">Empty Page</span>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      className="w-full h-full border-0"
      style={{ touchAction: 'none', overscrollBehavior: 'none' }}
      sandbox="allow-same-origin allow-scripts"
      title={`Page ${pageId}`}
    />
  );
});
