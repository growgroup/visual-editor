# キャンバスの拡大縮小を Figma にそろえる — 0.9.2

マルチフレームのキャンバス(`enableMultiPageCanvas`)の拡大縮小を Figma に合わせた。既定の挙動の変更はどれも後方互換
(API は足しただけ。倍率の範囲の既定は従来どおり 2%〜400%)。

## 変えたこと

| 操作 | 0.9.1 まで | 0.9.2 |
|---|---|---|
| Safari・WKWebView のトラックパッドのピンチ | **何も起きない**(ブラウザの拡大を止めるだけ) | カーソル位置を固定して拡大縮小。紙面(iframe)の上でも効く |
| Chrome・Edge・Electron のピンチ / ⌘ + ホイール | カーソル位置を固定して拡大縮小 | 同じ(ピンチの最中に両方届く環境で二重に拡大しない) |
| ⌘+ / ⌘− ・ヘッダーの +/− | 1.25 倍ずつ | 2 の累乗の段(…25% → 50% → 100% → 200%…。段の間からは向きの側の段へ) |
| ⌘2 / ⇧2 | 編集中のページに合わせる | 選んでいる要素に合わせる(選んでいなければ編集中のページ)。倍率メニューに「選択範囲に合わせる」 |
| IME の変換中の ⌘+ / Space 等 | キャンバスが奪うことがあった | 奪わない(`isComposing` / `keyCode 229`) |
| 倍率の範囲 | 2%〜400% 固定 | `canvasZoomRange` で変えられる(省略時は 2%〜400%。Figma と同じにするなら `{ min: 0.02, max: 256 }`) |

## 仕組み

- **ピンチの届き方はブラウザで違う**。Chrome 系はトラックパッドのピンチを ctrl 付きの `wheel` にして送る
  (`preventDefault` すればブラウザの拡大は起きない)。WebKit(Safari・WKWebView)は `gesturestart` / `gesturechange` /
  `gestureend` で送り、`scale` は **gesturestart からの累積**。
- 以前は `useBrowserZoomPrevention` と `useCanvasControls` が gesture を window の capture で `stopImmediatePropagation`
  して握りつぶし、紙面の iframe 側(`embedded-canvas-bridge`)も止めるだけだった。拡大縮小に使う処理はどこにも無かった。
  → ブラウザの拡大の防止(`preventDefault`)だけ残し、伝播は止めないようにした。
- `utils/canvas-gestures.ts`
  - `listenCanvasGestures`: 容器の上で起きた gesture と、紙面の iframe から転送された `EMBEDDED_GESTURE` を受け、
    始まりの倍率 × `scale` を `zoomAt`(カーソル位置が中心)に渡す。容器の外(ヘッダー・パネル)の上のピンチは拡大しない。
    GestureEvent に座標が無い環境では最後にポインタがあった所を中心にする。gestureend を取りこぼしても 1 秒で解く
  - `forwardEmbeddedGestures`: 紙面の iframe の gesture を親へ(ホイールと同じく、座標は送る前に親の座標へ直す)
  - `nextZoomLevel`: 2 の累乗の段。`isImeKeyEvent`: IME の変換中か。`selectionCanvasRect`: 選んでいる要素の矩形(キャンバスの座標)
- **拡大縮小はどの経路も `zoomAt` に集める**(ホイール・転送されたホイール・ピンチ・転送されたピンチ・タッチ)。
  キー・ボタンは画面の中心(`zoomTo`)。範囲はどの経路も Context の `clampZoom`(= `canvasZoomRange`)で収める。
- 選択範囲: `zoomToRect`(Context に追加)。全体表示と違って 100% で止めない(小さい要素は大きく見せる。Figma と同じ)。

## 確かめたこと

`npm run typecheck`、playground(`npm run playground` → `?mode=webpage&canvas`)を headless Chromium で開き、
次で倍率(ヘッダーの %)が変わることを見た。検証のスクリプトは gg-manager 側の作業ログにある。

- Chromium の本物のピンチ(CDP `Input.synthesizePinchGesture`、`gestureSourceType: 'mouse'` = トラックパッド)を
  キャンバスの余白の上と、紙面(iframe)の上で
- Control + ホイール(余白の上・紙面の上)
- 合成した GestureEvent(Safari 相当。余白の上と、紙面の iframe の中)
- Control + = / Control + −(2 の累乗の段)

実機でしか確かめられないもの: Safari・WKWebView の本物のピンチ(GestureEvent に座標が入るか)、
高い倍率(1600% 以上)での描画の重さ・定規。

## 触っていないもの

- 1 ページずつの表示(`enableMultiPageCanvas` なし)の Safari のピンチは従来どおり止めるだけ(拡大縮小しない)。
- 見るだけの紙面(編集していないページ)はこれまでどおり pointer-events を切っているので、その上の操作は容器が受ける。
