# @growgroup/visual-editor

HTML をブラウザ上で直接編集するビジュアルエディタ（React コンポーネント）。

**スライド（固定サイズ）と Web ページ（可変高さ）の両方**を同じエンジンで編集できます。
編集結果をどこへ保存するかはアダプタで差し替えるので、バックエンドの形を選びません。

- 要素の選択・移動・リサイズ、テキスト/色/余白/タイポグラフィの編集
- レイヤーツリー、複数選択、グループ化、undo/redo
- Figma からの貼り付け（クリップボード経由）
- 画像の差し替え・アップロード
- コメント（返信・解決つき）。要素を選んで投稿すると、その要素に紐づいて吹き出しが出る
- CSS 変数（デザイントークン）の一覧と編集。保存先は io で差し替えられる（例: Tailwind v4 の `@theme`）
- 再利用できる部品の登録と差し込み。部品は HTML の `<template data-part-def>`（利用側のファイル）を正本にできる

## インストール

```bash
npm install @growgroup/visual-editor
```

React 18 / 19 が peer dependency です。

## 使い方

```tsx
import { setEditorIO, VisualEditor } from "@growgroup/visual-editor";
import "@growgroup/visual-editor/style.css";

// 起動時に1回。どこから読み、どこへ保存するかを渡す
setEditorIO({
  loadDeck: () => fetch("/api/deck").then((r) => r.json()),
  commentAction: (page, action) =>
    fetch("/api/comment", {
      method: "POST",
      body: JSON.stringify({ page, ...action }),
    }).then((r) => r.json()),
});

export function Editor({ html, onSave }) {
  return (
    <VisualEditor
      html={html}
      editorMode="webpage"   // 'slide' | 'webpage'
      artboardWidth={1440}   // webpage のとき。省略時は 1400
      contentId="1"
      onSave={async (edited, { auto } = {}) => onSave(edited, auto)}
      onClose={() => history.back()}
    />
  );
}
```

`onSave` は自動保存でも呼ばれます。`options.auto` で手動保存と見分けてください
（自動保存のたびにトーストを出すと邪魔になります）。

### Next.js（App Router）

ソースを配布しているので、トランスパイル対象に加えます。

```js
// next.config.mjs
export default { transpilePackages: ["@growgroup/visual-editor"] };
```

エディタはブラウザでのみ動作します（iframe の DOM を直接操作するため）。
サーバー描画をせずクライアントでだけ読み込んでください。

```tsx
const VisualEditor = dynamic(
  () => import("@growgroup/visual-editor").then((m) => m.VisualEditor),
  { ssr: false },
);
```

### Vite

追加設定は不要です。

### マルチフレームのキャンバス(Figma 風、0.3.0)

`enableMultiPageCanvas` を渡すと、`contentList` の全ページを 1 枚のキャンバスにフレームとして並べ、
クリックしたページを編集できます。生きているエディタは 1 つだけで、他のページは見るだけの紙面です。

```tsx
setEditorIO({
  // 隣のページの本文。id は contentList の id
  loadContent: async (id) => fetch(`/api/pages/${id}`).then((r) => r.text()),
  // 見るだけの紙面(編集していないページ)に足すスタイル。本文がブラウザ版 Tailwind(script)に
  // 頼っている場合だけ要る(紙面は script を動かさない)。本文に CSS が入っていれば不要
  previewStyles: () => [{ href: "/src/index.css" }],
});

<VisualEditor
  html={firstPageHtml}
  editorMode="webpage"
  contentId="1"
  contentList={[{ id: "1", title: "トップ", order: 1 }, { id: "2", title: "会社案内", order: 2 }]}
  enableMultiPageCanvas
  canvasStorageKey="site-a"                 // 見えている範囲を記憶するキー
  onContentChange={(id) => setCurrent(id)}  // 編集中のページが変わった(URL 等を追う)
  onSave={async (html, { auto, contentId } = {}) => save(contentId, html)}
  onClose={() => history.back()}
/>
```

- ページを移るときは、未保存の変更を先に保存してから移る(入口がフレームのクリックでも `contentId` プロップの変更でも同じ)
- 複数選択はキャンバスの余白からドラッグ(マーキー)。ページの中に空白が無くても、余白から引けば帯がまたいだ要素が選ばれる
- 仕組みと確認したことは `docs/multi-frame-canvas-2026-09.md`

`onSave` には `contentId` が付くので、どのページの本文かはそれで見分けてください。
`contentId` プロップを変えると、エディタがそのページへ移ります。
操作(⌘+ホイールで拡大縮小、Space+ドラッグで移動、⇧1 全体、⇧2 編集中のページ、⇧R 定規)と仕組みは
[docs/multi-frame-canvas-2026-09.md](docs/multi-frame-canvas-2026-09.md)。

## 設計

### io — 保存先との唯一の境界

エディタは HTML を編集するだけで、保存先を知りません。

**すべて任意です。渡していない機能は、エディタが UI ごと出しません。**
「押すと 404 で失敗するボタン」が残らないようにするためです。

| io | 渡さないとどうなるか |
|---|---|
| `loadDeck` | 一覧は空として振る舞う |
| `commentAction` | コメント UI を出さない |
| `deckOps` | 並び替え・複製・削除を出さない |
| `apiFetch` | ページ設定・AI 機能は「未提供」として既定値へ落ちる |
| `uploadImage` | 画像は data URL のまま本文に埋め込む |
| `exportDeck` | 書き出し UI を出さない |
| `renderContent` | 一覧のサムネイルを描かない |
| `notifySave` | 保存結果を通知しない |
| `loadParts` / `savePart` / `deletePart` | 部品パネルはブラウザ内(localStorage)の JSON コンポーネントを使う（0.1 系と同じ） |
| `loadVariables` / `saveVariables` | CSS 変数はブラウザ内(localStorage)に持つ（0.1 系と同じ） |

```ts
import type { EditorIO } from "@growgroup/visual-editor";
```

### 部品 — HTML の `<template>` を正本にする（0.2）

`loadParts` を渡すと、部品パネルは利用側の **HTML ファイル**を読みます。1 部品 1 ファイルで、
中身はルート要素 1 つ。編集してよい範囲に `data-slot` を付けます。

```html
<!-- parts/ContactBand.html -->
<template data-part-def="ContactBand" data-part-v="1"
          data-part-name="お問合せ帯" data-part-category="block">
  <section class="…">
    <h2 data-slot="heading">お問い合わせ</h2>
    <div data-slot="body"><p>お気軽にご相談ください。</p></div>
    <a class="…">お問合せフォームへ</a>
  </section>
</template>
```

ページに挿すときは**実体化**します。定義の複製がページに残り、ルートに `data-part` `data-part-v` が付きます。
ページはそれ単体で描画できる完全な HTML で、読むときに部品を解決することはありません。

```html
<section data-part="ContactBand" data-part-v="1" class="…">
  <h2 data-slot="heading">採用に関するお問い合わせ</h2>
  …
</section>
```

- インスタンスの中で編集できるのは `data-slot` の中だけ（スロットの外は選択できない）。ルートは選択でき、動かす・消す・並べ替えられる
- 右クリック「部品として保存」… 選択要素を定義にして `savePart` へ。スロットは推定して付ける（h1–h6→`heading`、p→`body`、a→`link`、img→`image` …）
- 右クリック「この姿で部品を更新」… インスタンスの今の姿で定義を版 +1 にして `savePart` へ。**エディタは他ページのインスタンスを書き換えない**。他ページへの反映は利用側の `savePart` の実装が行う（構成ラフのスターターは、定義を書いた直後に全ページの `data-part-v` を見て描き直す。スロットの中身は保つ、それ以外は差し替える、が規則）。`savePart` の戻り値の部品をそのまま返せば十分
- 右クリック「部品から切り離す」… `data-part` を外して普通の HTML にする

```ts
import { setEditorIO, parsePartTemplate, serializePartTemplate } from "@growgroup/visual-editor";

setEditorIO({
  loadParts: async () => {
    const files = await fetch("/api/parts").then((r) => r.json()); // [{ name, source }]
    return {
      categories: [{ id: "block", name: "ブロック" }],
      parts: files.map((f) => parsePartTemplate(f.source)).filter(Boolean),
    };
  },
  savePart: async (part) => {
    await fetch(`/api/parts/${part.id}`, { method: "PUT", body: serializePartTemplate(part) });
  },
  loadVariables: async () => fetch("/api/variables").then((r) => r.json()),
  saveVariables: async (variables) => {
    await fetch("/api/variables", { method: "PUT", body: JSON.stringify(variables) });
  },
});
```

`loadParts` を渡さない利用側では何も変わりません。`data-part` を持たない HTML にはスロットのロックも効きません。

### editorMode で挙動が変わる

| | `slide` | `webpage` |
|---|---|---|
| キャンバス | 固定サイズ | 可変高さ |
| レイアウト | 開いた時に絶対配置へ倒す | **倒さない**（流し込みのまま） |
| 発表者ノート | あり | なし |

`webpage` で絶対配置に倒さないのは意図的です。倒すと版面が固定ピクセルに固まり、
別の幅で崩れ、デザインツールへ取り込んだときに意味を失うためです。

### CSS はビルド済みで配っています

エディタ UI は Tailwind CSS のクラスで書かれていますが、**利用側の Tailwind の
バージョン（v3 / v4）に依存しません**。パッケージ側で CSS まで作り切って
`dist/editor.css` として同梱しているためです。利用側の Tailwind 設定に
手を入れる必要はありません。

リセット（preflight）は含めていません。利用側のリセットと二重に当たると、
利用側のページの見た目が変わるためです。

## ライセンス

MIT © GrowGroup Inc.

同梱・依存しているソフトウェアの帰属表示は [NOTICE](./NOTICE) を参照してください。
`src/components/ui/` は [shadcn/ui](https://ui.shadcn.com/)（MIT）を出発点にしています。

Figma は Figma, Inc. の商標です。本パッケージは Figma, Inc. とは関係ありません。

## 開発

```bash
npm install
npm run build      # dist/editor.css を作る
npm run typecheck
```

`src/` のクラスを増やしたら `npm run build` で CSS を作り直してください
（作り直さないと新しいクラスにスタイルが当たりません）。
