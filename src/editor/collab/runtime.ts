/**
 * 共同編集の実体。io.collab があるときだけ動的に読まれる(yjs / Hocuspocus / idiomorph / fast-diff を束ねる側)。
 *
 * - 案件の部屋: 居場所(`{ user, kind: "editor", contentId, route }`)・書き戻し役の数・`Y.Map("pages")` の rev
 * - ページの部屋: いま編集中のページの本文(binding.ts)と、選択・カーソル・打鍵中の要素
 *   (`{ user, kind: "editor", selection, cursor, editing }`)
 * 表示は store.ts に書くだけ。ヘッダーや紙面の描画はそれを購読する
 */

import { WebSocketStatus } from '@hocuspocus/provider';
import type * as Y from 'yjs';
import type { EditorCollab } from '../../io';
import { acquireRoom, acquireSocket, peekRoom, releaseRoom, releaseSocket, type Room } from './connection';
import { colorFor } from './color';
import { PageBinding } from './binding';
import {
  collabStore,
  setCollabSharedReader,
  type CollabPagePeer,
  type CollabPeer,
  type CollabStatus,
  type CollabUser,
} from './store';

/** カーソルを送る間隔(ms) */
const CURSOR_THROTTLE_MS = 50;
/** 案件の部屋の pages の rev を進める間隔(ms。取り決め §5 の「1 秒に 1 回まで」) */
const REV_INTERVAL_MS = 1000;
/** 見るだけの紙面を読み直すために入った部屋を、抜けるまでの猶予(ms) */
const PREVIEW_ROOM_GRACE_MS = 15000;
/** 見るだけの紙面の本文を待つ上限(ms) */
const READ_SHARED_TIMEOUT_MS = 4000;

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

function waitSynced(room: Room, timeoutMs: number): Promise<boolean> {
  if (room.provider.synced) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      room.provider.off('synced', done);
      resolve(room.provider.synced);
    };
    const timer = setTimeout(done, timeoutMs);
    room.provider.on('synced', done);
  });
}

export type PageSession = {
  room: Room;
  contentId: string;
};

/** 編集中の紙面と部屋の本文の束縛(binding.ts)のうち、エディタから呼ぶもの */
export type CollabDocBinding = {
  scheduleSend(): void;
  flush(): void;
  undo(): void;
  redo(): void;
  sharedHtml(): string | null;
  destroy(): void;
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
  /**
   * 初期化を終えた紙面をページの部屋の本文につなぐ。そのページの部屋に入っていなければ null。
   * initialShared は読み込み直後の姿(encode 済み。種まきに使う)
   */
  bind(options: { doc: Document; contentId: string; initialShared: string; onApplied: (artboardHtml: string) => void }): CollabDocBinding | null;
  /** 他の人がそのページ(route)の本文を送った。登録した時点で rev のあるページにも 1 回ずつ呼ぶ */
  onRemoteRev(listener: (route: string) => void): () => void;
  /** そのページの部屋の本文(decode 済み)。部屋に入って同期を待つ。空・同期できなければ null */
  readShared(contentId: string): Promise<string | null>;
  destroy(): void;
};

export function createCollabRuntime(config: EditorCollab): CollabRuntime {
  const self: CollabUser = { id: config.user.id, name: config.user.name || config.user.id, color: colorFor(config.user.id, config.user.color) };
  const encode = config.encode ?? ((clean: string) => clean);
  const decodeFor = (contentId: string) => (shared: string) => (config.decode ? config.decode(shared, contentId) : shared);
  const socket = acquireSocket(config.url);
  const project = acquireRoom(config.url, config.projectRoom, config.token);
  const revOrigin = { collab: 'rev' };
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
    ready: false,
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

  const setLocalPending = (pending: boolean) => {
    if (pending === localPending) return;
    localPending = pending;
    refresh();
  };

  // ---- 案件の部屋の pages(rev)
  const pagesMap = project.doc.getMap<unknown>('pages');
  const revListeners = new Set<(route: string) => void>();
  const onPages = (event: Y.YMapEvent<unknown>, tx: Y.Transaction) => {
    if (tx.origin === revOrigin) return;
    event.keysChanged.forEach((route) => revListeners.forEach((listener) => listener(route)));
  };
  pagesMap.observe(onPages);
  const revTimers = new Map<string, { last: number; timer: ReturnType<typeof setTimeout> | null }>();
  const writeRev = (route: string) => {
    if (destroyed) return;
    project.doc.transact(() => {
      const prev = pagesMap.get(route) as { rev?: unknown } | undefined;
      const rev = typeof prev?.rev === 'number' ? prev.rev + 1 : 1;
      pagesMap.set(route, { rev, by: self.id, at: new Date().toISOString() });
    }, revOrigin);
  };
  const bumpRev = (route: string) => {
    const entry = revTimers.get(route) ?? { last: 0, timer: null };
    revTimers.set(route, entry);
    if (entry.timer) return;
    const wait = REV_INTERVAL_MS - (Date.now() - entry.last);
    if (wait <= 0) {
      entry.last = Date.now();
      writeRev(route);
      return;
    }
    entry.timer = setTimeout(() => {
      entry.timer = null;
      entry.last = Date.now();
      writeRev(route);
    }, wait);
  };

  const onProjectAwareness = () => readPeers();
  project.provider.awareness?.on('change', onProjectAwareness);
  project.provider.on('synced', refresh);
  socket.on('status', refresh);
  setProjectPresence();
  readPeers();
  refresh();

  // 共同編集中のページ切替で、部屋に同期済みの本文があればそれを使わせる
  setCollabSharedReader((contentId) => {
    const name = config.roomFor(contentId);
    const room = name ? peekRoom(config.url, name) : null;
    if (!room || !room.provider.synced) return null;
    const text = room.doc.getText('html').toString();
    return text ? decodeFor(contentId)(text) : null;
  });

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
      if (page && contentId && name && page.room.name === name) {
        page.contentId = contentId;
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
    bind({ doc, contentId, initialShared, onApplied }) {
      if (destroyed || !page || page.contentId !== contentId) return null;
      const route = config.routeFor(contentId);
      const binding = new PageBinding({
        room: page.room,
        doc,
        initialShared,
        encode,
        decode: decodeFor(contentId),
        onApplied,
        onLocalSent: () => {
          if (route) bumpRev(route);
        },
        onState: (state) => {
          collabStore.set({ pending: state.pending, canUndo: state.canUndo, canRedo: state.canRedo });
          setLocalPending(state.localPending);
        },
      });
      return {
        scheduleSend: () => binding.scheduleSend(),
        flush: () => binding.flush(),
        undo: () => binding.undo(),
        redo: () => binding.redo(),
        sharedHtml: () => binding.sharedHtml(),
        destroy: () => {
          binding.destroy();
          collabStore.set({ pending: false, canUndo: false, canRedo: false });
          setLocalPending(false);
        },
      };
    },
    onRemoteRev(listener) {
      revListeners.add(listener);
      pagesMap.forEach((_value, route) => listener(route));
      return () => {
        revListeners.delete(listener);
      };
    },
    async readShared(contentId) {
      const name = config.roomFor(contentId);
      if (destroyed || !name) return null;
      const fresh = !peekRoom(config.url, name);
      const room = acquireRoom(config.url, name, config.token);
      // 見るだけの紙面のために入る部屋では、居場所を出さない
      if (fresh) room.provider.awareness?.setLocalState(null);
      try {
        if (!(await waitSynced(room, READ_SHARED_TIMEOUT_MS))) return null;
        const text = room.doc.getText('html').toString();
        return text ? decodeFor(contentId)(text) : null;
      } finally {
        releaseRoom(room, PREVIEW_ROOM_GRACE_MS);
      }
    },
    destroy() {
      if (destroyed) return;
      leavePage();
      // 間引き中の rev は捨てずに書く
      revTimers.forEach((entry, route) => {
        if (!entry.timer) return;
        clearTimeout(entry.timer);
        entry.timer = null;
        writeRev(route);
      });
      destroyed = true;
      if (cursorTimer) clearTimeout(cursorTimer);
      setCollabSharedReader(null);
      pagesMap.unobserve(onPages);
      project.provider.awareness?.off('change', onProjectAwareness);
      project.provider.off('synced', refresh);
      socket.off('status', refresh);
      releaseRoom(project);
      releaseSocket(config.url);
      collabStore.reset();
    },
  };
}
