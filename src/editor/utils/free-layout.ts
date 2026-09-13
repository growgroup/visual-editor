/**
 * 自由配置(フリーレイアウト) = 器の中だけを絶対配置にする。
 *
 * 【なぜ必要か】
 * webpage(構成ラフ)は版面を流し込みのまま保つ約束で作ってある(README)。
 * そのおかげでページ高さが崩れないが、代わりに「この帯の中だけ Figma のように
 * 自由に置きたい」ができなかった。Figma の絶対位置トグルと同じで、
 * **範囲を器に区切れば**流し込みの利点を保ったまま自由配置を混ぜられる。
 *
 * 【なぜ class を目印にするか】
 * restore-flow.ts の注記と同じ理由。data-gg-* は保存時のサニタイズで落ちるため、
 * 保存HTML(=正本)まで届く印は class にするしかない。
 *
 * 【目印の意味】
 * - gg-freelayout      … この器は「子をすべて絶対配置」にしてある。
 *                         インラインの height はこの変換が書いたもの(解除で外す)
 * - gg-freelayout-rel  … この変換が position:relative を足した(元は static)。
 *                         解除でインラインの position を外してよい合図
 * - gg-freelayout-hold … 器ではないが、子を1つ以上フローから抜いたので高さを固定した。
 *                         抜いた子が全部フローへ戻ったら高さも外す
 *
 * 目印を分けているのは、**再読み込みしたあとでも解除が決定的に効く**ようにするため。
 * data-gg-prestyle(変換前 style の退避)は保存時に剥がされるので、
 * 解除の判断材料にはできない(同一セッション中の「元の値の書き戻し」にだけ使う)。
 *
 * 【slide とは別物】
 * slide は開いた瞬間に全要素を絶対配置へ倒す(convertToAbsolutePositioning)。
 * ここは webpage 専用で、ユーザーが明示的に指示した範囲だけを倒す。
 */

import { capturePrestyle, getArtboardScale } from './dom-utils';
import { debugLog } from './debug';

/** 器の印。class なので保存HTMLまで届く */
export const FREELAYOUT_CLASS = 'gg-freelayout';
/** この変換が position:relative を足した印 */
export const FREELAYOUT_REL_CLASS = 'gg-freelayout-rel';
/** 子を抜いたので高さを固定した印(器ではない親に付く) */
export const FREELAYOUT_HOLD_CLASS = 'gg-freelayout-hold';

/** 並べ替え・整列の対象にしない、エディタが描いている飾り */
const OVERLAY_SELECTOR =
  '.selection-box,.marquee-selection-box,.resize-handle,.rotation-handle,' +
  '.size-label,.element-breadcrumb,.gg-comment-layer,.gg-crop-ui,' +
  '.flex-drop-indicator,#gg-measure-layer,#gg-smart-guides,#gg-reorder-indicator';

/** 変換が書き込む幾何プロパティ。解除ではこれを全部外す */
const GEOMETRY_PROPS = [
  'position',
  'left',
  'top',
  'right',
  'bottom',
  'width',
  'height',
  'margin',
  'flex',
  'flex-grow',
  'flex-shrink',
] as const;

/** この要素は「子をすべて絶対配置」にした器か */
export function isFreeLayoutContainer(element: HTMLElement): boolean {
  return element.classList.contains(FREELAYOUT_CLASS);
}

/** この要素は自由配置の器の直下にいるか(ドラッグの判定で使う) */
export function isFreeLayoutChild(element: HTMLElement): boolean {
  const parent = element.parentElement;
  return !!parent && typeof parent.classList?.contains === 'function' && isFreeLayoutContainer(parent);
}

/** 実体のある直接の子だけを取り出す(エディタの飾りと script/style を外す) */
export function layoutChildren(container: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const node of Array.from(container.children)) {
    // [注意] `node instanceof HTMLElement` は使えない(iframeとは別realmのため常にfalse)
    const el = node as HTMLElement;
    if (typeof el.matches !== 'function') continue;
    if (el.matches(OVERLAY_SELECTOR)) continue;
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'TEMPLATE') continue;
    out.push(el);
  }
  return out;
}

/**
 * style プロパティに書くべき寸法を求める。
 *
 * getBoundingClientRect が返すのは常に border box。CSS の width/height が何を指すかは
 * box-sizing で変わるので、content-box の要素に border box の値を書くと
 * padding と border のぶん太る(実際に版面が数 px ずつ膨らむ)。
 */
function styleSizeFor(
  cs: CSSStyleDeclaration,
  borderBoxWidth: number,
  borderBoxHeight: number,
): { width: number; height: number } {
  if (cs.boxSizing === 'border-box') {
    return { width: borderBoxWidth, height: borderBoxHeight };
  }
  const px = (v: string): number => parseFloat(v) || 0;
  const insetX =
    px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth);
  const insetY =
    px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
  return {
    width: Math.max(0, borderBoxWidth - insetX),
    height: Math.max(0, borderBoxHeight - insetY),
  };
}

/** 変換前の style を保存した控え。巻き戻しに使う(自己検証で失敗したとき) */
interface StyleUndo {
  element: HTMLElement;
  style: string | null;
  className: string;
}

const snapshotStyle = (el: HTMLElement): StyleUndo => ({
  element: el,
  style: el.getAttribute('style'),
  className: el.getAttribute('class') ?? '',
});

function rollback(undos: StyleUndo[]): void {
  for (const u of undos) {
    if (u.style === null) u.element.removeAttribute('style');
    else u.element.setAttribute('style', u.style);
    if (u.className) u.element.setAttribute('class', u.className);
    else u.element.removeAttribute('class');
  }
}

/** translate を落として rotate/scale だけ残す(移動は left/top が担うため) */
function preserveTransform(transform: string): string {
  if (!transform || transform === 'none') return '';
  // matrix 形式は translate 成分を分離できないので、そのまま残すと二重に効く。
  // 変換前に inline で書かれていた関数表記だけを拾う
  const fns = transform.match(/(rotate|scale|skew)[XYZ3d]*\([^)]*\)/g);
  return fns ? fns.join(' ') : '';
}

/**
 * 器の高さを今の値で固定する。
 *
 * 子が絶対配置になると流れから抜け、器の auto 高さが 0 に潰れる。
 * 「セクションが消えた」に見える一番の事故なので、倒す前に必ず固定する。
 */
function freezeHeight(container: HTMLElement, win: Window): void {
  const cs = win.getComputedStyle(container);
  // SVG など offset 系を持たない要素は矩形から割り戻す(NaN を書かないため)
  const height =
    typeof container.offsetHeight === 'number'
      ? container.offsetHeight // border box(ズーム transform の影響を受けない)
      : container.getBoundingClientRect().height;
  if (!Number.isFinite(height) || height <= 0) return;
  const { height: styleHeight } = styleSizeFor(cs, container.offsetWidth || 0, height);
  capturePrestyle(container);
  container.style.height = `${Math.round(styleHeight * 100) / 100}px`;
}

/**
 * 器の中の子を、今見えている位置・大きさのまま絶対配置へ倒す。
 *
 * 【採寸と書き込みを分ける】
 * 1要素ずつ「測って書く」を繰り返すと、先に倒した要素が流れから抜け、
 * その分だけ後続の兄弟が上へ詰まってから測られる(版面が崩れる)。
 * dom-utils の一括変換と同じく **全部測りきってから全部書く**。
 *
 * @returns 倒した子の数。0 なら何も変えていない(巻き戻し済み)
 */
export function enableFreeLayout(container: HTMLElement, iframeDoc: Document): number {
  const win = iframeDoc.defaultView;
  if (!win) return 0;

  const children = layoutChildren(container);
  if (children.length === 0) return 0;

  const undos: StyleUndo[] = [snapshotStyle(container), ...children.map(snapshotStyle)];
  const scale = getArtboardScale(iframeDoc);

  // ① 変換前の見た目を控える(自己検証で使う)
  const before = children.map((el) => ({ el, rect: el.getBoundingClientRect() }));

  // ② 器を基準にする。position:relative を入れるだけでは要素は動かないので、
  //    採寸より前にやってよい(むしろ offsetParent を確定させるために前でなければならない)
  const containerCs = win.getComputedStyle(container);
  if (containerCs.position === 'static') {
    capturePrestyle(container);
    container.style.position = 'relative';
    container.classList.add(FREELAYOUT_REL_CLASS);
  }

  // ③ 高さを固定してから倒す(倒したあとだと潰れた 0 を測ってしまう)
  freezeHeight(container, win);

  // ④ 全部測りきる。offsetParent が器になっている素直なケースは offsetLeft/Top を使う
  //    (offset 系は CSS px で、ズームの transform の影響を受けない)
  const plans = children.map((el) => {
    const cs = win.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const useOffset = el.offsetParent === container && typeof el.offsetLeft === 'number';
    // 幅は rect を切り上げる。offsetWidth の整数丸めだと必要幅 1227.4px の文字列が
    // 1227px で固定されて最後の1文字だけ折り返す(dom-utils に同じ注記あり)
    const borderBoxW = Math.ceil(rect.width / scale);
    const borderBoxH = Math.ceil(rect.height / scale);
    const size = styleSizeFor(cs, borderBoxW, borderBoxH);
    let left: number;
    let top: number;
    if (useOffset) {
      left = el.offsetLeft;
      top = el.offsetTop;
    } else {
      // SVG など offset 系を持たない要素。器の padding box 基準へ割り戻す
      const cRect = container.getBoundingClientRect();
      const cCs = win.getComputedStyle(container);
      left =
        (rect.left - cRect.left) / scale -
        (parseFloat(cCs.borderLeftWidth) || 0) +
        (container.scrollLeft || 0);
      top =
        (rect.top - cRect.top) / scale -
        (parseFloat(cCs.borderTopWidth) || 0) +
        (container.scrollTop || 0);
    }
    return { el, left, top, size, transform: preserveTransform(el.style.transform || cs.transform) };
  });

  // ⑤ まとめて書く
  for (const p of plans) {
    capturePrestyle(p.el);
    p.el.style.position = 'absolute';
    p.el.style.left = `${Math.round(p.left * 100) / 100}px`;
    p.el.style.top = `${Math.round(p.top * 100) / 100}px`;
    p.el.style.width = `${Math.round(p.size.width * 100) / 100}px`;
    p.el.style.height = `${Math.round(p.size.height * 100) / 100}px`;
    // 絶対配置では margin は「位置のずれ」にしかならない。left/top に一本化する
    p.el.style.margin = '0';
    // 親が flex/grid のままでも子は絶対配置なので並びには乗らないが、
    // 解除したときに flex:1 が復活して伸びないよう明示的に止めておく
    p.el.style.flex = 'none';
    p.el.style.flexGrow = '0';
    p.el.style.flexShrink = '0';
    if (p.transform) p.el.style.transform = p.transform;
  }

  container.classList.add(FREELAYOUT_CLASS);
  // 子を抜いた親としての印は不要(器そのものが印)
  container.classList.remove(FREELAYOUT_HOLD_CLASS);

  // ⑥ 自己検証。1つでもずれたら**変換ごと巻き戻す**。
  //    崩れた版面より、変換されていない版面のほうがはるかにまし(dom-utils と同じ方針)
  const moved = before.filter(({ el, rect }) => {
    const now = el.getBoundingClientRect();
    return (
      Math.abs(now.left - rect.left) > 1.5 ||
      Math.abs(now.top - rect.top) > 1.5 ||
      Math.abs(now.width - rect.width) > 2 ||
      Math.abs(now.height - rect.height) > 2
    );
  });
  if (moved.length > 0) {
    console.warn(
      '[enableFreeLayout] 変換で',
      moved.length,
      '要素がずれたため巻き戻します(採寸タイミングの問題の可能性)',
    );
    rollback(undos);
    return 0;
  }

  debugLog('[enableFreeLayout] 絶対配置へ:', plans.length, '要素');
  return plans.length;
}

/**
 * 退避された変換前 style の中から、その要素が元々持っていた値を引く。
 * 同一セッション中だけ効く「おまけ」で、解除の可否をこれで決めてはいけない
 * (保存すると data-gg-prestyle は剥がされるため)。
 */
function prestyleValue(element: HTMLElement, prop: string): string | null {
  const pres = element.getAttribute('data-gg-prestyle');
  if (!pres || pres === '__none__') return null;
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i');
  const m = pres.match(re);
  return m ? m[1].trim() : null;
}

/** 幾何プロパティを外す。退避に元の値があればそれを書き戻す */
function stripGeometry(element: HTMLElement): void {
  for (const prop of GEOMETRY_PROPS) {
    const original = prestyleValue(element, prop);
    if (original) element.style.setProperty(prop, original);
    else element.style.removeProperty(prop);
  }
  if (!element.getAttribute('style')) element.removeAttribute('style');
}

/**
 * 「今見えている位置の順」に並べ替える。
 *
 * 上から下、同じ段なら左から右(行優先)。段の判定は 4px の遊びを持たせる
 * ——1px の誤差で段が割れると、横並びのカードが縦にばらけて戻ってしまう。
 */
function sortByVisualOrder(items: { el: HTMLElement; rect: DOMRect }[]): HTMLElement[] {
  const ROW_TOLERANCE = 4;
  return [...items]
    .sort((a, b) => {
      const dy = a.rect.top - b.rect.top;
      if (Math.abs(dy) > ROW_TOLERANCE) return dy;
      return a.rect.left - b.rect.left;
    })
    .map((i) => i.el);
}

/**
 * 器を流し込みへ戻す。
 *
 * 1. 動かす前に「見えている位置」を控える
 * 2. 子から幾何を外す(退避があれば元の値を書き戻す)
 * 3. DOM 順を見えていた順に合わせる
 * 4. 器の固定高さ・relative・目印を外す
 *
 * 並べ替えの順を**先に決めてから** position を外すのが肝。先に外すと要素が
 * 積み上がって動いてしまい、「見えていた順」が分からなくなる。
 *
 * @returns 戻した子の数
 */
export function disableFreeLayout(container: HTMLElement, iframeDoc: Document): number {
  const win = iframeDoc.defaultView;
  if (!win) return 0;

  const children = layoutChildren(container);
  const measured = children.map((el) => ({ el, rect: el.getBoundingClientRect() }));
  const ordered = sortByVisualOrder(measured);

  for (const el of ordered) stripGeometry(el);
  // appendChild は既存ノードの移動として働く。見えていた順に並べ直す
  for (const el of ordered) container.appendChild(el);

  container.classList.remove(FREELAYOUT_CLASS, FREELAYOUT_HOLD_CLASS);
  // 高さの固定は必ずこの変換が書いたもの(器の印がその証拠)なので外す
  const originalHeight = prestyleValue(container, 'height');
  if (originalHeight) container.style.height = originalHeight;
  else container.style.removeProperty('height');
  if (container.classList.contains(FREELAYOUT_REL_CLASS)) {
    const originalPosition = prestyleValue(container, 'position');
    if (originalPosition) container.style.position = originalPosition;
    else container.style.removeProperty('position');
    container.classList.remove(FREELAYOUT_REL_CLASS);
  }
  if (!container.getAttribute('style')) container.removeAttribute('style');
  if (!container.getAttribute('class')) container.removeAttribute('class');

  debugLog('[disableFreeLayout] 流し込みへ:', ordered.length, '要素');
  return ordered.length;
}

// ────────────────────────────────────────────────────────────
// 要素ひとつの切替(右パネルの「配置: 自動 / 絶対」)
// ────────────────────────────────────────────────────────────

/**
 * 要素ひとつを、今の位置のまま絶対配置にする(Figma の「絶対位置」トグル)。
 *
 * 基準は直近の位置指定された祖先。無ければ**親**に position:relative を付ける
 * (祖先をさかのぼって遠くを基準にすると、親をずらしたときに子が付いてこない)。
 *
 * 【親の高さを固定する理由】
 * 1つだけフローから抜くと、器の auto 高さがその要素の分だけ縮み、後続の
 * セクションが上へ詰め上がる。#artboard 直下のセクションでやると版面全体が動く。
 * そこで器が gg-freelayout でないときは、抜く前に親の高さを固定して
 * gg-freelayout-hold の印を残す(自動へ戻すときに外す手掛かり)。
 */
export function setElementAbsolute(element: HTMLElement, iframeDoc: Document): boolean {
  const win = iframeDoc.defaultView;
  if (!win) return false;
  const cs = win.getComputedStyle(element);
  if (cs.position === 'absolute' || cs.position === 'fixed') return false;

  const parent = element.parentElement;
  const artboard = iframeDoc.getElementById('artboard');
  if (!parent || parent === iframeDoc.body) return false;

  const rect = element.getBoundingClientRect();
  const scale = getArtboardScale(iframeDoc);

  // 親が既に自由配置の器なら高さは固定済み。そうでなければここで固定する
  if (!isFreeLayoutContainer(parent)) {
    if (!parent.classList.contains(FREELAYOUT_HOLD_CLASS)) {
      freezeHeight(parent, win);
      parent.classList.add(FREELAYOUT_HOLD_CLASS);
    }
  }

  // 基準づくり。artboard 自身は触らない(版面の器で、relative 化の影響が広い)
  const parentCs = win.getComputedStyle(parent);
  if (parentCs.position === 'static' && parent !== artboard) {
    capturePrestyle(parent);
    parent.style.position = 'relative';
    parent.classList.add(FREELAYOUT_REL_CLASS);
  }

  const borderBoxW = Math.ceil(rect.width / scale);
  const borderBoxH = Math.ceil(rect.height / scale);
  const size = styleSizeFor(cs, borderBoxW, borderBoxH);
  const useOffset = element.offsetParent === parent && typeof element.offsetLeft === 'number';
  let left: number;
  let top: number;
  if (useOffset) {
    left = element.offsetLeft;
    top = element.offsetTop;
  } else {
    const pRect = parent.getBoundingClientRect();
    const pCs = win.getComputedStyle(parent);
    left =
      (rect.left - pRect.left) / scale - (parseFloat(pCs.borderLeftWidth) || 0) + (parent.scrollLeft || 0);
    top =
      (rect.top - pRect.top) / scale - (parseFloat(pCs.borderTopWidth) || 0) + (parent.scrollTop || 0);
  }

  capturePrestyle(element);
  element.style.position = 'absolute';
  element.style.left = `${Math.round(left * 100) / 100}px`;
  element.style.top = `${Math.round(top * 100) / 100}px`;
  element.style.width = `${Math.round(size.width * 100) / 100}px`;
  element.style.height = `${Math.round(size.height * 100) / 100}px`;
  element.style.margin = '0';
  element.style.flex = 'none';
  element.style.flexGrow = '0';
  element.style.flexShrink = '0';
  return true;
}

/**
 * 要素ひとつを流し込みへ戻す。
 *
 * 戻したことで親からフロー外の子がいなくなったら、固定していた親の高さも外す
 * (固定したままだと、以後どれだけ中身を足しても下へ伸びない)。
 */
export function setElementAuto(element: HTMLElement, iframeDoc: Document): boolean {
  const win = iframeDoc.defaultView;
  if (!win) return false;
  const cs = win.getComputedStyle(element);
  if (cs.position !== 'absolute' && cs.position !== 'fixed') return false;

  stripGeometry(element);

  const parent = element.parentElement;
  if (parent && parent.classList.contains(FREELAYOUT_HOLD_CLASS)) {
    const stillOut = layoutChildren(parent).some((c) => {
      const p = win.getComputedStyle(c).position;
      return p === 'absolute' || p === 'fixed';
    });
    if (!stillOut) {
      const originalHeight = prestyleValue(parent, 'height');
      if (originalHeight) parent.style.height = originalHeight;
      else parent.style.removeProperty('height');
      parent.classList.remove(FREELAYOUT_HOLD_CLASS);
      if (parent.classList.contains(FREELAYOUT_REL_CLASS)) {
        const originalPosition = prestyleValue(parent, 'position');
        if (originalPosition) parent.style.position = originalPosition;
        else parent.style.removeProperty('position');
        parent.classList.remove(FREELAYOUT_REL_CLASS);
      }
      if (!parent.getAttribute('style')) parent.removeAttribute('style');
      if (!parent.getAttribute('class')) parent.removeAttribute('class');
    }
  }
  return true;
}

// ────────────────────────────────────────────────────────────
// ページ一括
// ────────────────────────────────────────────────────────────

/**
 * ページの最上位のセクション = 一括変換の対象。
 *
 * `#artboard > main` があればその直下、無ければ `#artboard` の直下。
 * artboard 自身は倒さない——倒すとセクションが重なり、ページの高さが 0 になる。
 * セクションは流し込みのまま積み、**それぞれの中だけ**を自由配置にする。
 */
export function topLevelSections(iframeDoc: Document): HTMLElement[] {
  const artboard = iframeDoc.getElementById('artboard');
  if (!artboard) return [];
  const main = Array.from(artboard.children).find(
    (c) => (c as HTMLElement).tagName === 'MAIN',
  ) as HTMLElement | undefined;
  const root = main ?? artboard;
  return layoutChildren(root);
}

/** ページ全体を自由配置にする。戻り値は変換できたセクションの数 */
export function enablePageFreeLayout(iframeDoc: Document): { sections: number; elements: number } {
  let sections = 0;
  let elements = 0;
  for (const section of topLevelSections(iframeDoc)) {
    if (isFreeLayoutContainer(section)) continue;
    const n = enableFreeLayout(section, iframeDoc);
    if (n > 0) {
      sections++;
      elements += n;
    }
  }
  return { sections, elements };
}

/** ページ全体を流し込みへ戻す */
export function disablePageFreeLayout(iframeDoc: Document): { sections: number; elements: number } {
  let sections = 0;
  let elements = 0;
  // 入れ子の器も拾う(一括変換のあとに個別で足した器があってもよいように)
  const artboard = iframeDoc.getElementById('artboard');
  if (!artboard) return { sections, elements };
  const containers = [
    ...(isFreeLayoutContainer(artboard) ? [artboard] : []),
    ...Array.from(artboard.querySelectorAll<HTMLElement>(`.${FREELAYOUT_CLASS}`)),
  ];
  for (const c of containers) {
    elements += disableFreeLayout(c, iframeDoc);
    sections++;
  }
  return { sections, elements };
}

// ────────────────────────────────────────────────────────────
// ドラッグの範囲
// ────────────────────────────────────────────────────────────

/**
 * 自由配置の器の中で動かせる delta の範囲を求める。
 *
 * 掴んでいる要素のうち、器(gg-freelayout)の直下にいるものだけが対象。
 * 対象が1つも無ければ null = 制限なし(従来どおりどこへでも動かせる)。
 *
 * 群で掴んだときは各要素の許容範囲の**共通部分**を返す。要素ごとに丸めると
 * 端に着いた要素だけが止まり、群の相対位置が崩れる。
 *
 * 座標系は origin と同じ「offsetParent の padding box 基準」。
 * clientWidth/clientHeight がちょうど padding box の内寸なので、
 * 左上 0 〜 右下 (client - offset寸法) が器に収まる範囲になる。
 */
export function computeFreeBounds(
  targets: { element: HTMLElement; origin: { left: number; top: number } }[],
  iframeDoc: Document,
): { dxMin: number; dxMax: number; dyMin: number; dyMax: number } | null {
  const win = iframeDoc.defaultView;
  if (!win) return null;
  let dxMin = -Infinity;
  let dxMax = Infinity;
  let dyMin = -Infinity;
  let dyMax = Infinity;
  let found = false;

  for (const { element, origin } of targets) {
    const container = element.offsetParent as HTMLElement | null;
    if (!container || typeof container.classList?.contains !== 'function') continue;
    if (!isFreeLayoutContainer(container)) continue;
    if (typeof element.offsetWidth !== 'number') continue;
    found = true;
    const maxLeft = container.clientWidth - element.offsetWidth;
    const maxTop = container.clientHeight - element.offsetHeight;
    dxMin = Math.max(dxMin, -origin.left);
    dxMax = Math.min(dxMax, maxLeft - origin.left);
    dyMin = Math.max(dyMin, -origin.top);
    dyMax = Math.min(dyMax, maxTop - origin.top);
  }

  return found ? { dxMin, dxMax, dyMin, dyMax } : null;
}

/** ページのどこかに自由配置の器があるか(メニューの出し分けに使う) */
export function hasFreeLayout(iframeDoc: Document): boolean {
  const artboard = iframeDoc.getElementById('artboard');
  if (!artboard) return false;
  return !!artboard.querySelector(`.${FREELAYOUT_CLASS}`);
}
