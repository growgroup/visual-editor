/**
 * 中継(gg-manager の hocuspocus-server)が保存する部屋名の形。
 *
 * 形を外れた部屋も**中継はされる**ので動いているように見えるが、サーバーは保存しない
 * (全員が抜けるか、翌日の掃除で中身が消える)。繋ぐ前にここで検査し、外れたら共同編集を始めない。
 *
 * 規則(取り決め §3 / サーバー側の persistence.ts と同じ):
 * - 部屋名は `wf/<room>__<route の encodeURIComponent>` か `wf/<room>__@project`
 * - room は `[A-Za-z0-9_-]` の 8〜100 文字(`__` が混ざっても、後半は `@` か `%` で始まるので境界は一意)
 * - route の部分は `/` 始まり = `%2F` 始まりで、`encodeURIComponent` の正規形
 *   (decode してから encode し直すと同じ文字列。16 進は大文字)
 * - encode 後の route は 1024 文字以内
 *
 * この検査は殻(書き戻し役・ホスト側)でも使えるように公開している(`checkCollabRoom`)。
 * 部屋名そのものが鍵なので、外れたことを知らせるときも名前は出さない。
 */

export type CollabRoomCheck = { ok: true } | { ok: false; reason: string };

/** サーバーが保存する部屋名(persistence.ts の WF_DOCUMENT_NAME と同じ) */
const WF_DOCUMENT_NAME = /^wf\/([A-Za-z0-9_-]{8,100})__(@project|%2F[A-Za-z0-9%._~!*'()-]*)$/;
/** 部屋名を分けるためだけの緩い形(どこが外れているかを言うために使う) */
const WF_LOOSE = /^wf\/([A-Za-z0-9_-]+)__([\s\S]*)$/;
const PROJECT_PAGE = '@project';
/** encodeURIComponent 済み route の長さの上限 */
const ROUTE_MAX_LENGTH = 1024;

const SHAPE = '部屋名は wf/<room>__<route> か wf/<room>__@project の形にする';
const ROOM = 'room は [A-Za-z0-9_-] の 8〜100 文字にする';
const ROUTE_HEAD = 'route の部分は @project か、/ 始まりの route を encodeURIComponent した形(%2F…)にする';
const ROUTE_CANONICAL = 'route は encodeURIComponent の正規形にする(16 進は大文字。%2f は不可)';
const ROUTE_LENGTH = `encode 後の route は ${ROUTE_MAX_LENGTH} 文字以内にする`;

/** encodeURIComponent の正規形か(長さの上限も含めて、サーバーの isCanonicalEncodedRoute と同じ) */
function isCanonicalEncodedRoute(encoded: string): boolean {
  if (encoded.length > ROUTE_MAX_LENGTH) return false;
  try {
    return encodeURIComponent(decodeURIComponent(encoded)) === encoded;
  } catch {
    return false; // 壊れた % 列(URIError)
  }
}

/**
 * 部屋名がサーバーに保存される形か。
 * 外れていれば理由を返す(繋がずに、接続状態へエラーとして出すため)
 */
export function checkCollabRoom(name: unknown): CollabRoomCheck {
  if (typeof name !== 'string' || !name) return { ok: false, reason: SHAPE };
  if (WF_DOCUMENT_NAME.test(name) && isCanonicalEncodedRoute(pageOf(name))) return { ok: true };

  const loose = WF_LOOSE.exec(name);
  let room: string;
  let page: string;
  if (loose) {
    room = loose[1];
    page = loose[2];
  } else {
    // room に使えない文字が入っているときも「room が悪い」と言えるようにする
    const rest = name.startsWith('wf/') ? name.slice(3) : null;
    const at = rest ? rest.indexOf('__') : -1;
    if (rest == null || at < 0) return { ok: false, reason: SHAPE };
    room = rest.slice(0, at);
    page = rest.slice(at + 2);
  }
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(room)) return { ok: false, reason: ROOM };
  if (page === PROJECT_PAGE) return { ok: true };
  if (page.length > ROUTE_MAX_LENGTH) return { ok: false, reason: ROUTE_LENGTH };
  // encode していない(/ のまま)・@project でも %2F でもない
  if (page.startsWith('/') || (!page.startsWith('%2F') && isCanonicalEncodedRoute(page))) {
    return { ok: false, reason: ROUTE_HEAD };
  }
  if (!isCanonicalEncodedRoute(page)) return { ok: false, reason: ROUTE_CANONICAL };
  // ここまで通って全体の形に合わないのは、route に使えない文字が残っているとき
  return { ok: false, reason: ROUTE_HEAD };
}

/** `wf/<room>__<page>` の page の部分(検査を通った名前にだけ使う) */
function pageOf(name: string): string {
  const m = WF_DOCUMENT_NAME.exec(name);
  return m ? m[2] : '';
}
