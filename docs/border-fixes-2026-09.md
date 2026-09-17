# 線(border)の欄の直し(2026-09-17)

利用者の報告から 3 件(3 は 2 を直す途中で見つけたもの)。構成ラフの instance のページで、左に線を引いた要素(`border-l-2 border-wf-ink`)を編集していて起きた。

## 1. スタイルを「なし」にしても紙面が変わらない

- 原因: `borderStyle` は `border-none` クラスだけを付け、インラインを書いていなかった。構成ラフの殻の紙面の CSS は
  Vite の `@source` 走査で**ファイルに書かれたクラスの分しか作られない**ので、付けたばかりの `border-none` にはルールが無い。
  右パネルは紙面の computed を読み直すので、「なし」を選んでも preflight の `solid` に戻って見えた
- 直し: `tailwind-utils.ts` の `LAYOUT_CRITICAL_PROPERTIES` に `borderStyle` を足し、インラインも書く

## 2. 線色・線幅を変えると、左の線や色・破線のクラスまで消える

- 原因: `TAILWIND_CONFLICT_GROUPS` の `borderWidth` / `borderColor` が接頭辞 `border-` で、太さ・色・スタイル・表のクラスを区別せず全部消していた。
  線色を白にすると `border-l-2` が消えて線が見えなくなり(instance の 9 要素はこれで `border-[#ffffff] border-none` になった)、
  線幅を変えると `border-wf-ink` や `border-dashed` が消えた。表の `border-collapse` / `border-spacing-*` も線色の変更で消えていた
- 直し: `removeConflictingClasses` で、線の太さ・色・スタイルは同じ種類のクラスだけを消す。クラスの形で見分ける
  - スタイル: `border-{solid,dashed,dotted,double,hidden,none}`
  - 表: `border-collapse` / `border-separate` / `border-spacing*`
  - 太さ: `border` / `border-2` / `border-l` / `border-l-2` / `border-[2px]` / `border-[min(2px,1vw)]` /
    `border-[length:var(--w)]` / `border-(length:--w)`(辺 `t r b l x y s e` と `bs` `be`)。
    太さのキーワードは `border-[thin]` `border-[medium]` `border-[thick]` の厳密一致(`border-[mediumblue]` は色)
  - 色: 上のどれでもない `border-*`(`border-wf-ink`・`border-l-wf-ink`・`border-[#fff]`・`border-[var(--x)]`・`border-wf-ink/50`)。テーマの色名を名簿で持たない
  - `!` 付き(`border-2!` / `!border-2` / `border-dashed!`)は、外して同じ種類として消す。
    残すと、新しい太さ・スタイルが `!important` に負けて紙面が変わらない(スタイルの `border-dashed!` は元から消せていなかった)
  - 辺の太さ(`borderLeftWidth` など)は、その辺の太さのクラスだけを消す(`border-2` や `border-l-wf-ink` は残す)
  - Tailwind 4 の出力に合わせた。tailwind-merge は `border-[thin]` を色とみなすので、線色を変えると twMerge の側で消える(こちらでは消さない)
- 線幅もインラインを残す(`LAYOUT_CRITICAL_PROPERTIES` に `borderWidth` と各辺)。`border-0` / `border-l-0` は殻のビルド済み CSS に無かった

## 3. 片側だけの線を、右パネル・リボンが「線なし」「四辺の枠」として扱っていた

- 原因: 右パネルは computed の `border-width` を `parseFloat` していたので、左だけ 2px の線は「0px」。線幅を変えると
  `border-[4px]` で四辺の枠になった。リボンの「枠線」は上の辺だけを見て「線が無い」と判定し、色を選ぶだけで四辺に 2px を足していた
- 直し: `utils/border-sides.ts`
  - `summarizeBorder`: 線が見えている辺(太さ > 0 でスタイルが none / hidden でない)が 1〜3 辺なら、最初の辺の太さ・スタイル・色と、辺の一覧を返す。
    四辺とも・線なしは今までどおり省略形の値
  - `declaredBorderSides`: 線が**見えていない**とき(線幅 0・スタイル「なし」・リボンの「枠線なし」のあと)は、要素自身の指定から辺を読む。
    インラインの辺ごとの線幅と、辺の太さのクラス(`border-x-2` など。`s` / `e` は左右、`bs` / `be` は上下として扱う)を見る。
    四辺まとめての太さ(`border` / `border-2`。`border-0` は除く)やインラインの `border-width` があれば四辺とみなす。
    太さ 0 のクラス(`border-b-0`。親の線を消すための指定)は辺として数えず、`border-x-2 border-l-0` の左のように 0 にされた辺は外す。
    これが無いと、線を消したあとに太さを入れ直すと四辺の枠になっていた
  - `borderWidthStyles`: 辺の一覧があれば、線幅の変更を `borderLeftWidth` などその辺だけにする
  - `extractElementInfo` が `borderSides` を右パネルへ渡す(`rawBorderWidth` もその辺のインラインの値)。右パネル・`BorderSection`・リボンの `ensureBorder` がそれを使う
- 線色の変更で、スタイルは線が無いときだけ実線にする(今までは今のスタイルを毎回書き直していて、片側だけの線では `none none none solid` がインラインに入った)
- リボンの `PAINT_PROPS` に辺ごとの `border{Top,Right,Bottom,Left}{Width,Style,Color}` を全部足した。
  上の辺だけが入っていたため、効果の枠(`data-gg-fx-host`)に包まれた図形では、上の辺を中身から・他の辺を枠から読んでいた
- リボンの「枠線」は、線が無いときに立てる 2px も、辺が分かっていればその辺だけに当てる

## 確かめたこと

### 実エディタ(パッケージを作って殻のコピーに入れた)

`npm pack` → 構成ラフ(実案件の複製、共同編集を外して別ポート)と提案書デッキ(実案件の複製、別ポート)に `npm install`。
headless Chrome で、実際にクリック・入力して右パネルとリボンを操作した。**元の案件のファイルは触っていない**(複製だけ。前後で比較して確認)。

- 構成ラフの右パネル 19 / 19
  - 左に線のある段落: 選ぶと欄が「2 / 実線 / wf ink」。線幅 0 → 線が消える → 続けて 3 で**左だけ**に戻る。
    スタイル「なし」→ 線幅 5 で左だけ実線 5px。線色を変数 `wf-red` にして左 5px の赤
  - ⌘S で保存 → ページファイルに `class="pl-6 text-lg leading-loose border-l-[5px] border-solid"` と
    `style="border-left-width: 5px; border-style: solid; border-color: var(--color-wf-red)"`。読み直しても左 5px の赤で、欄も「5 / 実線 / wf red」
  - 上だけに線のある親: 線色・線幅を変えても上だけのまま(`border-t` が残る)
  - 四辺の枠(`border border-wf-line`): 線幅 3 で四辺 3px、色クラスは残る。線色 `#0055ff` で四辺 3px の青
  - 複数選択(左の線 2 つ): 線幅 4 で両方とも左だけ 4px。⌘Z で両方とも `border-l-2` に戻る
- 提案書デッキのリボン(図形の書式 → 枠線) 9 / 9(0.8.0 でも同じ)
  - 左 5px の線: 太さ 2 → 左だけ 2px で色は元のまま。色 赤 → 左 2px の赤(四辺に枠を足さない)。種類 破線 → 左だけ破線
  - 枠線なし → 線が消える → 太さ 3 で**左だけ**実線 3px に戻る。色 緑 → 左 3px の緑
  - 保存 → 上書き置き場(`src/slides-html/Slide013.html`)に `style="border-left-width: 3px; …"`。元に戻す ×6 で左 5px の墨に戻る
  - 透明な左 5px の線に色を選ぶと、太さを足さずに左 5px の色だけが変わる
  - 紙面をクリックして選んだ実際の要素で、四辺の枠・下だけの線でも辺が増えないことを確認した

### 部品ごと

- クラスの消し方(`tailwind-utils.ts` / `tailwind-mappings.ts` を TypeScript のまま変換し、スタブ要素に `applyTailwindStyles` を当てる): 変更後 19 / 19、変更前 5 / 18。
  レビューで足した版(`unit-review.cjs`)は 21 / 22(残り 1 件は `border-[thin]` で、tailwind-merge 側が消すもの)
- 紙面の見た目(構成ラフの殻のビルド済み CSS を当てた headless Chrome で、右パネル・リボンの読み書きの手順を変更前と変更後で比べる): 変更前 6 / 18、変更後 18 / 18。
  効果の枠に包まれた切り抜き図形(スライドの図形)も含む
- `npx tsc --noEmit` が通る

### 別のエージェントによる敵対的レビュー

差分を読ませて指摘を出させ、指摘ごとに再現させた(報告は `claudedocs` ではなくスクラッチパッド)。重大 0、中 2(どちらもこの版で修正済み)、軽微 2:

- 中: 効果の枠に包まれた図形で、上の辺と他の辺を別の要素から読んでいた → `PAINT_PROPS` に辺ごとを全部足した
- 中: 線が見えなくなると辺の情報が消え、次の操作で四辺の枠に戻る(線幅欄の矢印キー・スタイル「なし」・リボンの「枠線なし」)→ `declaredBorderSides`
- 軽微: `border-2!` などの important 付きを見分けられず、太さを変えても紙面が変わらない → `!` を外して判定・削除
- 軽微: `border-[min(2px,1vw)]` / `border-bs-2` / `border-[thin]` を色とみなして消していた → 太さの値と辺の名前を足した

直した版にもう一度レビューをかけて、さらに 4 件(重大・中なし):

- 軽微: `border-[mediumblue]` などの色を太さと誤判定していた(`thin|medium|thick` の前方一致)→ キーワードは厳密一致にした
- 軽微: 線を消したあとの辺の判定に `border-s-*` / `border-bs-*` が入っていなかった → 左右・上下として扱う
- 軽微: `border-b-0` だけを持つ要素(親の線を消す指定)で、線幅を入れると下だけに線が出ていた → 太さ 0 のクラスは辺として数えない
- 未確認として残したもの: 表(`border-collapse`)のセルと `display: contents` の要素で、computed の辺の太さが実際と食い違う可能性(下の穴に書いた)

## 分かっている穴

- 複数選択では、辺の判定は主に選ばれている要素で行い、同じ指定を全部の要素に当てる(左の線 2 つは確認済み。左の線と四辺の枠を一緒に選ぶと、四辺の枠の側は左だけが変わる)
- `border-x-2 border-l-0` のように、辺のクラスが重なって片方が 0 のときは、線が見えていない状態での辺の判定が `["right","left"]` になる(左は 0)。
  線が見えていれば computed から正しく読む
- `border-b md:border-b-0` のように画面幅で消える線は、見えていない幅で線幅を入れると、インラインなのでどの幅でも線が付く
- `border-[thin]` は tailwind-merge が色とみなすので、線色を変えると消える(Tailwind 自身は太さとして扱う)
- 表(`border-collapse: collapse`)のセルと `display: contents` の要素で、辺の判定が実際と食い違う可能性がある(レビューの指摘。Chrome で確かめていない)。
  食い違っても、線の指定がその辺に寄るだけでデータは壊れない
- 見えている辺が複数で太さが違う(左 4px + 上 1px など)と、線幅の変更で同じ太さにそろう。色も四辺に当てるので、辺ごとの色は 1 色になる
- スタイルの変更は四辺に当たる(太さが 0 の辺は見えないので、見た目は線のある辺だけが変わる)
- 線幅・スタイルはクラスに加えてインラインも書くので、ページファイルに `style` が増える
- instance の `recruit/about/message/index.html` の 9 要素(`border-[#ffffff] border-none` になったもの)は戻していない
