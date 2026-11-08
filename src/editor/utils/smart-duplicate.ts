/**
 * ⌘D の「直前のずれを繰り返す」複製(Figma の Duplicate / PowerPoint の Ctrl+D と同じ作法)。
 *
 * Figma(help.figma.com「Copy and paste objects」): ⌘D は元の真上に複製する(最上位フレームを除く)。
 * ⌥ドラッグで複製したあとに ⌘D を続けると、同じ距離で複製を続ける。
 * ⌘D で複製 → 動かす → ⌘D でも、同じずれを繰り返す(PowerPoint の Ctrl+D と同じ)。
 *
 * 「どの要素を、どこから複製したか」を1組だけ覚え、次の ⌘D で選択がその要素のままなら
 * 「今の位置 − 複製元の位置」をずれとして使う。選択が変わっていれば真上(ずれ 0)。
 */

interface Point {
  left: number;
  top: number;
}

let memory: { key: string; from: Point } | null = null;

const keyOf = (ids: string[]) => [...ids].sort().join(',');

/** 位置指定の要素の left/top(使用値)。フロー要素など読めないときは null */
export function readPosition(el: HTMLElement): Point | null {
  const view = el.ownerDocument.defaultView;
  if (!view) return null;
  const cs = view.getComputedStyle(el);
  if (cs.position !== 'absolute' && cs.position !== 'fixed') return null;
  const left = parseFloat(cs.left);
  const top = parseFloat(cs.top);
  return Number.isFinite(left) && Number.isFinite(top) ? { left, top } : null;
}

/** 複製した(または ⌥ドラッグで複製を置いた)要素と、その複製元の位置を覚える */
export function rememberDuplicate(ids: string[], from: Point | null): void {
  memory = ids.length && from ? { key: keyOf(ids), from } : null;
}

export function forgetDuplicate(): void {
  memory = null;
}

/**
 * 次の ⌘D のずれ。覚えた要素が今も選ばれていて、動いていればそのずれ。それ以外は 0
 * @param ids 今の選択
 * @param first 今の選択の先頭の要素(位置を読む)
 */
export function repeatOffsetFor(ids: string[], first: HTMLElement | null): { dx: number; dy: number } {
  if (!memory || !first || memory.key !== keyOf(ids)) return { dx: 0, dy: 0 };
  const now = readPosition(first);
  if (!now) return { dx: 0, dy: 0 };
  return { dx: now.left - memory.from.left, dy: now.top - memory.from.top };
}
