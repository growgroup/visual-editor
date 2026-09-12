/**
 * 埋め込み(マルチフレームのキャンバス)のとき、生きているエディタの iframe で起きた
 * 「キャンバス全体に向けた操作」を親へ転送する。
 *
 * iframe の中で起きたホイール・キー・中ボタンは親には届かない。等倍の単独表示では
 * iframe 自身が #canvas-container をスクロールして受けていたが、埋め込みでは
 * 倍率も位置も外側(useInfiniteCanvas)が持つので、そのまま外へ流す。
 * 座標は iframe の座標のまま送る(受け手が送り元 iframe の実測矩形で親の座標へ直す)
 */

const ZOOM_KEYS = new Set(['=', '+', '-', '_', ';']);

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
}

export function setupEmbeddedCanvasBridge(iframeDoc: Document, iframe: HTMLIFrameElement): () => void {
  const parent = iframeDoc.defaultView?.parent;
  if (!parent) return () => undefined;

  /**
   * iframe の座標 → 親の client 座標。
   * このリスナーは親の realm で作られた関数なので postMessage の e.source は親自身になり、
   * 受け手が送り元の iframe を特定できない。送る前にここで親の座標へ直す(coords: 'parent')
   */
  const toParent = (x: number, y: number) => {
    const rect = iframe.getBoundingClientRect();
    const scale = rect.width / (iframe.clientWidth || rect.width) || 1;
    return { clientX: rect.left + x * scale, clientY: rect.top + y * scale };
  };

  // ---- ホイール(すべて外へ。iframe の中にはスクロールする物が無い)
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    parent.postMessage(
      {
        type: 'EMBEDDED_WHEEL',
        coords: 'parent',
        deltaX: e.deltaMode === 1 ? e.deltaX * 16 : e.deltaMode === 2 ? e.deltaX * 100 : e.deltaX,
        deltaY: e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY,
        ...toParent(e.clientX, e.clientY),
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
      },
      '*',
    );
  };

  // ---- Safari の gesture(ピンチ)はブラウザ拡大を止めるだけ
  const handleGesture = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // ---- 2 本指タッチ = ピンチ
  let lastDistance: number | null = null;
  const distance = (t: TouchList) => (t.length < 2 ? 0 : Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY));
  const handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length >= 2) {
      e.preventDefault();
      lastDistance = distance(e.touches);
    }
  };
  const handleTouchMove = (e: TouchEvent) => {
    if (e.touches.length < 2) return;
    e.preventDefault();
    if (lastDistance == null) return;
    const current = distance(e.touches);
    const center = toParent((e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
    parent.postMessage(
      {
        type: 'EMBEDDED_PINCH',
        coords: 'parent',
        previousDistance: lastDistance,
        currentDistance: current,
        centerX: center.clientX,
        centerY: center.clientY,
      },
      '*',
    );
    lastDistance = current;
  };
  const handleTouchEnd = (e: TouchEvent) => {
    if (e.touches.length < 2) lastDistance = null;
  };

  // ---- キー: Space(パン)、Cmd+/- (ズーム)、Shift+0/1/2(100%・全体・このページ)、Shift+R(定規)
  const forwardKey = (kind: 'down' | 'up') => (e: KeyboardEvent) => {
    const cmd = e.metaKey || e.ctrlKey;
    const typing = isTypingTarget(e.target);
    const isSpace = e.code === 'Space';
    const isZoomKey = cmd && ZOOM_KEYS.has(e.key);
    const isShiftView = !cmd && e.shiftKey && !e.altKey && (['0', '1', '2'].includes(e.key) || ['Digit0', 'Digit1', 'Digit2', 'KeyR'].includes(e.code) || e.key.toLowerCase() === 'r');
    if (!isSpace && !isZoomKey && !isShiftView) return;
    if (typing) return;
    if (isSpace && e.repeat) {
      e.preventDefault();
      return;
    }
    if (kind === 'down') e.preventDefault();
    parent.postMessage(
      {
        type: 'EMBEDDED_KEY',
        kind,
        key: e.key,
        code: e.code,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      },
      '*',
    );
  };
  const handleKeyDown = forwardKey('down');
  const handleKeyUp = forwardKey('up');

  // ---- 中ボタン = パンの開始(以降のマウス移動は親が受ける: 親が iframe の pointer-events を切る)
  const handleMouseDown = (e: MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    parent.postMessage({ type: 'EMBEDDED_PAN_START', coords: 'parent', ...toParent(e.clientX, e.clientY) }, '*');
  };

  const options: AddEventListenerOptions = { passive: false, capture: true };
  iframeDoc.addEventListener('wheel', handleWheel, options);
  iframeDoc.addEventListener('gesturestart', handleGesture, options);
  iframeDoc.addEventListener('gesturechange', handleGesture, options);
  iframeDoc.addEventListener('gestureend', handleGesture, options);
  iframeDoc.addEventListener('touchstart', handleTouchStart, options);
  iframeDoc.addEventListener('touchmove', handleTouchMove, options);
  iframeDoc.addEventListener('touchend', handleTouchEnd, options);
  iframeDoc.addEventListener('touchcancel', handleTouchEnd, options);
  iframeDoc.addEventListener('keydown', handleKeyDown, options);
  iframeDoc.addEventListener('keyup', handleKeyUp, options);
  iframeDoc.addEventListener('mousedown', handleMouseDown, options);

  return () => {
    iframeDoc.removeEventListener('wheel', handleWheel, options);
    iframeDoc.removeEventListener('gesturestart', handleGesture, options);
    iframeDoc.removeEventListener('gesturechange', handleGesture, options);
    iframeDoc.removeEventListener('gestureend', handleGesture, options);
    iframeDoc.removeEventListener('touchstart', handleTouchStart, options);
    iframeDoc.removeEventListener('touchmove', handleTouchMove, options);
    iframeDoc.removeEventListener('touchend', handleTouchEnd, options);
    iframeDoc.removeEventListener('touchcancel', handleTouchEnd, options);
    iframeDoc.removeEventListener('keydown', handleKeyDown, options);
    iframeDoc.removeEventListener('keyup', handleKeyUp, options);
    iframeDoc.removeEventListener('mousedown', handleMouseDown, options);
  };
}
