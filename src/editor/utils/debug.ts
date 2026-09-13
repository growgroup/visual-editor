/**
 * 開発時だけ出すログ。
 *
 * 【なぜ必要か】
 * 構成ラフ 26 ページをキャンバス表示で開くと、部品 89 個の読み込みだけで
 * console.log が 1,000 件以上出ていた(実測 2,327 件)。console.log は
 * 引数のオブジェクトを DevTools が握り続けるため GC されず、DevTools を
 * 開いていると読み込みが目に見えて遅くなる。利用者に意味のない内部ログは
 * 既定で黙らせ、調べたいときだけ出す。
 *
 * 【出し方】
 *   localStorage.setItem('gg-editor:debug', '1')   // 出る
 *   localStorage.removeItem('gg-editor:debug')     // 止まる
 * 値は毎回読む。DevTools でフラグを立てた直後から効かせるため
 * (キャッシュすると読み込み直後の 1 回しか反映されない)。
 */

const DEBUG_KEY = 'gg-editor:debug';

/**
 * デバッグログを出す設定か。
 * localStorage は srcdoc / sandbox の文脈や「サイトデータをブロック」設定で
 * 参照そのものが例外を投げるので、必ず握りつぶして false に倒す。
 */
export function isDebugEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DEBUG_KEY) === '1';
  } catch {
    return false;
  }
}

/** 内部の様子を見るためのログ。既定では出ない */
export function debugLog(...args: unknown[]): void {
  if (isDebugEnabled()) console.log(...args);
}

/**
 * 開発者向けの警告。既定では出ない。
 * 利用者が対処できる警告(保存に失敗した等)は console.warn のまま残すこと。
 */
export function debugWarn(...args: unknown[]): void {
  if (isDebugEnabled()) console.warn(...args);
}

/**
 * 開発時だけ握りつぶしたい失敗の記録。既定では出ない。
 * 利用者に伝える必要のある失敗は console.error のまま残すこと。
 */
export function debugError(...args: unknown[]): void {
  if (isDebugEnabled()) console.error(...args);
}
