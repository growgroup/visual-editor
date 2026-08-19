/**
 * 影・光彩の当て方を要素に合わせて切り替える。
 *
 * box-shadow は「ボックスの外側」に描かれるため、clip-path で切り抜いた図形
 * (星・矢印・吹き出しなど)では影ごと切り落とされて何も見えない。
 * 画像も同じで、透過PNGに box-shadow を掛けると絵ではなく矩形に影が出る。
 *
 * そこで clip-path のある要素と <img> は `filter: drop-shadow()` を使う。
 * drop-shadow はアルファ形状に沿うので、PowerPointの見え方と一致する。
 * それ以外(パネルなど普通の箱)は spread が使える box-shadow のままにする。
 */

export type ShadowSpec = {
  dx: number;
  dy: number;
  blur: number;
  /** box-shadow の spread 相当。drop-shadow では二重掛けで近似する */
  size: number;
  color: string;
} | null;

export type GlowSpec = { size: number; color: string } | null;

/** filter 文字列から drop-shadow(...) だけを取り除く(明るさ等は残す) */
export function stripDropShadow(filter: string): string {
  if (!filter) return '';
  const out: string[] = [];
  let i = 0;
  while (i < filter.length) {
    const rest = filter.slice(i);
    const m = /^\s*drop-shadow\(/.exec(rest);
    if (m) {
      // 括弧の対応を数えて関数末尾まで飛ばす(rgba(...) の入れ子があるため)
      let depth = 0;
      let j = i + m[0].length - 1;
      for (; j < filter.length; j++) {
        if (filter[j] === '(') depth++;
        else if (filter[j] === ')') {
          depth--;
          if (depth === 0) break;
        }
      }
      i = j + 1;
      continue;
    }
    const next = filter.indexOf('drop-shadow(', i);
    const end = next === -1 ? filter.length : next;
    out.push(filter.slice(i, end));
    i = end;
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/** clip-path で切り抜かれているか(影・反射がブラウザに切られる要素) */
export function isClipped(el: HTMLElement): boolean {
  if (el.style.clipPath && el.style.clipPath !== 'none') return true;
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
  return !!cs && cs.clipPath !== 'none';
}

const FX_HOST_ATTR = 'data-gg-fx-host';
/** ラッパーへ移す(=図形本体ではなく枠が持つべき)スタイル */
const GEOMETRY_PROPS = [
  'position', 'left', 'top', 'right', 'bottom', 'width', 'height',
  'margin', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom',
  'zIndex', 'transform', 'flex',
] as const;
/** ラッパーへ移す識別子(選択・ドラッグ・書き戻しの対象を枠に移すため) */
const IDENTITY_ATTRS = ['data-element-id', 'data-editable', 'data-gg-src', 'data-shape-type', 'data-shape-id'];

/**
 * 効果(影・反射)を載せる要素を返す。
 *
 * clip-path のある要素は、自分に付けた drop-shadow も -webkit-box-reflect も
 * 切り抜きで消えてしまう(Chromeで実測)。そこで図形を枠<div>で包み、
 * 効果は枠が持ち、切り抜きは中身が持つ形にする。枠は位置・大きさと
 * data-element-id を引き継ぐので、選択・移動・リサイズは今までどおり動く。
 */
export function getFxHost(el: HTMLElement, create = false): HTMLElement {
  const parent = el.parentElement;
  if (el.hasAttribute(FX_HOST_ATTR)) return el;
  if (parent?.hasAttribute(FX_HOST_ATTR)) return parent;
  if (!isClipped(el) || !create) return el;

  const doc = el.ownerDocument;
  const win = doc.defaultView;
  const cs = win?.getComputedStyle(el);
  const wrap = doc.createElement('div');
  wrap.setAttribute(FX_HOST_ATTR, '1');

  wrap.style.position =
    el.style.position || (cs && cs.position !== 'static' ? cs.position : 'relative');
  for (const prop of GEOMETRY_PROPS) {
    if (prop === 'position') continue;
    const v = (el.style as unknown as Record<string, string>)[prop];
    if (v) (wrap.style as unknown as Record<string, string>)[prop] = v;
  }
  if (!wrap.style.width && cs) wrap.style.width = `${el.offsetWidth}px`;
  if (!wrap.style.height && cs) wrap.style.height = `${el.offsetHeight}px`;

  el.parentElement?.insertBefore(wrap, el);
  wrap.appendChild(el);

  // 中身は枠いっぱいに置き直す
  el.style.position = 'absolute';
  el.style.left = '0';
  el.style.top = '0';
  el.style.right = '';
  el.style.bottom = '';
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.margin = '0';
  el.style.transform = '';
  el.style.zIndex = '';

  for (const name of IDENTITY_ATTRS) {
    const v = el.getAttribute(name);
    if (v !== null) {
      wrap.setAttribute(name, v);
      el.removeAttribute(name);
    }
  }
  if (el.classList.contains('selected')) {
    el.classList.remove('selected');
    wrap.classList.add('selected');
  }
  return wrap;
}

/** 効果が全部外れた枠は畳んで元の1要素に戻す */
export function unwrapFxHostIfEmpty(host: HTMLElement): void {
  if (!host.hasAttribute(FX_HOST_ATTR)) return;
  const hasFx =
    !!stripDropShadow(host.style.filter) ||
    /drop-shadow\(/.test(host.style.filter || '') ||
    !!host.style.getPropertyValue('-webkit-box-reflect') ||
    !!host.style.getPropertyValue('-webkit-mask-image');
  if (hasFx) return;

  const inner = host.firstElementChild as HTMLElement | null;
  if (!inner || host.children.length !== 1) return;

  for (const prop of GEOMETRY_PROPS) {
    const v = (host.style as unknown as Record<string, string>)[prop];
    if (v) (inner.style as unknown as Record<string, string>)[prop] = v;
  }
  for (const name of IDENTITY_ATTRS) {
    const v = host.getAttribute(name);
    if (v !== null) inner.setAttribute(name, v);
  }
  if (host.classList.contains('selected')) inner.classList.add('selected');
  host.parentElement?.insertBefore(inner, host);
  host.remove();
}

/** 塗り・枠線など「図形本体」に当てるべき要素(枠が選択されている場合は中身) */
export function paintTarget(el: HTMLElement): HTMLElement {
  if (!el.hasAttribute(FX_HOST_ATTR)) return el;
  const inner = el.firstElementChild as HTMLElement | null;
  return inner && isClipped(inner) ? inner : el;
}

/** この要素(の中身)は形が矩形でないか = drop-shadow で影を付けるべきか */
export function usesDropShadow(el: HTMLElement): boolean {
  if (el.tagName === 'IMG') return true;
  if (isClipped(el)) return true;
  if (el.hasAttribute(FX_HOST_ATTR)) return true;
  const only = el.children.length === 1 ? (el.children[0] as HTMLElement) : null;
  return !!only && (only.tagName === 'IMG' || isClipped(only));
}

/** 影と光彩をまとめて当てる(両方 null で解除)。戻り値は実際に効果を持った要素 */
export function applyShadowAndGlow(el: HTMLElement, shadow: ShadowSpec, glow: GlowSpec): HTMLElement {
  // 切り抜き図形は枠に載せないと影が消える
  const host = shadow || glow ? getFxHost(el, true) : getFxHost(el);
  if (host !== el) {
    // 図形本体に残っている古い影は消しておく
    el.style.boxShadow = '';
    el.style.filter = stripDropShadow(el.style.filter);
  }
  const target = host;
  const base = stripDropShadow(target.style.filter);

  if (usesDropShadow(target)) {
    const parts: string[] = [];
    if (shadow) {
      parts.push(`drop-shadow(${shadow.dx}px ${shadow.dy}px ${shadow.blur}px ${shadow.color})`);
      // drop-shadow に spread は無いので、0距離の影を重ねて太らせる
      if (shadow.size > 0) parts.push(`drop-shadow(0 0 ${shadow.size}px ${shadow.color})`);
    }
    if (glow) parts.push(`drop-shadow(0 0 ${glow.size}px ${glow.color})`);
    target.style.boxShadow = '';
    target.style.filter = [base, ...parts].filter(Boolean).join(' ');
    if (!shadow && !glow) unwrapFxHostIfEmpty(target);
    return target;
  }

  const shadows: string[] = [];
  if (shadow) shadows.push(`${shadow.dx}px ${shadow.dy}px ${shadow.blur}px ${shadow.size}px ${shadow.color}`);
  if (glow) shadows.push(`0 0 ${glow.size}px ${Math.round(glow.size / 3)}px ${glow.color}`);
  target.style.filter = base;
  target.style.boxShadow = shadows.join(', ');
  if (!shadow && !glow) unwrapFxHostIfEmpty(target);
  return target;
}

/** リボンの影プリセット(なし/弱/中/強)。切り抜き図形でも見えるようにする */
export function applyShadowPreset(el: HTMLElement, preset: 'none' | 'sm' | 'md' | 'lg'): HTMLElement {
  const spec: ShadowSpec =
    preset === 'none'
      ? null
      : preset === 'sm'
        ? { dx: 0, dy: 1, blur: 3, size: 0, color: 'rgba(0,0,0,0.25)' }
        : preset === 'md'
          ? { dx: 0, dy: 4, blur: 12, size: 0, color: 'rgba(0,0,0,0.3)' }
          : { dx: 0, dy: 10, blur: 28, size: 0, color: 'rgba(0,0,0,0.4)' };
  return applyShadowAndGlow(el, spec, null);
}
