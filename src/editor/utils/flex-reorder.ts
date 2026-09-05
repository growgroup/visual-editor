/**
 * フロー内ドラッグ = 同一親の中での並べ替え。
 *
 * オートレイアウト(display:flex)の子を掴んだとき、従来は問答無用で絶対配置へ
 * 倒していたため、フレックスの設定が触った瞬間に無意味になっていた。
 * ここでは「親の中での順番を変える」だけを行い、**要素を親の外へ出さない**。
 * 以前あった「ゴースト並べ替え」は任意の親へ再挿入できたため、離した場所に
 * よっては要素が画面の外へ消えた。同一親に限ることでその事故を構造的に防ぐ。
 *
 * 【slide と webpage で入口が違う】
 * - slide  : `shouldReorder` = 明示的にオートレイアウトONにした flex の器だけ。
 *            テンプレート由来の flex が山ほどあり、全部を器にすると既定の
 *            ドラッグ(絶対配置化して自由移動)が勝手に変わってしまうため。
 * - webpage: `resolveWebpageDrag` = フロー内の要素は**常に**並べ替え。
 *            webpage は版面を流し込みのまま保つ約束なので、絶対配置へ倒すと
 *            ページ高さが潰れて紙面が飛ぶ(これが「動かすと版面が崩れる」の正体)。
 *
 * 座標はクライアント座標(getBoundingClientRect)のまま扱う。ここで必要なのは
 * 「カーソルが兄弟の前半か後半か」だけで、アートボード座標へ割り戻す必要がない。
 */

import { isAutoLayoutContainer, restoreChildrenToFlow } from './restore-flow';

const INDICATOR_ID = 'gg-reorder-indicator';
const BLUE = '#0d99ff';

/** 並べ替えの対象にしない、エディタが描いている飾り */
const OVERLAY_SELECTOR =
  '.selection-box,.marquee-selection-box,.resize-handle,.rotation-handle,' +
  '.size-label,.element-breadcrumb,.gg-comment-layer,.gg-crop-ui,' +
  '.flex-drop-indicator,#gg-measure-layer,#gg-smart-guides,#' + INDICATOR_ID;

/**
 * 並びの性格。挿入位置の決め方と、青い線の引き方がこれで変わる。
 * - block : 縦一列の流し込み。前後は y の中点で決まる
 * - flex  : 主軸が1本(row/column)。前後は主軸の中点で決まる
 * - grid2d: grid と flex-wrap。1本の軸では決まらないので、
 *           「カーソルに一番近い兄弟」を選んでから、ずれの大きい軸で前後を決める
 */
export type ReorderLayout = 'block' | 'flex' | 'grid2d';

/** 親が並べ替えの器になり得る display か。webpage の入口で使う */
function classifyDisplay(display: string): ReorderLayout | null {
  if (display === 'flex' || display === 'inline-flex') return 'flex';
  if (display === 'grid' || display === 'inline-grid') return 'grid2d';
  if (display === 'block' || display === 'flow-root' || display === 'list-item') return 'block';
  // inline / table 系 / contents などは並びの前後が素直に決まらないので触らない
  return null;
}

/** ドラッグを並べ替えとして扱うための材料。これが作れたら並べ替えできる */
export interface ReorderPlan {
  /** 動かす要素(DOM順の連続した塊)。単一選択なら1個 */
  elements: HTMLElement[];
  parent: HTMLElement;
  layout: ReorderLayout;
}

/** webpage モードでドラッグをどう扱うかの判定結果 */
export type WebpageDragPlan =
  /** 同一親の中で並べ替える */
  | { kind: 'reorder'; plan: ReorderPlan }
  /** 兄弟がいない(ひとりっ子)。動かす先がないので何もしない */
  | { kind: 'no-siblings' }
  /** 複数選択がバラバラ(親が違う/連続していない/フロー内と絶対配置の混在) */
  | { kind: 'not-contiguous' }
  /** 従来どおり座標で自由に動かす(すでに絶対配置の要素など) */
  | { kind: 'free' };

/** 並べ替え中の状態。ドラッグ開始時に1回だけ作る */
export interface ReorderSession {
  /** 動かしている要素(DOM順の連続した塊) */
  elements: HTMLElement[];
  parent: HTMLElement;
  /** 動かしている要素を除いた兄弟(DOM順) */
  siblings: HTMLElement[];
  layout: ReorderLayout;
  /** 主軸が縦か(grid2d では使わない) */
  isColumn: boolean;
  /** flex-direction が *-reverse か(画面上の並びとDOM順が逆になる) */
  isReverse: boolean;
  /** 開始時の挿入位置。ここと同じなら「順番は変わっていない」 */
  originalIndex: number;
  /** 直前に描いた挿入位置。同じなら描き直さない */
  lastIndex: number;
  /** grid2d で直近に使った軸。青い線をこの軸で引く */
  lastAxis: 'x' | 'y';
  /** grid2d で線を引く相手(カーソルに一番近い兄弟) */
  lastNeighbor: HTMLElement | null;
  /** lastNeighbor の手前に入れるのか(false なら後ろ) */
  lastBefore: boolean;
}

/** 並べ替えの相手になる子だけを取り出す */
export function realChildren(parent: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const node of Array.from(parent.children)) {
    // [注意] `node instanceof HTMLElement` は使えない。この関数は親ウィンドウで
    // 動くが要素は iframe の realm に属するため、常に false になる
    const el = node as HTMLElement;
    if (typeof el.matches !== 'function') return out.length ? out : [];
    if (el.matches(OVERLAY_SELECTOR)) continue;
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    out.push(el);
  }
  return out;
}

/** フロー(static/relative)の中にいるか */
function isInFlow(element: HTMLElement, win: Window): boolean {
  const position = win.getComputedStyle(element).position;
  return position !== 'absolute' && position !== 'fixed';
}

/**
 * この要素を「同一親の並べ替え」で動かすべきか判定する。【slide 専用・変更禁止】
 *
 * 【既定は現状維持】computed が flex というだけでは並べ替えにしない。
 * テンプレート由来の flex はスライド中に山ほどあり、それを全部器として扱うと
 * 既定のドラッグ(絶対配置化して自由移動)が勝手に変わってしまう。
 *
 * 条件はすべて満たす必要がある:
 *   - 単一選択(群ドラッグは従来どおり座標移動。順番の概念が無い)
 *   - 親が **明示的にオートレイアウトON** (gg-autolayout クラスを持つ)
 *   - 親が display:flex / inline-flex(gridは対象外。2次元の並びは順番だけでは決まらない)
 *   - 自身がフローの中にいる(ONにした時点で子はフロー化済み。
 *     その後ユーザーが自分で絶対配置にした子は座標移動のまま)
 *   - 並べ替える相手が2つ以上いる
 */
export function shouldReorder(
  element: HTMLElement,
  doc: Document,
  selectedCount: number,
): boolean {
  if (selectedCount > 1) return false;
  const win = doc.defaultView;
  const parent = element.parentElement;
  if (!win || !parent) return false;

  // 明示的にONにした器の中だけが並べ替えの対象
  if (!isAutoLayoutContainer(parent)) return false;

  const display = win.getComputedStyle(parent).display;
  if (display !== 'flex' && display !== 'inline-flex') return false;

  const own = win.getComputedStyle(element).position;
  if (own === 'absolute' || own === 'fixed') return false;

  return realChildren(parent).length >= 2;
}

/** slide の並べ替え(shouldReorder が true のとき)の材料を作る */
export function planSlideReorder(
  element: HTMLElement,
  doc: Document,
): ReorderPlan | null {
  const parent = element.parentElement;
  if (!parent) return null;
  // shouldReorder が display:flex/inline-flex を保証しているので layout は 'flex' 固定。
  // ここで flex-wrap を見て grid2d へ振ると slide の既存挙動が変わるので、あえて見ない
  return { elements: [element], parent, layout: 'flex' };
}

/**
 * webpage モードでこのドラッグをどう扱うか決める。
 *
 * webpage は「絶対配置へ倒さない」が設計原則(README)。倒すと版面が固定pxに固まり、
 * さらにカラムが流れから抜けてページ高さが潰れ、紙面が中央寄せで飛ぶ。
 * そこでフロー内の要素は必ず並べ替えに回し、倒すのは Cmd/Ctrl の逃げ道だけにする。
 *
 * 判定の順番:
 *   1. すでに絶対配置(全部) → free。倒す必要がないので従来どおり座標移動
 *   2. フロー内と絶対配置の混ざった複数選択 → not-contiguous(何もしない)。
 *      片方を倒すと版面が崩れ、倒さないと群がバラけるため、どちらも選ばない
 *   3. 親が並べ替えの器になり得ない display → free
 *   4. 複数選択が別の親 / 連続していない → not-contiguous
 *   5. 兄弟がいない → no-siblings
 *   6. それ以外 → reorder
 */
export function resolveWebpageDrag(
  elements: HTMLElement[],
  doc: Document,
): WebpageDragPlan {
  const win = doc.defaultView;
  if (!win || elements.length === 0) return { kind: 'free' };

  const inFlow = elements.filter((el) => isInFlow(el, win));
  // 1. 全部フロー外 → 触っても版面は動かない。従来どおりの自由移動
  if (inFlow.length === 0) return { kind: 'free' };
  // 2. 混在 → 群としてまとまった扱いができない
  if (inFlow.length !== elements.length) return { kind: 'not-contiguous' };

  const parent = elements[0].parentElement;
  if (!parent) return { kind: 'free' };
  if (elements.some((el) => el.parentElement !== parent)) {
    return { kind: 'not-contiguous' };
  }

  // 3. 器になり得る display か
  const layout = classifyDisplay(win.getComputedStyle(parent).display);
  if (!layout) return { kind: 'free' };

  const children = realChildren(parent);
  const indices = elements
    .map((el) => children.indexOf(el))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  if (indices.length !== elements.length) return { kind: 'free' };

  // 4. 連続した塊か(飛び飛びの選択を1か所へ寄せると、選んでいない要素の順番まで変わる)
  const contiguous = indices.every((v, i) => i === 0 || v === indices[i - 1] + 1);
  if (!contiguous) return { kind: 'not-contiguous' };

  // 5. 並べ替える相手がいない
  if (children.length - elements.length < 1) return { kind: 'no-siblings' };

  // DOM順に揃えてから渡す(選択の順番ではなく並びの順番で動かす)
  const ordered = indices.map((i) => children[i]);
  return { kind: 'reorder', plan: { elements: ordered, parent, layout } };
}

/**
 * 並べ替えの下ごしらえ(ドラッグが動き出した最初の1回だけ呼ぶ)
 *
 * @param options.restoreFlow
 *   子の絶対配置を解いてフローへ戻すか。
 *   slide の明示ONの器では true(ONにした後に別経路で絶対配置が焼き込まれた子を直す)。
 *   **webpage では必ず false**。webpage の普通の親には「Cmd+ドラッグで自由配置にした子」が
 *   混ざり得て、隣の要素を普通にドラッグしただけでそれが勝手にフローへ戻ってしまうため。
 */
export function startReorder(
  plan: ReorderPlan,
  doc: Document,
  options: { restoreFlow: boolean },
): ReorderSession | null {
  const win = doc.defaultView;
  const { parent, elements, layout } = plan;
  if (!win || elements.length === 0) return null;

  if (options.restoreFlow) {
    // 子はONにした時点でフロー化済み。ただし後から追加された子や、
    // 別経路で絶対配置が焼き込まれた子が混じると並びが崩れるので保険で通す
    restoreChildrenToFlow(parent);
  }

  const children = realChildren(parent);
  const moving = new Set(elements);
  const siblings = children.filter((c) => !moving.has(c));
  const firstIndex = children.indexOf(elements[0]);
  if (firstIndex < 0) return null;

  // 連続した塊が children の firstIndex から始まるなら、
  // 塊を抜いた siblings の中では firstIndex 番目の手前が「元の位置」になる
  const originalIndex = firstIndex;

  const parentStyle = win.getComputedStyle(parent);
  const dir = parentStyle.flexDirection || 'row';

  // 掴んでいる要素は「持ち上がっている」ことを見せる。
  // 既存の .dragging(opacity .7 + grabbing)をそのまま使う。インラインstyleで
  // 当てると保存HTMLに漏れうるが、このクラスは getCleanHtml が必ず剥がす
  for (const el of elements) el.classList.add('dragging');

  return {
    elements,
    parent,
    siblings,
    layout,
    // block は縦一列。flex の computed は block でも 'row' を返すので、
    // flexDirection をそのまま信じると横軸で判定してしまう
    isColumn: layout === 'block' ? true : dir.startsWith('column'),
    isReverse: layout === 'flex' && dir.endsWith('-reverse'),
    originalIndex,
    lastIndex: -1,
    lastAxis: 'y',
    lastNeighbor: null,
    lastBefore: true,
  };
}

/**
 * カーソル位置から「兄弟の何番目の前に入るか」を決める
 *
 * 返すのは siblings(動かしている要素を除いた配列)に対する挿入位置。
 *
 * block / flex は1本の軸しかないので、各兄弟の中点と比べるだけでよい。
 * 要素が可変幅でも破綻しない。flex-direction:*-reverse は画面上の並びと
 * DOM順が逆なので、最後に反転する。
 *
 * grid / flex-wrap は1本の軸では決まらない(右隣も下隣もいる)。
 * カーソルに一番近い兄弟を選び、その中心からのずれを要素の幅・高さで正規化して、
 * **ずれが支配的なほうの軸**で前後を決める。これ以上凝らない。
 */
export function computeInsertIndex(
  session: ReorderSession,
  clientX: number,
  clientY: number,
  doc: Document,
): number {
  const { siblings, isColumn, isReverse, layout } = session;
  if (siblings.length === 0) return 0;

  if (layout === 'grid2d') {
    let nearest = 0;
    let best = Infinity;
    let bestRect: DOMRect | null = null;
    for (let i = 0; i < siblings.length; i++) {
      const r = siblings[i].getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = (clientX - cx) ** 2 + (clientY - cy) ** 2;
      if (d < best) {
        best = d;
        nearest = i;
        bestRect = r;
      }
    }
    if (!bestRect) return siblings.length;

    const cx = bestRect.left + bestRect.width / 2;
    const cy = bestRect.top + bestRect.height / 2;
    // 幅・高さで割ってから比べる。割らないと、横長のカードで
    // 少し上下にずれただけで「縦の入れ替え」に化ける
    const nx = bestRect.width > 0 ? (clientX - cx) / bestRect.width : 0;
    const ny = bestRect.height > 0 ? (clientY - cy) / bestRect.height : 0;
    const useY = Math.abs(ny) > Math.abs(nx);
    const before = useY ? clientY < cy : clientX < cx;

    session.lastAxis = useY ? 'y' : 'x';
    session.lastNeighbor = siblings[nearest];
    session.lastBefore = before;
    return before ? nearest : nearest + 1;
  }

  let index = siblings.length;
  for (let i = 0; i < siblings.length; i++) {
    const r = siblings[i].getBoundingClientRect();
    const mid = isColumn ? r.top + r.height / 2 : r.left + r.width / 2;
    const cursor = isColumn ? clientY : clientX;
    const before = isReverse ? cursor > mid : cursor < mid;
    if (before) {
      index = i;
      break;
    }
  }
  session.lastAxis = isColumn ? 'y' : 'x';
  session.lastNeighbor = null;
  return index;
}

/**
 * 挿入位置を示す青い線を描く
 *
 * 線は #artboard 直下ではなく **親のすぐ内側** に置きたいが、親に
 * position が無いと座標の基準にできない。親の style を書き換えると版面が動くので、
 * body直下に fixed で置く(画面座標そのまま)。ドラッグ中しか出ないので
 * スクロール追従は不要。
 *
 * grid2d だけは親いっぱいに引くと意味が伝わらない(どの行に入るか分からない)ので、
 * 「入る先の隣人」の辺に、その隣人の幅・高さで引く。
 */
export function drawInsertIndicator(
  session: ReorderSession,
  index: number,
  doc: Document,
): void {
  clearInsertIndicator(doc);

  const { siblings, isColumn, isReverse, parent, layout } = session;
  const base = 'position:fixed;z-index:10001;pointer-events:none;' +
    `background:${BLUE};border-radius:1.5px;box-shadow:0 0 6px rgba(13,153,255,0.5);`;
  const line = doc.createElement('div');
  line.id = INDICATOR_ID;

  if (layout === 'grid2d' && session.lastNeighbor) {
    const r = session.lastNeighbor.getBoundingClientRect();
    if (session.lastAxis === 'y') {
      const y = session.lastBefore ? r.top : r.bottom;
      line.style.cssText = base + `left:${r.left}px;width:${r.width}px;top:${y - 1.5}px;height:3px;`;
    } else {
      const x = session.lastBefore ? r.left : r.right;
      line.style.cssText = base + `top:${r.top}px;height:${r.height}px;left:${x - 1.5}px;width:3px;`;
    }
    doc.body.appendChild(line);
    return;
  }

  const parentRect = parent.getBoundingClientRect();

  // 挿入位置の座標。末尾なら最後の兄弟の後ろ、それ以外は index 番目の手前
  let pos: number;
  if (siblings.length === 0) {
    pos = isColumn ? parentRect.top : parentRect.left;
  } else if (index >= siblings.length) {
    const r = siblings[siblings.length - 1].getBoundingClientRect();
    pos = isColumn ? (isReverse ? r.top : r.bottom) : isReverse ? r.left : r.right;
  } else {
    const r = siblings[index].getBoundingClientRect();
    pos = isColumn ? (isReverse ? r.bottom : r.top) : isReverse ? r.right : r.left;
  }

  line.style.cssText = isColumn
    ? base + `left:${parentRect.left}px;width:${parentRect.width}px;top:${pos - 1.5}px;height:3px;`
    : base + `top:${parentRect.top}px;height:${parentRect.height}px;left:${pos - 1.5}px;width:3px;`;

  doc.body.appendChild(line);
}

/** 挿入位置の線を消す */
export function clearInsertIndicator(doc: Document): void {
  doc.getElementById(INDICATOR_ID)?.remove();
}

/**
 * 塊を siblings の index 番目の手前へ入れる。順番が変わったら true
 *
 * insertBefore しか使わないので、要素は必ず同じ親の中に留まる。
 */
export function applyReorder(
  parent: HTMLElement,
  elements: HTMLElement[],
  siblings: HTMLElement[],
  originalIndex: number,
  index: number,
): boolean {
  // すでにその位置にいるなら DOM を触らない(履歴を無駄に汚さない)
  if (index === originalIndex) return false;

  const target = index >= siblings.length ? null : siblings[index];
  // 塊はDOM順のまま順に差し込む。同じ参照点の前に入れれば元の順番が保たれる
  for (const el of elements) parent.insertBefore(el, target);
  return true;
}

/**
 * 並べ替えを確定する。順番が変わったら true
 */
export function commitReorder(
  session: ReorderSession,
  index: number,
  doc: Document,
): boolean {
  const { elements, parent, siblings, originalIndex } = session;

  // 見た目の持ち上げを戻してから並べ替える(保存HTMLに opacity を残さない)
  endReorder(session, doc);

  return applyReorder(parent, elements, siblings, originalIndex, index);
}

/** 見た目の持ち上げと線を片付ける(取り消し・中断からも呼ぶ) */
export function endReorder(session: ReorderSession | null, doc: Document): void {
  clearInsertIndicator(doc);
  if (!session) return;
  for (const el of session.elements) el.classList.remove('dragging');
}
