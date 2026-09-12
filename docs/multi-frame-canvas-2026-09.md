# マルチフレームのキャンバス(Figma 風)— 0.3.0

`enableMultiPageCanvas` を渡すと、全ページを 1 枚のキャンバスにフレームとして並べ、クリックしたページを編集できる。
1 ページずつの表示(従来)はそのまま残る。利用側はどちらを出すか選べる(両方の切替を用意した構成ラフ・提案書のテンプレートを参照)。

## 仕組み

- **編集エンジンは 1 つ**。生きているエディタ(`EditorCanvas`)は常に 1 つで、編集中のフレームの位置に置かれる。ページを移っても作り直さない(iframe の中身だけ差し替える)。
- **他のページは見るだけの紙面**(`PageFramePreview`)。`srcdoc` の iframe に `sandbox="allow-same-origin"` で描く。編集用の属性は付けない。画面から遠いものは描かず、webpage は高さの実測がレイアウトに要るので順番に少しずつ先読みする。
- **倍率は外側の CSS transform が持つ**。iframe の中は常に等倍(`generateEditableHtml(…, { embedded: true })`)。座標を親 ⇄ iframe で渡す箇所はすべて `iframeRect.width / iframe.clientWidth` の実測で倍率を掛ける(単独表示では 1 になるので同じ式でよい)。
- **iframe の中で起きたホイール・キー・中ボタンは親へ転送する**(`utils/embedded-canvas-bridge.ts` → `useInfiniteCanvas`)。座標は転送前に親の座標へ直す(親の realm で作ったリスナーから `postMessage` すると `e.source` が親自身になり、送り元の iframe を特定できないため)。
- **選択枠・ハンドル・コメントのピンは画面上で同じ太さ**。外側の倍率を `<html data-outer-zoom>` に書き、`applyOverlayScale` が内側 × 外側で割る。
- **フレームの寸法**: 幅は版面の幅(webpage は `artboardWidth`、slide は 1920)。高さは実測(生きているページはエディタ、他は見るだけの紙面の `#artboard` を `ResizeObserver` で)。位置は寸法から毎回計算する(状態に持たない)。
- **見えている範囲は記憶する**(`canvasStorageKey`、省略時は `parentId`)。開き直すと同じ場所に戻る。内容と重ならなければ編集中のページに合わせる。

## ページ切替と保存

1. フレームをクリック(またはフレーム名・左パネルのページ一覧)→ `activatePage(id)`
2. 未保存の変更があれば先に保存(`flushAutoSave`)。失敗したときだけ確認する
3. `onContentChange(id)` → `FrontendVisualEditor` の `handleContentChange` が本文を読む。順に `io.loadContent(id)` → `contentList[].thumbnailHtml` → `parentId` の API
4. 読み込みから iframe の初期化が終わるまで自動保存を止める(`beginContentSwitch` / `endContentSwitch`)。止めないと、履歴に残っている前のページの本文を次のページへ書いてしまう
5. 保存は常に `onSave(html, { auto, contentId })`。利用側は `contentId` で保存先を選ぶ。保存できた本文は見るだけの紙面にも写す(離れたあとも最新が見える)

## 利用側に要るもの

| 要るもの | 何のため |
|---|---|
| `contentList` | フレームの並びとタイトル。`id` は `contentId` と同じ体系 |
| `io.loadContent(id)` か `contentList[].thumbnailHtml` | 隣のページの本文 |
| `onSave(html, { contentId })` | どのページの本文かを見て保存する |
| `onContentChange(id)` | URL や「編集中のページ」を利用側が追う。逆に `contentId` プロップを変えるとエディタがそのページへ移る |
| `canvasStorageKey` | 見えている範囲の記憶(省略時は `parentId`) |

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

- 3 ページの構成ラフ / 6 枚のスライドで、フレームのクリック・左パネルからの切替・⇧1 / ⇧2・ホイールとピンチの転送・Space ドラッグ
- 22%〜125% で要素の選択・ダブルクリックの文字編集・右クリックメニューの位置
- 自動保存が `contentId` 付きで正しいページへ届き、見るだけの紙面に反映される
- ライト / ダークの切替
