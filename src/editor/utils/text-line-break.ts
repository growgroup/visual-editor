/**
 * テキスト編集中の Enter を「同じ要素の中の改行(<br>)」にする。
 *
 * [なぜ要るか]
 * contenteditable の既定の Enter は段落を分ける。Chrome は <p> の中に <div> を差し込み
 * (`<p>前半<div>後半</div></p>`)、HTML では p の中に div を置けないので、保存して読み直すと
 * 段落が閉じ、後半が段落のクラス(文字の大きさ・行間)を持たない div になっていた。
 * Shift+Enter は同じ要素の中に <br> が入るだけで正しいので、Enter もそれにそろえる。
 * p / 見出し / li / td / ボタン / span など、テキスト編集に入るすべての要素で同じ。
 *
 * [なぜ execCommand('insertLineBreak') か]
 * Shift+Enter と同じブラウザの処理なので、範囲選択の削除・行末での改行(次の行を作る 2 つ目の <br>)・
 * 文字単位の取り消し(編集中の ⌘Z 1 回)・input イベント(共同編集の送信)がそのまま付いてくる。
 * 自前で Range に <br> を差し込むと、ブラウザの取り消しの履歴に載らず ⌘Z で戻らない。
 * 使えないブラウザ(insertLineBreak を持たない)でだけ自前で差し込む。
 *
 * [日本語入力]
 * 変換を確定する Enter は改行ではない。ここを誤ると確定するたびに改行が入る。
 * Chrome は確定の keydown に isComposing=true / keyCode 229 を付け、Safari は compositionend の
 * 直後に keyCode 229 の keydown を送る。確定の直後(keyup まで)の Enter も見送る。
 * 見送った Enter がそれでも段落を分けようとしたとき(beforeinput の insertParagraph)は、そこで改行に直す。
 */

const EDITING_HOST = '[contenteditable="true"]';

function editingHostOf(target: EventTarget | null): HTMLElement | null {
  const el = target as Element | null;
  if (!el || typeof el.closest !== 'function') return null;
  return el.closest<HTMLElement>(EDITING_HOST);
}

/** 改行の後ろに、次の行を作る中身(文字・画像・改行)があるか */
function hasContentAfter(doc: Document, node: Node, host: HTMLElement): boolean {
  const range = doc.createRange();
  range.setStartAfter(node);
  range.setEnd(host, host.childNodes.length);
  const rest = range.cloneContents();
  if ((rest.textContent ?? '').length > 0) return true;
  return !!rest.querySelector('br, img, svg, video, iframe, input, canvas');
}

/** insertLineBreak を持たないブラウザ向け。選択を消して <br> を入れ、キャレットを次の行に置く */
function insertLineBreakManually(doc: Document, host: HTMLElement): void {
  const selection = doc.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!host.contains(range.commonAncestorContainer)) return;
  range.deleteContents();
  const br = doc.createElement('br');
  range.insertNode(br);
  // 行末の <br> 1 つだけでは次の行ができない(キャレットが前の行に残る)ので、もう 1 つ置く
  if (!hasContentAfter(doc, br, host)) br.after(doc.createElement('br'));
  const caret = doc.createRange();
  caret.setStartAfter(br);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  const InputEventCtor = doc.defaultView?.InputEvent ?? InputEvent;
  host.dispatchEvent(new InputEventCtor('input', { bubbles: true, inputType: 'insertLineBreak' }));
}

function insertLineBreak(doc: Document, host: HTMLElement): void {
  let done = false;
  try {
    done = doc.execCommand('insertLineBreak');
  } catch {
    done = false;
  }
  if (!done) insertLineBreakManually(doc, host);
}

/**
 * iframe の紙面に「Enter = 改行」を張る。編集に入る経路(ダブルクリック・テキストツール)によらず、
 * 編集中の要素(contenteditable="true")の中で押された Enter だけを扱う。
 * @returns 外す関数
 */
export function setupLineBreakOnEnter(doc: Document): () => void {
  // 変換の確定から keyup までの間(Safari は確定の後に Enter の keydown が来る)
  let composingEnter = false;

  const onCompositionEnd = () => {
    composingEnter = true;
  };
  const onKeyUp = () => {
    composingEnter = false;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // 日本語入力の変換中・確定の Enter には触らない(最初に見る)
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key !== 'Enter') return;
    if (composingEnter) return;
    // Shift+Enter はブラウザの既定がすでに改行。⌘ / Ctrl との組み合わせはショートカットに譲る
    if (e.shiftKey || e.metaKey || e.ctrlKey) return;
    if (e.defaultPrevented) return;
    const host = editingHostOf(e.target);
    if (!host) return;
    e.preventDefault();
    insertLineBreak(doc, host);
  };

  // 上で見送った Enter や、キーを経ない段落分け(Android の IME など)も改行にする
  const onBeforeInput = (e: InputEvent) => {
    if (e.inputType !== 'insertParagraph' || e.isComposing) return;
    const host = editingHostOf(e.target);
    if (!host) return;
    e.preventDefault();
    insertLineBreak(doc, host);
  };

  doc.addEventListener('compositionend', onCompositionEnd, true);
  doc.addEventListener('keyup', onKeyUp, true);
  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('beforeinput', onBeforeInput as EventListener, true);
  return () => {
    doc.removeEventListener('compositionend', onCompositionEnd, true);
    doc.removeEventListener('keyup', onKeyUp, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('beforeinput', onBeforeInput as EventListener, true);
  };
}
