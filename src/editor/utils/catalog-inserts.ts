/**
 * 「台帳から挿入」の DOM まわり。React に依存しない純粋なユーティリティ。
 *
 * 利用側(io.fetchInsert)は Tailwind のクラスが付いたままの静的 HTML を断片で返す。
 * 色はトークン名なので、紙面の CSS が解決できるものだけが色になる(解決できなければ地の色)。
 * エディタは中身を組み替えず、
 *   1. `<script>` を落とす
 *   2. 要素にする
 *   3. どこに入れるかを決める
 * の 3 つだけをやる。
 */
import { fallbackContainer, isContainer } from './drop-target';

/**
 * 紙面に `<script>` を持ち込まない。
 *
 * 【なぜ paste-sanitizer(DOMPurify)を通さないか】
 * あちらは貼り付け用で、許可する属性を列挙する作り。`data-ds` / `data-ds-v` / `data-slot` の
 * ような台帳側の目印が黙って消える。挿入元は利用側が自分で作った HTML(外部から来た文字列ではない)
 * なので、ここでは「紙面で script を動かさない」という既存の方針だけを守る。
 * 同じ理由で `on*` のイベント属性も落とす(紙面は sandbox で script を動かさないが、
 * 保存 HTML に残ると公開物に混ざるため)。
 */
export function stripScripts(root: Element): void {
  for (const el of Array.from(root.querySelectorAll('script'))) el.remove();
  const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
  }
}

/**
 * HTML の断片を `doc` の要素にする。
 * ルートが 2 つ以上あるときは `<div>` で束ねずに先頭だけを返す ── 利用側が
 * `<section class="wf-ds">` で包む約束なので、束ねる器をエディタが勝手に足すと
 * 保存 HTML に出どころ不明の `<div>` が増える。空なら null。
 */
export function insertHtmlToElement(doc: Document, html: string): HTMLElement | null {
  const tpl = doc.createElement('template');
  tpl.innerHTML = html.trim();
  const root = tpl.content.firstElementChild;
  if (!root) return null;
  const el = doc.importNode(root, true) as HTMLElement;
  stripScripts(el);
  return el;
}

/** 挿入先。`before` が null なら `parent` の末尾 */
export type InsertionPoint = { parent: Element; before: Element | null };

/**
 * 挿入位置の規則。
 *
 * - 選択中の要素があれば**その直後**。ただし選択が器(`<main>` など)の直下でなければ、
 *   器の直下まで上がった祖先の直後に入れる(セクションの列に並ぶ)
 * - 選択が無ければ器の末尾
 * - 器 = `<main>` / `[data-wf-body]` / `#artboard` / body(drop-target.ts と同じ判定)
 *
 * ドラッグ&ドロップの `findFlowInsertion` と器の規則を共有しているので、
 * 「ドロップしたときと挿入したときで入る場所が違う」が起きない。
 */
export function resolveInsertionPoint(doc: Document, selected: Element | null): InsertionPoint {
  const container = fallbackContainer(doc);
  if (!selected || !selected.isConnected) return { parent: container, before: null };

  // 選択そのものが器なら、その中の末尾に入れる(器の「直後」に入れると紙面の外に出る)
  if (isContainer(doc, selected)) return { parent: selected, before: null };

  // 器の直下まで上がる
  let node: Element = selected;
  for (;;) {
    const parent: Element | null = node.parentElement;
    if (!parent) return { parent: container, before: null };
    if (isContainer(doc, parent)) return { parent, before: node.nextElementSibling };
    node = parent;
  }
}
