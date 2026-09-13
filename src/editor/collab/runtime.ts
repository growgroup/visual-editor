/**
 * 共同編集の実体。io.collab があるときだけ動的に読まれる(yjs / Hocuspocus を束ねる側)。
 *
 * - 案件の部屋: 居場所(`{ user, kind: "editor", contentId, route }`)と書き戻し役の数
 * - ページの部屋: いま編集中のページの本文と、選択・カーソル・打鍵中の要素
 *   (`{ user, kind: "editor", selection, cursor, editing }`)
 * 表示は store.ts に書くだけ。ヘッダーや紙面の描画はそれを購読する
 */

import { WebSocketStatus } from '@hocuspocus/provider';
import type { EditorCollab } from '../../io';
import { acquireRoom, acquireSocket, releaseRoom, releaseSocket, type Room } from './connection';
import { colorFor } from './color';
import { collabStore, type CollabPagePeer, type CollabPeer, type CollabStatus, type CollabUser } from './store';

/** カーソルを送る間隔(ms) */
const CURSOR_THROTTLE_MS = 50;

type AwarenessState = Record<string, unknown>;

function toUser(raw: unknown): CollabUser | null {
  if (!raw || typeof raw !== 'object') return null;
  const { id, name, color } = raw as { id?: unknown; name?: unknown; color?: unknown };
  if (typeof id !== 'string' || !id) return null;
  const label = typeof name === 'string' && name.trim() ? name : id;
  return { id, name: label, color: colorFor(id, typeof color === 'string' ? color : undefined) };
}

function toCursor(raw: unknown): { x: number; y: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { x, y } = raw as { x?: unknown; y?: unknown };
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export type PageSession = {
  room: Room;
  contentId: string;
};

export type CollabRuntime = {
  readonly config: EditorCollab;
  readonly self: CollabUser;
  /** 編集中のページが変わった(null = どのページも編集していない) */
  setPage(contentId: string | null): void;
  setSelection(anchors: string[]): void;
  setCursor(cursor: { x: number; y: number } | null): void;
  setEditing(anchor: string | null): void;
  /** いまのページの部屋。入っていなければ null */
  page(): PageSession | null;
  /** 本文の束縛(binding)から、まだ送っていない変更の有無を知らせる(同期中の表示に使う) */
  setLocalPending(pending: boolean): void;
  /** 状態の表示を計算し直す(束縛の中の変化から呼ぶ) */
  refresh(): void;
  destroy(): void;
};

export function createCollabRuntime(config: EditorCollab): CollabRuntime {
  const self: CollabUser = { id: config.user.id, name: config.user.name || config.user.id, color: colorFor(config.user.id, config.user.color) };
  const socket = acquireSocket(config.url);
  const project = acquireRoom(config.url, config.projectRoom, config.token);
  let destroyed = false;
  let currentContentId: string | null = null;
  let page: (PageSession & { off: () => void }) | null = null;
  let localPending = false;
  let selection: string[] = [];
  let editing: string | null = null;
  let cursorLatest: { x: number; y: number } | null = null;
  let cursorSent: string | undefined;
  let cursorTimer: ReturnType<typeof setTimeout> | null = null;

  collabStore.set({
    enabled: true,
    self,
    requireBridge: !!config.requireBridge,
    status: 'offline',
    peers: [],
    pagePeers: [],
    bridges: 0,
    pageActive: false,
    pending: false,
    unsynced: 0,
    canUndo: false,
    canRedo: false,
    ready: false,
  });

  const setProjectPresence = () => {
    project.provider.awareness?.setLocalState({
      user: self,
      kind: 'editor',
      contentId: currentContentId,
      route: currentContentId ? config.routeFor(currentContentId) : null,
    });
  };

  const readPeers = () => {
    const aw = project.provider.awareness;
    if (!aw) return;
    const peers: CollabPeer[] = [];
    const seen = new Set<string>();
    let bridges = 0;
    const states = Array.from(aw.getStates().entries()).sort((a, b) => a[0] - b[0]);
    for (const [clientId, raw] of states) {
      if (clientId === aw.clientID || !raw) continue;
      const state = raw as AwarenessState;
      if (state.kind === 'bridge') {
        bridges += 1;
        continue;
      }
      if (state.kind !== 'editor') continue;
      const user = toUser(state.user);
      // 同じ人が別のタブで開いていても 1 人として出す(自分の別タブは出さない)
      if (!user || user.id === self.id || seen.has(user.id)) continue;
      seen.add(user.id);
      peers.push({
        clientId,
        user,
        contentId: typeof state.contentId === 'string' ? state.contentId : null,
        route: typeof state.route === 'string' ? state.route : null,
      });
    }
    collabStore.set({ peers, bridges });
  };

  const readPagePeers = () => {
    const aw = page?.room.provider.awareness;
    if (!aw) {
      collabStore.set({ pagePeers: [] });
      return;
    }
    const list: CollabPagePeer[] = [];
    aw.getStates().forEach((raw, clientId) => {
      if (clientId === aw.clientID || !raw) return;
      const state = raw as AwarenessState;
      if (state.kind !== 'editor') return;
      const user = toUser(state.user);
      if (!user) return;
      list.push({
        clientId,
        user,
        selection: Array.isArray(state.selection) ? state.selection.filter((v): v is string => typeof v === 'string') : [],
        cursor: toCursor(state.cursor),
        editing: typeof state.editing === 'string' ? state.editing : null,
      });
    });
    list.sort((a, b) => a.clientId - b.clientId);
    collabStore.set({ pagePeers: list });
  };

  const refresh = () => {
    if (destroyed) return;
    const connected = socket.status === WebSocketStatus.Connected;
    const target = page?.room ?? project;
    const unsynced = page ? page.room.provider.unsyncedChanges : 0;
    const status: CollabStatus = !connected
      ? 'offline'
      : !target.provider.synced || unsynced > 0 || localPending
        ? 'syncing'
        : 'synced';
    collabStore.set({ status, unsynced, ready: project.provider.synced || collabStore.get().ready });
  };

  const onProjectAwareness = () => readPeers();
  project.provider.awareness?.on('change', onProjectAwareness);
  project.provider.on('synced', refresh);
  socket.on('status', refresh);
  setProjectPresence();
  readPeers();
  refresh();

  const joinPage = (contentId: string, name: string) => {
    const room = acquireRoom(config.url, name, config.token);
    selection = [];
    editing = null;
    cursorLatest = null;
    cursorSent = undefined;
    room.provider.awareness?.setLocalState({ user: self, kind: 'editor', selection, cursor: null, editing });
    const onAwareness = () => readPagePeers();
    room.provider.awareness?.on('change', onAwareness);
    room.provider.on('synced', refresh);
    room.provider.on('unsyncedChanges', refresh);
    page = {
      room,
      contentId,
      off: () => {
        room.provider.awareness?.off('change', onAwareness);
        room.provider.off('synced', refresh);
        room.provider.off('unsyncedChanges', refresh);
      },
    };
    readPagePeers();
  };

  const leavePage = () => {
    if (!page) return;
    page.off();
    releaseRoom(page.room);
    page = null;
    collabStore.set({ pagePeers: [] });
  };

  const sendCursor = () => {
    const aw = page?.room.provider.awareness;
    if (!aw) return;
    const key = JSON.stringify(cursorLatest);
    if (key === cursorSent) return;
    cursorSent = key;
    aw.setLocalStateField('cursor', cursorLatest);
  };

  return {
    config,
    self,
    setPage(contentId) {
      if (destroyed) return;
      currentContentId = contentId;
      setProjectPresence();
      const name = contentId ? config.roomFor(contentId) : null;
      if (page && name && page.room.name === name) {
        page.contentId = contentId!;
      } else {
        leavePage();
        if (contentId && name) joinPage(contentId, name);
      }
      collabStore.set({ pageActive: !!page, pending: false });
      refresh();
    },
    setSelection(anchors) {
      if (JSON.stringify(anchors) === JSON.stringify(selection)) return;
      selection = anchors;
      page?.room.provider.awareness?.setLocalStateField('selection', anchors);
    },
    setCursor(cursor) {
      cursorLatest = cursor;
      if (cursorTimer) return;
      sendCursor();
      cursorTimer = setTimeout(() => {
        cursorTimer = null;
        sendCursor();
      }, CURSOR_THROTTLE_MS);
    },
    setEditing(anchor) {
      if (anchor === editing) return;
      editing = anchor;
      page?.room.provider.awareness?.setLocalStateField('editing', anchor);
    },
    page: () => (page ? { room: page.room, contentId: page.contentId } : null),
    setLocalPending(pending) {
      if (pending === localPending) return;
      localPending = pending;
      refresh();
    },
    refresh,
    destroy() {
      if (destroyed) return;
      leavePage();
      destroyed = true;
      if (cursorTimer) clearTimeout(cursorTimer);
      project.provider.awareness?.off('change', onProjectAwareness);
      project.provider.off('synced', refresh);
      socket.off('status', refresh);
      releaseRoom(project);
      releaseSocket(config.url);
      collabStore.reset();
    },
  };
}
