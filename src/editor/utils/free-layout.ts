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
 * - gg-freelayout-item … この変換が絶対配置にした要素。解除で幾何を外すのはこの印の要素だけ
 *                         (元から absolute だった飾りまで static に落とさないため)
 *
 * 【--gg-flow-* = 変換前のインラインの幾何】
 * 変換で上書きするプロパティに元からインラインの値があったときだけ、
 * `--gg-flow-width: 64px` のようにカスタムプロパティへ控える。style 属性の中なので
 * 保存 HTML まで届き、読み直したあとでも解除で元の値へ戻せる(data-gg-prestyle は保存で落ちる)。
 * 値が `unset` の控えは「元は指定なし。この変換が書いた」の意味(器の幅・余白の手当てに使う)。
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
/** この変換が絶対配置にした要素の印。解除の対象はこれだけ */
export const FREELAYOUT_ITEM_CLASS = 'gg-freelayout-item';

/** 並べ替え・整列の対象にしない、エディタが描いている飾り */
const OVERLAY_SELECTOR =
  '.selection-box,.marquee-selection-box,.resize-handle,.rotation-handle,' +
  '.size-label,.element-breadcrumb,.gg-comment-layer,.gg-crop-ui,' +
  '.flex-drop-indicator,#gg-measure-layer,#gg-smart-guides,#gg-reorder-indicator,.gg-collab-layer';

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

/** 絶対配置にした要素へ書くプロパティの longhand。控え(--gg-flow-*)はこの名前で取る */
const ITEM_LONGHANDS = [
  'position',
  'left',
  'top',
  'right',
  'bottom',
  'width',
  'height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
] as const;

const FLOW_RECORD_PREFIX = '--gg-flow-';
/** 控えの「元は指定なし」 */
const FLOW_UNSET = 'unset';

/** 控え(--gg-flow-*)を読む。prop 名 → 値 */
function readFlowRecord(element: HTMLElement): Map<string, string> {
  const out = new Map<string, string>();
  const st = element.style;
  for (let i = 0; i < st.length; i++) {
    const name = st[i];
    if (!name.startsWith(FLOW_RECORD_PREFIX)) continue;
    out.set(name.slice(FLOW_RECORD_PREFIX.length), st.getPropertyValue(name).trim());
  }
  return out;
}

function clearFlowRecord(element: HTMLElement): void {
  for (const prop of readFlowRecord(element).keys()) element.style.removeProperty(FLOW_RECORD_PREFIX + prop);
}

/**
 * 上書きする前に、元からあったインラインの値を控える。
 * すでに控えがあるプロパティは触らない(最初の変換の前の値が正)。
 * markUnset のときは、元に値が無くても `unset` を控える(=「この変換が書いた」の記録)
 */
export function rememberFlowValues(element: HTMLElement, props: readonly string[], markUnset = false): void {
  const record = readFlowRecord(element);
  for (const prop of props) {
    if (record.has(prop)) continue;
    const value = element.style.getPropertyValue(prop);
    if (value) element.style.setProperty(FLOW_RECORD_PREFIX + prop, value);
    else if (markUnset) element.style.setProperty(FLOW_RECORD_PREFIX + prop, FLOW_UNSET);
  }
}

/**
 * 絶対配置にする要素の、元の幾何を控える。
 * 器(gg-freelayout / gg-freelayout-hold)だった要素の高さと position はこの変換が書いたもの
 * なので控えない(控えると、解除で固定した高さが「元の値」として戻ってしまう)
 */
export function rememberItemGeometry(element: HTMLElement): void {
  if (element.classList.contains(FREELAYOUT_ITEM_CLASS)) return;
  const ours =
    element.classList.contains(FREELAYOUT_CLASS) || element.classList.contains(FREELAYOUT_HOLD_CLASS);
  rememberFlowValues(
    element,
    ours ? ITEM_LONGHANDS.filter((p) => p !== 'height' && p !== 'position') : ITEM_LONGHANDS,
  );
}

/** エディタが紙面に描いている飾り(選択枠・共同編集の札など)か */
export function isEditorOverlay(element: Element): boolean {
  return typeof element.closest === 'function' && !!element.closest(OVERLAY_SELECTOR);
}

/** この要素は「子をすべて絶対配置」にした器か */
export function isFreeLayoutContainer(element: HTMLElement): boolean {
  return element.classList.contains(FREELAYOUT_CLASS);
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
 * style に書き戻すべき寸法を、いまの見た目のまま求める。
 *
 * 【computed をそのまま使う理由】
 * getComputedStyle().width / height は **その要素の box-sizing と同じ物差し**で、
 * 端数まで含めた使用値を返す(実測: border-box の要素は border box、
 * content-box の要素は content box)。つまり style へそのまま書き戻せば寸法は 1px も動かない。
 *
 * 矩形(getBoundingClientRect)をズーム倍率で割り戻す方式は端数が合わず、
 * 切り上げると枠線が半画素ずれる(画素比較で 3 行ぶんの差として見えた)。
 * offsetWidth は整数に丸められるので、必要幅 1227.4px の文字列が 1227px で固定され、
 * 最後の 1 文字だけ折り返す(dom-utils に同じ注記あり)。どちらも使わない。
 *
 * 万一 computed が px にならない(auto 等)ときだけ、矩形から割り戻した値に落とす。
 */
export function styleSizeFor(
  cs: CSSStyleDeclaration,
  fallbackBorderBoxWidth: number,
  fallbackBorderBoxHeight: number,
): { width: string; height: string } {
  const usable = (v: string): boolean => /px$/.test(v) && Number.isFinite(parseFloat(v));
  const px = (v: string): number => parseFloat(v) || 0;
  const toStyleBox = (borderBox: number, axis: 'x' | 'y'): string => {
    if (cs.boxSizing === 'border-box') return `${Math.ceil(borderBox)}px`;
    const inset =
      axis === 'x'
        ? px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth)
        : px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
    return `${Math.max(0, Math.ceil(borderBox) - inset)}px`;
  };
  return {
    width: usable(cs.width) ? cs.width : toStyleBox(fallbackBorderBoxWidth, 'x'),
    height: usable(cs.height) ? cs.height : toStyleBox(fallbackBorderBoxHeight, 'y'),
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

/** 変形が掛かっているか(矩形が外接矩形になり、左上が本当の位置と合わない) */
function isTransformed(cs: CSSStyleDeclaration): boolean {
  return (
    cs.transform !== 'none' ||
    (!!cs.translate && cs.translate !== 'none') ||
    (!!cs.rotate && cs.rotate !== 'none') ||
    (!!cs.scale && cs.scale !== 'none')
  );
}

/**
 * 位置と大きさをインラインのまま持つ要素か(Tailwind のクラスへ畳まない)。
 * 自由配置で倒した要素の幾何は、解除でインラインから外す約束。ドラッグやリサイズの終わりに
 * `left-[36px]` のようなクラスへ畳むと、解除のあとにクラスだけが残る
 */
export function keepsInlineGeometry(element: HTMLElement): boolean {
  return element.classList.contains(FREELAYOUT_ITEM_CLASS);
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
  // [computed の height をそのまま書く]
  // getComputedStyle().height は **その要素の box-sizing と同じ物差し**で返る
  // (実測: border-box の要素は border box、content-box の要素は content box)。
  // つまり style.height へそのまま書き戻せば、box-sizing が何であれ寸法は変わらない。
  // offsetHeight は整数に丸められるので使わない——214.4px の帯を 214px で固定すると
  // 0.4px ぶん版面が詰まり、下にあるものが全部わずかにずれる(画素比較で見えた)
  const h = parseFloat(cs.height);
  if (!Number.isFinite(h) || h <= 0) return;
  capturePrestyle(container);
  if (!container.classList.contains(FREELAYOUT_CLASS) && !container.classList.contains(FREELAYOUT_HOLD_CLASS)) {
    rememberFlowValues(container, ['height']);
  }
  container.style.height = cs.height;
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
    rememberFlowValues(container, ['position']);
    container.style.position = 'relative';
    container.classList.add(FREELAYOUT_REL_CLASS);
  }

  // ③ 高さを固定してから倒す(倒したあとだと潰れた 0 を測ってしまう)
  freezeHeight(container, win);

  // ④ 全部測りきる。位置は矩形を器の padding box 基準へ割り戻した小数で出す。
  //    offsetLeft/Top は整数に丸められ、行の高さが端数になる段落の下の要素が 0.5px 未満ずつ
  //    ずれて文字のにじみが変わる(ツリーの変換を足したときに画素比較で見えた)。
  //    変形(rotate など)が掛かった子だけは矩形が外接矩形になるので、変形の影響を受けない offset 系を使う
  const plans = children.map((el) => {
    const cs = win.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const useOffset = isTransformed(cs) && el.offsetParent === container && typeof el.offsetLeft === 'number';
    const size = styleSizeFor(cs, rect.width / scale, rect.height / scale);
    let left: number;
    let top: number;
    if (useOffset) {
      left = el.offsetLeft;
      top = el.offsetTop;
    } else {
      // 器の padding box 基準へ割り戻す(SVG など offset 系を持たない要素もここ)
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
    rememberItemGeometry(p.el);
    p.el.classList.add(FREELAYOUT_ITEM_CLASS);
    p.el.style.position = 'absolute';
    p.el.style.left = `${Math.round(p.left * 100) / 100}px`;
    p.el.style.top = `${Math.round(p.top * 100) / 100}px`;
    p.el.style.width = p.size.width;
    p.el.style.height = p.size.height;
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

/**
 * 絶対配置にした要素を流し込みへ戻す(幾何を外し、元の値があれば書き戻す)。
 *
 * 元の値は控え(--gg-flow-*)を正にする。控えが無い要素は、同一セッション中だけ
 * 退避(data-gg-prestyle)を見る。どちらにも無ければ外すだけ(元は指定なし)
 */
export function restoreItemGeometry(element: HTMLElement): void {
  const record = readFlowRecord(element);
  if (record.size > 0) {
    for (const prop of GEOMETRY_PROPS) element.style.removeProperty(prop);
    for (const prop of ITEM_LONGHANDS) element.style.removeProperty(prop);
    for (const [prop, value] of record) {
      if (value && value !== FLOW_UNSET) element.style.setProperty(prop, value);
    }
    clearFlowRecord(element);
  } else {
    for (const prop of GEOMETRY_PROPS) {
      const original = prestyleValue(element, prop);
      if (original) element.style.setProperty(prop, original);
      else element.style.removeProperty(prop);
    }
  }
  element.classList.remove(FREELAYOUT_ITEM_CLASS, FREELAYOUT_REL_CLASS);
  if (!element.getAttribute('style')) element.removeAttribute('style');
  if (!element.getAttribute('class')) element.removeAttribute('class');
}

/**
 * 流れに残った器(gg-freelayout / gg-freelayout-hold)の手当てを外す。
 *
 * 高さの固定は必ずこの変換が書いたもの(器の印がその証拠)。position は gg-freelayout-rel の
 * ときだけ外す。幅・余白の手当ては控え(`unset` を含む)があるものだけ戻す
 */
export function restoreContainerGeometry(container: HTMLElement): void {
  const record = readFlowRecord(container);
  const restore = (prop: string): void => {
    const recorded = record.get(prop);
    const original = recorded !== undefined ? (recorded === FLOW_UNSET ? null : recorded) : prestyleValue(container, prop);
    if (original) container.style.setProperty(prop, original);
    else container.style.removeProperty(prop);
  };
  restore('height');
  if (container.classList.contains(FREELAYOUT_REL_CLASS)) restore('position');
  for (const prop of record.keys()) {
    if (prop !== 'height' && prop !== 'position') restore(prop);
  }
  clearFlowRecord(container);
  container.classList.remove(FREELAYOUT_CLASS, FREELAYOUT_HOLD_CLASS, FREELAYOUT_REL_CLASS);
  if (!container.getAttribute('style')) container.removeAttribute('style');
  if (!container.getAttribute('class')) container.removeAttribute('class');
}

/**
 * 絶対配置の要素を流し込みへ戻すが、その要素自身が器(中の子が絶対配置)なら
 * 今の高さで固定したまま器として残す。外すと中の子が抜けたぶん高さが 0 に潰れる
 */
function restoreItemKeepingContainer(element: HTMLElement, win: Window): void {
  if (!isFreeLayoutContainer(element)) {
    restoreItemGeometry(element);
    return;
  }
  const height = win.getComputedStyle(element).height;
  restoreItemGeometry(element);
  rememberFlowValues(element, ['height']);
  element.style.height = height;
  if (win.getComputedStyle(element).position === 'static') {
    rememberFlowValues(element, ['position']);
    element.style.position = 'relative';
    element.classList.add(FREELAYOUT_REL_CLASS);
  }
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
  // 解除するのはこの変換が倒した子だけ。元から absolute の飾りは位置も並びも触らない
  const items = children.filter((el) => el.classList.contains(FREELAYOUT_ITEM_CLASS));
  const measured = items.map((el) => ({ el, rect: el.getBoundingClientRect() }));
  const ordered = sortByVisualOrder(measured);

  for (const el of ordered) restoreItemKeepingContainer(el, win);
  // 倒した子が占めていた並びの枠に、見えていた順で入れ直す(飾りの位置は変えない)。
  // insertBefore は既存ノードの移動として働く
  const slots = children.map((el) => items.includes(el));
  const marker = iframeDoc.createComment('gg-freelayout');
  container.insertBefore(marker, children[0] ?? null);
  let next = 0;
  for (let i = 0; i < children.length; i++) {
    container.insertBefore(slots[i] ? ordered[next++] : children[i], marker);
  }
  // 印の手前へ順に入れ直したので、印はもう要らない
  marker.remove();

  restoreContainerGeometry(container);

  debugLog('[disableFreeLayout] 流し込みへ:', ordered.length, '要素');
  return ordered.length;
}

/**
 * 選んだ要素から下の自由配置を、入れ子まで全部流し込みへ戻す。
 *
 * **並べ替えはしない**。DOM の順はツリーの変換で一度も変えていないので、幾何を外すだけで
 * 元の流し込み(元の HTML)に戻る。見えている順に並べ直す disableFreeLayout と違い、
 * flex-row-reverse や order で並びと見た目の順が食い違う器でも元どおりになる。
 * 深い要素から戻す(親の高さの固定を外すのは子が流れへ戻ってから)。
 *
 * 選んだ要素自身が親の器の中で絶対配置(gg-freelayout-item)なら、その位置と大きさは残す
 * (解除するのは「このツリーの中」だけ)。
 *
 * @returns 流し込みへ戻した要素の数
 */
export function disableFreeLayoutTree(root: HTMLElement, iframeDoc: Document): number {
  const win = iframeDoc.defaultView;
  if (!win) return 0;
  const inside = Array.from(
    root.querySelectorAll<HTMLElement>(`.${FREELAYOUT_ITEM_CLASS}, .${FREELAYOUT_CLASS}, .${FREELAYOUT_HOLD_CLASS}`),
  ).reverse();
  let items = 0;
  for (const el of inside) {
    if (el.classList.contains(FREELAYOUT_ITEM_CLASS)) {
      restoreItemGeometry(el);
      el.classList.remove(FREELAYOUT_CLASS, FREELAYOUT_HOLD_CLASS);
      if (!el.getAttribute('class')) el.removeAttribute('class');
      items++;
    } else {
      restoreContainerGeometry(el);
    }
  }
  if (root.classList.contains(FREELAYOUT_ITEM_CLASS)) {
    // 自身の絶対配置は親の器のもの。器の印だけ外す(高さは自身の大きさとして残る)
    root.classList.remove(FREELAYOUT_CLASS, FREELAYOUT_HOLD_CLASS);
  } else if (isFreeLayoutContainer(root) || root.classList.contains(FREELAYOUT_HOLD_CLASS)) {
    restoreContainerGeometry(root);
  }
  debugLog('[disableFreeLayoutTree] 流し込みへ:', items, '要素');
  return items;
}

/** この要素から下に、自由配置の手当て(器・絶対配置にした要素)があるか */
export function hasFreeLayoutInside(element: HTMLElement): boolean {
  return (
    isFreeLayoutContainer(element) ||
    !!element.querySelector(`.${FREELAYOUT_CLASS}, .${FREELAYOUT_ITEM_CLASS}, .${FREELAYOUT_HOLD_CLASS}`)
  );
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
    rememberFlowValues(parent, ['position']);
    parent.style.position = 'relative';
    parent.classList.add(FREELAYOUT_REL_CLASS);
  }

  const size = styleSizeFor(cs, rect.width / scale, rect.height / scale);
  // 位置は小数で出す(enableFreeLayout の④と同じ理由)。変形が掛かった要素だけ offset 系
  const useOffset = isTransformed(cs) && element.offsetParent === parent && typeof element.offsetLeft === 'number';
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
  rememberItemGeometry(element);
  element.classList.add(FREELAYOUT_ITEM_CLASS);
  element.style.position = 'absolute';
  element.style.left = `${Math.round(left * 100) / 100}px`;
  element.style.top = `${Math.round(top * 100) / 100}px`;
  element.style.width = size.width;
  element.style.height = size.height;
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

  restoreItemKeepingContainer(element, win);

  const parent = element.parentElement;
  if (parent && parent.classList.contains(FREELAYOUT_HOLD_CLASS)) {
    const stillOut = layoutChildren(parent).some((c) => c.classList.contains(FREELAYOUT_ITEM_CLASS));
    if (!stillOut) restoreContainerGeometry(parent);
  }
  return true;
}

// ────────────────────────────────────────────────────────────
// ページ一括
// ────────────────────────────────────────────────────────────

/**
 * ページの最上位のセクション = 一括変換の対象。
 *
 * `main` があればその直下、無ければ `#artboard` の直下。
 * main は直下とは限らない——構成ラフの殻は
 * `#artboard > .wf-frame > .flex > .flex-1 > main` のように何段も挟むうえ、
 * 隣に注釈の欄(aside)が並ぶ。**版面の帯だけ**を対象にしたいので main を探す。
 *
 * artboard 自身は倒さない——倒すとセクションが重なり、ページの高さが 0 になる。
 * セクションは流し込みのまま積み、**それぞれの中だけ**を自由配置にする。
 */
export function topLevelSections(iframeDoc: Document): HTMLElement[] {
  const artboard = iframeDoc.getElementById('artboard');
  if (!artboard) return [];
  const main = artboard.querySelector('main');
  const root = (main as HTMLElement | null) ?? artboard;
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

/**
 * ページ全体を流し込みへ戻す。
 *
 * 入れ子の器(ツリーの変換で作ったもの)を含む器は、並べ替えない disableFreeLayoutTree で戻す。
 * 1 段だけの器は従来どおり、見えている順に並べ直して戻す
 */
export function disablePageFreeLayout(iframeDoc: Document): { sections: number; elements: number } {
  let sections = 0;
  let elements = 0;
  const artboard = iframeDoc.getElementById('artboard');
  if (!artboard) return { sections, elements };
  const containers = [
    ...(isFreeLayoutContainer(artboard) ? [artboard] : []),
    ...Array.from(artboard.querySelectorAll<HTMLElement>(`.${FREELAYOUT_CLASS}`)),
  ];
  // 外側の器から見る。内側は外側の処理で戻っていることがある
  for (const c of containers) {
    if (!c.isConnected || !isFreeLayoutContainer(c)) continue;
    const nested = !!c.querySelector(`.${FREELAYOUT_CLASS}`);
    elements += nested ? disableFreeLayoutTree(c, iframeDoc) : disableFreeLayout(c, iframeDoc);
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
