/**
 * ローカル永続化スタブ。オリジナルは Firebase 実装。
 *
 * このプロジェクトにはバックエンドが存在しないため、Firebase App / Auth /
 * Firestore / Storage / Functions のインスタンスはすべてダミーオブジェクトを返す。
 * `firebase/*` パッケージからの import は一切行わない（バンドルに混入させないため）。
 *
 * 実際の永続化は同ディレクトリの css-variables.ts / editor-components.ts /
 * storage.ts が localStorage・data URL で代替している。
 * ここから export されるオブジェクトは「import してもクラッシュしない」ことだけを
 * 保証するプレースホルダであり、メソッド呼び出しは想定していない。
 */

/** Firebase App のダミー */
export const app = {} as any;

/** Firebase Auth のダミー */
export const auth = {} as any;

/** Cloud Firestore のダミー */
export const db = {} as any;

/** Firebase Storage のダミー */
export const storage = {} as any;

/** Cloud Functions のダミー（asia-northeast1 相当） */
export const functions = {} as any;

export default app;
