/**
 * 履歴が「同じ要素への続けての変更」を1つにまとめる間隔(ms)。
 * EditorHistoryContext と、数字キーの不透明度(2桁入力)の両方が使う。
 *
 * EditorHistoryContext.tsx から直接 export しないのは、コンポーネント以外の値を export すると
 * React Fast Refresh がそのファイルを差し替えられず、編集のたびにページ全体が読み込み直される
 * (開いている編集の ⌘Z 履歴が消える)ため。
 */
export const COALESCE_WINDOW_MS = 400;
