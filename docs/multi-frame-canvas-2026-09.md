# マルチフレームのキャンバス(Figma 風)— 0.3.0

`enableMultiPageCanvas` を渡すと、全ページを 1 枚のキャンバスにフレームとして並べ、クリックしたページを編集できる。
1 ページずつの表示(従来)はそのまま残る。利用側はどちらを出すか選べる(両方の切替を用意した構成ラフ・提案書のテンプレートを参照)。

## 仕組み

- **編集エンジンは 1 つ**。生きているエディタ(`EditorCanvas`)は常に 1 つで、編集中のフレームの位置に置かれる。ページを移っても作り直さない(iframe の中身だけ差し替える)。
- **他のページは見るだけの紙面**(`PageFramePreview`)。`srcdoc` の iframe に `sandbox="allow-same-origin"` で描く。編集用の属性は付けず、script は外す(動かないのにコンソールへ「Blocked script execution」が 1 枚ごとに出るだけ)。画面から遠いものは描かない(webpage は高さの実測がレイアウトに要るので見えていなくても読む)。
- **同時に読む紙面は 4 枚まで**(`requestPreviewSlot` / `releasePreviewSlot`、編集中のページに近い順)。150 枚を一度に読むと接続枠と主スレッドを占め、編集中のページの切替が 1 秒近く待たされた(実測 82ms → 912ms。絞って 220ms 前後)。
- **紙面に足すスタイルは利用側が渡す**(`io.previewStyles` → `PreviewStyle[]`、URL か CSS 文字列)。本文が Tailwind のブラウザ版 JIT(script)に頼っている利用側(提案書)は、それが無いと紙面が素の HTML になる。提案書のテンプレートは自分のページの stylesheet と `/src/index.css`(dev)を渡す。構成ラフは本文に CSS が入っているので不要。
- **倍率は外側の CSS transform が持つ**。iframe の中は常に等倍(`generateEditableHtml(…, { embedded: true })`)。座標を親 ⇄ iframe で渡す箇所はすべて `iframeRect.width / iframe.clientWidth` の実測で倍率を掛ける(単独表示では 1 になるので同じ式でよい)。
- **iframe の中で起きたホイール・キー・中ボタンは親へ転送する**(`utils/embedded-canvas-bridge.ts` → `useInfiniteCanvas`)。座標は転送前に親の座標へ直す(親の realm で作ったリスナーから `postMessage` すると `e.source` が親自身になり、送り元の iframe を特定できないため)。
- **選択枠・ハンドル・コメントのピンは画面上で同じ太さ**。外側の倍率を `<html data-outer-zoom>` に書き、`applyOverlayScale` が内側 × 外側で割る。
- **フレームの寸法**: 幅は版面の幅(webpage は `artboardWidth`、slide は 1920)。高さは実測(生きているページはエディタ、他は見るだけの紙面の `#artboard` を `ResizeObserver` で)。位置は寸法から毎回計算する(状態に持たない)。
- **見えている範囲は記憶する**(`canvasStorageKey`、省略時は `parentId`)。開き直すと同じ場所に戻る。内容と重ならなければ編集中のページに合わせる。
- **倍率・位置は Context の外の小さなストア**(`viewStore`、`useCanvasViewState()` で購読)。ホイール 1 目盛りごとに Context の値を変えると、購読しているもの全部(エディタ本体・150 枚の紙面・左パネル)が描き直しになる。パンで変わる DOM は転写層とオーバーレイの transform の 2 つだけ(実測)。フレーム 1 枚ずつの要素は memo で倍率だけに依存する。
- **フレーム名は行の隙間に収まる倍率でだけ出す**。全体表示で 150 枚を並べると下の行の名前が上の行のフレームに被り、クリックを奪う(実測: 2 を押したのに 8 へ移った)。
- **キャンバスの余白から始めるマーキー**(`useCanvasMarquee`)。埋め込みでは iframe が紙面ぴったりで外側の「空白」が無いので、余白で押したドラッグを親が受け、矩形を iframe の座標に直して同じ判定(交差 → 最上位に畳む)で選ぶ。外→中に引くとページ全体の器の縁を必ずまたぐので、「他の候補をすべて含み、矩形にすっぽり入っていない」器は背景として外す。押している間はエディタの層を pointer-events: none にする(ポインタが iframe に入ると mouseup が親へ来ない)。

## ページ切替と保存

入口は 2 つ: フレームのクリック(フレーム名・左パネルのページ一覧も同じ)→ `activatePage(id)` → `onContentChange(id)`、
または利用側が `contentId` プロップを変える(構成ラフのレール、提案書の URL)。どちらも `FrontendVisualEditor.handleContentChange` に集まる。

1. `activatePage` はリング(選択枠)と名前の強調だけをクリックしたページへ移し(押した手応え)、生きているエディタはまだ動かさない
2. `handleContentChange` が **未保存の変更を先に保存**する(`flushAutoSave`。失敗したときだけ確認する。入口ごとに保存を書くと片方に漏れて 2 秒以内の編集が消える ── 実測で起きた)。断ったときは利用側の「編集中のページ」を今のページへ戻す
3. 本文を読む。順に `io.loadContent(id)` → `contentList[].thumbnailHtml` → `parentId` の API。連続して呼ばれたら最後の 1 つだけを通す
4. 読み込みから iframe の初期化が終わるまで自動保存を止める(`beginContentSwitch` / `endContentSwitch`)。止めないと、履歴に残っている前のページの本文を次のページへ書いてしまう
5. 本文が来た時点で `currentContentId` が変わり、エディタがそのフレームへ移る。新しい文書が描けるまで(`iframeReady`)エディタは隠し、下の見るだけの紙面が透ける(前のページの姿が新しい枠に見えない)。高さの報告先も `currentContentId`
6. 保存は常に `onSave(html, { auto, contentId })`。利用側は `contentId` で保存先を選ぶ。保存できた本文は見るだけの紙面にも写す(離れたあとも最新が見える)

## 利用側に要るもの

| 要るもの | 何のため |
|---|---|
| `contentList` | フレームの並びとタイトル。`id` は `contentId` と同じ体系 |
| `io.loadContent(id)` か `contentList[].thumbnailHtml` | 隣のページの本文 |
| `onSave(html, { contentId })` | どのページの本文かを見て保存する |
| `onContentChange(id)` | URL や「編集中のページ」を利用側が追う。逆に `contentId` プロップを変えるとエディタがそのページへ移る |
| `canvasStorageKey` | 見えている範囲の記憶(省略時は `parentId`) |
| `io.previewStyles` | 見るだけの紙面に足すスタイル。本文がブラウザ版 Tailwind に頼っている利用側だけ |

## 操作

| 操作 | 動き |
|---|---|
| ホイール / 2 本指 | 移動。Shift で横 |
| ⌘ + ホイール / ピンチ | カーソル位置を固定して拡大縮小 |
| Space + ドラッグ / 中ボタン / 手のひら(H) | 移動 |
| ⌘0 / ⇧1 | 全体表示 |
| ⌘2 / ⇧2 | 編集中のページに合わせる |
| ⌘1 / ⇧0 | 100% |
| ⌘+ / ⌘− | 段階ズーム(1.25 倍) |
| ⇧R | 定規の表示 |
| フレーム名をクリック | そのページへ編集を移す(編集中ならページに合わせる)。ダブルクリックで画面に合わせる |
| 余白からドラッグ | マーキー選択(編集中のページの要素)。Shift で追加。余白をクリックすると選択解除 |

## 配色(Figma UI3 の実測値に寄せた)

ライト: カンバス `#F5F5F5` / パネル `#FFFFFF` / 罫線 `#E6E6E6` / 文字 `#1E1E1E` / 補助 `#6B6B6B` / アクセント `#0D99FF`。
ダーク: カンバス `#1E1E1E` / パネル `#2C2C2C` / 入力 `#383838` / 罫線 `#444444` / アクセント `#0D99FF`(文字は `#4FB8FF`)。
正本は `src/styles/skin.css` の `.gg-editor-ui` トークン。

## 変えたもの(0.2.2 → 0.3.0)

- `enableMultiPageCanvas` の実装を差し替えた。旧実装(全ページの iframe に編集ハンドラを付ける独自エンジン)は削除。`MultiPageCanvasView` / `PageFramePreview` / `CanvasRulers` が新しい部品
- `onSave` の第 2 引数に `contentId` が付く。`onContentChange` / `canvasStorageKey` プロップ、`io.loadContent` を追加
- `FrontendVisualEditor` が `parentId` の `/api/websites/...` へ直接保存する経路は無くした。保存は常に `onSave`
- コメント(ピン・パネル)とノートはキャンバスでも出す
- `useGoogleFonts`: 利用側に `/api/google-fonts` が無くてもエラーを出さない(同梱の一覧で静かに済ませる)
- `.gg-editor-ui` の配色を Figma UI3 に寄せた(アクセントが `#2459C4` → `#0D99FF` など)

## 確認したこと(2026-09-13、playground と構成ラフ・提案書のテンプレート)

手で: 3 ページの構成ラフ / 6 枚のスライドで、フレームのクリック・左パネルからの切替・⇧1 / ⇧2・ホイールとピンチの転送・Space ドラッグ、
22%〜125% で要素の選択・ダブルクリックの文字編集・右クリックメニューの位置、ライト / ダークの切替。

Playwright(headless Chromium、21 項目すべて合格。スクリプトは作業用で同梱していない):

- 構成ラフの殻(21 ページ): 見出しを直して 2 秒以内にレールで別ページへ → ファイルに保存され、離れたページの紙面にも反映
- 提案書(150 枚)の全体表示: パンで style が変わる要素は 2 つ、p95 9ms / ズーム p95 9ms。紙面に利用側の CSS が乗る(utility class が解決する)
- 提案書: フレームのクリック直後にリングが移り、エディタは `ready=false` で隠れてから移り、220ms 前後で本文が載る(全体表示の直後でも)。URL は `#/edit/2` を追う
- 提案書: 要素を選んでコメントを投稿 → ピンは 37% / 24% のどちらでも画面上 32px、クリックでスレッドが開く
- playground: 46% でカードのドラッグ並べ替え(流れのまま)、16% で右下ハンドルのリサイズ(画面の移動量 ÷ 倍率)、ハンドルは画面上 12px
- playground: 余白からのマーキーで、帯がまたいだ 2 枚 / 1 行の 3 枚のカードが選ばれる(器の section / main は選ばれない)
