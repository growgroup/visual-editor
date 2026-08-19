/**
 * 表(<table>)の行・列の挿入と削除。
 *
 * 右クリックしたセルを起点に、そのセルの見た目(style / class)を写して増やす。
 * PowerPointの「行を上に挿入」等と同じ操作面を、素のHTMLの表に対して行う。
 *
 * 【対応範囲】rowspan / colspan は考慮しない(挿入した表は常に矩形)。
 * 崩れた表に対しては、行ごとにセル数が違っても落ちないよう index を丸めて扱う。
 *
 * 【なぜ data-shape-type を見ないか】
 * 保存時に data-shape-type は取り除かれる(html-utils.ts の getCleanHtml)。
 * 一度保存して開き直した表でも同じように編集できるよう、判定は <table> の有無で行う。
 */

/**
 * 右クリック位置などから表のセルを取り出す(表の外なら null)。
 *
 * ここで instanceof を使わないのは、対象が iframe の中の要素だから。
 * iframe は別realmなので、親ページの HTMLTableCellElement とは別のコンストラクタになり、
 * `el instanceof Element` すら常に false になる。タグ名で見るのが唯一確実。
 */
export function findTableCell(el: EventTarget | Element | null): HTMLTableCellElement | null {
  const node = el as Element | null;
  if (!node || typeof node.closest !== 'function') return null;
  const cell = node.closest('td,th') as HTMLTableCellElement | null;
  return cell && cell.closest('table') ? cell : null;
}

/** セルが属する表 */
function tableOf(cell: HTMLTableCellElement): HTMLTableElement | null {
  return cell.closest('table');
}

/** その行が置かれているセクション(thead / tbody / tfoot) */
function sectionOf(row: HTMLTableRowElement): HTMLTableSectionElement | null {
  const p = row.parentElement;
  return p && ['THEAD', 'TBODY', 'TFOOT'].includes(p.tagName)
    ? (p as HTMLTableSectionElement)
    : null;
}

/** セクションに応じたセルのタグ。見出し行は th、本文行は td */
function cellTagFor(section: HTMLTableSectionElement | null): 'th' | 'td' {
  return section?.tagName === 'THEAD' ? 'th' : 'td';
}

/** 見た目(style / class)だけ写した空セルを作る */
function makeCell(ref: HTMLTableCellElement, tag: 'th' | 'td'): HTMLTableCellElement {
  const cell = ref.ownerDocument.createElement(tag) as HTMLTableCellElement;
  const style = ref.getAttribute('style');
  if (style) cell.setAttribute('style', style);
  if (ref.className) cell.className = ref.className;
  cell.textContent = '';
  return cell;
}

/** 行 row の中で、列 index に相当するセル(短い行なら末尾で丸める) */
function cellAt(row: HTMLTableRowElement, index: number): HTMLTableCellElement | null {
  if (!row.cells.length) return null;
  return row.cells[Math.min(index, row.cells.length - 1)];
}

/** 列数(先頭行の基準。rowspan/colspanは見ない) */
function columnCount(table: HTMLTableElement): number {
  return table.rows.length ? table.rows[0].cells.length : 0;
}

/**
 * 行を挿入する。戻り値は挿入した行(できなければ null)。
 *
 * 見出し行の「下に挿入」だけは本文側の先頭へ入れる。見出しが2行になるのは
 * まず意図と違うため(PowerPointでも見出しの下は本文行になる)。
 */
export function insertRow(cell: HTMLTableCellElement, where: 'above' | 'below'): HTMLTableRowElement | null {
  const table = tableOf(cell);
  const row = cell.parentElement as HTMLTableRowElement | null;
  if (!table || row?.tagName !== 'TR') return null;

  const doc = table.ownerDocument;
  let section = sectionOf(row);
  let before: Node | null = where === 'above' ? row : row.nextSibling;

  if (where === 'below' && section?.tagName === 'THEAD' && !row.nextElementSibling) {
    // 見出しの最終行の下 = 本文の先頭
    let body = table.tBodies[0] as HTMLTableSectionElement | undefined;
    if (!body) {
      body = doc.createElement('tbody');
      table.appendChild(body);
    }
    section = body;
    before = body.firstChild;
  }
  if (!section) return null;

  // 見た目の雛形は挿入先セクションの既存行(無ければ元の行)
  const template = section.rows[0] ?? row;
  const tag = cellTagFor(section);
  const width = columnCount(table) || row.cells.length;

  const newRow = doc.createElement('tr');
  for (let i = 0; i < width; i++) {
    const ref = cellAt(template, i) ?? cellAt(row, i);
    if (ref) newRow.appendChild(makeCell(ref, tag));
  }
  if (!newRow.cells.length) return null;

  section.insertBefore(newRow, before);
  return newRow;
}

/** 列を挿入する。表の全行(見出し含む)に1セルずつ足す。戻り値は挿入できたか */
export function insertColumn(cell: HTMLTableCellElement, where: 'left' | 'right'): boolean {
  const table = tableOf(cell);
  if (!table || !table.rows.length) return false;

  const index = cell.cellIndex;
  for (const row of Array.from(table.rows)) {
    const ref = cellAt(row, index);
    if (!ref) continue;
    const tag = cellTagFor(sectionOf(row));
    row.insertBefore(makeCell(ref, tag), where === 'left' ? ref : ref.nextSibling);
  }
  return true;
}

/** 行を削除する。最後の1行は消さない(空の表を作らない)。戻り値は削除できたか */
export function deleteRow(cell: HTMLTableCellElement): boolean {
  const table = tableOf(cell);
  const row = cell.parentElement as HTMLTableRowElement | null;
  if (!table || row?.tagName !== 'TR') return false;
  if (table.rows.length <= 1) return false;

  const section = sectionOf(row);
  row.remove();
  // 空になった thead / tbody は畳む(保存後のHTMLに空タグを残さない)
  if (section && !section.rows.length) section.remove();
  return true;
}

/** 列を削除する。最後の1列は消さない。戻り値は削除できたか */
export function deleteColumn(cell: HTMLTableCellElement): boolean {
  const table = tableOf(cell);
  if (!table || columnCount(table) <= 1) return false;

  const index = cell.cellIndex;
  for (const row of Array.from(table.rows)) {
    if (row.cells.length <= 1) continue;
    cellAt(row, index)?.remove();
  }
  return true;
}
