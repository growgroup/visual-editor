# 線(border)の欄の直し(2026-09-17)

利用者の報告から 2 件。構成ラフの instance のページで、左に線を引いた要素(`border-l-2 border-wf-ink`)を編集していて起きた。

## 1. スタイルを「なし」にしても紙面が変わらない

- 原因: `borderStyle` は `border-none` クラスだけを付け、インラインを書いていなかった。構成ラフの殻の紙面の CSS は
  Vite の `@source` 走査で**ファイルに書かれたクラスの分しか作られない**ので、付けたばかりの `border-none` にはルールが無い。
  右パネルは紙面の computed を読み直すので、「なし」を選んでも preflight の `solid` に戻って見えた
- 直し: `tailwind-utils.ts` の `LAYOUT_CRITICAL_PROPERTIES` に `borderStyle` を足し、インラインも書く

## 2. 線色・線幅を変えると、左の線や色・破線のクラスまで消える

- 原因: `TAILWIND_CONFLICT_GROUPS` の `borderWidth` / `borderColor` が接頭辞 `border-` で、太さ・色・スタイル・表のクラスを区別せず全部消していた。
  線色を白にすると `border-l-2` が消えて線が見えなくなり(instance の 9 要素はこれで `border-[#ffffff] border-none` になった)、
  線幅を変えると `border-wf-ink` や `border-dashed` が消えた。表の `border-collapse` / `border-spacing-*` も線色の変更で消えていた
- 直し: `removeConflictingClasses` で、線の太さ・色は同じ種類のクラスだけを消す。見分け方は tailwind-merge と同じ
  - スタイル: `border-{solid,dashed,dotted,double,hidden,none}`
  - 表: `border-collapse` / `border-separate` / `border-spacing*`
  - 太さ: `border` / `border-2` / `border-l` / `border-l-2` / `border-[2px]` / `border-[length:var(--w)]` / `border-(length:--w)`(辺 `t r b l x y s e`)
  - 色: 上のどれでもない `border-*`(`border-wf-ink`・`border-l-wf-ink`・`border-[#fff]`・`border-[var(--x)]`・`border-wf-ink/50`)。テーマの色名を名簿で持たない
  - 辺の太さ(`borderLeftWidth` など)は、その辺の太さのクラスだけを消す(`border-2` や `border-l-wf-ink` は残す)
- 線幅もインラインを残す(`LAYOUT_CRITICAL_PROPERTIES` に `borderWidth` と各辺)。`border-0` / `border-l-0` は殻のビルド済み CSS に無かった

## 3. 片側だけの線を、右パネル・リボンが「線なし」「四辺の枠」として扱っていた

- 原因: 右パネルは computed の `border-width` を `parseFloat` していたので、左だけ 2px の線は「0px」。線幅を変えると
  `border-[4px]` で四辺の枠になった。リボンの「枠線」は上の辺だけを見て「線が無い」と判定し、色を選ぶだけで四辺に 2px を足していた
- 直し: `utils/border-sides.ts`
  - `summarizeBorder`: 線が見えている辺(太さ > 0 でスタイルが none / hidden でない)が 1〜3 辺なら、最初の辺の太さ・スタイル・色と、辺の一覧を返す。
    四辺とも・線なしは今までどおり省略形の値
  - `borderWidthStyles`: 辺の一覧があれば、線幅の変更を `borderLeftWidth` などその辺だけにする
  - `extractElementInfo` が `borderSides` を右パネルへ渡す(`rawBorderWidth` もその辺のインラインの値)。右パネル・`BorderSection`・リボンの `ensureBorder` がそれを使う
- 線色の変更で、スタイルは線が無いときだけ実線にする(今までは今のスタイルを毎回書き直していて、片側だけの線では `none none none solid` がインラインに入った)

## 確かめたこと

- クラスの消し方(`tailwind-utils.ts` / `tailwind-mappings.ts` を TypeScript のまま変換し、スタブ要素に `applyTailwindStyles` を当てる): 変更後 19 / 19、変更前 5 / 18
  (変更前の実行のあとで C4 を足した)。
  左の線の線色・線幅、変数の色、`border-l-wf-ink`、`border-x-2`、表、`border-wf-ink/50`、任意値の色 + 左の任意値の太さ、`border-t`、
  枠 + 左だけ太い、`hover:border-2`、線色を空にする、`border-[length:var(--w)]`、破線の枠の線幅
- 紙面の見た目: 構成ラフの殻のビルド済み CSS(instance の `dist/assets`)を当てた headless Chrome で、右パネルとリボンの読み書きの手順を
  変更前(このブランチの 1 つ前のコミット)と変更後のコードに通して、各辺の computed を比べた。変更前 4 / 11、変更後 11 / 11
  - 左の線の値を読む(変更前は線幅 0、変更後は 2・実線・`["left"]`)
  - 左の線の線色を白に(変更前は線が消える、変更後は左 2px の白)
  - 左の線の線幅 4px(変更前は四辺の枠、変更後は左だけ 4px で色も残る)/ 線幅 0(どちらも線が消える)
  - 線色を白 → 線幅 3px(変更後は左だけ 3px の白)/ スタイルなし → 実線(どちらも左 2px に戻る)
  - 上の線の線色(変更前は線が消える)/ 四辺の枠の線幅 3px(どちらも四辺、変更後は `border-wf-ink` が残る)
  - リボン: 左の線の枠線の色・太さ(変更前は四辺の枠)/ 線の無い要素に枠線の色(どちらも今までどおり 2px の枠が立つ)
- `npx tsc --noEmit` が通る

## 分かっている穴

- エディタに組み込んだ状態(構成ラフ・デッキの殻に tgz を入れる)では確かめていない。紙面の確認は、右パネル・リボンの手順を検証用に写したもので、React の部品は通していない
- 複数選択では、辺の判定は主に選ばれている要素で行い、同じ指定を全部の要素に当てる
- 見えている辺が複数で太さが違う(左 4px + 上 1px など)と、線幅の変更で同じ太さにそろう。色も四辺に当てるので、辺ごとの色は 1 色になる
- スタイルの変更は四辺に当たる(太さが 0 の辺は見えないので、見た目は線のある辺だけが変わる)
- 片側だけの線を線幅 0 にすると辺の情報が無くなり、次に線幅を入れると四辺の枠になる
- 線幅・スタイルはクラスに加えてインラインも書くので、ページファイルに `style` が増える
- instance の `recruit/about/message/index.html` の 9 要素(`border-[#ffffff] border-none` になったもの)は戻していない
