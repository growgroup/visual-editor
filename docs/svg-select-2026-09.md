# SVG の選択(0.9.1)

利用者の報告: 「SVG があると、クリックすると問答無用で SVG が選ばれる。Cmd / Ctrl を押しながらクリックしても(下の要素を)選べない」。

## 原因

1. HTML の中の `<svg>` は、線や塗りが無い所も含めて**箱全体**でクリックを受ける。装飾の SVG(斜めの線・背景の図形)や
   図形ツールで描いた線が文字やボタンに重なっていると、その箱の中はどこを押しても `e.target` が SVG になる
2. Cmd / Ctrl+クリック(最下層を選ぶ)も、押した点の最上面から編集できる祖先を探すので、やはり SVG になる
3. SVG の中の要素のうち、編集の印(`data-editable`)を外していたのは `path` と `g` だけで、`circle` `rect` `line` `polygon` などは単独で選べていた

## 直し方(`src/editor/utils/svg-hit.ts`)

- `passThroughSvg(doc, target, x, y)`: 押した点に SVG の形(子要素)が描かれていなければ、その SVG を素通りして下の要素を押したことにする。
  形の上かどうかは `elementsFromPoint` で見る(SVG の子は描かれている所でしか当たらない。`pointer-events` の既定 `visiblePainted`)。
  細い線は掴みにくいので周り 3px も見る。SVG 自身に CSS の背景があれば箱全体を形とみなす
- SVG を包むだけの透明な器(子が素通りさせた要素だけで、文字・背景・枠線・影が無い)も素通りする。
  図形ツールの線・矢印・ペンは `<div style="position:absolute;background-color:transparent"><svg style="position:absolute">…</svg></div>` の形なので、
  線の周りの空きで器が当たらないようにするため。エディタが編集できる要素すべてに付ける透明な `outline` は見ない
- 図形ツールの線の上を押したら、器(位置と大きさを持つ方)を選ぶ(`drawnShapeOf`)。効果の枠(`data-gg-fx-host`)は対象外
- 使う場所: クリック(`useElementSelection` の判別器)・ホバーの予告(`useIframeSetup`)・ダブルクリック・右クリック(`useContextMenuHandler`)。
  予告とクリック結果が食い違わないよう、4 か所とも同じ判定を通す
- SVG の中の要素には編集の印を付けない(`isInsideSvg`。`useIframeSetup` と部品の切り離し `parts.ts`)。SVG は 1 つの図として選ぶ

## 確かめたこと(playground `?mode=svg`、headless Chrome。各ケースはページを読み直してから 1 回クリック)

| 押した所 | 修正前(素 / Cmd) | 修正後(素 / Cmd)・ホバーの予告も同じ |
|---|---|---|
| 装飾の SVG の箱の中の見出し | 装飾の SVG / 装飾の SVG | 見出し / 見出し |
| 装飾の SVG の箱の中の段落 | 装飾の SVG / 装飾の SVG | 段落 / 段落 |
| ボタンのアイコンの線の上 | 装飾の SVG / 装飾の SVG | アイコンの SVG / アイコンの SVG |
| ボタンのアイコンの箱の空き | 装飾の SVG / 装飾の SVG | ボタン / ボタン |
| 装飾の SVG の線の上 | 装飾の SVG / 装飾の SVG | 装飾の SVG / 装飾の SVG |
| 塗りの円の中 | `circle`(SVG の中の要素) / `circle` | 円の SVG / 円の SVG |
| 円の箱の角(塗りの外) | — | 下の見出し / 下の見出し |
| 図形ツールの線の器の空き(下は段落) | — | 段落 / 段落 |
| 図形ツールの線の上 | — | 線の器 / 線の器 |

ダブルクリック(装飾の SVG の下の見出し)で見出しの文字編集に入る、右クリック(装飾の SVG の下の段落)で段落が選ばれる。`npx tsc --noEmit` が通る。

## 分かっている穴

- `pointer-events: none` を付けた SVG は元々クリックを受けないので、この処理は通らない(下の要素が選ばれる。従来どおり)
- 見た目は塗られていても当たり判定を持たない描き方(`pointer-events` を変えた子、`fill="none"` で `stroke` も無い形)は空きとみなす
- SVG の中の個々の形(`path` など)を選んで編集することはできない(従来も色・寸法の欄は効かなかった)
