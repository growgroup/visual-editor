/**
 * SVG をクリックしたときの当たり判定。
 *
 * 【なぜ要るか】
 * HTML の中の `<svg>` は、描いた線や塗りが無い所も含めて**箱全体**でクリックを受ける。
 * 装飾の SVG(斜めの線・背景の図形)が文字やボタンの上に重なっていると、その箱の中を
 * どこを押しても SVG が選ばれ、下の要素を選べなかった。Cmd/Ctrl+クリック(最下層を選ぶ)も
 * 押した点の最上面から探すので同じだった。
 *
 * 【どう直したか】
 * Figma と同じく、見えている形(線・塗り・画像)の上を押したときだけ SVG を選び、
 * 箱の中の何も描かれていない所は**素通り**して下の要素を選ぶ。
 * 形の上かどうかは elementsFromPoint で見る。SVG の子(path / circle など)は
 * 描かれている所でしか当たらない(pointer-events の既定 visiblePainted)ので、
 * その点に子が返らなければ「箱の空き」と分かる。細い線は掴みにくいので、周り 3px も見る。
 *
 * SVG の中の要素(path / circle / g など)は、SVG ごと 1 つの図として扱う。
 * 編集の印(data-editable)は付けない(isInsideSvg)。
 */

/** エディタが紙面に重ねる層(選択枠・マーキー・ガイド)。当たり判定から外す */
const EDITOR_LAYERS =
  '.selection-box,.marquee-selection-box,[data-editor-overlay],#gg-smart-guides,#gg-measure-layer,.gg-collab-layer';

/** 細い線を掴めるようにする許容(px) */
const STROKE_TOLERANCE = 3;

/** SVG の中の要素か(`<svg>` 自身は含まない)。中身は SVG ごと 1 つの図として扱う */
export function isInsideSvg(el: Element): boolean {
  const parent = el.parentElement;
  return !!parent && typeof parent.closest === 'function' && !!parent.closest('svg');
}

/** 入れ子の SVG なら一番外の `<svg>` */
function outermostSvg(el: Element): Element | null {
  let svg = typeof el.closest === 'function' ? el.closest('svg') : null;
  while (svg) {
    const up = svg.parentElement?.closest('svg') ?? null;
    if (!up) return svg;
    svg = up;
  }
  return null;
}

function isEditorLayer(el: Element): boolean {
  return typeof el.closest === 'function' && !!el.closest(EDITOR_LAYERS);
}

/** SVG 自身に背景(CSS の background)が塗られていれば、箱全体が見えている */
function hasOwnBackground(svg: Element, doc: Document): boolean {
  const cs = doc.defaultView?.getComputedStyle(svg);
  if (!cs) return false;
  const bg = cs.backgroundColor;
  const transparent = !bg || bg === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(bg);
  return !transparent || (cs.backgroundImage && cs.backgroundImage !== 'none') || false;
}

/**
 * SVG を包んでいるだけの透明な器か(図形ツールで描いた線・矢印・ペンは
 * `<div style="position:absolute;background-color:transparent"><svg …></div>` の形)。
 * 子が全部「素通りさせた要素」で、自分の文字も背景・枠線・影も無ければ、器も素通りさせる。
 * これが無いと、SVG を素通りした先で器の箱が当たり、線の周りの空きで結局同じことが起きる
 */
function isBareWrapper(el: Element, doc: Document, skipped: Set<Element>): boolean {
  if (el.children.length === 0) return false;
  if (!Array.from(el.children).every((c) => skipped.has(c))) return false;
  if (Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')) return false;
  const cs = doc.defaultView?.getComputedStyle(el);
  if (!cs) return false;
  const paintsBox =
    hasOwnBackground(el, doc) ||
    ['Top', 'Right', 'Bottom', 'Left'].some(
      (s) => parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) > 0 && cs.getPropertyValue(`border-${s.toLowerCase()}-style`) !== 'none',
    ) ||
    (!!cs.boxShadow && cs.boxShadow !== 'none');
  // outline は見ない。エディタが編集できる要素すべてに透明な outline(ホバー予告用)を付けているため
  return !paintsBox;
}

/**
 * 図形ツールの線・矢印・ペンは、位置と大きさを持つ透明な器の中に `position:absolute` の SVG が 1 つだけ入る。
 * 動かす・大きさを変える対象は器なので、SVG を押したら器を選ぶ(SVG を選ぶと器の中で SVG だけが動く)
 */
function drawnShapeOf(svg: Element, doc: Document): Element {
  const parent = svg.parentElement;
  if (!parent || parent.children.length !== 1) return svg;
  if (parent.hasAttribute('data-gg-fx-host')) return svg;
  if (doc.defaultView?.getComputedStyle(svg).position !== 'absolute') return svg;
  return isBareWrapper(parent, doc, new Set([svg])) ? parent : svg;
}

/** (x, y) の近くで、その SVG の形(子要素)が描かれているか */
function paintedNear(doc: Document, svg: Element, x: number, y: number): boolean {
  const t = STROKE_TOLERANCE;
  const offsets = [[0, 0], [t, 0], [-t, 0], [0, t], [0, -t], [t, t], [t, -t], [-t, t], [-t, -t]];
  for (const [dx, dy] of offsets) {
    for (const el of doc.elementsFromPoint(x + dx, y + dy)) {
      if (el !== svg && svg.contains(el)) return true;
    }
  }
  return false;
}

/**
 * クリック(ホバー・右クリック・ダブルクリック)の対象を、SVG の空きを素通りさせて決める。
 * SVG と関係の無い点では target をそのまま返す(elementsFromPoint も呼ばない)。
 *
 * @param target 生のイベント対象(e.target、または選択枠の下から拾った要素)
 * @param x, y   紙面(iframe)の中の座標(e.clientX / e.clientY)
 * @returns 選択の判別に使う要素。空白(body 等)になることもある
 */
export function passThroughSvg(
  doc: Document,
  target: EventTarget | null,
  x: number,
  y: number,
): Element | null {
  const el = target as Element | null;
  if (!el || el.nodeType !== 1 || typeof el.closest !== 'function') return el;
  if (!el.closest('svg')) return el;
  if (typeof doc.elementsFromPoint !== 'function') return el;

  const skipped = new Set<Element>();
  for (const candidate of doc.elementsFromPoint(x, y)) {
    if (isEditorLayer(candidate)) continue;
    const svg = outermostSvg(candidate);
    if (!svg) {
      // 素通りさせた SVG を包むだけの透明な器なら、それも素通りする
      if (skipped.size > 0 && isBareWrapper(candidate, doc, skipped)) {
        skipped.add(candidate);
        continue;
      }
      return candidate; // SVG の外の要素 = 下にあるもの
    }
    if (skipped.has(svg)) continue;
    if (candidate !== svg) return drawnShapeOf(svg, doc); // 形の上を押した = その SVG
    if (hasOwnBackground(svg, doc) || paintedNear(doc, svg, x, y)) return drawnShapeOf(svg, doc);
    skipped.add(svg); // 箱の空き = 素通りして下を見る
  }
  return null;
}
