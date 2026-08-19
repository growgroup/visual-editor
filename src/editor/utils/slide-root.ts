/**
 * [移植時の追加] iframe内の「スライド本体」を特定するユーティリティ。
 *
 * このプロジェクトのスライドは 1920×1080 のルート要素で、ズーム倍率のtransformが
 * かかった状態でiframe内に置かれている。要素を追加するときに、その外側
 * (body や #artboard ラッパー)へ入れてしまうと座標系がスケールの分だけずれ、
 *  - スライドの外に表示される
 *  - ドラッグすると 1/zoom 倍(例: 41%なら約2.4倍)動いて飛んでいく
 * という不具合になる。挿入先は必ずこのルート要素に揃える。
 */

/**
 * スライドの内容が入るルート要素。
 * エディタは `#artboard-wrapper`(ズームのtransformがかかる) > `#artboard`(内容) の
 * 入れ子でキャンバスを作るので、内容側の `#artboard` を基準にする。
 * 通常のWebページ編集などで見つからない場合は null。
 */
export function findSlideRoot(doc: Document): HTMLElement | null {
  const artboard = doc.getElementById('artboard');
  if (artboard) return artboard;
  const marked = doc.querySelector('[data-slide-root]');
  if (marked instanceof HTMLElement) return marked;
  return null;
}

/** 新しい要素の追加先 */
export function findInsertionParent(doc: Document): HTMLElement {
  return findSlideRoot(doc) ?? doc.getElementById('slide-artboard') ?? doc.body;
}
