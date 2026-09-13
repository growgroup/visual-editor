/**
 * 共同編集の表示用の状態(依存なし)。
 *
 * 接続の実体(runtime.ts: yjs / Hocuspocus / idiomorph)は io.collab があるときだけ動的に読む。
 * ヘッダーのアバター・フレーム名の点・紙面の選択枠は、ここを購読するだけにして
 * 重い依存を持たない(io.collab が無い利用側では何も読まれず、何も描かれない)。
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';

export type CollabStatus = 'offline' | 'syncing' | 'synced';

export type CollabUser = { id: string; name: string; color: string };

/** 案件の部屋に居るエディタ(自分以外)。contentId / route はそのエディタが編集中のページ */
export type CollabPeer = { clientId: number; user: CollabUser; contentId: string | null; route: string | null };

/** いまのページの部屋に居るエディタ(自分以外)。selection / editing は anchorValueOf の値、cursor は紙面の px */
export type CollabPagePeer = {
  clientId: number;
  user: CollabUser;
  selection: string[];
  cursor: { x: number; y: number } | null;
  editing: string | null;
};

export type CollabSnapshot = {
  /** io.collab があり、接続の実体が動いている */
  enabled: boolean;
  /** 案件の部屋と一度でも同期できた(書き戻し先の数が当てになる) */
  ready: boolean;
  self: CollabUser | null;
  status: CollabStatus;
  peers: CollabPeer[];
  pagePeers: CollabPagePeer[];
  /** 案件の部屋に居る書き戻し役の数 */
  bridges: number;
  requireBridge: boolean;
  /** いま編集中のページの部屋に入っている(このあいだ onSave の自動保存は呼ばない) */
  pageActive: boolean;
  /** 打鍵中の要素に掛かる他人の変更を blur まで保留している */
  pending: boolean;
  /** 中継にまだ届いていない自分の変更の数 */
  unsynced: number;
  canUndo: boolean;
  canRedo: boolean;
};

export const COLLAB_DISABLED: CollabSnapshot = {
  enabled: false,
  ready: false,
  self: null,
  status: 'offline',
  peers: [],
  pagePeers: [],
  bridges: 0,
  requireBridge: false,
  pageActive: false,
  pending: false,
  unsynced: 0,
  canUndo: false,
  canRedo: false,
};

let snapshot: CollabSnapshot = COLLAB_DISABLED;
const listeners = new Set<() => void>();

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export const collabStore = {
  get: (): CollabSnapshot => snapshot,
  /** 変わったキーがあるときだけ知らせる(カーソルの 50ms ごとの更新で関係ない部品を描き直さない) */
  set(patch: Partial<CollabSnapshot>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof CollabSnapshot)[]) {
      if (!sameValue(snapshot[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l());
  },
  reset(): void {
    if (snapshot === COLLAB_DISABLED) return;
    snapshot = COLLAB_DISABLED;
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/**
 * 状態の一部だけを購読する。select はモジュールの関数など、描画ごとに変わらないものを渡す。
 * 値は JSON で比べ、同じなら前の参照を返す(描き直さない)
 */
export function useCollabSelector<T>(select: (s: CollabSnapshot) => T): T {
  const cache = useRef<{ snap: CollabSnapshot; value: T; key: string } | null>(null);
  const read = useCallback(() => {
    const snap = collabStore.get();
    const c = cache.current;
    if (c && c.snap === snap) return c.value;
    const value = select(snap);
    const key = JSON.stringify(value);
    if (c && c.key === key) {
      c.snap = snap;
      return c.value;
    }
    cache.current = { snap, value, key };
    return value;
  }, [select]);
  return useSyncExternalStore(collabStore.subscribe, read, read);
}

/** いまのページの部屋に入っているか(このあいだ保存の状態の代わりに接続状態を出し、自動保存を止める) */
export const selectCollabPageActive = (s: CollabSnapshot): boolean => s.enabled && s.pageActive;

/** 中継へまだ送れていない変更があるか(離脱の警告に使う) */
export const selectCollabUnsynced = (s: CollabSnapshot): boolean => s.enabled && (s.unsynced > 0 || s.status === 'offline');

/** 共同編集中の取り消しの状態(Y.UndoManager) */
export const selectCollabUndo = (s: CollabSnapshot) => ({ canUndo: s.canUndo, canRedo: s.canRedo });

let flusher: (() => void) | null = null;

/** 編集中の紙面の束縛が「まだ送っていない変更を今すぐ送る」関数を登録する(離れるときは null) */
export function setCollabFlusher(flush: (() => void) | null): void {
  flusher = flush;
}

/** まだ送っていない変更を今すぐ送る(手動保存・ページ切替の直前)。共同編集していなければ何もしない */
export function flushCollab(): void {
  flusher?.();
}

let sharedReader: ((contentId: string) => string | null) | null = null;

/** 接続の実体が「そのページの部屋に本文があれば返す」関数を登録する(抜けるときは null) */
export function setCollabSharedReader(reader: ((contentId: string) => string | null) | null): void {
  sharedReader = reader;
}

/**
 * そのページの部屋に既に同期済みの本文があれば、エディタに渡す HTML(decode 済み)を返す。
 * 共同編集中のページ切替で、ファイル(まだ書き戻されていないことがある)より部屋の本文を優先するために使う
 */
export function readCollabSharedHtml(contentId: string): string | null {
  if (!sharedReader) return null;
  try {
    return sharedReader(contentId);
  } catch {
    return null;
  }
}

export type CollabPresence = {
  enabled: boolean;
  status: CollabStatus;
  self: CollabUser | null;
  /** 自分以外のエディタ(同じ人が複数のタブで開いていても 1 人) */
  peers: CollabPeer[];
  bridges: number;
};

const selectPresence = (s: CollabSnapshot): CollabPresence => ({
  enabled: s.enabled,
  status: s.status,
  self: s.self,
  peers: s.peers,
  bridges: s.bridges,
});

/** 誰がどのページに居るか。io.collab が無ければ enabled: false で peers は空 */
export function useCollabPresence(): CollabPresence {
  return useCollabSelector(selectPresence);
}
