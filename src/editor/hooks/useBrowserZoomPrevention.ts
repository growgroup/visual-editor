import { useEffect } from 'react';
import { debugLog } from '../utils/debug';

/**
 * ブラウザのネイティブズーム（ピンチ、Ctrl+ホイール、キーボードショートカット等）を防止するフック
 * エディタ画面全体で独自のズーム制御を行うために使用
 */
export function useBrowserZoomPrevention(): void {
  useEffect(() => {
    // body と html にスタイルを適用してブラウザのピンチズームを完全にブロック
    const originalBodyOverflow = document.body.style.overflow;
    const originalBodyTouchAction = document.body.style.touchAction;
    const originalHtmlTouchAction = document.documentElement.style.touchAction;
    const originalHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    document.documentElement.style.touchAction = 'none';
    document.documentElement.style.overflow = 'hidden';
    
    // Add custom attribute to trigger CSS protections from globals.css
    document.body.setAttribute('data-editor-active', 'true');

    // Chrome macOSのピンチズーム（wheelイベント + ctrlKey）を防止
    // 注: stopPropagation/stopImmediatePropagationは呼ばない
    // → キャンバスのズームハンドラにイベントが到達する必要がある
    const preventBrowserZoom = (e: WheelEvent) => {
      // ctrlKey または metaKey が押されている場合（ピンチジェスチャー含む）
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };

    // Safari/WebKitのジェスチャーイベントを防止
    const preventGesture = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    };

    // タッチイベントでの2本指ピンチを防止
    const preventTouchZoom = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // キーボードショートカットでのブラウザデフォルト動作を防止
    // - Ctrl/Cmd + +/-/0: ズーム
    // - Ctrl/Cmd + Alt + C: Chrome DevTools (開発者ツールのJavaScriptコンソール)
    // - Ctrl/Cmd + Alt + V: 一部ブラウザのショートカット
    // 注意: stopImmediatePropagation は使わない（自前のハンドラーも止まってしまうため）
    const preventBrowserShortcuts = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // ズーム防止
      if (isCmdOrCtrl && (key === '+' || key === '-' || key === '=' || key === '0')) {
        e.preventDefault();
        return;
      }

      // スタイルコピー/ペースト用のショートカット（DevTools起動を防止）
      // Cmd/Ctrl + Alt + C または Cmd/Ctrl + Alt + V
      // 注意: macOSではOption+CやOption+Vが特殊文字（ç, √）を生成するため、
      // e.key ではなく e.code を使用して物理キーを判定する
      // preventDefault のみでブラウザのデフォルト動作を止め、自前のハンドラーは動くようにする
      if (isCmdOrCtrl && e.altKey && (e.code === 'KeyC' || e.code === 'KeyV')) {
        debugLog('[preventBrowserShortcuts] Preventing browser default for Cmd/Ctrl+Alt+C/V', {
          key: e.key,
          code: e.code,
        });
        e.preventDefault();
        return;
      }
    };

    // document と window 両方でキャプチャフェーズで登録（最優先）
    document.addEventListener('wheel', preventBrowserZoom, { passive: false, capture: true });
    window.addEventListener('wheel', preventBrowserZoom, { passive: false, capture: true });

    // ジェスチャーイベント（Safari）
    document.addEventListener('gesturestart', preventGesture, { passive: false, capture: true });
    document.addEventListener('gesturechange', preventGesture, { passive: false, capture: true });
    document.addEventListener('gestureend', preventGesture, { passive: false, capture: true });
    window.addEventListener('gesturestart', preventGesture, { passive: false, capture: true });
    window.addEventListener('gesturechange', preventGesture, { passive: false, capture: true });
    window.addEventListener('gestureend', preventGesture, { passive: false, capture: true });

    // タッチイベント
    document.addEventListener('touchstart', preventTouchZoom, { passive: false, capture: true });
    document.addEventListener('touchmove', preventTouchZoom, { passive: false, capture: true });

    // キーボードショートカット防止（ズーム、DevTools等）
    document.addEventListener('keydown', preventBrowserShortcuts, { passive: false, capture: true });
    window.addEventListener('keydown', preventBrowserShortcuts, { passive: false, capture: true });

    return () => {
      // スタイルを復元
      document.body.style.overflow = originalBodyOverflow;
      document.body.style.touchAction = originalBodyTouchAction;
      document.documentElement.style.touchAction = originalHtmlTouchAction;
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.body.removeAttribute('data-editor-active');

      document.removeEventListener('wheel', preventBrowserZoom, { capture: true });
      window.removeEventListener('wheel', preventBrowserZoom, { capture: true });
      document.removeEventListener('gesturestart', preventGesture, { capture: true });
      document.removeEventListener('gesturechange', preventGesture, { capture: true });
      document.removeEventListener('gestureend', preventGesture, { capture: true });
      window.removeEventListener('gesturestart', preventGesture, { capture: true });
      window.removeEventListener('gesturechange', preventGesture, { capture: true });
      window.removeEventListener('gestureend', preventGesture, { capture: true });
      document.removeEventListener('touchstart', preventTouchZoom, { capture: true });
      document.removeEventListener('touchmove', preventTouchZoom, { capture: true });
      document.removeEventListener('keydown', preventBrowserShortcuts, { capture: true });
      window.removeEventListener('keydown', preventBrowserShortcuts, { capture: true });
    };
  }, []);
}
