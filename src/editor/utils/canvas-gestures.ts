/**
 * マルチフレームのキャンバスの拡大縮小を Figma にそろえる部品(0.10.0)。
 *
 * - Safari・WKWebView のトラックパッドのピンチは gesturestart / gesturechange / gestureend で届く
 *   (Chrome・Edge・Electron は ctrl 付きの wheel で届く)。以前は止めるだけで拡大縮小に使っていなかった。
 *   scale は gesturestart からの累積なので、始まりの倍率に掛ける。紙面(iframe)の中で起きたものは親へ転送する
 * - ⌘+ / ⌘− とヘッダーの +/− は 2 の累乗の段(…50% → 100% → 200%…。段の間からは向きの側の段へ)
 * - IME の変換中のキーは奪わない
 * - 選んでいる要素に合わせる(⌘2 / ⇧2)ための矩形
 *
 * DOM と数値だけを扱い、React やキャンバスの Context には触らない(受け手が zoomAt 等を渡す)。
 */

export interface ZoomRange {
  min: number;
  max: number;
}

/**
 * マルチフレームのキャンバスの拡大縮小の設定(`canvasZoomOptions`)。どれも省略時は従来の挙動。
 * Figma にそろえるなら `{ min: 0.02, max: 256, steps: 'powers-of-two', fitShortcut: 'selection' }`
 */
export interface CanvasZoomOptions {
  /** 倍率の下限(省略時 0.02 = 2%) */
  min?: number;
  /** 倍率の上限(省略時 4 = 400%。Figma は 256 = 25600%) */
  max?: number;
  /** ⌘+ / ⌘− とヘッダーの +/− の刻み。'ratio' = 1.25 倍ずつ(省略時)、'powers-of-two' = 2 の累乗の段(Figma) */
  steps?: 'ratio' | 'powers-of-two';
  /** ⌘2 / ⇧2 の合わせ先。'page' = 編集中のページ(省略時)、'selection' = 選んでいる要素(無ければページ。Figma) */
  fitShortcut?: 'page' | 'selection';
}
export type ResolvedCanvasZoomOptions = ZoomRange & Required<Pick<CanvasZoomOptions, 'steps' | 'fitShortcut'>>;

const clamp = (zoom: number, range: ZoomRange) => Math.max(range.min, Math.min(range.max, zoom));

/** ⌘+ / ⌘− の次の倍率。2 の累乗の段へ寄せる(今が段の上なら 1 段、段の間なら向きの側の段へ) */
export function nextZoomLevel(current: number, direction: 1 | -1, range: ZoomRange): number {
  if (!Number.isFinite(current) || current <= 0) return clamp(1, range);
  const exponent = Math.log2(current);
  const EPSILON = 1e-6;
  const next = direction > 0 ? Math.floor(exponent + EPSILON) + 1 : Math.ceil(exponent - EPSILON) - 1;
  return clamp(2 ** next, range);
}

/** IME の変換中のキーか(Safari・Chrome は変換中の keydown に keyCode 229 を出す) */
export function isImeKeyEvent(event: KeyboardEvent): boolean {
  return event.isComposing === true || event.keyCode === 229;
}

// ------------------------------------------------------------------ ピンチ(GestureEvent)

/** WebKit の GestureEvent(型定義は標準の lib に無い) */
export type CanvasGestureEvent = Event & { scale?: number; clientX?: number; clientY?: number };
export type CanvasGesturePhase = 'start' | 'change' | 'end';
export interface EmbeddedGestureMessage {
  type: 'EMBEDDED_GESTURE';
  coords: 'parent';
  phase: CanvasGesturePhase;
  scale: number;
  clientX: number;
  clientY: number;
}

export interface GestureZoomTarget {
  getZoom: () => number;
  /** client 座標の点を動かさずに倍率を変える(倍率の範囲は受け手が収める) */
  zoomAt: (zoom: number, clientX: number, clientY: number) => void;
  markInteracting?: () => void;
}

/** これだけピンチの続きが来なければ、終わったものとみなす(ms) */
const GESTURE_IDLE_MS = 1000;
const PHASES: Array<[CanvasGesturePhase, string]> = [['start', 'gesturestart'], ['change', 'gesturechange'], ['end', 'gestureend']];
const LISTEN = { passive: false, capture: true } as const;

/**
 * ピンチの状態。始まりの倍率を覚え、scale(累積)を掛ける。
 * `active` の間は ctrl 付き wheel での拡大をしない(両方届く環境で二重に拡大しない)。
 * end を取りこぼしたまま止まったら GESTURE_IDLE_MS で解く(ctrl 付き wheel の拡大が戻らなくならない)
 */
export function createGestureZoom(target: () => GestureZoomTarget | null, now: () => number = () => Date.now()) {
  let base: number | null = null;
  let lastAt = 0;
  const isLive = () => base !== null && now() - lastAt < GESTURE_IDLE_MS;
  return {
    get active() { return isLive(); },
    handle(phase: CanvasGesturePhase, scale: number, clientX: number, clientY: number) {
      const canvas = target();
      if (!canvas) return;
      if (phase === 'start') { base = canvas.getZoom(); lastAt = now(); return; }
      // start を取りこぼしても(iframe の読み込み直し等)、今の倍率を始まりにして続ける
      const start = isLive() && base !== null ? base : canvas.getZoom();
      base = start;
      lastAt = now();
      if (Number.isFinite(scale) && scale > 0) {
        canvas.markInteracting?.();
        canvas.zoomAt(start * scale, clientX, clientY);
      }
      if (phase === 'end') base = null;
    },
  };
}

/**
 * 親(キャンバスの容器がある文書)でピンチを受ける。容器の上で起きたものと、紙面の iframe から転送されてきたもの。
 * 容器の外(ヘッダー・パネル)のピンチは拡大しない(ブラウザ自体の拡大は useBrowserZoomPrevention が止める)。
 * GestureEvent に座標が無い環境では、最後にポインタがあった所を中心にする。
 */
export function listenCanvasGestures(input: {
  win: Window;
  container: HTMLElement;
  target: () => GestureZoomTarget | null;
}): { readonly active: boolean; dispose: () => void } {
  const { win, container } = input;
  const zoom = createGestureZoom(input.target);
  let pointer: { x: number; y: number } | null = null;
  const onPointer = (event: MouseEvent) => { pointer = { x: event.clientX, y: event.clientY }; };
  const pointOf = (event: CanvasGestureEvent) => {
    if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) return { x: event.clientX as number, y: event.clientY as number };
    if (pointer) return pointer;
    const rect = container.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const handlers = PHASES.map(([phase, type]) => {
    const handler = (event: Event) => {
      const target = event.target as Node | null;
      if (!target || typeof target.nodeType !== 'number' || !container.contains(target)) return;
      event.preventDefault();
      const gesture = event as CanvasGestureEvent;
      const point = pointOf(gesture);
      zoom.handle(phase, Number(gesture.scale ?? 1), point.x, point.y);
    };
    return [type, handler] as const;
  });
  const onMessage = (event: MessageEvent) => {
    const data = event.data as Partial<EmbeddedGestureMessage> | null;
    if (!data || typeof data !== 'object' || data.type !== 'EMBEDDED_GESTURE' || data.coords !== 'parent') return;
    if (data.phase !== 'start' && data.phase !== 'change' && data.phase !== 'end') return;
    zoom.handle(data.phase, Number(data.scale), Number(data.clientX), Number(data.clientY));
  };
  for (const [type, handler] of handlers) win.addEventListener(type, handler, LISTEN);
  win.addEventListener('mousemove', onPointer, { passive: true });
  win.addEventListener('message', onMessage);
  return {
    get active() { return zoom.active; },
    dispose() {
      for (const [type, handler] of handlers) win.removeEventListener(type, handler, LISTEN);
      win.removeEventListener('mousemove', onPointer);
      win.removeEventListener('message', onMessage);
    },
  };
}

/**
 * 紙面(生きているエディタの iframe)で起きたピンチを親へ転送する。座標は送る前に親の座標へ直す
 * (親の realm で作った関数なので、受け手からは送り元の iframe が分からない。ホイールの転送と同じ)。
 */
export function forwardEmbeddedGestures(input: {
  doc: Document;
  toParent: (x: number, y: number) => { clientX: number; clientY: number };
  post: (message: EmbeddedGestureMessage) => void;
}): () => void {
  const { doc } = input;
  let pointer: { x: number; y: number } | null = null;
  const onPointer = (event: MouseEvent) => { pointer = { x: event.clientX, y: event.clientY }; };
  const handlers = PHASES.map(([phase, type]) => {
    const handler = (event: Event) => {
      const gesture = event as CanvasGestureEvent;
      event.preventDefault();
      event.stopPropagation();
      const hasPoint = Number.isFinite(gesture.clientX) && Number.isFinite(gesture.clientY);
      const local = hasPoint
        ? { x: gesture.clientX as number, y: gesture.clientY as number }
        : pointer ?? { x: (doc.defaultView?.innerWidth ?? 0) / 2, y: (doc.defaultView?.innerHeight ?? 0) / 2 };
      input.post({ type: 'EMBEDDED_GESTURE', coords: 'parent', phase, scale: Number(gesture.scale ?? 1), ...input.toParent(local.x, local.y) });
    };
    return [type, handler] as const;
  });
  for (const [type, handler] of handlers) doc.addEventListener(type, handler, LISTEN);
  doc.addEventListener('mousemove', onPointer, { passive: true, capture: true });
  return () => {
    for (const [type, handler] of handlers) doc.removeEventListener(type, handler, LISTEN);
    doc.removeEventListener('mousemove', onPointer, { capture: true });
  };
}

// ------------------------------------------------------------------ 選択範囲に合わせる

/**
 * 紙面で選んでいる要素(#artboard の .selected)を囲む矩形を、キャンバスの座標で返す。無ければ null。
 * 埋め込みの紙面は iframe の中では等倍なので、iframe の中の矩形にフレームの位置を足せばよい。
 */
export function selectionCanvasRect(
  iframe: HTMLIFrameElement | null | undefined,
  framePosition: { x: number; y: number } | null | undefined,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const doc = iframe?.contentDocument;
  if (!doc || !framePosition) return null;
  const rects = Array.from(doc.querySelectorAll<HTMLElement>('#artboard .selected'))
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 || rect.height > 0);
  if (!rects.length) return null;
  return {
    minX: framePosition.x + Math.min(...rects.map((rect) => rect.left)),
    minY: framePosition.y + Math.min(...rects.map((rect) => rect.top)),
    maxX: framePosition.x + Math.max(...rects.map((rect) => rect.right)),
    maxY: framePosition.y + Math.max(...rects.map((rect) => rect.bottom)),
  };
}
