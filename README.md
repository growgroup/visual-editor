# @growgroup/visual-editor

HTML をブラウザ上で直接編集するビジュアルエディタ（React コンポーネント）。

**スライド（固定サイズ）と Web ページ（可変高さ）の両方**を同じエンジンで編集できます。
編集結果をどこへ保存するかはアダプタで差し替えるので、バックエンドの形を選びません。

- 要素の選択・移動・リサイズ、テキスト/色/余白/タイポグラフィの編集
- レイヤーツリー、複数選択、グループ化、undo/redo
- Figma からの貼り付け（クリップボード経由）
- 画像の差し替え・アップロード
- ページ単位のコメント（返信・解決つき）
- CSS 変数（デザイントークン）の一覧と編集
- 再利用できるコンポーネントの登録と差し込み

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

```ts
import type { EditorIO } from "@growgroup/visual-editor";
```

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
