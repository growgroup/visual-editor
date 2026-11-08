# キャンバスの操作を Figma にそろえる — 2026-11

提案書のスライド(1920×1080 の HTML、150 枚のデッキ)を触る人が、Figma と同じ手の動きで編集できるようにする。
既にある操作(スマートガイド・範囲選択・Alt の距離表示・右クリック・整列パネル・⌘D・Shift＋クリック・⌘クリック・
V/H/K/C・⌘0/1/2・undo/redo)は作り直さず、Figma と 1 つずつ比べて、違う・無いものだけを足した。

## 出典

- 公式ヘルプ(2026-11-09 に取得): 
  [Select layers and objects](https://help.figma.com/hc/en-us/articles/360040449873)、
  [Adjust alignment, rotation, position, and dimensions](https://help.figma.com/hc/en-us/articles/360039956914)、
  [Lock and unlock layers](https://help.figma.com/hc/en-us/articles/360041596573)、
  [Toggle visibility to hide layers](https://help.figma.com/hc/en-us/articles/360041112614)、
  [Set small and big nudge values](https://help.figma.com/hc/en-us/articles/4404575206295)、
  [Copy and paste properties between layers](https://help.figma.com/hc/en-us/articles/4412765442967)、
  [Copy and paste objects](https://help.figma.com/hc/en-us/articles/4409078832791)、
  [Explore text properties](https://help.figma.com/hc/en-us/articles/360039956634)(第2弾で追加)、
  [Rename layers](https://help.figma.com/hc/en-us/articles/360039958934)・
  [View layer outlines](https://help.figma.com/hc/en-us/articles/5724448965527)・
  [Hide or minimize the UI](https://help.figma.com/hc/en-us/articles/41414918021271)・
  [Add guides to the canvas or frames](https://help.figma.com/hc/en-us/articles/360040449713)(第4弾で追加)
- 表の「出典」が **記憶** のものは、公式ヘルプの本文で確かめられなかった(記憶にもとづく・未確認)。

## 比較表

前 = この作業の前(feat/pptx-feel の 2026-11-09 時点)。今 = この作業の後。

### 選択の階層

| 項目 | Figma の挙動(出典) | 前 | 今 |
|---|---|---|---|
| クリック | 親(最上位の塊)を選ぶ(Select layers) | 同じ | 同じ |
| ダブルクリック | 1 段内側へ(Select layers) | 同じ(枠の大きさが変わる段まで潜る) | 同じ |
| Enter | 子を選ぶ(Select layers: Select Child) | **無い** | 子をすべて選ぶ。文字を直に持つ要素(段落・見出し)なら文字の編集に入る |
| Shift+Enter | 親を選ぶ(Select layers: Select Parent) | **無い** | 親を選ぶ。複数選択なら各要素の親をまとめて |
| Esc | 選択を外す(Select layers)。入れ子では親へ(記憶) | 単独選択なら親へ、複数選択は解除 | 複数選択でも親が 1 つにそろうなら親へ(Enter→Esc で元に戻れる)。親は「編集できる最も近い祖先」にした(以前は ID の無い包みを選ぶことがあった) |
| Tab / Shift+Tab | 兄弟を巡る(Select layers) | 同じ | 同じ |
| ⌘A | すべて選択(Select layers) | 同じ階層をすべて | 同じ |
| ⌘クリック | 深い選択(Select layers) | 同じ | 同じ |
| ホバーの輪郭 | 青い輪郭(Select layers: Highlight on hover) | 同じ(青の輪郭・文字は青い下線) | 同じ |
| ロック中の要素 | 紙面のクリックで選べない。レイヤーパネルからは選べる(Lock and unlock) | **ロックが無い** | ⌘⇧L。紙面のクリック・ドラッグ・範囲選択は下の要素へ素通り。Tab・レイヤーパネルからは選べる |

### 移動

| 項目 | Figma の挙動(出典) | 前 | 今 |
|---|---|---|---|
| 矢印 / Shift+矢印 | 1 / 10(Set small and big nudge values) | 同じ | 同じ |
| ドラッグ中の Shift | 縦横に固定(記憶) | 同じ(毎フレーム判定) | 同じ |
| Alt(⌥)ドラッグ | 複製して動かす(記憶) | **無い**(距離の表示だけ) | 元の位置に複製を残して動かす。途中で Alt を離すと複製は消える。Esc で取り消すと複製も消える。⌘Z 1 回で複製と移動が両方戻る |
| スマートガイド | 端・中央に吸着して赤い線(Adjust alignment: Snap to objects) | 同じ(画面上 4px で吸着) | 同じ |
| 等間隔 | 兄弟と同じ間隔に吸着し、ピンクの線と数値(記憶) | **無い**(Alt を押せば赤の距離は出る) | 追加。同じ列(直交方向に重なる兄弟)で「前後の中間」「前の 2 つと同じ間隔」「後ろの 2 つと同じ間隔」に画面上 4px で吸着し、隙間ごとにピンクの線と数値を出す。端・中央の整列と同じ位置なら赤の線も一緒に出す |
| ドラッグ開始のしきい値 | 数 px(記憶) | 2px | 同じ |
| ドラッグ中の X, Y | 位置を出す(記憶) | 同じ | 同じ |
| 小さい要素を選んだ状態で掴む | 掴める | **角丸ハンドルが中央を覆って掴めない**(40×28px の矢印で実測) | 短い辺が画面上 56px 未満の要素には角丸ハンドルを出さない |

### リサイズ

| 項目 | Figma の挙動(出典) | 前 | 今 |
|---|---|---|---|
| Shift | 縦横比を固定(Adjust alignment) | 同じ | 同じ |
| Alt | 中心から(記憶) | 同じ | 同じ |
| 辺を掴む | 1 軸だけ | 同じ(辺に 8px の当たり) | 同じ |
| W×H のラベル | 選択枠の下(記憶) | 同じ | 同じ |
| ⌘矢印 / ⌘⇧矢印 | 1 / 10 で大きさ(記憶) | 同じ | 同じ |

### 重なり順

| 項目 | Figma の挙動(出典) | 前 | 今 |
|---|---|---|---|
| ⌘] / ⌘[ | 前面へ / 背面へ 1 つ(Adjust alignment) | 同じ | 同じ |
| 最前面 / 最背面 | Mac ⌥⌘] / ⌥⌘[、Windows Ctrl+Shift+] / [(Adjust alignment) | ⌘⇧] / ⌘⇧[ だけ | ⌥⌘] / ⌥⌘[ を追加。⌘⇧] / ⌘⇧[(PowerPoint の Mac と同じ)も残した |

### 整列

| 項目 | Figma の挙動(出典) | 前 | 今 |
|---|---|---|---|
| ⌥A / ⌥D / ⌥W / ⌥S | 左 / 右 / 上 / 下(Adjust alignment) | **無い**(パネルのボタンだけ) | 追加 |
| ⌥H / ⌥V | 左右中央 / 上下中央(Adjust alignment) | **無い** | 追加 |
| 等間隔 | Mac ⌃⌥H / ⌃⌥V、Windows Alt+Shift+H / V(記憶) | **無い** | ⇧⌥H / ⇧⌥V を追加(3 つ以上)。⌃⌥H も効く。⌃⌥V は Windows の「スタイルをペースト」(Ctrl+Alt+V)と同じキーなので割り当てない |
| 1 つだけ選んだときの基準 | 親フレーム(Adjust alignment) | — | **紙面(1920×1080)**。リボンの整列と同じ `utils/align-elements.ts` を使うため。最上位の要素では親=紙面なので同じ |

### その他

| 項目 | Figma の挙動(出典) | 前 | 今 |
|---|---|---|---|
| ⌘G / ⌘⇧G | グループ化 / 解除(記憶) | 同じ | 同じ |
| ⌘⇧H | 隠す(Toggle visibility) | **無い**(レイヤーパネルの目だけ) | 追加。書き方はレイヤーパネルの目と同じ(visibility:hidden + opacity:0)。隠した要素は範囲選択で拾わない |
| ⌘⇧L | ロック(Lock and unlock) | **無い** | 追加(`data-locked="true"`。保存される) |
| ⌥⌘C / ⌥⌘V | 書式のコピー / 貼り付け(Copy and paste properties) | 同じ | 同じ |
| 数字 1〜0 | 不透明度 10〜100%。2 つ素早く続けると 2 桁(記憶。公式ヘルプの本文では見つからなかった) | **無い** | 追加(1=10% … 9=90%、0=100%)。400ms 以内に 2 つ続けると 2 桁(4→5 で 45%、0→5 で 5%、0→0 で 0%)。(第3弾)2 打目は 1 打目の履歴を置き換えるので ⌘Z 1 回で押す前に戻る |
| Enter で文字の編集 | テキストレイヤーで Enter(記憶) | **無い**(ダブルクリックだけ) | 追加。文字はすべて選んだ状態で入る(ダブルクリックと同じ) |
| Esc で編集を抜ける | 選択は残る(記憶) | 同じ | 同じ |
| ⌘B / ⌘I / ⌘U | 文字を選ばずに押すとレイヤー全体(記憶) | **無い**(編集中のブラウザ既定だけ) | 要素を選んだ状態で要素全体の太字 / 斜体 / 下線を切り替え。複数なら「全部 ON なら OFF、それ以外は ON」 |
| Delete / Backspace | 削除 | 同じ | 同じ |
| ⌘C / ⌘X / ⌘V / ⌘⇧V | 貼り付けは元の枠の中と同じ x / y。フレームを選んでいればその中へ(入りきらない軸は中央)。⌘⇧V はその場に貼る(Copy and paste objects) | 右下へ 10px ずつずれる。枠を選んでも中に入らない | (第3弾)Figma に合わせた。ずらさない(同じスライドで元の真上に重なっても)。器(位置指定のある箱で文字を直に持たない要素。p・見出し・画像・svg・表などは器にしない)を選んでいればその中へ入れ、入りきる軸は元の x / y、入りきらない軸は中央。器でない要素を選んでいればその親へ(1 つ前面)。コピー元そのものを選んでいるときは兄弟として。別のスライドへも同じ座標。⌘⇧V を追加(OS のクリップボードを直接読む。読めなければ内部のクリップボード)。貼った要素の中の ID も作り直す(前は中の要素が元と同じ ID のままだった) |
| ⌘⇧C | Copy as PNG(Copy and paste objects) | Figma 形式でコピー | 同じ(変えていない。差として残す) |
| ⌘D | 元の真上に複製(最上位フレームだけ右へ)。⌥ドラッグで複製したあと ⌘D を続けると同じ距離で複製を続ける(Copy and paste objects) | 右下へ 20px ずらして複製 | 真上に複製(スライドの要素は Figma の「最上位フレーム以外」にあたる)。直前に複製した要素(⌘D でも ⌥ドラッグでも)が選ばれたままで動いていれば、そのずれを繰り返す。PowerPoint の Ctrl+D と同じ使い方 |
| ⌘⇧> / ⌘⇧< | 文字の大きさを上げる / 下げる(Explore text properties。本文はキーだけで刻みは書いていない。刻み 1 は記憶) | **無い** | 追加。選んだ要素の中で文字を直に持つ要素それぞれを 1px ずつ(見出しと本文の差は保つ)。複数選択でも ⌘Z 1 回で戻る。行の高さ(leading-*)は残す |
| ロックの解除 | レイヤーパネルの鍵(Lock and unlock) | **無い** | レイヤーパネルの行に鍵を出す。ロック中は常に、それ以外は行にマウスを乗せたとき。押すとロック / 解除(⌘Z で戻る)。(第3弾)親がロック中の子の行には薄い鍵(押せない) |
| ロック中の矢印キー | 動かない(記憶) | 動いた | (第3弾)矢印キーの移動・⌘矢印の大きさ変更とも、ロック中(本人か祖先)は何もしない |
| 隠した印 | レイヤーパネルの目(Toggle visibility) | マウスを乗せたときだけ | 隠しているあいだは目の印を常に出す |

| 回転 | 角の少し外側をドラッグ。Shift で 15° 刻み(Adjust alignment, rotation, position, and dimensions) | 同じ(4 隅の外に透明の回転域、右上に ⟳ の印) | 同じ(変えていない。実機で 15° 刻みを確かめた) |

### 見た目

| 項目 | Figma(出典) | 今 |
|---|---|---|
| 選択枠 | 青 #0D99FF(記憶) | #0d99ff・画面上 2px(box-shadow)。Figma は 1px に見える(記憶)。変えていない |
| ハンドル | 白い四角に青い縁(記憶) | 白 8px + 青 1px、当たり 12px |
| 部品(コンポーネント) | 紫 | 紫 #7b61ff |
| 寸法ラベル | 枠の下に W×H(記憶) | 同じ(ドラッグ中は X, Y) |

## 変えたこと(ファイル)

- `src/types/editor.ts`: アクションとキーを追加(Enter・Shift+Enter・⌥A 等・⇧⌥H/V・⌃⌥H・⌘⇧H・⌘⇧L・1〜0・⌘B/I/U・⌥⌘]/[)
- `src/hooks/useEditorShortcuts.ts`: IME の変換中(`isComposing` / `keyCode 229`)は何も奪わない。Enter と数字はキャンバスにフォーカスがあるときだけ(`CANVAS_ONLY`)
- `src/editor/hooks/useKeyboardShortcuts.ts`: 実処理を `useCanvasShortcutActions()` にまとめた。`editableChildrenOf` / `editableParentOf`
- `src/editor/FrontendVisualEditor.tsx`: 上のフックを `shortcutCallbacks` に展開。右クリックメニューに表示・ロックを渡す。Esc の「1 段上へ」を `editableParentOf` に置き換え(紙面いっぱいのルートは親にしない)
- `src/editor/hooks/useDragResize.ts`: Alt ドラッグの複製(`createAltDuplicates`)。等間隔の線を渡す
- `src/editor/utils/smart-guides.ts`: 等間隔の吸着(`snapToSpacing`)とピンクの線
- `src/editor/hooks/useMarqueeSelection.ts`: ロック中・非表示を範囲選択で拾わない
- `src/editor/constants.ts`: ロック中は `pointer-events:none`、ロック中の選択枠はハンドルを隠す
- `src/editor/utils/dom-utils.ts`: 小さい要素では角丸ハンドルを出さない。ロック中の要素の選択枠に `selection-locked`
- `src/editor/components/EditorFooter.tsx`: ショートカット一覧と下の帯の案内
- (第2弾)`src/editor/components/EditorLayerPanel.tsx` / `LayerTreeItem.tsx`: 鍵のボタン(`isLocked` / `onToggleLock`)、隠した行の目を常に出す
- (第3弾)`useElementActions.ts`: `pasteSerializedElements` を Figma の置き方に(`isPasteContainer`、`SerializedElement.box`)。`pasteInPlace`(⌘⇧V)。`moveElement` / `resizeElements` がロック中を除く(`blocked: 'locked'`)
- (第3弾)`src/editor/utils/history-timing.ts`(新規): 履歴がまとめる間隔(400ms)。`EditorHistoryContext.tsx` と不透明度の 2 桁で共有
- (第3弾)`FrontendVisualEditor.tsx`: `pasteInPlace` を受け取り、`shortcutCallbacks` に 1 行
- (第2弾)`src/editor/utils/html-utils.ts`: 保存時に `data-layer-hover` を外す。`src/editor/contexts/EditorHistoryContext.tsx`: 履歴にも焼き付けない(⌘Z で強調が戻らないように)
- (第2弾)`src/editor/utils/smart-duplicate.ts`(新規): ⌘D の「直前のずれ」を覚える。`useElementActions.ts` の `duplicateElement` と `useDragResize.ts` の ⌥ドラッグから使う。`DUPLICATE_OFFSET`(20px)は消した
- (第2弾)`src/editor/hooks/useKeyboardShortcuts.ts`: `stepFontSize`、不透明度の 2 桁。`src/types/editor.ts` に `fontSizeUp` / `fontSizeDown`。`src/hooks/useEditorShortcuts.ts` の `keyFromCode` に Period / Comma
- `src/editor/components/EditorContextMenu.tsx`: 右クリックに「表示 / 非表示」「ロック / 解除」を追加。最前面・最背面の表示を ⌥⌘] / ⌥⌘[ に

## 確かめたこと

テストベッド(提案デッキ 3 枚目、1 枚表示、50%)を Orca の内蔵ブラウザで操作した。
Orca の `mouse` コマンドは Shift / Alt を mouse イベントに乗せない(実測: `keydown Shift` の後の mousemove の `shiftKey` は false)。
修飾キー付きのドラッグは、本物のマウスでドラッグを始めてから、iframe に `MouseEvent`(`altKey` / `shiftKey` 付き)を送って確かめた。
ダブルクリックも同じく合成の `dblclick` で送った。

- Enter: 見出しの塊 → 子 5 つ。Shift+Enter → 塊に戻る。段落で Enter → 文字の編集、文字を打って Esc → 選択は段落のまま、⌘Z で文字が戻る
- Esc: カードで Enter(子 2 つ) → Esc → カード → Esc → 選択なし
- 整列: 入れ子の 4 要素を ⌘A → ⌥D で右端がそろう(幅 420 の要素だけ left 36→334)。⌃⌥V で縦の間隔がそろう(このあと ⌃⌥V はスタイルのペーストと重なると分かり ⇧⌥V に変更。変更後は下の再確認を参照)。⌘Z 2 回で 4 つとも元の位置
- 重なり順: 段落で ⌥⌘[ → 8 つ中の 0 番目、⌥⌘] → 7 番目、⌘⇧[ → 0、⌘] → 1
- ⌘⇧H: opacity 0 / hidden ↔ 元へ。⌘⇧L: 選択枠は残りハンドルが消える(`selection-locked`)、紙面のクリックが素通り(何も選ばれない)、⌘Z で解除、また選べる
- 数字: 5 → opacity 0.5、0 → 1。⌘B / ⌘I / ⌘U が切り替わる(ホバー中の青い下線を「下線あり」と読まない)
- Alt ドラッグ: 63 要素 → 64(元の位置に `dup-` の段落)、動かした段落は新しい位置。途中で Alt を離すと 0、また押すと 1、Esc で 0 のまま元の位置。ドラッグ中は Alt の距離(赤)も出る。⌘Z 1 回で要素数も位置も元どおり
- 右クリック: 「ロック / 解除」で `data-locked` が付き、⌘Z で外れる
- ⇧⌥V(キー変更後の再確認): 入れ子の 4 要素で 2 つ目の top が 92→94 になり、⌘Z で 92 に戻る
- (第2弾)レイヤーパネル: ⌘⇧L でロックした行に鍵が出て、押すと解除、⌘Z でロックに戻る
- (第2弾)⌘⇧>: 本文 24px → 25px(行の高さは 1.5 倍のまま 37.5px)、⌘Z 1 回で 24px。⌘A で 8 要素を選んで ⌘⇧> → 文字を直に持つ要素だけが +1(28→29、30→31、22→23 など。文字を持たない包みの 16 は動かない)、⌘Z 1 回で全部戻る
- (第2弾)不透明度: 4→5 で 0.45、間をあけて 7 で 0.7、⌘Z 3 回で 1
- (第2弾)⌘D: 矢印を ⌘D → 真上(920)。⇧→ 2 回で 940 → ⌘D で 960 → ⌘D で 980。⌥ドラッグで (920,513) → (960,593) に複製したあと ⌘D → (1000,673)。どちらも ⌘Z で戻る
- (第2弾)⌘V(Playwright・クリップボード許可つき): 本文を ⌘C → ⌘V で (96,838) → (106,848)。カードを選んで ⌘V でも兄弟として (106,848)。どれも ⌘Z で 63 個に戻る
- (第2弾)レイヤーパネルの目・鍵を押すと、行に乗ったマウスの強調 `data-layer-hover` が保存 HTML に残っていた(既存の不具合。押すと保存が走るので必ず出る)。`getCleanHtml` で外すようにした
- (第3弾)⌘V(Playwright): 元を選んだまま → (96,838) に重ねて貼る。何も選ばず → (96,838)。右のカード(792×540)を選んで本文(1728 幅)を貼る → 入りきらないので中央(-468,252)。左のカードの中の人物画像(20,130・141×248)を右のカードへ → 入りきるので (20,130) のまま、親は右のカード。左のカードを丸ごとスライド 4 へ → (96,268) のまま。⌘⇧V も同じ位置に貼る。どれも ⌘Z 1 回で戻り、貼った直後に保存ファイルへ入り、⌘Z と保存で元のファイルと同じになる
- (第3弾)不透明度: 4→5 で 0.45 → ⌘Z 1 回で 1
- (第3弾)ロック: ⌘⇧L のあと → と ⇧→ を押しても left 96 のまま。外すと → で 97、⌘Z で 96。グループ(2) をロック → 中の「目指すべき姿」「グループ(1)」の行に薄い鍵
- (第2弾)回転: 左下の角の外側を引いて -10.9°、Shift で -15°、⌘Z で戻る
- 等間隔: 2 枚のカードの間の矢印を 6px ずらす → 920 に戻り、両側に「32」のピンクの線(中央の赤い線も)。入れ子の縦の 3 要素の下に続く 4 つ目を 6px ずらす → 前 2 つと同じ間隔(28)の位置 192 に吸着。どちらも Esc で元の位置
- リサイズ: 角を Alt で引くと左右に 80px ずつ広がる(中心から)。Shift で 792×540 → 872×595(比 1.467 を保つ)。⌘Z で戻る
- 保存: 操作のあと 2 秒ほどでヘッダーが「保存済み」。読み直しても変更が残っている(テストで動かした段落は手で元に戻した)

## 残った穴

- 等間隔の吸着は兄弟(同じ親の子)だけが相手。入れ子の外の要素との間隔は見ない。ピンクの数値が選択枠のパンくずと重なることがある
- 1 つだけ選んだ整列は紙面が基準(Figma は親フレーム)
- ロック中の要素は `pointer-events:none` なので、紙面で右クリックして解除できない。解除はレイヤーパネルの鍵(第2弾で追加)か、Tab で選んでから ⌘⇧L
- ロック中でも右パネルの数値では動かせる(Figma もプロパティ欄からは変えられる。記憶)。矢印キー・⌘矢印(大きさ)は第3弾で止めた
- 不透明度の 2 桁の待ち時間(400ms)は記憶にもとづく。履歴がまとめる間隔と揃えたので、2 打目は 1 打目の履歴を置き換える(⌘Z 1 回)
- ⌘⇧> / ⌘⇧< の刻みは 1px だけ(Figma の刻みは公式ヘルプに書いていない)。1920px のスライドでは大きく変えるには右パネルの数値のほうが早い
- ⌘D の「ずれの記憶」は 1 組だけ。複製した要素を選び直さずに続けたときだけ効く(別の要素を選ぶと真上に戻る)
- 部品のインスタンス(`data-component-instance`)を含む要素は Alt ドラッグで複製しない(⌘D を使う)

## 型検査

`npx tsc --noEmit` を最後に 1 回だけ実行。出た 2 件はどちらもこの作業のもの(キーの重複 `ctrl+alt+v`、`toggleTextStyle` の styles の型)で、直した。ほかの担当のファイルのエラーは無かった。直したあとの再実行はしていない(1 回だけの取り決めのため)。

第2弾の最後にもう 1 回実行し、エラー 0(第1弾の修正も含めて通った)。その後 `EditorHistoryContext.tsx` に属性を外す 3 行を足したが、再実行はしていない。

## テストデッキが勝手に読み込み直された原因(第3弾で調べた)

テストデッキの `vite.log` で、ページ全体の読み込み直し(`page reload`)が出た時刻と原因を並べた。

- **エディタ本体のソースの編集**(主因)。`PptChrome.tsx` は型と `initialPptTheme`(コンポーネントでない値)を export しているので、React Fast Refresh で差し替えられず、編集のたびに Vite がページ全体を読み込み直す。01:46:02・01:46:08 の 2 回が、第2弾で ⌘D の試験中に ⌘Z の履歴が消えた時刻と一致する(この時刻の `PptChrome.tsx` の編集は ve-perf のもの)。`EditorContext.tsx` も同じで、01:55:11 は私の編集(履歴の間隔の定数を `EditorHistoryContext.tsx` から export した)で起きた。この定数は `utils/history-timing.ts` に移し、`EditorHistoryContext.tsx` が値を export しないように戻した
- テストデッキの直下に作られる `dist-bench` / `dist-base` / `dist-p1` / `dist-p2`(計測用のビルド結果)。Vite の監視に入っていて、書き出しのたびに数百件の `page reload` と `index.css` の更新が出る。開いているページの URL とは一致しないので読み込み直しにはならないが、Tailwind の CSS 作り直しが走る。テストデッキの `vite.config.ts` の `server.watch.ignored` に `dist-*` を入れると止まる(テストデッキの設定で、エディタのコードではない)
- エディタの動作そのもの(保存の監視など)が読み込み直しを起こしている形跡は無い。直すものは無い

開発中だけの話で、本番の利用者には関係しない。

## 第4弾(2026-11-09 02:07〜)

先に Orca で今の挙動を確かめ、無いもの・違うものだけを直した。

| # | Figma | 出典 | 直す前 | 第4弾のあと |
|---|---|---|---|---|
| 1 | 何も無い所からドラッグで範囲選択 | 記憶 | 紙面の背景(要素の無い所)からのドラッグで範囲選択になっていた。要素の上から始めるとその要素が動く(Figma も同じ) | 変更なし |
| 2 | 右クリックはカーソルの下の要素を選んでからメニューを出す。項目にキーを並べる | 記憶 | 選んでいない要素を右クリックすると、その要素が選ばれてメニューが出ていた。キーのある項目はすべてキーを表示していた(AI で再生成・リンク・HTML・部品・表の項目は、割り当てたキーが無いので表示なし) | 反転 2 項目を足した(⇧H / ⇧V)。メニューは画面の高さで切れるがスクロールできる(既存) |
| 3 | ⇧H 左右反転 / ⇧V 上下反転。右クリックからも | 360039956914「Flip layers」 | 無し(PowerPoint 風の殻の画像だけにあった) | 追加。`transform` に `scaleX(-1)` / `scaleY(-1)` を付け外し。回転している要素は角度の符号を反転してから付けるので、**画面の縦横の軸で鏡写し**になる(Figma と同じ見え方)。回転のドラッグは反転を残す(既存の `setTransformFn`)。右パネルの回転欄・反転ボタンも反転を読み取った |
| 4 | ドラッグ中に吸着を一時的に切る: **Control を押す** | 360039956914「Snap to settings」 | ⌘ か Ctrl で切れていた | 変更なし(Ctrl が Figma と同じ。⌘ も残す) |
| 5 | ⌘R でレイヤー名を変える | 360039958934 | 名前を変える手段が無かった(レイヤーパネルのダブルクリックも無し) | 追加。⌘R か、レイヤーパネルの名前のダブルクリックで入力欄を出す。Enter で確定、Esc で取り消し、外をクリックで確定。名前は `data-layer-name` に保存(パネルの名前の付け方は元からこれを最優先で読む)。空にすると自動の名前に戻る。表示中の名前のまま確定しても書き込まない。ページのタブを開いていたらレイヤーのタブへ切り替える。⌘Z 1 回で戻る |
| 6 | ⌘\ で UI を隠す / 出す | 41414918021271 | 無し | 追加。上の帯・左右のパネル・発表者ノート・下の帯・道具箱を隠し、紙面だけ残す。全体表示のまま切り替えると紙面がその広さに合わせて大きくなり、戻すと元の位置・倍率に戻る。選択が無くても効く |
| 6b | アウトライン表示: **⌘⇧O**(依頼の ⌘Y は Figma の古いキー。ここでは ⌘Y がやり直しなので使わない) | 5724448965527 | 無し | 追加。紙面の塗り・画像を消して、要素の枠と文字の輪郭だけを見せる。iframe の `<html>` にクラスを付けるだけで、保存(`#artboard` の中身)にも履歴にも入らない |
| 7 | 定規からドラッグしてガイドを引く | 360040449713「Create a new guide」 | 無し。定規(`multi-page/CanvasRulers.tsx`)は目盛りを描くだけで、押してもガイドは出ない。1 枚表示には定規そのものが無い | 実装しない(報告だけ) |

### 変えたファイル(第4弾)

- `src/types/editor.ts` — `flipH` / `flipV` / `renameLayer` / `toggleUi` / `toggleOutline` とキー(`shift+h`・`shift+v`・`meta|ctrl+r`・`meta|ctrl+\`・`meta|ctrl+shift+o`)
- `src/hooks/useEditorShortcuts.ts` — `Backslash`(と JIS の `IntlYen` / `IntlRo`)を `\` として読む
- `src/editor/hooks/useKeyboardShortcuts.ts` — `toggleFlipIn`(反転の付け外し・回転の符号反転)、`RENAME_LAYER_EVENT`、`toggleEditorUi`、`toggleOutlineIn`。⌘\ と ⌘⇧O は選択が無くても返す
- `src/editor/components/LayerTreeItem.tsx` — 名前の入力欄(ダブルクリック・⌘R)。`focus({ preventScroll: true })` でパネルが横へ流れないようにした
- `src/editor/components/EditorLayerPanel.tsx` — 入力中の行の管理と、`data-layer-name` への書き込み
- `src/editor/components/shell/LeftPanel.tsx` — ⌘R でレイヤーのタブへ切り替える
- `src/editor/components/EditorContextMenu.tsx` — 左右反転 ⇧H / 上下反転 ⇧V
- `src/editor/components/EditorFooter.tsx` — ショートカット一覧に 4 行
- `src/styles/skin.css` — `.gg-ui-hidden` で殻を隠す
- `src/editor/FrontendVisualEditor.tsx`(共有)— `EditorContextMenu` に `onFlipH` / `onFlipV` を渡す 2 行だけ

### 確かめたこと(第4弾・Orca)

- 紙面の背景から右下へドラッグ → 範囲内の 2 要素が選ばれた
- 何も選んでいない状態で矢印を右クリック → 矢印が選ばれ、メニューが出た
- ⇧H → `scaleX(-1)`、⇧V → `scaleX(-1) scaleY(-1)`、もう一度 ⇧H → `scaleY(-1)`。⌘Z 3 回で元へ
- 回転ハンドルで 53.8° 回した矢印に ⇧H → `rotate(-53.8deg) scaleX(-1)`。右下向きの矢印が左下向きになった(画面の縦軸で鏡写し)。⌘Z 2 回で `transform` 無しに戻った
- 右クリックの「左右反転」→ `scaleX(-1)`、⌘Z で戻る
- ⌘R → レイヤーのタブに切り替わり、入力欄に今の名前が選ばれた状態で出た。名前を変えて Enter → `data-layer-name="矢印"`、パネルの行も変わった。⌘Z / ⌘⇧Z / ⌘Z で付く・外れるを確かめた。そのまま Enter は書き込まない。Esc は取り消し(選択は外れない)
- ⌘\ → 殻が消えて紙面だけ(80% に広がった)。もう一度 → 元の 50%・同じ位置。選択が無い状態でも効いた
- ⌘⇧O → 枠と文字の輪郭だけの表示。もう一度で戻る。保存状態は「保存済み」のまま、保存した本文も試験前と同じ
- 最後に保存した `Slide003.html` は試験前の控えと一致(`data-element-id` を除いて差分なし)

テストデッキの CSS は `dist/editor.css`(ビルド結果)を読むので、`skin.css` に足した `.gg-ui-hidden` の規則は、同じ規則を `<style>` で差し込んで確かめた。ビルドすれば効く。

### 残った穴(第4弾)

- ~~反転は要素ごとにその場で反転する~~ → 第5弾で塊として反転するようにした
- ⌘R は 1 つ目の要素だけ名前を変える。Figma の ⌘R は複数を一括で変える画面(連番・置換)を出す
- ~~何も選んでいないときの ⌘R はブラウザの読み込み直しに通す~~ → 第5弾の追加で、キャンバスにフォーカスがあるときは何もしない(読み込み直さない)ようにした
- ⌘\ の状態とアウトライン表示は覚えない。ページを切り替えるとアウトライン表示は外れる(⌘\ は残る)
- アウトライン表示では、画像は消え、線(border)も消えて枠線(outline)に置き換わる。Figma の「ベクターの輪郭」ほど細かくはない
- ~~定規からガイドは引けない(上の表の 7)~~ → 第5弾でキャンバス表示に足した
- 試験中、ve-perf の `PageFramePreview.tsx` の編集(02:14:48)の Fast Refresh で紙面が古い本文で組み直され、名前の変更が DOM から消えた(保存済みのファイルには残っていた)。読み込み直してから試験をやり直した。エディタの不具合ではなく、開発中の差し替えの都合

## 第5弾(2026-11-09 02:21〜)

| # | Figma | 出典 | 第5弾のあと |
|---|---|---|---|
| 1 | 複数選択の反転は、選択全体を 1 つの塊として鏡写しにする | 記憶 | 選択群の外接枠の中心を軸に、各要素の位置を反転し(`align-elements.ts` の `mirrorPositions`)、各要素にも `scaleX(-1)` / `scaleY(-1)` を付ける。1 回の操作なので ⌘Z 1 回で戻る |
| 2 | 定規からドラッグしてガイドを作る。定規へ戻すと消える | 360040449713「Create a new guide」「Remove guides」 | キャンバス表示に追加。上の定規から下へ → 横のガイド、左の定規から右へ → 縦のガイド。引いている間は位置(紙面の px)を出す。置いたガイドはドラッグで動かせ、定規の上へ戻して離すと消える。ガイドは要素の移動の吸着の相手になる(リサイズはもともと吸着しない) |
| 2b | ⇧R で定規の表示切替 | 記憶(公式ヘルプはメニューの View > Rulers だけで、キーは書いていない) | もともとキャンバス表示にあった(`useInfiniteCanvas.ts`)。一度キーの表にも足したら二重に切り替わって効かなくなったので、足したものは戻した。定規を隠すとガイドも隠れ、吸着もしない。ガイドそのものは残り、定規を戻すと出る |

### 変えたファイル(第5弾)

- `src/editor/utils/align-elements.ts` — `mirrorPositions` を追加。`<svg>` は `offsetLeft` などを持たず(undefined)、選択群の枠が NaN になって整列・反転で動かなかったので、画面の矩形から測る `measureByRect` を足した(整列 ⌥A などにも効く)
- `src/editor/hooks/useKeyboardShortcuts.ts` — 複数選択の反転で `mirrorPositions` を呼ぶ
- `src/editor/utils/canvas-guides.ts`(新規)— ページごとのガイドの置き場(メモリ)と、吸着が見る「編集中のページ」
- `src/editor/components/canvas-guides/CanvasGuides.tsx`(新規)— 定規の当たり・ガイドの線・引き出し中の表示
- `src/editor/components/multi-page/CanvasRulers.tsx` — `<CanvasGuides />` を置く 1 行と import(このファイルは触る前に `git diff` で ve-perf の変更が無いことを確かめた)
- `src/editor/utils/smart-guides.ts` — `collectGuideCandidates` が定規のガイドも候補に入れる

### 確かめたこと(第5弾・Orca)

- 見出し・左右のカード・矢印の 4 つを範囲選択して ⇧H → 左のカード 96→1032、右のカード 1032→96、見出し(全幅)と矢印(中央)はそのままの位置で、4 つとも `scaleX(-1)`。紙面は左右が入れ替わった鏡写しになった。⌘Z 1 回で 4 つとも元へ。保存した本文は試験前と同じ
- 上の定規から引く → 編集中のページの範囲に横のガイド(位置 540 を表示)。定規へ戻して離す → 足されない。左の定規から引く → 縦のガイド
- 既存のガイドをドラッグ → 動いた。定規の上へ戻す → 消えた(縦・横とも)
- 吸着: ガイド y=696 の近くへ矢印を落とす → top=696、ガイド x=1166 の近くへ → left=1166
- ページ 4 へ切り替える → ガイドは 0 本(ページごと)。ページ 3 へ戻す → ガイドが戻った
- 吸着の試験で動かした矢印は ⌘Z で戻したが、⌘Z は自動保存されず、ページの切り替えで動いた位置の本文が読み込まれた。保存ファイルを試験前の控えに戻して読み込み直し、一致を確かめた
- ⇧R(合成のキー入力で確かめた。Orca の `press Shift+KeyR` はキーが届かなかった)→ 定規とガイドが消える/出る

### 残った穴(第5弾)

- **ガイドは保存しない**。ページごとにメモリで持つので、読み込み直すと消える。本文(HTML)にも履歴にも入らないので ⌘Z では戻らない
- 右クリックの「ガイドを削除」・Option ドラッグでガイドを複製する(Figma にある)は無い(選んで Delete は第6弾で追加)
- ガイドは編集中のページの範囲に引く(Figma のキャンバスのガイドは全面に引く)。引いている最中だけ画面いっぱいに出る
- ガイドの線の上は紙面をクリックできない(ガイドをつかむ当たりが 7px ある)
- 1 枚表示には定規が無いので、ガイドも無い
- ~~キャンバス表示の吸着の距離は、紙面の 4px~~ → 第6弾で画面の 4px にした
- 複数選択の反転で、絶対配置でない要素(通常の並び)は位置を動かせないので、その場で反転するだけ

### CSS の作り直しと型検査(第5弾)

- `npm run build:css` で `dist/editor.css` を作り直した(`.gg-ui-hidden` の規則が入った)。テストデッキはこの CSS を読むので、差し込みなしで ⌘\ が効くことをキャンバス表示で確かめた(左パネルの幅 264→0→264)。`@import` の順番の警告(Material Symbols)は以前から出ているもので、この作業とは関係ない
- `npx tsc --noEmit -p tsconfig.json` を CSS の作り直しの後に 1 回だけ実行し、エラー 0

### 第5弾の追加: キャンバスでの ⌘R は読み込み直さない

- 何も選んでいなくても、キャンバス(紙面の iframe・body)にフォーカスがあるときの ⌘R は `preventDefault` して何もしない。⌘Z の履歴が消える事故を防ぐ。UI(ボタン・入力欄など)にフォーカスがあるときは既定どおりブラウザの読み込み直しに通す。選択があるときは、どこにフォーカスがあってもレイヤー名の入力を開く(従来どおり)
- 実装は `src/hooks/useEditorShortcuts.ts` の `SWALLOW_ON_CANVAS`(コールバックが無いときでも、キャンバス側なら既定を止めるキーの一覧)。判定はタブ移動と同じ `isCanvasEvent`
- 確かめ方: Orca のキー入力(CDP)はブラウザの ⌘R の読み込み直しを起こさないので、合成の keydown の `defaultPrevented` で見た。UI のボタンにフォーカス → false(読み込み直す)、iframe 内 → true、body → true、選択ありで UI にフォーカス → true(名前の入力が開く)

## 第6弾(2026-11-09 02:34〜)

| # | 内容 | 結果 |
|---|---|---|
| 1 | キャンバスにフォーカスがあるとき、選択が無くても ⌘R を読み込み直しに渡さない | 第5弾の追加で済んでいた(上の節) |
| 2 | キャンバス表示の吸着の距離を「画面の 4px」にする | `useDragResize.ts` の移動の吸着で、しきい値を `4 / (アートボードの倍率 × iframe が外で拡縮されている倍率)` にした。外の倍率は `iframeOuterScale`(iframe の画面上の幅 ÷ `offsetWidth`)。1 枚表示では外の倍率が 1 なので今までと同じ |
| 3 | ガイドを選んで Delete で消す | クリック(2px 以内の押し離し)で選ぶと青(#0d99ff)になる。選んだ線にフォーカスを当て、Delete / Backspace で消す。Esc か、ほかをクリック(フォーカスが外れる)で選択が外れる。ドラッグで動かしたガイドは同じ番号のまま位置だけ変わり、選ばれた状態になる |

### 確かめたこと(第6弾・Orca)

吸着(キャンバス表示)。ガイド x=1100 に対し、矢印の左端を画面上で 2px / 7px 手前に落とした(倍率は `setView` で指定):

| 倍率 | 2px 手前 | 7px 手前 |
|---|---|---|
| 100% | 1100 に吸着(素の位置 1098) | 吸着しない(1093) |
| 45% | 1100 に吸着(素の位置 1095.6。紙面で 4.4px 離れているので、直す前は吸着しなかった) | 吸着しない(1084) |
| 200% | 1100 に吸着(素の位置 1099) | 吸着しない(1096.5。紙面で 3.5px なので、直す前は吸着していた) |

1 枚表示(50% と 100%)。矢印の下端を兄弟の辺 y=808 の 2px 手前に落とす → どちらも 808 に吸着。50% で 3.5px・7px 手前、100% で 7px 手前は 808 に吸着しなかった(別の候補 800 に寄った)。

ガイドの選択と削除: 縦・横のガイドを引く → クリックで青くなりフォーカスが線へ移る → Delete で消えた。紙面の要素は消えず(要素数 79 のまま)、要素の選択もそのまま。Esc で選択が外れる。Backspace でも消えた。保存した本文は試験前と同じ。

### 残った穴(第6弾)

- ガイドの複数選択(Shift クリック)は無い。1 本ずつ
- 選んだガイドを矢印キーで動かす(Figma にある。記憶)は無い
- 等間隔の吸着の判定(`snapToSpacing`)も同じしきい値を使うので、キャンバス表示では一緒に画面の 4px になった

## レビューでの修正(2026-11-09 02:40〜)

| # | 指摘 | 直し方 | 確かめ方 |
|---|---|---|---|
| 1 | ロックが矢印キーと範囲選択にしか効かない | `src/editor/utils/lock.ts` に `isLockedEl`(本人か祖先がロック)と `withoutLocked` を置き、⌘A・Tab の巡回(`selectAllSiblingsIn` / `selectSiblingIn`)、整列・分布・反転・不透明度・⌘B/I/U・⌘⇧>(`useKeyboardShortcuts`)、ドラッグ(`getDragTargets`)、複数選択の拡大縮小(`handleMultiElementResize` のループ)から外した。選ぶことはできる(レイヤーパネルの Shift クリックも選べる)が、変わらない | Orca: ロックした要素とロックしていない要素を一緒に選び、⇧H・5・⌥D・ドラッグ・→ を押す。ロックした方だけ位置・不透明度・transform が変わらない。レイヤーパネルで範囲を Shift クリックで選んで ⌥D・3・→ も同じ。⌘A と Tab はロック中を飛ばす |
| 2 | 部品定義の `data-locked`(component-renderer.ts)とユーザーのロックが同じ属性名 | ユーザーのロックを `data-gg-locked` に改名(constants.ts の CSS・dom-utils.ts・useElementActions.ts・useMarqueeSelection.ts・useKeyboardShortcuts.ts・EditorLayerPanel.tsx)。component-renderer.ts はそのまま | `data-locked="true"` だけでは pointer-events が auto のまま、`data-gg-locked="true"` で none。`stripEditorAttrs` に通すと `data-gg-locked` は消える(部品の定義に持ち込まれない) |
| 3 | ⌘⇧V が OS に別のものがあっても内部の古い要素を貼る | 読めて印が無ければ何もしない。読めないときだけ内部へ、それも OS への書き込みが成功していたら貼らない(通常の ⌘V の `pasteFromInternalIfFresh` と同じ判断) | Playwright: 文字をコピーし直して ⌘⇧V → 増えない。要素をコピーして ⌘⇧V → 1 つ増える。読み取りを失敗させる(書き込みは成功)→ 増えない。書き込みも失敗させる → 内部から 1 つ増える |
| 4 | ⌘⇧O の輪郭表示で選択枠・寸法・ガイドまで透明になる | 対象を `#artboard *:not(:is(枠・ハンドル・寸法・#gg-smart-guides・#gg-measure-layer など)):not(:is(…) *)` に絞った | Orca のスクリーンショット: 輪郭表示のまま要素をドラッグして、選択枠・ハンドル・座標ラベル・赤い吸着ガイドが見える。離したあとも枠と「80 × 56」が見える |
| 5 | webpage でも ⌘V が器の中へ入れる | 器の中へ入れるのは「スライド(webpage でない)かつ貼る要素がすべて位置(box)を持つ」ときだけ。それ以外は従来どおり選択の直後へ | Playwright: 絶対配置の文をカードを選んで貼る → カードの中。同じ文を流し込み(position: static、box なし)にしてから貼る → カードの直後(兄弟)。webpage の画面はテストデッキに無いので、条件の分岐(`editorMode !== 'webpage'`)はコードで確認 |
| 6 | 名前の変更を Esc で取り消したあとの blur で確定する | `renameCancelledRef` を持ち、Esc で立てて onBlur で見る(入力欄が出るたびに onFocus で下ろす) | Orca: ⌘R → 文字を入れて Esc → 名前は付かない。⌘R → 文字を入れて blur → 付く、⌘Z で戻る |
| 7 | ガイドのドラッグ中に張った window のリスナーが、アンマウントやページの切り替えで残る | 外す関数を `detachRef` に持ち、useEffect の後始末とページの切り替えで外す | Orca: `addEventListener` を数える。ルーラーから引いている途中でページを切り替える → pointermove のリスナーが 1 → 0。そのあと離しても新しいページにガイドは増えない |
| 8 | 数字キーを押しっぱなしにすると 50% と 55% を行き来する | ディスパッチャー(useEditorShortcuts.ts)で、不透明度の操作は `event.repeat` を捨てる(既定の動作は止める) | Orca: repeat 付きの「5」→ 変わらない。repeat なし → 50%。続けて repeat 付きを 3 回 → 50% のまま |
| 9 | 紙面での ⌘R の扱いがショートカット一覧に無い | 一覧の「レイヤー名を変える」に「紙面にフォーカスがあるときの ⌘R は、何も選んでいなくてもページを再読み込みしない」と書いた | 文言のみ |

残ること:
- `data-gg-*` は保存時のサニタイズで落ちる(restore-flow.ts・free-layout.ts のコメント。サニタイズ本体はこのリポジトリの外)。属性名を `data-gg-locked` にしたので、ロックは元の TSX へは保存されない見込み。テストデッキの保存(`#artboard` の innerHTML)には残る。ロックを保存したいなら、サニタイズ側で `data-gg-locked` を残すか、`data-gg-` で始まらない名前にする必要がある。
- ロック中の要素への右パネル(プロパティ)からの書き換えは止めていない(property-panel/** は ve-perf の担当)。表示/非表示(⌘⇧H)とロックの切り替えはロック中にも効く(Figma と同じ)。
