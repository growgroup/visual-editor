/**
 * Hocuspocus への接続(1 タブ 1 本の WebSocket に部屋を相乗りさせる)。
 *
 * - WebSocket は URL ごとに 1 本(HocuspocusProviderWebsocket)。部屋(HocuspocusProvider)はそこへ attach する。
 *   v3 は websocketProvider を共有すると attach() を呼ぶまで繋がらない(取り決め §2 の実測)
 * - 部屋を手放すときは、まず自分の居場所(awareness)を消し、数秒の猶予のあと detach する。
 *   猶予の間に同じ部屋へ戻れば(ページを行き来した・1 ページ表示でエディタが作り直された)繋ぎ直さない
 * - WebSocket も最後の部屋が抜けてから猶予を置いて閉じる
 */

import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import * as Y from 'yjs';

/** WebSocket を閉じるまでの猶予(ms) */
const SOCKET_GRACE_MS = 5000;
/** 部屋を detach するまでの猶予(ms) */
export const ROOM_GRACE_MS = 4000;

type SocketEntry = { socket: HocuspocusProviderWebsocket; refs: number; timer: ReturnType<typeof setTimeout> | null };
const sockets = new Map<string, SocketEntry>();

export function acquireSocket(url: string): HocuspocusProviderWebsocket {
  let entry = sockets.get(url);
  if (!entry) {
    entry = { socket: new HocuspocusProviderWebsocket({ url }), refs: 0, timer: null };
    sockets.set(url, entry);
  }
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  entry.refs += 1;
  return entry.socket;
}

export function releaseSocket(url: string): void {
  const entry = sockets.get(url);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs > 0 || entry.timer) return;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (entry.refs > 0) return;
    sockets.delete(url);
    entry.socket.destroy();
  }, SOCKET_GRACE_MS);
}

/** いま張っている WebSocket(検証で切断・再接続を起こすのに使う) */
export function socketFor(url: string): HocuspocusProviderWebsocket | null {
  return sockets.get(url)?.socket ?? null;
}

export type Room = {
  key: string;
  url: string;
  name: string;
  doc: Y.Doc;
  provider: HocuspocusProvider;
  refs: number;
  timer: ReturnType<typeof setTimeout> | null;
};
const rooms = new Map<string, Room>();

export function acquireRoom(url: string, name: string, token?: () => Promise<string | undefined>): Room {
  const key = `${url}\n${name}`;
  const existing = rooms.get(key);
  if (existing) {
    if (existing.timer) {
      clearTimeout(existing.timer);
      existing.timer = null;
    }
    existing.refs += 1;
    return existing;
  }
  const socket = acquireSocket(url);
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name,
    document: doc,
    // 本番の wf/ の部屋は token 無し(空文字)で通る。渡されていればそれを使う
    token: token ? async () => (await token()) ?? '' : '',
  });
  provider.attach();
  const room: Room = { key, url, name, doc, provider, refs: 1, timer: null };
  rooms.set(key, room);
  return room;
}

/** 部屋を手放す。居場所はすぐ消し、接続は猶予のあと切る */
export function releaseRoom(room: Room, graceMs = ROOM_GRACE_MS): void {
  room.refs = Math.max(0, room.refs - 1);
  if (room.refs > 0) return;
  room.provider.awareness?.setLocalState(null);
  if (room.timer) clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    room.timer = null;
    if (room.refs > 0) return;
    rooms.delete(room.key);
    room.provider.destroy();
    room.doc.destroy();
    releaseSocket(room.url);
  }, graceMs);
}

/** 既に持っている部屋(猶予中も含む)。無ければ null */
export function peekRoom(url: string, name: string): Room | null {
  return rooms.get(`${url}\n${name}`) ?? null;
}
