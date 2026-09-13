'use client';

/**
 * 共同編集の表示(ヘッダーの参加者・接続状態、フレーム名とページ一覧の色の点)。
 * store.ts を購読するだけ。io.collab が無ければ何も描かない。
 */

import { useCallback } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, Loader2, PauseCircle } from 'lucide-react';
import { useEditorContext } from '../EditorContext';
import { useMultiPageCanvasOptional } from '../contexts/MultiPageCanvasContext';
import { useCollabSelector, type CollabSnapshot } from './store';
import { initialOf } from './color';

/** ヘッダーに並べるアバターの数(超えた分は +n) */
const MAX_AVATARS = 5;

const selectHeader = (s: CollabSnapshot) => ({
  enabled: s.enabled,
  ready: s.ready,
  status: s.status,
  roomError: s.roomError,
  self: s.self,
  peers: s.peers,
  bridges: s.bridges,
  requireBridge: s.requireBridge,
});

/** 参加者のアバターと書き戻し先の数。アバターのクリックでその人のページへ移る */
export function CollabPresence() {
  const s = useCollabSelector(selectHeader);
  const canvas = useMultiPageCanvasOptional();
  const { onContentChange, currentContentId, contentList } = useEditorContext();

  const goTo = useCallback(
    (id: string | null) => {
      if (!id) return;
      if (canvas) {
        // 編集をそのページへ移し、視点も寄せる(activatePage 自体は「見えていれば動かさない」)
        void canvas.activatePage(id).then((moved) => {
          if (moved) canvas.focusPage(id);
        });
        return;
      }
      if (id !== currentContentId) void onContentChange?.(id);
    },
    [canvas, currentContentId, onContentChange],
  );

  if (!s.enabled || !s.self) return null;
  // 部屋名が中継に保存されない形のときは、参加者ではなく理由を出す(繋いでいないので参加者は居ない)
  if (s.status === 'error') {
    return (
      <div data-collab-presence className="ed-collab-presence">
        <span
          data-collab-room-error
          data-collab-status="error"
          role="alert"
          className="ed-collab-bridge ed-collab-bridge-alert"
          title={`部屋名が中継に保存されない形なので繋いでいません(${s.roomError ?? ''})。保存は今までどおりファイルへ行われます`}
        >
          <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
          共同編集できません(部屋名)
        </span>
      </div>
    );
  }
  const shown = s.peers.slice(0, MAX_AVATARS);
  const more = s.peers.length - shown.length;
  const pageTitle = (id: string | null) => (id ? contentList.find((c) => c.id === id)?.title : undefined);

  return (
    <div data-collab-presence className="ed-collab-presence">
      {s.ready &&
        (s.bridges > 0 ? (
          <span data-collab-bridge={s.bridges} className="ed-collab-bridge" title="変更をファイルへ書き戻している dev サーバーの数">
            書き戻し先 {s.bridges}
          </span>
        ) : s.requireBridge ? (
          <span data-collab-bridge="0" role="alert" className="ed-collab-bridge ed-collab-bridge-alert">
            <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
            書き戻し先がありません。変更は保存されません
          </span>
        ) : (
          <span data-collab-bridge="0" className="ed-collab-bridge ed-collab-bridge-warn" title="書き戻し役(dev サーバー)が居ないので、変更はファイルに書かれていません">
            書き戻し先 0
          </span>
        ))}
      <div className="ed-collab-avatars" aria-label="共同編集の参加者">
        {shown.map((p) => {
          const title = pageTitle(p.contentId);
          return (
            <button
              key={p.user.id}
              type="button"
              data-collab-avatar={p.user.id}
              data-collab-page={p.contentId ?? ''}
              className="ed-collab-avatar"
              style={{ backgroundColor: p.user.color }}
              title={title ? `${p.user.name}: ${title}(クリックでこのページへ)` : p.user.name}
              aria-label={`${p.user.name}${title ? `(${title})` : ''}のページへ移る`}
              onClick={() => goTo(p.contentId)}
            >
              {initialOf(p.user.name)}
            </button>
          );
        })}
        {more > 0 && (
          <span className="ed-collab-avatar ed-collab-avatar-more" title={s.peers.slice(MAX_AVATARS).map((p) => p.user.name).join('、')}>
            +{more}
          </span>
        )}
        <span data-collab-self className="ed-collab-avatar ed-collab-avatar-self" style={{ backgroundColor: s.self.color }} title={`${s.self.name}(自分)`}>
          {initialOf(s.self.name)}
        </span>
      </div>
    </div>
  );
}

const selectStatus = (s: CollabSnapshot) => ({ status: s.status, pending: s.pending, unsynced: s.unsynced, roomError: s.roomError });

/** 接続状態(ページの部屋に入っている間、保存の状態の代わりに出す) */
export function CollabStatusPill() {
  const { status, pending, roomError } = useCollabSelector(selectStatus);
  const view = status === 'error'
    ? {
        label: '共同編集できません',
        Icon: AlertTriangle,
        title: `部屋名が中継に保存されない形なので繋いでいません(${roomError ?? ''})。保存は今までどおりファイルへ行われます`,
      }
    : pending
      ? { label: '反映待ち', Icon: PauseCircle, title: '入力中の要素に他の人の変更があります。入力を終えると反映します' }
      : {
          synced: { label: '同期済み', Icon: CheckCircle2, title: '変更は共同編集の中継に届いています' },
          syncing: { label: '同期中…', Icon: Loader2, title: '変更を中継へ送っています' },
          offline: { label: 'オフライン', Icon: CloudOff, title: '中継に繋がっていません。繋がると変更が送られます' },
          error: { label: '共同編集できません', Icon: AlertTriangle, title: '部屋名が中継に保存されない形です' },
        }[status];
  return (
    <span
      data-topbar="save-status"
      data-collab-status={status}
      data-collab-pending={pending ? '1' : undefined}
      role={status === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      className="ed-save-status"
      title={view.title}
    >
      <view.Icon aria-hidden="true" className={`h-4 w-4 ${status === 'syncing' && !pending ? 'animate-spin' : ''}`} />
      {view.label}
    </span>
  );
}

/** フレーム名・ページ一覧に出す、そのページに居る参加者の色の点 */
export function CollabPageDots({ contentId }: { contentId: string }) {
  const select = useCallback(
    (s: CollabSnapshot) =>
      s.enabled ? s.peers.filter((p) => p.contentId === contentId).map((p) => ({ id: p.user.id, name: p.user.name, color: p.user.color })) : [],
    [contentId],
  );
  const users = useCollabSelector(select);
  if (users.length === 0) return null;
  return (
    <span className="ed-collab-dots" data-collab-dots={contentId} aria-label={`${users.map((u) => u.name).join('、')}が編集中`}>
      {users.map((u) => (
        <span key={u.id} className="ed-collab-dot" data-collab-dot={u.id} style={{ backgroundColor: u.color }} title={u.name} />
      ))}
    </span>
  );
}
