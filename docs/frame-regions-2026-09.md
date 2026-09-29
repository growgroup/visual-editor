# 紙面の外に並べる表示だけの領域 — 0.10.0

マルチフレームのキャンバスで、利用側が紙面(`#artboard`)の **外** の上下に、表示だけの領域を並べられるようにした。
例: サイトの共通のヘッダー・フッター(フッターの先頭の共通 CTA 帯を含む)を、ページ本文の上下に重ねて見せる。

## なぜ要ったか

- ページの文書(保存・共同編集の単位)はページ本文だけを持つ。共通パーツは別の文書にあるので、本文だけを描くと
  「ヘッダー・フッターが入っていない」ように見える。
- 利用側が生きているエディタの文書に領域を差し込むこと自体はできる。ただ、埋め込み(マルチフレーム)では
  **フレームの高さを `#artboard` だけから測っていた**(`EditorCanvas` の `updateContentHeightFromIframe`)ので、
  `#artboard` の後ろに置いたフッターがフレームの下端で切れて見えなかった。

## 使い方

1. 生きているエディタの文書で、`#artboard` の兄弟(`#artboard-wrapper` の中)に要素を置く。上なら `#artboard` の前、下なら後ろ。
2. その要素に `FRAME_REGION_ATTRIBUTE`(= `data-editor-frame-region`、値は何でもよい)を付ける。
3. 大きさが変わったら(中の iframe が高さを知らせてきた等)、そのまま高さを変えるだけでよい。`#artboard-wrapper` を
   `ResizeObserver` で見ているので、フレームの高さも測り直される。

```ts
import { FRAME_REGION_ATTRIBUTE } from "@growgroup/visual-editor";

const artboard = doc.getElementById("artboard")!;
const header = doc.createElement("div");
header.setAttribute(FRAME_REGION_ATTRIBUTE, "header");
artboard.before(header);     // 上
const footer = doc.createElement("div");
footer.setAttribute(FRAME_REGION_ATTRIBUTE, "footer");
artboard.after(footer);      // 下
```

- 文書は読み込み直し(ページ切替等)のたびに作り直されるので、iframe の `load` で差し込み直すこと。
- 保存・共同編集が送るのは `#artboard` の中身だけ(`getCleanHtml`)。外に置いたものは本文に混ざらない。
  中身は別の iframe(`sandbox="allow-scripts"`)にしておくと、本文の CSS と混ざらず、クリックも本文の選択に化けない。

## 仕組み

- 測り方: これまでどおり `#artboard` の `scrollHeight` と子孫の下端の最大に、`[data-editor-frame-region]` の下端を足した最大。
  領域の無い利用側は従来と同じ値になる。
- 測り直し: `#artboard` に加えて `#artboard-wrapper` も `ResizeObserver` で見る。領域の高さが変わると wrapper が伸び縮みする。
- 見るだけの紙面(編集していないページ、`PageFramePreview`)には入れていない(利用側が差し込む先が無い)。
