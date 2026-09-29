# キャンバスの拡大縮小を Figma にそろえる — 0.10.0

マルチフレームのキャンバス(`enableMultiPageCanvas`)の拡大縮小を Figma に合わせられるようにした。
**既定の挙動は変えていない**(刻み・範囲・⌘2 の合わせ先はオプション)。既定で変わるのは、何も起きなかった操作が効くようになる直しだけ。

## 変えたこと

| 操作 | 0.9.1 まで | 0.10.0 の既定 | `canvasZoomOptions` |
|---|---|---|---|
| Safari・WKWebView のトラックパッドのピンチ | **何も起きない**(ブラウザの拡大を止めるだけ) | カーソル位置を固定して拡大縮小。紙面(iframe)の上でも効く | — |
| Chrome・Edge・Electron のピンチ / ⌘ + ホイール | カーソル位置を固定して拡大縮小 | 同じ(ピンチの最中に両方届く環境で二重に拡大しない) | — |
| IME の変換中の ⌘+ / Space 等 | キャンバスが奪うことがあった | 奪わない(`isComposing` / `keyCode 229`) | — |
| 倍率の範囲 | 2%〜400% | 同じ | `min` / `max`(Figma は 0.02〜256) |
| ⌘+ / ⌘− ・ヘッダーの +/− | 1.25 倍ずつ | 同じ | `steps: 'powers-of-two'` で 2 の累乗の段(…50% → 100% → 200%…。段の間からは向きの側の段へ) |
| ⌘2 / ⇧2 | 編集中のページに合わせる | 同じ | `fitShortcut: 'selection'` で選んでいる要素に合わせる(選んでいなければページ)。倍率メニューに「選択範囲に合わせる」が出る |

Figma にそろえる利用側は `canvasZoomOptions={{ min: 0.02, max: 256, steps: 'powers-of-two', fitShortcut: 'selection' }}`。

## 仕組み

- **ピンチの届き方はブラウザで違う**。Chrome 系(Electron を含む)はトラックパッドのピンチを ctrl 付きの `wheel` にして送る
  (最初の 1 つを `preventDefault` すればブラウザの拡大は起きず、残りも wheel で届く)。
  WebKit(Safari・WKWebView)は `gesturestart` / `gesturechange` / `gestureend` で送り、`scale` は **gesturestart からの累積**。
- 以前は `useBrowserZoomPrevention` と `useCanvasControls` が gesture を window の capture で `stopImmediatePropagation`
  して握りつぶし、紙面の iframe 側(`embedded-canvas-bridge`)も止めるだけだった。拡大縮小に使う処理はどこにも無かった。
  → ブラウザの拡大の防止(`preventDefault`)だけ残し、伝播は止めないようにした。
- `utils/canvas-gestures.ts`(DOM と数値だけを扱う。React・Context には触らない)
  - `listenCanvasGestures`: 容器の上で起きた gesture と、紙面の iframe から転送された `EMBEDDED_GESTURE` を受け、
    始まりの倍率 × `scale` を `zoomAt`(カーソル位置が中心)に渡す。容器の外(ヘッダー・パネル)の上のピンチは拡大しない。
    GestureEvent に座標が無い環境では最後にポインタがあった所を中心にする。gestureend を取りこぼしても 1 秒で解く
  - `forwardEmbeddedGestures`: 紙面の iframe の gesture を親へ(ホイールと同じく、座標は送る前に親の座標へ直す)
  - `nextZoomLevel`: 2 の累乗の段。`isImeKeyEvent`: IME の変換中か。`selectionCanvasRect`: 選んでいる要素の矩形(キャンバスの座標)
- **拡大縮小はどの経路も `zoomAt` に集める**(ホイール・転送されたホイール・ピンチ・転送されたピンチ・タッチ)。
  キー・ボタンは画面の中心(`zoomTo`)。範囲はどの経路も Context の `clampZoom`(= `canvasZoomOptions` の min / max)で収める。
- 選択範囲: `zoomToRect`(Context に追加)。全体表示と違って 100% で止めない(小さい要素は大きく見せる。Figma と同じ)。

## 確かめたこと

`npm run typecheck`。playground(`npm run playground` → `?mode=webpage&canvas`、Figma にそろえた設定は `&figma`)を headless Chromium で開き、ヘッダーの % で見た。

| 操作 | main(0.9.1) | このブランチ(既定) |
|---|---|---|
| Chromium の本物のピンチ(CDP `Input.synthesizePinchGesture`、`gestureSourceType: 'mouse'` = トラックパッド)を余白の上 / 紙面の上 | 54 → 107% / → 215% | 同じ |
| Control + ホイール(紙面の上・余白の上) | 拡大 / 縮小 | 同じ |
| 合成した GestureEvent(Safari 相当)を余白の上 / 紙面の iframe の中 | **変わらない** | 変わる(215 → 107% / 107 → 215%) |
| Control + = / Control + −(既定) | 1.25 倍(215 → 268 → 215%) | 同じ |
| Control + = / Control + −(`steps: 'powers-of-two'`、playground の `&figma`) | — | 2 の累乗の段(215 → 400 → 200%) |
| ⇧2(168×42 の要素を選んだ状態。既定) | 編集中のページ(34%) | 同じ |
| ⇧2(同じ。`fitShortcut: 'selection'`) | — | 選んだ要素に合わせる(593%) |

実機でしか確かめられないもの: Safari・WKWebView の本物のピンチ(GestureEvent に座標が入るか)、
高い倍率(`max` を上げたとき。1600% 以上)での描画の重さ・定規。

## Electron のアプリの中のブラウザでピンチが効かないとき

コードとドキュメントで分かる範囲:

- Electron(Chromium の content 層)は、トラックパッドのピンチをまず ctrl 付きの `wheel` としてページへ送る。
  ページがそれを `preventDefault` すればブラウザ側の拡大(Electron では既定で無効の visual zoom、`setVisualZoomLevelLimits`)は起きない。
  webview / `WebContentsView` のどちらでも、ページの中身には同じ経路で届く。
- `webContents` の `zoom-changed` は、ページが消費しなかった ctrl + ホイールで「アプリの拡大」を求められたときに出る。
  ページが `preventDefault` していれば出ない。アプリがここで独自の拡大をしていても、キャンバスの上のピンチは食われないはず。
- 以上から、Electron のアプリの中でもこのキャンバスはピンチで拡大縮小できるはずで、headless Chromium ではそのとおり動いた。
  それでも効かないなら、アプリがページより手前で入力を処理している(画面の転写・入力の中継など)可能性がある。

実機で確かめる手順(そのアプリの中のブラウザで、キャンバスのあるページを開く):

1. 開発者ツールのコンソールで次を実行する。
   ```js
   window.addEventListener('wheel', (e) => console.log('wheel', e.ctrlKey, e.deltaY, e.target.nodeName), { capture: true, passive: true });
   for (const t of ['gesturestart', 'gesturechange', 'gestureend']) window.addEventListener(t, (e) => console.log(t, e.scale), { capture: true });
   ```
   紙面の上でピンチすると、コンソールは紙面の iframe の文書ではなく親の文書なので出ない。**キャンバスの余白(灰色)の上**でピンチする。
2. 判定
   - `wheel true …` が続けて出て、ヘッダーの % も変わる → 正常
   - `wheel true …` は出るのに % が変わらない → キャンバス側の不具合(このパッケージ)
   - 何も出ない → アプリがページへピンチを送っていない(アプリ側の事情)。⌘ + マウスホイールで拡大縮小できるかも見る
   - `gesture…` だけが出る → WebKit 系(このパッケージの 0.10.0 で拡大縮小する)
3. 同じページを普通の Chrome でも開き、同じように見比べる。

## 触っていないもの

- 1 ページずつの表示(`enableMultiPageCanvas` なし)の Safari のピンチは従来どおり止めるだけ(拡大縮小しない)。
- 見るだけの紙面(編集していないページ)はこれまでどおり pointer-events を切っているので、その上の操作は容器が受ける。
