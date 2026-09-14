# 改行・Enter・サイズ欄の修正と、最小・最大の幅と高さ(0.7.0)

不具合 3 件(`<br>` がレイヤーに出る / Enter で段落が分かれる / サイズ欄の数値が切れる)と、
足りなかった機能 1 件(min / max-width・height の編集)。

## 1. `<br>` がレイヤー一覧に「シェイプ」として出て、選べた

- 原因: `useIframeSetup` の `initializeEditableElements` が紙面のすべての要素に `data-editable` と `data-element-id` を付け、
  `BR` を除外していなかった。`buildDomTreeInternal` は ID を持つ要素を全部レイヤーにし、`buildLayerLabel` は中身の無い要素を
  「シェイプ」と呼ぶ。キャンバスでも幅 0 の要素として選べた
- 直し方: `isNonEditableTag`(`utils/dom-utils.ts`、`BR` と `WBR`)
  - 印を付ける経路で飛ばす: iframe の初期化、部品の切り離し(`unlockPartDescendants`)、グループ解除、`makeChildrenEditable`
  - 前に付いていた印(`data-editable` / `data-element-id` / `data-inline`)は初期化で外す
  - レイヤーの木(`buildDomTreeInternal`)とクリックの解決(`getEditableElement`)でも、改行は親の文字要素として扱う

## 2. テキスト編集中に Enter を押すと、段落が分かれてスタイルが別になる

- 原因: contenteditable の既定の Enter。Chrome は `<p>` の中に `<div>` を差し込む(`<p>前半<div>後半</div></p>`)。
  HTML では p の中に div を置けないので、保存して読み直すと段落が閉じ、後半が段落のクラス(文字の大きさ・行間)を持たない div になる。
  Shift+Enter は同じ段落に `<br>` が入るだけで正しかった
- 直し方: `utils/text-line-break.ts` の `setupLineBreakOnEnter(doc)` を、`EditorCanvas` が紙面の document に張る(keydown の capture 1 本)。
  編集中の要素(`[contenteditable="true"]`)の中の Enter を `execCommand('insertLineBreak')` にする。Shift+Enter と同じブラウザの処理
  - 範囲選択の削除、行末の改行(次の行を作る 2 つ目の `<br>`)、編集中の ⌘Z 1 回での取り消し、`input` イベント(共同編集の送信)は
    ブラウザの処理がそのまま担う。自前で Range に `<br>` を入れると、ブラウザの取り消しの履歴に載らない
  - `insertLineBreak` を持たないブラウザでだけ自前で入れる(行末なら 2 つ目の `<br>` を置き、`input` イベントも投げる)
  - **日本語入力**: `isComposing` か `keyCode === 229` の keydown には触らない(最初に見る)。
    Safari は確定(`compositionend`)の後に Enter の keydown を送るので、確定から keyup までの Enter も見送る
  - 見送った Enter などが段落を分けようとしたとき(`beforeinput` の `insertParagraph`。Android の IME など)も改行に直す
  - ⌘ / Ctrl + Enter はショートカットに譲る
  - 対象はテキスト編集に入るすべての要素: p / 見出し / li / td / ボタン / span、テキストツールで置いた要素(`useDrawingMode`。同じ document なので同じ扱い)
  - 編集を抜けた後の ⌘Z は、今までどおりエディタの履歴(編集 1 回 = 1 段)

## 3. 右パネル「サイズ」の W / H の数値が切れて読めない

- 原因: `VariableAwareSizeInput` の固定値の箱が `w-14`(56px)決め打ちで、その中に数値とモード切替、外に単位(40px)を置いていた。
  さらにパネル共通の入力の見た目(`skin.css`: 高さ 32px・左右 8px の余白)が中の数値にも当たり、数値に使える幅が 26px しか無かった
- 直し方: 箱はモードによらず列の残りを使う(`flex-1 min-w-0`)。数値・単位・モード切替を箱の中に並べる。
  外側に `.group` を付けて共通の入力の見た目を中に当てず、箱は `.group.h-5`(数値のスクラブ入力と同じ見た目)にする。
  単位の `<select>` は既定の矢印を出さない。効いていなかった `:global()` の `<style>` を消した
- 数値の欄の幅(12px の文字。「1820.5」は 39px): パネル幅 280 / 303 / 480 で 54 / 65 / 154px

## 4. 最小・最大の幅と高さ(min-width / max-width / min-height / max-height)

- サイズ欄の右上の「+ 最小・最大」で、最小W・最大W・最小H・最大H の欄を出す。値が入っている要素を選んだときは最初から出る。別の要素を選ぶと閉じる
- 欄は W / H と同じ `VariableAwareSizeInput`(`variant="limit"`)。px / % / vw・vh / em / rem と変数を扱う。空にすると指定を消す。モードの切替は出さない
- 適用は W / H と同じ `updateElementStyle`(複数選択なら全要素に同じ値、履歴 1 段)。Web ページ(構成ラフ)とスライドの両方
- 保存形は W / H と同じく、任意値のクラス(`min-w-[300px]`)とインラインの指定の両方。
  この 4 つは特殊値(`100%` → `min-w-full`)でもインラインを残す(`LAYOUT_CRITICAL_PROPERTIES`)。ページの Tailwind にクラスが無くても効き、欄に読み戻せる
- 読み戻し(`extractElementInfo` の `rawMinWidth` など): インライン → Tailwind の任意値・特殊値のクラス → 同じ系統の名前付きクラス(`max-w-6xl`)なら計算値。`none` / `auto` は指定なし
- `applyTailwindStyles` は空の値で、競合クラスに加えてインラインの指定も外すようにした(これまではクラスだけ消えていた。`: ''` の直書きと計算キーで探した範囲では、空を渡す呼び出し元は他に無い)
- 選択枠のハンドルでのリサイズも、要素の min / max で止める(`computeResizeGeometry` の `limits`、開始時に計算値を読む。px で読めない軸は制約なし)。
  止まった軸を「効かないハンドル」と誤判定しない。左・上のハンドルでは、止まった分だけ対辺が動かない
- 最小の 0(`min-w-0` など。構成ラフのページに数百か所ある)だけの要素では欄を自動で開かない。0 は制約なしと見分けがつかないため。開けば 0 が入っている
- W / H と最小・最大の入力は、フォーカスが外れたら打ちかけの文字を捨てて要素の値を出す(打ちかけの文字を、次に選んだ要素の欄に残さない)

## 確かめたこと

Playwright(headless Chromium)で、`npm pack` した tgz を入れた構成ラフの殻・提案書デッキと、playground・ローカルの Hocuspocus で確かめた。

- `<br>`: `<br>` / `<wbr>` に印が付かない・前の印が外れる・レイヤーの段落の行に子が無い・改行の位置のクリックで段落が選ばれる
- Enter: 段落の途中(p は 1 つ・`<br>` +1・p の中の div 0)/ 編集中の ⌘Z 1 回 / 行末で Enter して打った文字が次の行に入る / 範囲選択して Enter /
  保存 HTML に `<br>` が入り div が無い / 読み直しても段落は 1 つでクラスが残る / 編集を抜けた後の ⌘Z 1 回で Enter の分だけ戻る /
  h2・li・td・button・span / テキストツールで置いた要素 / 共同編集に接続中(相手の紙面にも `<br>` が届き、段落は分かれない)
- 日本語入力: 合成の keydown(`isComposing: true` では入らない、対照の `false` では入る)と、
  CDP の `Input.imeSetComposition` で変換中の状態を作り、keyCode 229 の Enter → `Input.insertText` で確定(Chrome の順)、
  確定 → keyCode 229 の Enter(Safari の順)。どちらも `<br>` が入らず、確定の後の普通の Enter は改行になる
- サイズ欄: パネル幅 280 / 303 / 480 で W 1820・H 791 の固定値、「790.5」を打った状態で `scrollWidth <= clientWidth`・数値と単位とモード切替が重ならない。Fill / Hug と変数に紐づいた状態も列の中に収まる
- 最小・最大: 既定で隠れる → 4 つを入れると computed style に効く → W 800 / H 60 にしても 500 × 150 で止まる → ハンドルで広げても 500 で止まり、そのまま狭められる →
  保存 HTML に残る → 読み直すと最初から欄が出て値が戻る → 空にすると紙面と保存 HTML から消える → ⌘Z 1 回で戻る(Web ページとスライドの両方)。`min-w-0` だけの要素では自動で開かない
- わざと壊した版で落ちること: `<br>` の除外を外す → 3 件 FAIL、日本語入力の判定を外す → 4 件 FAIL

## 分かっている穴

- 日本語入力は headless Chromium で CDP と合成イベントを使って確かめた。実機の IME(macOS / Windows)、Safari、Firefox では確かめていない。
  `insertLineBreak` を持たないブラウザ向けの自前の差し込みは、ブラウザの取り消しの履歴に載らない(編集を抜けた後のエディタの履歴では戻る)
- W / H の数値は、今までどおり実測値を整数に丸めて出す(790.5px の要素は 791)。欄の幅は「1820.5」まで入る
- 最小・最大の欄が読むのは要素自身の指定(インライン・Tailwind のクラス)だけ。ページの CSS のセレクタで付いた min / max は出ない
- `beforeinput` の `insertParagraph` を改行に直す経路(keydown を見送ったのに段落を分けようとしたとき)は、どの検証でも通っていない
- 複数選択での最小・最大は W / H と同じ `updateElementStyle`(選択中の全要素)に乗せただけで、検証していない
- ハンドルで止めるのは計算値が px の軸だけ。% などの min / max はハンドルでは止めない(紙面では CSS が効く)。複数選択の枠のリサイズは要素ごとの min / max を見ない
