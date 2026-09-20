# 台帳から挿入(2026-09)

デザインシステムの台帳にある **セクション / パーツ / ページの雛形** を、エディタの紙面に挿せるようにした。

利用側(構成ラフの殻)が台帳の部品を **静的な HTML** として渡してくる。Tailwind のクラスは付いたままで、
色はトークン名なので、紙面の CSS が解決できないものは地の色のまま出る(これは意図した姿で、
構成ラフの段階で色を決めないため)。エディタはそれを紙面に入れ、既存の保存経路でページに書く
(= 案件のファイルにコピーされる)。

## io は 3 つ(すべて任意)

```ts
/** 台帳の目録(利用側が束ねる)。無ければ「台帳から挿入」は出さない */
loadInserts?: () => Promise<EditorInsertCatalog>;
/** 1 件の HTML(断片)。dummy は見出し・リード文を赤字ダミーにする利用側の整形 */
fetchInsert?: (id: string, opts: { dummy: boolean }) => Promise<{ html: string; name?: string }>;
/** 新しいページを作る(TPL / PAG の挿入) */
createContent?: (input: { title: string; path: string; templateId?: string; parentId?: string }) => Promise<{ id: string }>;
```

```ts
type EditorInsertLevel = 'SEC' | 'MOL' | 'TPL' | 'PAG' | (string & {});
type EditorInsertItem = {
  id: string;
  name: string;
  family?: string;
  description?: string;
  level?: EditorInsertLevel;
  previewUrl?: string;
  source?: 'ledger' | 'local';
};
type EditorInsertGroup = { id: string; label: string; items: EditorInsertItem[] };
type EditorInsertCatalog = { groups: EditorInsertGroup[] };
```

`level` は `'SEC'|'MOL'|'TPL'|'PAG'|string` ではなく `(string & {})` で書いてある。
素の `string` を混ぜると共用体が `string` に潰れて補完が消えるため、受け付ける値は同じまま、
IDE に 4 つを出させている。

**役割分担**: 何が台帳にあるか・HTML をどう整形するかは利用側。エディタは
「紙面のどこに入れるか」「編集の印を付ける」「履歴に 1 段で載せる」の 3 つだけを持つ。

## 入口

ツールバーの「＋ 追加」に「台帳から挿入」。`loadInserts` が無い利用側では**項目ごと出さない**
(io の capability ベース。押すと失敗するボタンを残さないため)。
webpage / slide の両方に出し、PowerPoint 風の殻では「挿入」タブのリボンに出す。

## パネル

- 左に 分類(利用側のグループ)と 系統(`family`)の絞り込み、上に検索(名前・説明・系統の部分一致)
- 本体はカード一覧。`previewUrl` があれば iframe を縮小して見本にする
  (`loading="lazy"`、`pointer-events: none`、sandbox 無し)
- 1 件選ぶと右に大きめの見本と「挿入」。「見出し・リード文を赤字ダミーにする」は既定 ON で、
  そのまま `fetchInsert` の `opts.dummy` になる
- Esc で閉じる。開くと検索欄にフォーカスが入る

slide モードでは `level` が `TPL` / `PAG` の項目を目録から外し(グループが空になれば分類も消える)、
赤字ダミーのチェックも出さない。判定はグループの id ではなく `level` で行う(グループ id は利用側が決めるため)。

## 挿入位置

```
選択あり → 選択(またはその祖先で「器」の直下にいるもの)の直後
選択なし → 器の末尾
器 = <main> / [data-wf-body] / #artboard / body
```

器の判定は `src/editor/utils/drop-target.ts` の `isContainer` / `fallbackContainer` を
ドラッグ&ドロップと**共有**している。別々に書くと「ドロップした場所と挿入した場所が違う」
という一番たちの悪いズレ方をする。

### 基準はパネルを開いた時点の選択(既存の不具合を避けるため)

最初の実装は挿すときに選択を読み直していた。これだと **2 回目以降の挿入がほぼ必ず末尾へ飛ぶ**。
原因は台帳から挿入の側ではなく、既存の次の連鎖だった。

```
編集 → 2 秒後に自動保存 → effectiveSave が setOriginalHtml(いまの姿)
     → 「ページ切替で古い選択が残らないように」という effect が [originalHtml] で走る
     → setSelectedElement(null)
```

紙面の `.selected` の枠は残るので、利用者には選んだままに見えるのに、
状態としては選択が無い。パネルを開いて見比べている数秒のあいだに自動保存が挟まると、
選んだつもりなのに末尾へ入る。

そこで基準を **パネルを開いた時点** に固定し(`catalogAnchorRef`)、そのとき状態が空なら
紙面の `.selected` を採る(利用者が見ている選択に合わせる)。パネルは modal なので
開いている間に紙面を選び直せない = 開いた時点の選択が答えでよい。

この自動保存で選択が消える件は**台帳から挿入に限らない既存の挙動**(選んだまま 2 秒待つと、
削除やリボンの操作が効かなくなる)。範囲外なので直していない。

挿したあとは他の要素の `.selected` を外してから新しい要素に付ける。
付けっぱなしだと 2 つ選ばれているように見え、次に挿すときの基準にも前の要素が残る。

## 履歴は 1 段

挿す手順は部品のドロップ(`IFRAME_COMPONENT_DROP`)と同じ順にしてある。

1. `fetchInsert` → `<script>` と `on*` を落とす → 要素にする
2. 位置を決めて `insertBefore`
3. 編集の印(`data-editable` / `data-element-id`)を付ける(ルート + `makeChildrenEditable`)
4. `notifyIframeChange(true)` ← ここで履歴に 1 段
5. 選択状態にして、紙面をそこへ寄せる

印を 4 より先に付け終えないと、Undo で戻した HTML に印が無く、押すたびに 1 段ぶん違う紙面へ戻る。
紙面の MutationObserver は `data-editable` の付け直しとレイヤー一覧の作り直しだけで履歴に触らないので、
履歴はここ 1 回で 1 段になる。

## 挿したクラスの CSS

台帳の HTML は **Tailwind のクラスが付いたまま**来る。紙面の Tailwind ブラウザ版
(`/vendor/tailwindcss-browser.js`。利用側が配る)は、足しただけの class を知らないので、
挿したあとに `triggerTailwindRecompile`(`tailwind-utils.ts`。中身は
`window.tailwindcss.refresh()`)を **1 回だけ**呼ぶ。もともと右パネルで class を
書き換えたときに呼んでいた関数を export して使い回している。

生成した CSS は紙面の `<head>` に入るので、`#artboard` の中身(= 保存 HTML・履歴)は変わらない。
`reloadStyles` のような io は足していない。色はトークン名なので、
利用側の CSS が解決できないものは地の色のまま出る(構成ラフでは意図した姿)。

## サニタイズは `<script>` と `on*` だけ

貼り付け用の `paste-sanitizer.ts`(DOMPurify)は**通していない**。あちらは許可する属性を
列挙する作りで、`data-ds` / `data-ds-v` / `data-slot` のような台帳側の目印が黙って消える。
挿入元は利用側が自分で作った HTML(外から来た文字列ではない)なので、
「紙面で script を動かさない」という既存の方針だけを守る。

利用側が `<section class="wf-ds" data-ds="…" data-ds-v="…">` で包んで渡す前提で、
**エディタは包み直さない**。断片のルートが 2 つ以上あるときは先頭だけを使う
(器を勝手に足すと、保存 HTML に出どころ不明の `<div>` が増えるため)。

## ページを作る(TPL / PAG)

1. 「ページを作る」→ タイトルとパス(`/` 始まりの英小文字・数字・ハイフン・スラッシュ)
2. `createContent({ title, path, templateId })`
3. 戻りの id を覚えて、利用側が `contentList` を読み直すのを待つ
4. 現れたら、リンク移動(`useLinkNavigation`)と同じ経路でそのページを編集中にする
   - キャンバス … `focusPage` + `activatePage`
   - 1 ページ表示 … `onContentChange`

   どちらも未保存の変更を保存してから移る(保存はこの経路が既に持っている。自前で呼ばない)

**待ち方**: キャンバスのフレームは `MultiPageCanvasProvider`(エディタ本体の親)の effect で
`contentList` から組み直される。親の effect は子より後に走るので、`contentList` が届いた瞬間には
まだフレームが無く `activatePage` は false を返す。「一覧に出たか」と「フレームが組めたか」の
2 つを待つ必要があるので、200ms ごとに試し直し、15 秒で諦めて知らせる(黙って待ち続けない)。

`useLinkNavigation` の視点移動を `useRevealElement` として切り出し、アンカー移動と
挿入後の移動で同じ計算を使うようにした。キャンバスでは紙面(iframe)が伸びきっていて
スクロールしないので、`scrollIntoView` では何も動かない。

## 確かめたこと

playground に `?mode=inserts` を足し(`playground/inserts-samples.ts` が目録・HTML・
`createContent` のメモリ実装)、headless Chrome で次を見た。

| 見たこと | 結果 |
|---|---|
| `loadInserts` があると「＋ 追加」に「台帳から挿入」が出る | 出る |
| `loadInserts` が無い利用側(`?mode=webpage`)では出ない | 出ない |
| パネル: カード 9 件・検索欄にフォーカス・分類と系統の絞り込み | OK |
| 検索「CTA」(`family` が対象) | 1 件に絞れる |
| Esc で閉じる | 閉じる |
| 選択なしで挿す | 器の末尾に入る |
| 2 つめのセクションを選んで挿す | その直後(`HEADER, SECTION, SECTION, →ここ←, FOOTER`) |
| ヘッダーを選んで挿す | その直後(`HEADER, →ここ←, SECTION, …`) |
| セクションの中の `h2` を選んで挿す | 祖先のセクションの直後(器の直下まで上がる) |
| 直前に挿したものが選ばれたまま、もう 1 回挿す | その直後(続けて足せる) |
| キャンバスで選んで挿す | その直後・選択される・**キャンバスの視点が動く** |
| 挿した要素に `data-editable` と id が付く | ルート + 子孫 4/4 |
| 挿した要素が選択され、紙面がそこへ寄る | 選択済み・`scrollTop` が動く |
| 赤字ダミー 既定 ON → 見出しが赤 | 赤(`#a42323`) |
| ダミーを OFF にして挿す | 実文・赤くない |
| **Undo 1 回で消える / Redo で戻る** | 消える・戻る(1 段) |
| 保存 HTML(`getCleanHtml`) | `data-ds` 3 件・`<script>` 0 件・`data-editable` 0 件・`selected` 0 件 |
| ページの雛形を選ぶと「挿入」が消え「ページを作る」になる | なる(ダミー欄も出ない) |
| パスが `company`(`/` 無し)だと送れない | 送れない |
| `createContent({title:'会社情報',path:'/company',templateId:'tpl-lower'})` が呼ばれる | 呼ばれる |
| 作ったページが一覧に出て、編集中になる | 1 ページ表示・キャンバスの両方で切り替わった |
| slide で TPL / PAG が目録に出ない | 出ない(7 件。webpage は 9 件) |
| slide で赤字ダミーのチェックを出さない | 出さない |
| slide で挿すと `#artboard` の直下に入る | 入る |
| PowerPoint 風の殻の「挿入」タブにボタンが出る | 出る |
| 見本の iframe が中身を持つ | 7/7 |
| 挿入のあと `window.tailwindcss.refresh()` が呼ばれる | 1 回(紙面に模擬を置いて計測)|
| その呼び出しで `#artboard` に `style` / `link` が増えない | 0 件・Undo はいまも 1 段 |
| `npx tsc --noEmit -p .` / `npm run build` | 通る |

## 穴(分かっていて直していないこと)

- **選択が無いときの「器の末尾」は、フッターの後ろになる**。器が `<main>` で、フッターも
  その直下にいるため。ドラッグ&ドロップ(`findFlowInsertion`)と同じ規則なので揃ってはいる。
  「本文の最後」にしたい利用側は、本文の器に `data-wf-body` を付ける
- **slide でも流し込みで入れる**(`#artboard` の末尾に足すだけで `position: absolute` にしない)。
  部品のドロップは slide で絶対配置にしているので、そこと揃っていない。
  slide に台帳のセクションを入れる使い方が固まってから決める
- `createContent` に **`parentId` を渡していない**。どの階層に作るかは利用側が決める前提で、
  いまは `templateId` だけを渡す。階層を選ばせたくなったらパネルに増やす
- サニタイズは `<script>` と `on*` だけ。`<iframe>` / `<style>` / `<link>` は**落としていない**。
  台帳が利用側のものである前提に乗っている
- 見本の iframe に **`sandbox` を付けていない**。同上
- 再コンパイルは **playground では実物で確かめていない**。playground が
  `/vendor/tailwindcss-browser.js` を配っていないため、`window.tailwindcss.refresh` の
  模擬を紙面に置いて「1 回呼ばれること」だけを見た。実物での見え方は利用側(殻)で確かめる
- 目録は**パネルを開くたびに読む**(キャッシュしない)。台帳が大きくなったら `loadInserts` の側で持つ
- 挿した HTML に `data-slot` があっても、`data-part` が無いのでスロットのロックは効かない
  (全部が編集できる)。台帳の部品を「部品」として扱いたくなったら、
  利用側が `data-part` を付けて返すか、`loadParts` の側に載せる
- **挿したものが紙面の外にはみ出したときの畳み方**は見ていない。台帳の HTML は紙面の幅に
  合う前提で、合わなければ横スクロールが出る
- **自動保存が走ると選択の状態が消える**(上の節)。台帳から挿入は開いた時点の選択を
  握ることで避けているが、**元の連鎖は直していない**。選んだまま 2 秒待つと削除や
  リボンの操作が効かなくなるので、別途直す価値がある
- 利用側への注意: **`io.loadContent`(または `contentList[].thumbnailHtml` か `parentId`)が
  無いと、作ったページを開けない**(`handleContentChange` が本文を取れないため)。
  playground で実際に踏んだ。`createContent` を渡す利用側は `loadContent` も渡すこと
