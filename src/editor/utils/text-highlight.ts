/**
 * 蛍光ペン(文字の背景色)と文字色を「箱」ではなく**文字**に効かせる。
 *
 * PowerPointの蛍光ペンは段落やプレースホルダー全体ではなく、文字の背後だけを塗る。
 * 要素に background-color を直接置くと <p> や <div> の箱全体が塗られてしまうので、
 *   - テキストを範囲選択している → その範囲だけを <span> で包む
 *   - 選択が無い(要素選択だけ)  → 要素の中の**テキスト部分**を <span> で包む
 * という2段構えにする。生成されるのはただのDOMなので、保存すると書き戻し
 * エンジンがそのまま原本TSXへ運ぶ。
 *
 * 文字色は箱に置いても見た目が変わらない(継承されるだけ)ため、範囲選択が
 * ある時だけ span 化し、それ以外は要素のスタイルに置く。
 */

const HL_ATTR = 'data-gg-hl';

const isElement = (n: Node): n is HTMLElement => n.nodeType === 1;
const isText = (n: Node): n is Text => n.nodeType === 3;

/** 蛍光ペンで作った(あるいは同等の)スパンか */
function isHighlightSpan(el: Element | null): el is HTMLElement {
  if (!el || el.tagName !== 'SPAN') return false;
  const he = el as HTMLElement;
  if (he.hasAttribute(HL_ATTR)) return true;
  // 保存→再読込後は data-gg-* が落ちるので、背景色だけを持つspanも対象にする
  const bg = he.style.backgroundColor;
  return !!bg && bg !== 'transparent' && he.style.length <= 2;
}

/** spanを外して中身だけ残す */
function unwrap(el: HTMLElement): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
  parent.normalize();
}

/** 範囲に関わる蛍光スパンを外す(入れ子を作らないため適用前に必ず通す) */
function clearHighlights(root: HTMLElement | Document, range?: Range): void {
  const scope = 'querySelectorAll' in root ? root : (root as Document);
  const spans = [...scope.querySelectorAll('span')].filter(isHighlightSpan);
  for (const s of spans) {
    if (!range || range.intersectsNode(s)) unwrap(s);
  }
  // 範囲を「包んでいる」スパン(範囲の内側には現れない)も外す
  if (range) {
    let node: Node | null = range.commonAncestorContainer;
    while (node && isText(node)) node = node.parentNode;
    let cur = node as Element | null;
    while (cur) {
      if (isHighlightSpan(cur)) {
        unwrap(cur);
        break;
      }
      cur = cur.parentElement;
    }
  }
}

/** テキスト編集中/アートボード内の有効な範囲選択を返す */
function activeRange(doc: Document): Range | null {
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!range.toString().trim()) return null;
  const artboard = doc.getElementById('artboard');
  if (!artboard || !artboard.contains(range.commonAncestorContainer)) return null;
  return range;
}

function makeSpan(doc: Document, color: string): HTMLElement {
  const span = doc.createElement('span');
  span.setAttribute(HL_ATTR, '1');
  span.style.backgroundColor = color;
  return span;
}

/**
 * 直前に蛍光ペンを当てたスパン。
 * 適用後は選択を解除する(青い選択帯が蛍光色の上に残るのを避ける)ので、
 * 「続けて別の色を選ぶ」操作のために対象を覚えておく。
 */
let lastSpan: HTMLElement | null = null;

/** 範囲をspanで包む(要素境界をまたぐ選択にも耐える) */
function wrapRange(doc: Document, range: Range, color: string): void {
  const span = makeSpan(doc, color);
  try {
    range.surroundContents(span);
  } catch {
    span.appendChild(range.extractContents());
    range.insertNode(span);
  }
  lastSpan = span;
  // 選択は解除する。残すとリボンへフォーカスが移った後も選択帯が描かれ、
  // 蛍光ペンの色が見えなくなる
  doc.getSelection()?.removeAllRanges();
}

/**
 * 要素の中の「文字が並んでいる部分」だけを span で包む。
 * テキストノードとインライン要素の連続を1つの run とみなすので、
 * 見出しの中の <span>強調</span> のようなインライン構造も一続きで塗れる。
 */
function wrapTextRuns(doc: Document, el: HTMLElement, color: string): boolean {
  const win = doc.defaultView;
  if (!win) return false;

  // 直接テキストを持つ要素を集める(自分自身も含む)
  const hosts: HTMLElement[] = [];
  const visit = (node: HTMLElement) => {
    if ([...node.childNodes].some((n) => isText(n) && n.textContent?.trim())) hosts.push(node);
    for (const child of [...node.children]) visit(child as HTMLElement);
  };
  visit(el);
  if (!hosts.length) return false;

  let changed = false;
  for (const host of hosts) {
    // 連続する「テキスト or インライン要素」を run にまとめる
    const runs: Node[][] = [];
    let cur: Node[] = [];
    for (const n of [...host.childNodes]) {
      const inline =
        isText(n) || (isElement(n) && win.getComputedStyle(n).display.startsWith('inline'));
      if (inline) cur.push(n);
      else if (cur.length) {
        runs.push(cur);
        cur = [];
      }
    }
    if (cur.length) runs.push(cur);

    for (const run of runs) {
      if (!run.some((n) => n.textContent?.trim())) continue;
      // すでに蛍光スパンだけの run なら色を差し替える
      if (run.length === 1 && isElement(run[0]) && isHighlightSpan(run[0])) {
        run[0].style.backgroundColor = color;
        changed = true;
        continue;
      }
      const span = makeSpan(doc, color);
      host.insertBefore(span, run[0]);
      for (const n of run) span.appendChild(n);
      changed = true;
    }
  }
  return changed;
}

/**
 * 蛍光ペンを適用する。color=null で解除。
 * @returns DOMを変更したか
 */
export function applyTextHighlight(
  doc: Document,
  els: HTMLElement[],
  color: string | null,
): boolean {
  const range = activeRange(doc);

  if (range) {
    clearHighlights(doc, range);
    if (color) wrapRange(doc, range, color);
    else lastSpan = null;
    return true;
  }

  // 直前に塗った範囲がまだ生きていれば、そこを塗り替える/消す
  if (lastSpan?.isConnected && (!els.length || els.some((el) => el.contains(lastSpan!)))) {
    if (color) lastSpan.style.backgroundColor = color;
    else {
      unwrap(lastSpan);
      lastSpan = null;
    }
    return true;
  }

  if (!els.length) return false;
  let changed = false;
  for (const el of els) {
    // 要素自身に付いていた箱の塗りは外す(旧仕様で塗られていた分の後始末)
    if (el.style.backgroundColor) {
      el.style.backgroundColor = '';
      changed = true;
    }
    clearHighlights(el);
    lastSpan = null;
    if (color) changed = wrapTextRuns(doc, el, color) || changed;
    else changed = true;
  }
  return changed;
}

/**
 * 文字色。範囲選択があればその範囲だけ、無ければ要素のスタイルに置く。
 */
export function applyTextColor(doc: Document, els: HTMLElement[], color: string): boolean {
  const range = activeRange(doc);
  if (range) {
    const span = doc.createElement('span');
    span.style.color = color;
    try {
      range.surroundContents(span);
    } catch {
      span.appendChild(range.extractContents());
      range.insertNode(span);
    }
    doc.getSelection()?.removeAllRanges();
    return true;
  }
  if (!els.length) return false;
  for (const el of els) el.style.color = color;
  return true;
}
