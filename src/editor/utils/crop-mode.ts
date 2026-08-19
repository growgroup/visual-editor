/**
 * 画像のトリミング(PowerPointの「トリミング」相当)。
 *
 * 仕組み: 画像を overflow:hidden のラッパー(.gg-crop)で包み、
 *   - 枠ハンドルのドラッグ = ラッパーの矩形を変える(画像は動かない=見た目固定)
 *   - 枠の内側のドラッグ   = ラッパー内で画像の位置を動かす(見せる範囲の調整)
 * Enter/枠外クリックで確定、Escで開始時の状態へ完全に戻す。
 *
 * ラッパーは通常のDOM編集としてそのまま保存され、書き戻しエンジンが
 * 構造変更(要素の挿入+スタイル)として原本TSXへ運ぶ。切り抜きが
 * 初期状態(全表示)のまま確定された場合はラッパーを外して元の<img>に戻す。
 * ハンドル等のUI(.gg-crop-ui)は表示専用で、確定/中断時に必ず取り除く。
 */

const UI_CLASS = 'gg-crop-ui';
const WRAP_CLASS = 'gg-crop';

export type CropSession = {
  commit: () => void;
  cancel: () => void;
  readonly active: boolean;
};

const px = (n: number) => `${Math.round(n * 10) / 10}px`;

export function enterCropMode(
  iframeDoc: Document,
  img: HTMLImageElement,
  onDone: (changed: boolean) => void,
): CropSession | null {
  const artboard = iframeDoc.getElementById('artboard');
  const win = iframeDoc.defaultView;
  if (!artboard || !win) return null;

  // ── ラッパーを用意(既存の .gg-crop を再編集 or 新規に包む) ──
  let wrapper = img.parentElement?.classList.contains(WRAP_CLASS)
    ? (img.parentElement as HTMLElement)
    : null;
  const created = !wrapper;
  const snapshotTarget = wrapper ?? img;
  const snapshotParent = snapshotTarget.parentElement!;
  const snapshotNext = snapshotTarget.nextSibling;
  const snapshotHtml = snapshotTarget.outerHTML;

  if (!wrapper) {
    wrapper = iframeDoc.createElement('div');
    wrapper.className = WRAP_CLASS;
    const cs = win.getComputedStyle(img);
    wrapper.style.position = cs.position === 'absolute' || cs.position === 'fixed' ? cs.position : 'absolute';
    wrapper.style.left = px(img.offsetLeft);
    wrapper.style.top = px(img.offsetTop);
    wrapper.style.width = px(img.offsetWidth);
    wrapper.style.height = px(img.offsetHeight);
    wrapper.style.overflow = 'hidden';
    img.parentElement!.insertBefore(wrapper, img);
    // 画像はラッパー座標系の(0,0)に等倍で置き直す
    img.style.position = 'absolute';
    img.style.left = '0px';
    img.style.top = '0px';
    img.style.width = px(img.offsetWidth);
    img.style.height = px(img.offsetHeight);
    img.style.maxWidth = 'none';
    img.style.margin = '0';
    wrapper.appendChild(img);
  }

  // クロップ中はエディタの選択・ドラッグ機構を止める(bodyクラスで通知)。
  // 止めないと選択枠(白ハンドル)がクロップUIの上に再描画され、
  // それを掴んだ操作が「枠外クリック」となって勝手に確定・終了してしまう
  iframeDoc.body.classList.add('gg-cropping');

  // ── UIレイヤー(枠+8ハンドル)。アートボード座標なのでズームに自動追従 ──
  const ui = iframeDoc.createElement('div');
  ui.className = UI_CLASS;
  ui.style.cssText = 'position:absolute;inset:0;z-index:9500;pointer-events:none;';
  artboard.appendChild(ui);

  const frame = iframeDoc.createElement('div');
  frame.style.cssText =
    'position:absolute;border:2px solid #111;box-shadow:0 0 0 20000px rgba(0,0,0,0.25);' +
    'pointer-events:auto;cursor:move;';
  ui.appendChild(frame);

  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
  type Handle = (typeof HANDLES)[number];
  for (const h of HANDLES) {
    const el = iframeDoc.createElement('div');
    el.setAttribute('data-handle', h);
    // PowerPoint風の黒い鉤型ハンドル(簡略: 太い短線)
    const base =
      'position:absolute;background:#111;pointer-events:auto;';
    const size = h.length === 2 ? 'width:16px;height:16px;' : h === 'n' || h === 's' ? 'width:22px;height:6px;' : 'width:6px;height:22px;';
    el.style.cssText = base + size + `cursor:${h}-resize;`;
    frame.appendChild(el);
  }

  // 枠はアートボード直下のUIレイヤーに描くため、位置は**アートボード座標**が要る。
  // offsetLeft/offsetTop は offsetParent(入れ子の親)基準なので、画像がパネル等の
  // 中にあると枠だけ左上へ大きくずれる(実際に起きた)。rectから換算する
  const artboardPos = (el: HTMLElement) => {
    const a = artboard.getBoundingClientRect();
    const s = a.width / artboard.offsetWidth || 1;
    const r = el.getBoundingClientRect();
    return {
      left: (r.left - a.left) / s,
      top: (r.top - a.top) / s,
      width: r.width / s,
      height: r.height / s,
    };
  };

  const layout = () => {
    const p = artboardPos(wrapper!);
    frame.style.left = px(p.left);
    frame.style.top = px(p.top);
    frame.style.width = px(p.width);
    frame.style.height = px(p.height);
    const w = p.width;
    const h = p.height;
    const pos: Record<Handle, [number, number]> = {
      nw: [-3, -3], n: [w / 2 - 11, -3], ne: [w - 13, -3], e: [w - 3, h / 2 - 11],
      se: [w - 13, h - 13], s: [w / 2 - 11, h - 3], sw: [-3, h - 13], w: [-3, h / 2 - 11],
    };
    frame.querySelectorAll<HTMLElement>('[data-handle]').forEach((el) => {
      const [x, y] = pos[el.getAttribute('data-handle') as Handle];
      el.style.left = px(x);
      el.style.top = px(y);
    });
  };
  layout();

  // ── ドラッグ処理(枠=リサイズ / 内側=画像移動) ──
  const scaleOf = () => {
    // アートボードのズーム倍率(クライアント座標→アートボード座標の換算)
    const r = artboard.getBoundingClientRect();
    return r.width / artboard.offsetWidth || 1;
  };

  let dragging: { kind: 'frame'; handle: Handle } | { kind: 'image' } | null = null;
  let start = { x: 0, y: 0, wl: 0, wt: 0, ww: 0, wh: 0, il: 0, it: 0 };

  const clampImage = () => {
    // 画像がラッパーを覆い続けるように位置を制限(白場を作らない)
    const minL = wrapper!.offsetWidth - img.offsetWidth;
    const minT = wrapper!.offsetHeight - img.offsetHeight;
    img.style.left = px(Math.min(0, Math.max(minL, img.offsetLeft)));
    img.style.top = px(Math.min(0, Math.max(minT, img.offsetTop)));
  };

  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    e.preventDefault();
    const k = scaleOf();
    const dx = (e.clientX - start.x) / k;
    const dy = (e.clientY - start.y) / k;
    if (dragging.kind === 'image') {
      img.style.left = px(start.il + dx);
      img.style.top = px(start.it + dy);
      clampImage();
      return;
    }
    const h = dragging.handle;
    // 枠の辺を動かす。画像の見た目位置は固定(左/上辺はラッパー移動+画像を逆補正)
    if (h.includes('e')) {
      wrapper!.style.width = px(Math.max(24, Math.min(start.ww + dx, img.offsetWidth + start.il)));
    }
    if (h.includes('s')) {
      wrapper!.style.height = px(Math.max(24, Math.min(start.wh + dy, img.offsetHeight + start.it)));
    }
    if (h.includes('w')) {
      const move = Math.max(start.il, Math.min(dx, start.ww - 24));
      wrapper!.style.left = px(start.wl + move);
      wrapper!.style.width = px(start.ww - move);
      img.style.left = px(start.il - move);
    }
    if (h.includes('n')) {
      const move = Math.max(start.it, Math.min(dy, start.wh - 24));
      wrapper!.style.top = px(start.wt + move);
      wrapper!.style.height = px(start.wh - move);
      img.style.top = px(start.it - move);
    }
    layout();
  };

  const onDown = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!ui.contains(target)) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = target.getAttribute('data-handle') as Handle | null;
    dragging = handle ? { kind: 'frame', handle } : { kind: 'image' };
    start = {
      x: e.clientX, y: e.clientY,
      wl: wrapper!.offsetLeft, wt: wrapper!.offsetTop,
      ww: wrapper!.offsetWidth, wh: wrapper!.offsetHeight,
      il: img.offsetLeft, it: img.offsetTop,
    };
  };
  const onUp = () => { dragging = null; };

  // 枠外クリック=確定 / Enter=確定 / Esc=取り消し
  const onDocDown = (e: MouseEvent) => {
    if (!ui.contains(e.target as Node)) finish(true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  };

  ui.addEventListener('mousedown', onDown);
  iframeDoc.addEventListener('mousemove', onMove, true);
  iframeDoc.addEventListener('mouseup', onUp, true);
  // 直後のクリックで即確定しないよう、次のティックから枠外検知を有効化
  const armTimer = setTimeout(() => iframeDoc.addEventListener('mousedown', onDocDown, true), 0);
  iframeDoc.addEventListener('keydown', onKey, true);

  let done = false;
  const cleanup = () => {
    iframeDoc.body.classList.remove('gg-cropping');
    clearTimeout(armTimer);
    ui.removeEventListener('mousedown', onDown);
    iframeDoc.removeEventListener('mousemove', onMove, true);
    iframeDoc.removeEventListener('mouseup', onUp, true);
    iframeDoc.removeEventListener('mousedown', onDocDown, true);
    iframeDoc.removeEventListener('keydown', onKey, true);
    ui.remove();
  };

  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    cleanup();
    if (!commit) {
      // 開始時の姿へ完全に戻す
      const tmp = iframeDoc.createElement('div');
      tmp.innerHTML = snapshotHtml;
      const restored = tmp.firstElementChild!;
      wrapper!.remove();
      snapshotParent.insertBefore(restored, snapshotNext);
      onDone(false);
      return;
    }
    // 切り抜き無し(全表示のまま)なら、ラッパーを外して素の<img>へ戻す
    const uncropped =
      Math.abs(img.offsetLeft) < 1 && Math.abs(img.offsetTop) < 1 &&
      Math.abs(img.offsetWidth - wrapper!.offsetWidth) < 1 &&
      Math.abs(img.offsetHeight - wrapper!.offsetHeight) < 1;
    if (uncropped && created) {
      const tmp = iframeDoc.createElement('div');
      tmp.innerHTML = snapshotHtml;
      const restored = tmp.firstElementChild!;
      wrapper!.remove();
      snapshotParent.insertBefore(restored, snapshotNext);
      onDone(false);
      return;
    }
    onDone(true);
  };

  return {
    commit: () => finish(true),
    cancel: () => finish(false),
    get active() { return !done; },
  };
}
