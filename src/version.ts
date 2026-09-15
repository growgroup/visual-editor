/**
 * パッケージの版(package.json の version と同じ値。scripts/check-version.mjs が一致を検査する)。
 *
 * 利用側が「いま動いているエディタの版」を知るために使う。dev サーバー(Vite)は起動時に
 * node_modules を束ねるので、パッケージを更新しても再起動するまで古いコードが動く。
 * 利用側はこの値と node_modules の package.json を見比べて、食い違っていれば
 * 「再起動してください」と出せる(構成ラフのテンプレートが行っている)
 */
export const EDITOR_VERSION = '0.7.1';
