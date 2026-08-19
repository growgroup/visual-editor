/**
 * インライン書式(マーカー・太字)のツールバー。
 *
 * 【設計方針】
 * `<span class="px-[6px] bg-mark-green">改善サイクル</span>` のようなインライン要素は
 * 「箱」ではなく**文字の属性**として扱う(Figmaのキャラクタースタイル相当)。
 * - ドラッグ・リサイズの対象にしない(data-inline としてドラッグ対象外なのは現状どおり)
 * - 新規作成・解除は、テキスト編集中(contenteditable)の**範囲選択**に対して行う
 * - 語彙はデザインシステムの Mark に拘束する(緑=強調 / 赤=課題 / 太字)。
 *   任意の色は出さない。マーカーの意味(赤は課題のみ・1スライド1箇所)を
 *   エディタから崩せないようにするため
 *
 * テキストをダブルクリックして編集に入り、文字を選択するとツールバーが浮かぶ。
 */

const TOOLBAR_ID = 'gg-inline-format-toolbar';

/** デザインシステムのインライン語彙。ここ以外の書式は出さない */
const FORMATS = [
  { key: 'mark-green', label: 'マーカー', cls: 'px-[6px] bg-mark-green', swatch: '#cfe6d6' },
  { key: 'mark-red', label: 'マーカー(課題)', cls: 'px-[6px] bg-mark-red', swatch: '#ffd9d1' },
  { key: 'bold', label: '太字', cls: 'font-bold', swatch: null },
] as const;

/** この属性を持つspanを「書式スパン」とみなす(解除の対象) */
const FORMAT_CLASSES = ['bg-mark-green', 'bg-mark-red', 'font-bold'];

const isFormatSpan = (el: Element | null): el is HTMLElement =>
  !!el &&
  el.tagName === 'SPAN' &&
  FORMAT_CLASSES.some((c) => (el as HTMLElement).classList.contains(c));

/** 選択がテキスト編集中の要素の中にあるときだけ、その要素を返す */
function editingHost(doc: Document): HTMLElement | null {
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const host = doc.querySelector('[contenteditable="true"]') as HTMLElement | null;
  if (!host) return null;
  const range = sel.getRangeAt(0);
  if (!host.contains(range.commonAncestorContainer)) return null;
  if (!range.toString().trim()) return null;
  return host;
}

/** spanを外して中身だけ残す */
function unwrap(el: HTMLElement): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
  parent.normalize();
}

/** 範囲内(および範囲を含む)書式スパンをすべて外す */
function clearFormats(doc: Document, range: Range): void {
  // 範囲を包んでいるスパン
  let node: Node | null = range.commonAncestorContainer;
  while (node && node.nodeType === 3) node = node.parentNode;
  let cur = node as Element | null;
  while (cur && cur.getAttribute?.('contenteditable') !== 'true') {
    if (isFormatSpan(cur)) {
      unwrap(cur as HTMLElement);
      return; // 包んでいたものを外したら終わり(選択は文字列として残る)
    }
    cur = cur.parentElement;
  }
  // 範囲の中にあるスパン
  const host = doc.querySelector('[contenteditable="true"]');
  if (!host) return;
  [...host.querySelectorAll('span')].filter(isFormatSpan).forEach((s) => {
    if (range.intersectsNode(s)) unwrap(s);
  });
}

/** 選択範囲に書式スパンを適用する */
function applyFormat(doc: Document, cls: string): void {
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;

  // 入れ子や部分交差を作らないよう、先に範囲に関わる書式を外す
  clearFormats(doc, range);

  const span = doc.createElement('span');
  span.className = cls;
  // 既存のインライン要素と同じ扱いにする(ドラッグ対象外・保存対象)
  span.setAttribute('data-editable', 'true');
  span.setAttribute('data-inline', 'true');
  span.setAttribute(
    'data-element-id',
    `el-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  );
  try {
    range.surroundContents(span);
  } catch {
    // 選択が要素境界をまたぐ場合は extract で包む
    span.appendChild(range.extractContents());
    range.insertNode(span);
  }
  // 適用後はスパンの中身を選択したままにする(続けて解除・変更ができる)
  sel.removeAllRanges();
  const r = doc.createRange();
  r.selectNodeContents(span);
  sel.addRange(r);
}

function notifyChange(doc: Document): void {
  const artboard = doc.getElementById('artboard');
  window.postMessage(
    { type: 'SLIDE_CONTENT_CHANGED', html: artboard ? artboard.innerHTML : '' },
    '*',
  );
}

function buildToolbar(doc: Document): HTMLElement {
  const bar = doc.createElement('div');
  bar.id = TOOLBAR_ID;
  bar.style.cssText = [
    'position: fixed',
    'z-index: 10000',
    'display: none',
    'align-items: center',
    'gap: 2px',
    'padding: 4px',
    'border-radius: 8px',
    'background: rgba(24,24,27,0.95)',
    'box-shadow: 0 8px 24px rgba(0,0,0,0.45)',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", sans-serif',
  ].join(';');

  const mkBtn = (label: string, swatch: string | null, onClick: () => void) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.style.cssText = [
      'display: inline-flex',
      'align-items: center',
      'gap: 6px',
      'padding: 5px 10px',
      'border: 0',
      'border-radius: 6px',
      'background: transparent',
      'color: #e4e4e7',
      'font-size: 12px',
      'font-weight: 600',
      'cursor: pointer',
      'white-space: nowrap',
    ].join(';');
    if (swatch) {
      const dot = doc.createElement('span');
      dot.style.cssText = `width:10px;height:10px;border-radius:3px;background:${swatch};display:inline-block`;
      b.appendChild(dot);
    }
    b.appendChild(doc.createTextNode(label));
    b.addEventListener('mouseenter', () => (b.style.background = 'rgba(255,255,255,0.12)'));
    b.addEventListener('mouseleave', () => (b.style.background = 'transparent'));
    // mousedown でフォーカスと選択が失われないようにするのが肝
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  };

  for (const f of FORMATS) {
    bar.appendChild(
      mkBtn(f.label, f.swatch, () => {
        applyFormat(doc, f.cls);
        notifyChange(doc);
        position(doc, bar);
      }),
    );
  }
  const sep = doc.createElement('span');
  sep.style.cssText = 'width:1px;height:16px;background:rgba(255,255,255,0.2);margin:0 2px';
  bar.appendChild(sep);
  bar.appendChild(
    mkBtn('解除', null, () => {
      const sel = doc.getSelection();
      if (sel && sel.rangeCount > 0) {
        clearFormats(doc, sel.getRangeAt(0));
        notifyChange(doc);
      }
      position(doc, bar);
    }),
  );
  doc.body.appendChild(bar);
  return bar;
}

/** 選択範囲の上にツールバーを置く(画面上端に近いときは下) */
function position(doc: Document, bar: HTMLElement): void {
  const host = editingHost(doc);
  if (!host) {
    bar.style.display = 'none';
    return;
  }
  const rect = doc.getSelection()!.getRangeAt(0).getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  // 一度表示してから実寸で位置決め
  const bw = bar.offsetWidth;
  const bh = bar.offsetHeight;
  const win = doc.defaultView!;
  let x = rect.left + rect.width / 2 - bw / 2;
  x = Math.max(8, Math.min(win.innerWidth - bw - 8, x));
  let y = rect.top - bh - 8;
  if (y < 8) y = rect.bottom + 8;
  bar.style.left = `${x}px`;
  bar.style.top = `${y}px`;
}

/**
 * インライン書式ツールバーを iframe に取り付ける。
 * @returns 後片付け関数
 */
export function setupInlineFormatToolbar(iframeDoc: Document): () => void {
  const bar = buildToolbar(iframeDoc);
  const onSelectionChange = () => position(iframeDoc, bar);
  // 選択の変化・スクロールで追従。selectionchange は document にしか飛ばない
  iframeDoc.addEventListener('selectionchange', onSelectionChange);
  iframeDoc.addEventListener('scroll', onSelectionChange, true);
  return () => {
    iframeDoc.removeEventListener('selectionchange', onSelectionChange);
    iframeDoc.removeEventListener('scroll', onSelectionChange, true);
    bar.remove();
  };
}
