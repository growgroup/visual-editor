/**
 * オートレイアウトの「明示的なON」と、そのための子のフロー化。
 *
 * 【なぜ明示的なONにするか】
 * テンプレート由来の display:flex はスライド中に山ほどあり、それを全部
 * 「並べ替えの器」として扱うと、既定のドラッグ(絶対配置化して自由移動)が
 * 勝手に変わってしまう。そこで **右パネルでレイアウトをONにしたコンテナだけ** を
 * 目印クラス gg-autolayout で区別し、挙動を変えるのはその中だけに閉じる。
 *
 * 目印を class にしているのは、書き戻しエンジンを触らずに原本TSXへ乗せるため。
 * data-gg-* は保存時のサニタイズで落ちるので使えない。
 *
 * 【ONにした瞬間に何をするか】(Figmaの「オートレイアウトを追加」と同じ)
 * エディタは開いた時点で全要素を絶対配置へ倒す(EditorCanvas の一括変換)。
 * 絶対配置の子はフレックスの並びから外れるため、そのままでは gap も方向も
 * 効かない(実測: gap 6→60px で子の位置は 278/285/292 のまま不動。
 * position を static に戻した瞬間 278/312/347 になった)。
 * そこでONの瞬間に、**今見えている位置の順**で子を並べ直し、
 * position/left/top を外して流し込みへ戻す。サイズは維持する。
 */

/** オートレイアウトを明示的にONにした印。class なので原本TSXまで届く */
export const AUTOLAYOUT_CLASS = 'gg-autolayout';

/** この要素は明示的にオートレイアウトONか */
export function isAutoLayoutContainer(element: HTMLElement): boolean {
  return element.classList.contains(AUTOLAYOUT_CLASS);
}

/** 一括変換が書き込む幾何プロパティ。これらだけを取り除く */
const CONVERTED_PROPS = [
  'position',
  'left',
  'top',
  'right',
  'bottom',
  'width',
  'height',
  'margin',
  'flex',
] as const;

/** 退避された変換前スタイルの中で、その要素が元々持っていた値を引く */
function prestyleValue(pres: string, prop: string): string | null {
  // data-gg-prestyle は素の style 文字列。'__none__' は「元は style 属性なし」
  if (!pres || pres === '__none__') return null;
  const re = new RegExp(`(?:^|;)\\s*${prop.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}\\s*:\\s*([^;]+)`, 'i');
  const m = pres.match(re);
  return m ? m[1].trim() : null;
}

/**
 * 要素を流し込みへ戻す。戻したら true
 *
 * 変換が書いた幾何プロパティを消し、元の style に同じ指定があればそれを書き戻す。
 * 「元から絶対配置だった要素」(退避値に position:absolute がある)は
 * ユーザーの意図なので触らない。
 */
export function restoreElementToFlow(element: HTMLElement): boolean {
  const pres = element.getAttribute('data-gg-prestyle');

  // 退避が無い = 一括変換を経ていない。勝手に位置指定を剥がすと
  // ユーザーが自分で置いた要素を動かしてしまうので何もしない
  if (pres === null) return false;

  const originalPosition = prestyleValue(pres, 'position');
  if (originalPosition === 'absolute' || originalPosition === 'fixed') return false;

  for (const prop of CONVERTED_PROPS) {
    const original = prestyleValue(pres, prop);
    if (original) {
      element.style.setProperty(
        prop.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()),
        original,
      );
    } else {
      element.style.removeProperty(prop.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()));
    }
  }
  return true;
}

/**
 * コンテナの直接の子を流し込みへ戻す。戻した数を返す
 *
 * 対象は**直接の子だけ**。孫まで戻すと、子の内側で絶対配置に頼っている
 * 作り込み(重ね置きの図など)まで崩れる。フレックスの並びに要るのは
 * 直接の子が流れに乗っていることだけ。
 */
export function restoreChildrenToFlow(container: HTMLElement): number {
  let n = 0;
  for (const node of Array.from(container.children)) {
    // [注意] `node instanceof HTMLElement` は使えない(iframeとは別realmのため常にfalse)
    const el = node as HTMLElement;
    if (typeof el.matches !== 'function') continue;
    if (el.matches('.selection-box,.marquee-selection-box,.resize-handle,.rotation-handle,.size-label,.element-breadcrumb')) {
      continue;
    }
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    if (restoreElementToFlow(el)) n++;
  }
  return n;
}

/**
 * コンテナ自身の「サイズの固定」を解く
 *
 * 一括変換は width/height も焼き込む。縦積みに変えたのに高さが固定のままだと
 * 中身がはみ出す(overflow)ため、元々サイズ指定が無かったなら外す。
 * 位置(left/top)は動かさない — コンテナの居場所はユーザーが決めたものなので。
 */
export function relaxContainerSize(container: HTMLElement): void {
  const pres = container.getAttribute('data-gg-prestyle');
  if (pres === null) return;
  for (const prop of ['width', 'height'] as const) {
    const original = prestyleValue(pres, prop);
    if (original) container.style.setProperty(prop, original);
    else container.style.removeProperty(prop);
  }
}

/** 並べ替え・整列の対象にしない、エディタが描いている飾り */
const OVERLAY_SELECTOR =
  '.selection-box,.marquee-selection-box,.resize-handle,.rotation-handle,' +
  '.size-label,.element-breadcrumb,.gg-comment-layer,.gg-collab-layer,.gg-crop-ui,' +
  '#gg-measure-layer,#gg-smart-guides,#gg-reorder-indicator';

/** 実体のある直接の子だけを取り出す */
function layoutChildren(container: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const node of Array.from(container.children)) {
    // [注意] `node instanceof HTMLElement` は使えない(iframeとは別realmのため常にfalse)
    const el = node as HTMLElement;
    if (typeof el.matches !== 'function') continue;
    if (el.matches(OVERLAY_SELECTOR)) continue;
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    out.push(el);
  }
  return out;
}

/**
 * オートレイアウトをONにする。
 *
 * 1. 目印クラスを付ける
 * 2. 今見えている位置の順に子を並べ替える(row=左→右 / column=上→下)
 * 3. 子の絶対配置を解いて流し込みへ戻す。**サイズは維持する**
 *
 * 並べ替えを先に決めてから position を外すのが肝。先に外すと要素が動いてしまい、
 * 「見えていた順」が分からなくなる。
 */
export function enableAutoLayout(
  container: HTMLElement,
  direction: 'row' | 'column',
): number {
  container.classList.add(AUTOLAYOUT_CLASS);

  const children = layoutChildren(container);
  if (children.length === 0) return 0;

  // ① 動かす前に「見えている位置」と実寸を控える
  const measured = children.map((el) => {
    const r = el.getBoundingClientRect();
    return { el, x: r.left, y: r.top, width: el.offsetWidth, height: el.offsetHeight };
  });

  // ② 視覚順に並べ替える。同じ座標なら元のDOM順を保つ(安定ソート)
  const ordered = [...measured].sort((a, b) => (direction === 'column' ? a.y - b.y : a.x - b.x));

  // ③ 絶対配置を解く。サイズは実寸で固定して、戻した瞬間に縮まないようにする
  for (const m of ordered) {
    for (const prop of ['position', 'left', 'top', 'right', 'bottom'] as const) {
      m.el.style.removeProperty(prop);
    }
    if (!m.el.style.width && m.width > 0) m.el.style.width = `${m.width}px`;
    if (!m.el.style.height && m.height > 0) m.el.style.height = `${m.height}px`;
  }

  // ④ DOM順を視覚順に合わせる(appendChild は既存ノードの移動として働く)
  for (const m of ordered) container.appendChild(m.el);

  return ordered.length;
}

/** オートレイアウトをOFFにする。印を外すだけで、子の位置は今の見た目のまま残す */
export function disableAutoLayout(container: HTMLElement): void {
  container.classList.remove(AUTOLAYOUT_CLASS);
}
