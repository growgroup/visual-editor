# @growgroup/visual-editor

HTML をブラウザ上で直接編集するビジュアルエディタ（React コンポーネント）。

**スライド（固定サイズ）と Web ページ（可変高さ）の両方**を同じエンジンで編集できます。
編集結果をどこへ保存するかはアダプタで差し替えるので、バックエンドの形を選びません。

- 要素の選択・移動・リサイズ、テキスト/色/余白/タイポグラフィの編集
- レイヤーツリー、複数選択、グループ化、undo/redo
- Figma からの貼り付け（クリップボード経由）
- 画像の差し替え・アップロード
- コメント（返信・解決つき）。要素を選んで投稿するとその要素に、コメントツール(C)で紙面をドラッグするとその範囲に紐づいて番号付きのピンが出る
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
- `contentList[].parentId` を渡すと、フレームがサイトマップの階層(親の下に子)のツリーで並び、親子が線でつながる(0.3.1)
- 紙面のリンクを ⌥ Option + クリック(Windows は Alt + クリック)すると、リンク先へ移る。同じサイトのページは `contentList[].href` と照らし合わせてそのページを編集中にし(表記の揺れ `/company/`・`index.html`・相対パス・`?`・`#` も同じページ)、`#id` はその場所へ紙面を寄せ、別のサイトは新しいタブで開く。仕組みと、⌘ / Ctrl クリック(最下層の選択・レイヤーパネルの複数選択)から変えた理由は `docs/link-nav-2026-09.md`
- `contentList[].href` を渡すと、フレーム名と一覧に「別タブで開く」が付く。`contentList[].revision` を進めると、そのページの紙面が読み直される(外からファイルが変わったとき)
- `contentList[].thumbnail` にページ全体を写した画像(PNG / JPEG、幅 480px 以上、縦横比はページと同じ)の URL を渡すと、大きく縮めた表示で紙面が iframe ではなくその画像になり、縮小が軽くなる。実測で縮小の p95 が 26.5ms → 18.4ms、50ms を超えるフレームが 0 回。画像を出す倍率の上限は画像の解像度と `devicePixelRatio` から決まり(`min(0.5, 画像の幅 × 1.25 ÷ (紙面の幅 × DPR))`)、**Retina では 960px の画像だと 31% まで**。にじんで見えないように、それより拡大すると iframe に戻る。解像度の高い画像を渡せば上限は 0.5 まで上がる。縮小している最中も、上限 × 0.8 を割った時点で(画像が読めていれば)切り替わる。内容が変わったら URL も変える(`&v=…`)。渡さないページ・画像が読めなかったページは今までどおり iframe(0.4.0)
- `documentAttributes={{ "data-notes": "0" }}` のように渡すと、編集中の文書と紙面の `<html>` に読み直さずに属性が付く(利用側の CSS で表示を切り替える)
- 部品(`data-part`)を選ぶと枠が紫になり、名前と版の札が出る。「この姿で更新」で他ページの紙面もその場で描き直される
- 仕組みと確認したことは `docs/multi-frame-canvas-2026-09.md`

`onSave` には `contentId` が付くので、どのページの本文かはそれで見分けてください。
`contentId` プロップを変えると、エディタがそのページへ移ります。
操作(⌘+ホイール・ピンチで拡大縮小、Space+ドラッグで移動、⇧1 全体、⇧2 編集中のページ、⇧R 定規)と仕組みは
[docs/multi-frame-canvas-2026-09.md](docs/multi-frame-canvas-2026-09.md)。

### キャンバスの拡大縮小を Figma にそろえる・紙面の外の領域(0.10.0)

- **Safari・WKWebView のトラックパッドのピンチでも拡大縮小します**。WebKit はピンチを `gesturestart` / `gesturechange` で送る
  (Chrome・Edge・Electron は ctrl 付きの wheel)。以前は止めるだけで何も起きませんでした。紙面(iframe)の上のピンチも効きます。
  どの経路(ホイール・ピンチ・タッチ)もカーソル位置を中心にします
- IME の変換中のキー(⌘+ や Space 等)は奪いません
- `canvasZoomOptions` で拡大縮小の設定を変えられます。**省略時は従来の挙動のまま**です
  - `min` / `max`: 倍率の範囲(省略時 2%〜400%)
  - `steps`: ⌘+ / ⌘− とヘッダーの +/− の刻み。`'ratio'`(1.25 倍ずつ。省略時)か `'powers-of-two'`(…50% → 100% → 200%…。Figma)
  - `fitShortcut`: ⌘2 / ⇧2 の合わせ先。`'page'`(編集中のページ。省略時)か `'selection'`(選んでいる要素。無ければページ。Figma。倍率メニューに「選択範囲に合わせる」も出る)
- 紙面(`#artboard`)の外、上下に利用側が表示だけの領域(サイトの共通のヘッダー・フッター等)を並べるときは、
  その要素に `FRAME_REGION_ATTRIBUTE`(`data-editor-frame-region`)を付けるとフレームの高さに入ります(付けないと紙面の高さで切れます)。
  保存・共同編集が送るのは `#artboard` の中身だけなので、本文には混ざりません
- 仕組みと確かめたことは [docs/figma-zoom-2026-09.md](docs/figma-zoom-2026-09.md) と [docs/frame-regions-2026-09.md](docs/frame-regions-2026-09.md)

```tsx
<VisualEditor
  enableMultiPageCanvas
  // Figma にそろえる(省略時は 2%〜400%・1.25 倍ずつ・⌘2 は編集中のページ)
  canvasZoomOptions={{ min: 0.02, max: 256, steps: "powers-of-two", fitShortcut: "selection" }}
  /* … */
/>
```

### コメントに操作を足す(0.10.0)

- `io.commentActions` で、コメントパネルの**各スレッド**と**パネル上部(いま開いているページ)**に利用側のボタンを足せます。
  何をするか(返信を足す・外部に依頼する・別画面を開く など)は利用側が決め、エディタは
  ボタンを出す・押している間の表示(二重押しの防止)・失敗の表示・戻り値の deck の反映だけを受け持ちます
- **渡さなければ見た目も挙動も 0.9 系と同じ**です。コメントパネルは `commentAction` がある場合だけ出るので、
  `commentActions` だけ渡しても出ません
- スレッドの操作は既定で**未解決のスレッドにだけ**、パネルの操作は既定で**そのページに未解決が 1 件以上あるときだけ**出ます(`when` で変えられます)
- `run` が `{ deck }` を返せば一覧に反映し、`{ message }` を返せば押した場所の下に出します。投げたエラーも同じ場所に出します
- 走っている間も他のコメント操作(投稿・返信・解決)は止めません
- `apiFetch` を渡している利用側に出る「AIで修正」「すべてAIで修正」(`/__comment-fix`)は今までどおりで、これとは別物です
- 出すのは編集画面の右のコメントパネルだけです(`CommentBoard` / `CommentBoardPanel` には出しません)

```ts
setEditorIO({
  loadDeck,
  commentAction,
  commentActions: {
    thread: [{
      id: "ask-fix",
      label: "直してもらう",
      run: async ({ page, comment }) => {
        await requestFix(page, comment.id);          // 利用側の処理
        return { message: "依頼しました" };           // 押した場所の下に出る
      },
    }],
    panel: [{
      id: "ask-fix-all",
      label: "未解決をまとめて直してもらう",
      run: async ({ page, comments }) => {
        await requestFix(page, comments.filter((c) => !c.resolved).map((c) => c.id));
        return { message: "依頼しました" };
      },
    }],
  },
});
```

- 仕組みと確かめたことは [docs/comment-actions-2026-09.md](docs/comment-actions-2026-09.md)

### 台帳から挿入(0.9.0)

- デザインシステムの台帳にある **セクション / パーツ / ページの雛形** を紙面に挿せます。
  ツールバーの「＋ 追加」→「台帳から挿入」(PowerPoint 風の殻では「挿入」タブ)。
  `loadInserts` を渡していない利用側では**項目ごと出しません**
- 挿す位置は **選択中の要素の直後**(選択が無ければ器の末尾)。器の判定はドラッグ&ドロップと同じです。
  挿した要素は選択状態になり、紙面がそこへ寄ります。**取り消し(⌘Z)1 回で消えます**
- 「見出し・リード文を赤字ダミーにする」(既定 ON)はそのまま `fetchInsert` の `opts.dummy` に渡ります。
  赤字にするかどうかの整形は利用側の仕事です
- ページの雛形(`level` が `TPL` / `PAG`)は紙面に挿さず、タイトルとパスを決めて `createContent` を呼びます。
  作ったページが `contentList` に出てきたら、そのページを編集中にします
- スライドでは ページの雛形 と 赤字ダミーのチェック を出しません
- 利用側は `<section class="wf-ds" data-ds="…" data-ds-v="…">` で包んだ HTML を返します。
  エディタは包み直さず、`<script>` と `on*` だけ落とします
- 仕組みと確かめたこと、穴は [docs/catalog-inserts-2026-09.md](docs/catalog-inserts-2026-09.md)

### スライドを開くと版面がずれる(0.8.1)

- 部品の中の罫線など**編集対象でない要素が上へ詰まる**件と、**全要素の幅・高さが 1px 膨らむ**(1px の罫線が 2px になる)件を直しました。
  どちらもスライドを開くときの絶対配置への変換の採寸の問題で、iframe とは関係ありません。
  原因と確かめたことは [docs/canvas-label-2026-09.md](docs/canvas-label-2026-09.md)

### 線の欄・リンク移動のキー・キャンバスのラベル崩れ(0.8.0)

- **リンク先へ移るのは Alt(Mac は ⌥ Option)+ クリック**になりました(0.7.0 は ⌘ / Ctrl + クリック)。
  ⌘ / Ctrl + クリックは「最下層の要素を選ぶ」に戻り、レイヤーパネルの複数選択とぶつからなくなりました。
  Alt を押してリンクの上にいると行き先の案内が出ます。⌘ / Ctrl / Shift と一緒に押したときは移りません。
  仕組みと変えた理由は [docs/link-nav-2026-09.md](docs/link-nav-2026-09.md)
- **線(border)の欄**が片側だけの線を扱えるようになりました
  - 左だけ 2px の線(`border-l-2`)を選ぶと、線幅の欄に 2 と出ます(今までは 0)。線幅を変えても**その辺だけ**が変わります(四辺の枠になりません)
  - 線色・線幅を変えても、他の種類のクラス(`border-l-2`・`border-wf-ink`・`border-dashed`・`border-collapse`)は消えません
  - スタイルの「なし」が紙面に効きます。線幅・スタイルはクラスと一緒にインラインにも書きます
    (紙面の CSS はファイルに書かれたクラスの分しか作られないため)
  - スライドのリボンの「図形の枠線」も同じです。線の無い図形に色を選んだときに 2px を立てる動きは今までどおりです
  - 原因と確かめたことは [docs/border-fixes-2026-09.md](docs/border-fixes-2026-09.md)
- **キャンバス表示でスライドのラベルが見出しに重なる**件を直しました。スライドを開くときの絶対配置への変換で、
  変換しないインライン要素(ラベルなど)が動いたときも巻き戻します。原因と確かめたことは
  [docs/canvas-label-2026-09.md](docs/canvas-label-2026-09.md)

### テキスト編集の Enter・文字の一部の書式・サイズ欄の最小・最大(0.7.0)

- テキスト編集中の **Enter は、同じ要素の中の改行(`<br>`)**です(Shift+Enter と同じ)。段落を分けて別の要素にはしません。
  日本語入力の変換を確定する Enter では改行しません
- `<br>` / `<wbr>` はレイヤー一覧に出ず、選択もされません(クリックすると親の文字要素が選ばれます)
- サイズ欄の「+ 最小・最大」で **幅と高さの最小・最大**(min / max-width・height)を編集できます。W の列に幅、H の列に高さの「最小」「最大」が並びます。
  値が入っている要素では最初から出ます。空にすると指定を消します。選択枠のハンドルでのリサイズもその範囲で止まります
- サイズ欄の W / H は、パネルを最小幅(280px)にしても数値が欠けません
- テキスト編集中に**文字の一部を選んで**右パネルで大きさ・太さ・字間・色などを変えると、**選んだ所だけ**に効きます
  (選んだ所を行内の `<span>` で包むか、ちょうど 1 つの行内要素を選んでいればその要素に当てます)。
  行間・揃え・余白は要素全体です。選んだ文字の中で値が揃っていなければ「混在」と出ます。範囲を選ばなければ今までどおり要素全体です
- 紙面の文字を選んだまま、キャンバスの何も無い所・別のページのフレーム・紙面の外の余白をクリックするか Esc を押すと、文字の選択は消えます
  (テキスト編集中なら編集も終わります)。右パネル・書式ツールバー・リボンの操作では消えません
- 原因と直し方、確かめたことは [docs/editor-fixes-2026-09.md](docs/editor-fixes-2026-09.md)

## 設計

### io — 保存先との唯一の境界

エディタは HTML を編集するだけで、保存先を知りません。

**すべて任意です。渡していない機能は、エディタが UI ごと出しません。**
「押すと 404 で失敗するボタン」が残らないようにするためです。

| io | 渡さないとどうなるか |
|---|---|
| `loadDeck` | 一覧は空として振る舞う |
| `commentAction` | コメント UI を出さない |
| `commentActions` | コメントパネルに利用側の操作を足さない（0.9 系と同じ見た目） |
| `deckOps` | 並び替え・複製・削除を出さない |
| `apiFetch` | ページ設定・AI 機能は「未提供」として既定値へ落ちる |
| `uploadImage` | 画像は data URL のまま本文に埋め込む |
| `exportDeck` | 書き出し UI を出さない |
| `renderContent` | 一覧のサムネイルを描かない |
| `notifySave` | 保存結果を通知しない |
| `loadParts` / `savePart` / `deletePart` | 部品パネルはブラウザ内(localStorage)の JSON コンポーネントを使う（0.1 系と同じ） |
| `loadInserts` / `fetchInsert` / `createContent` | 「台帳から挿入」を出さない（`loadInserts` が無ければ入口ごと出ない） |
| `loadVariables` / `saveVariables` | CSS 変数はブラウザ内(localStorage)に持つ（0.1 系と同じ） |

```ts
import type { EditorIO } from "@growgroup/visual-editor";
```

コメントの `add` には `anchorSrc` / `anchorLabel`（要素）のほかに `anchorRect`（紙面の px の矩形。0.4.0）が付くことがあります。
ホストはそのまま保存し、ページ内の通し番号 `seq` を採番して返すと、ピンに番号が出ます（採番しなくても動きます）。
詳しくは [docs/region-comments-2026-09.md](docs/region-comments-2026-09.md)。

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

### 自由配置 — 器ごとに流し込みと絶対配置を切り替える(webpage、0.5.0)

構成ラフでも「この帯の中だけは Figma のように自由に置きたい」ことがあります。
`webpage` の既定は流し込みのままで、**指示した範囲の中だけ**を絶対配置にできます。

| したいこと | 操作 |
|---|---|
| 選んだ要素から下を、入れ子まですべて自由に置く | 右クリック → **このツリーをすべて絶対配置にする** |
| そのツリーを流し込みへ戻す | 右クリック → **このツリーの絶対配置を解除する** |
| この帯の中だけ(直下の子だけ)自由に置く | 器を右クリック → **直下の子だけ絶対配置にする** |
| 流し込みへ戻す | 同じ器を右クリック → **流し込みに戻す** |
| この要素だけ流れから外す | 右パネル「位置」→ **配置: 自動 / 絶対** |
| ページ全体 | 右クリック → **このページを自由配置にする… / ページを流し込みに戻す…**(確認あり) |

- 器は今の高さで固定され(子が抜けてもページの高さが変わらない)、中の子は
  ドラッグ・矢印キー・右パネルの X / Y で自由に動きます。**器の外へは出ません**
- 変換の前後で見た目は 1px も変わりません(画素差 0%)。ずれる採寸になった場合は変換ごと巻き戻します
- 目印はインラインの style と class(`gg-freelayout` / `gg-freelayout-rel` / `gg-freelayout-hold`)として
  保存 HTML に残ります。`data-gg-*` が保存時に落ちるための選択です
- `slide` の挙動は変わりません(開いた時に全部倒す従来どおり)。自由配置の UI は `webpage` にだけ出ます

- ツリーの変換では、段落・見出し・画像・ボタン・ブロックの箱を倒し、文字の流れ(span・a・strong・br)・表の中・svg の中・
  縦のリストは流れのまま残します。部品(`data-part`)のスロットの外は変換しません
- 解除は並べ替えずに元の流し込み(元の HTML の順)へ戻します。上書きした元のインラインの幾何は `--gg-flow-*` に控えるので、
  保存して読み直したあとでも元の値に戻ります

設計と判断の経緯、確かめていないことは [docs/free-layout-2026-09.md](./docs/free-layout-2026-09.md) と
[docs/free-layout-tree-2026-09.md](./docs/free-layout-tree-2026-09.md) にあります。

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
