# 範囲コメント(0.4.0)

gg-manager のフィードバックシートの「指摘」と同じように、紙面の好きな場所を囲ってコメントを付けられるようにした。
要素を選んで付ける従来のコメントはそのまま。刻印の無い HTML(構成ラフの HTML 正本)でも要素に付くようにした。

## 使い方

- **コメントツール**: ツールバーの吹き出し(Figma 風)/ 校閲タブの「範囲を指定」(PowerPoint 風)/ コメントパネルの「範囲を指定」/ キー **C**
- 紙面をドラッグすると矩形、クリックだけなら点。決まるとコメントパネルが開いて本文にフォーカスが移り、選択ツールに戻る
- パネルの上に「指定した範囲 (x, y) w×h へのコメント」と出る。✕ か Esc で解除
- 投稿すると紙面に枠と番号付きのピンが出る。ピンか枠をクリックするとそのスレッドが開く。開いているスレッドの枠は太くなる
- Esc は 1 段ずつ戻る: コメントツール → 選択ツール → 下書きの解除 → (従来どおり)テキスト編集の終了・選択解除

## データ

`EditorComment` に 2 つ増えた(どちらも任意。古いホスト・古いデータはそのまま読める)。

```ts
type CommentRect = { x: number; y: number; width: number; height: number; ref?: { width: number; height: number } };
type EditorComment = { …; seq?: number; anchorRect?: CommentRect };
```

- `anchorRect` は **紙面(`#artboard`)の左上を原点にした px**。% にしなかったのは、Web ページは編集で高さが変わるため
  (下に節を足しただけで上の方の % の矩形が動く)。`ref` は投稿時の紙面の大きさで、幅が変わっていたら横方向だけ比で補正する。縦は補正しない
- `width` / `height` が 0 なら点
- `seq` はページ内の通し番号。**ホストが採番する**(`max(件数, 最大の seq) + 1`)。削除しても振り直さないので、返信の「#3 の件」がずれない。
  採番しないホストではピンに投稿者の頭文字が出る(従来どおり)
- `CommentAction` の `add` に `anchorRect` を足した。範囲があるときは要素アンカーを付けず、`anchorLabel` に「範囲 (x, y) w×h」を入れる

ホスト側(ggm): `html-starter/vite-plugin-wf.ts` と `proposal/reference/vite-plugin-slide-io.ts` が `anchorRect` を数値に正して保存し `seq` を採番する。
`scripts/wf-comments.mjs` の `list` / `show` は範囲と番号を出す。提案書の「AIで修正」のプロンプトにも範囲を入れる。

## 刻印の無い HTML の要素アンカー

`data-gg-src` / `data-wf-src` が無い要素は、紙面からの短い CSS パスを刻印の代わりにする(`css:#artboard>main>section:nth-of-type(2)>h2`)。
途中に一意な id があればそこから始める。エディタが付ける `data-element-id` は読み込みのたびに変わるので使わない。

引くときはまずパスそのもの。無ければ辿れる所まで親に戻り、その下で同じタグ・同じラベル(`describeElement` の文字)の要素が **1 つだけ**あればそれ。
ページ全体を文字だけで探すことはしない(同じボタンが何度も出るページで別の場所に付いてしまうため)。

## 実装

- ツール `'comment'`(`EditorTool` / `ShortcutAction` / `KEYBOARD_SHORTCUTS` の `c` / `TOOL_CONFIGS` の group `comment`)。
  ツールバーには `canComment`(= `can('commentAction')`)のときだけ出す
- iframe の body に `comment-mode`。`draw-mode` と同じ扱いで、要素の選択・ホバー・mousedown を止め、`[data-editable]` は `pointer-events: none`
  (`EditorCanvas` / `useIframeInitializer` の class 切替、`useElementSelection` ×2 / `useIframeSetup` / `useIframeInitializer` の判定)
- `useCommentRegionTool`(PptComments.tsx): iframe の document に capture で pointerdown/move/up/cancel。`#artboard` に `setPointerCapture` して紙面の外で離しても拾う。
  座標は `#artboard` の `getBoundingClientRect` と `offsetWidth` の比で紙面 px に戻す(外側のキャンバス倍率は clientX に織り込まれている)。
  ドラッグ中の破線は `.gg-comment-layer` の `[data-comment-drafting]`。4px 未満の動きは点
- 下書きの状態は `FrontendVisualEditor` の `commentDraftRect`(パネルは開くまでマウントされないため)。ページを切り替えると消える
- `useCommentMarkers`: `[data-comment-id][data-comment-rect]`(div)と `[data-comment-pin]`(button)。太さ・大きさは `内側の倍率 × 外側の倍率` で割って画面上で一定。
  下書きは `[data-comment-draft]`。掃除は `[data-comment-id]` 単位(以前は button だけだった)。`activeThreadId` で太線
- comment-mode では枠(`[data-comment-rect]`)は `pointer-events: none !important` にして、枠の上からも新しい範囲を描ける。ピンはクリックでスレッドを開く

## 確かめたこと(scratch の html-starter 5197 / 提案書 5198、headless Chromium)

`verify-comments.mjs`: ツールバー・C・ドラッグ → パネルと下書き → 投稿 → 枠とピン #1 → 保存(px + ref + seq)→ 縮小しても画面上 32px / 2px →
下に 600px 足しても動かない → Esc の段階 → 点 → css: パスの要素アンカー → 再読み込みで 3 つとも引ける → 削除しても番号を詰めない → CLI が範囲を出す。
キャンバス表示(外側の倍率 < 1)で描いた矩形が紙面 px になり、ピンが 32px。提案書(PowerPoint 風)の校閲タブ「範囲を指定」→ deck.json に anchorRect と seq。

## やっていないこと

- フィードバックシートの % 矩形(1500px 幅のキャプチャ)を紙面の px に正確に写すこと。ノート欄の有無で本文の幅が違い、比で写すと隣の要素に付く。
  `pull` は今までどおり `anchorLabel` に「シート #n (x%, y%)」を入れるだけ
- 見るだけの紙面(キャンバスの他ページ)へのピン表示
