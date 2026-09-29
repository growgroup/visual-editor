# コメントに利用側の操作を足す(0.10.0)

コメントパネルに、利用側が決めた操作のボタンを足せるようにした。
きっかけは gg-manager の制作スタジオで「このコメントを AI に直させる」ボタンを出したいという要望だが、
パッケージは他の利用側(ggm のスキルなど)でも使うので、AI や特定の画面に固有の口にはしていない。
**渡さなければ見た目も挙動も 0.9 系と 1 文字も変わらない**。

## 使い方

```ts
setEditorIO({
  loadDeck,
  commentAction,
  commentActions: {
    thread: [{ id: 'ask-fix', label: '直してもらう', run: async ({ page, comment }) => ({ message: '依頼しました' }) }],
    panel: [{ id: 'ask-fix-all', label: '未解決をまとめて直してもらう', run: async ({ page, comments }) => ({ message: '依頼しました' }) }],
  },
});
```

| 項目 | 型 | 既定 |
|---|---|---|
| `thread[].when` | `(comment, { page }) => boolean` | 未解決のスレッドにだけ出す |
| `panel[].when` | `({ page, comments }) => boolean` | いまのページに未解決が 1 件以上あるときだけ出す |
| `run` の戻り値 | `{ deck?, message? } \| void` | `deck` は一覧に反映、`message` は押した場所の下に出す |
| `icon` | `ReactNode` | 無し(ラベルだけ) |

- `panel[].run` の `comments` は**いまのページのコメント全部**(解決済みも含む)。どれを対象にするかは利用側が絞る
- ボタンには `data-comment-action="<id>"` / `data-comment-panel-action="<id>"` が付く(利用側のテスト・目視用)
- コメントパネル自体が `commentAction` がある場合だけ出るので、`commentActions` だけ渡しても何も出ない

## エディタが受け持つこと

- ボタンを出す(スレッドは既存の「AIで修正」の下、返信の上。パネルはヘッダーの下、「すべてAIで修正」の隣)
- 押してから `run` が終わるまで、そのボタンだけを押せなくしてスピナーを出す(同じスレッドの同じ操作の二重押しを防ぐ)
- `run` が投げたエラーは `role="alert"` で、`message` は `role="status"` で押した場所の下に出す。次に押すまで残る
- `deck` が返ったら `applyDeck` で一覧に反映する(返信を足した操作なら、その場で返信が見える)

共通の `run()`(投稿・返信・解決が使う)には載せていない。利用側の操作は外部に依頼して長くかかりうるので、
走らせている間も投稿・返信・解決・他のスレッドの操作は止めない(既存の「AIで修正」と同じ理由)。
進行状況はパネルの state に `操作id:コメントid`(パネルの操作は `操作id:@ページ番号`)で持つ。
`renderThread` をコンポーネントにしてはいけない件(返信欄が 1 打鍵ごとに作り直される)は守っている。

## 既存の「AIで修正」との関係

`apiFetch` を渡している利用側に出る「AIで修正」「すべてAIで修正」(`/__comment-fix` を叩き、終わったら再読み込みする。
TSX を原本にする構成ラフ用)は**そのまま**。`commentActions` とは独立で、両方渡せば両方出る。

## 確かめたこと

- `npm run typecheck` / `npm run check:version` が通る
- 描画の比較(`react-dom/server` で `PptCommentsPanel` を描き、EditorContext と PptChrome だけ差し替え):
  - `commentActions` を渡さないとき、0.9.1(main)と**出力の HTML が 1 バイトも違わない**(未解決・解決済みの混在ページ、解決済みだけのページの 2 通り)
  - 渡したとき、未解決のスレッドにだけ既定の操作が出る。`when: () => true` の操作も出る。解決済みだけのページにはパネルの操作が出ない
- 操作の流れ(jsdom + `react-dom/client`):
  - 押すとそのボタンが押せなくなり、走っている間にもう一度押しても `run` は 1 回しか呼ばれない。他のスレッドのボタンは押せる
  - 終わるとボタンが戻り、`message` が出て、返った `deck` の返信がスレッドに出る
  - `run` が投げると、その文言がそのスレッドの下に出る
  - パネルの操作には `page` と、そのページのコメント全部が渡る

## 穴・やっていないこと

- `CommentBoard` / `CommentBoardPanel`(デッキ全体のカンバン)には出さない。要る利用側が出てきたら、
  `CommentBoardPanel` が `io().commentActions` を読んで `BoardCard` に渡す形で足す
- `when` が投げた例外は捕まえない(描画ごと落ちる)。軽い判定だけを書くこと
- `message` / エラーは次に押すまで残る(時間で消さない)。ページを移ってもパネルの操作のものはページ番号ごとに持つ
