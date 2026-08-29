"use client";

/**
 * コメントボードの配線済み版。props なしで置ける。
 *
 *   <div className="h-screen"><CommentBoardPanel /></div>
 *
 * 取得は useDeck()、更新は commentAction() で、右パネル(PptComments)と同じ道を通る。
 * 独自のAPIは持たないので、利用側は setEditorIO を渡してあれば何もしなくてよい。
 * 名前も右パネルと同じ置き場(localStorage)を使うので、どちらで入れても引き継がれる。
 *
 * 見た目は CommentBoard(純UI)が持つ。ここは「置き場との配線」だけを持つ。
 * エディタの外に単独で置ける(EditorProvider は要らない)。
 */

import { useCallback, useState } from 'react';
import { useDeck, refreshDeck } from '../../../components/viewer/useDeck';
import { commentAction } from '../../../lib/deck';
import { can } from '../../../io';
import { flushAutoSave } from '../../autosave';
import type { PptTheme } from '../ppt/PptChrome';
import { loadAuthor, storeAuthor } from '../ppt/PptComments';
import { CommentBoard } from './CommentBoard';

export type CommentBoardPanelProps = {
  /** 配色。既定は light(サーバー描画でずれないよう固定値にしている) */
  theme?: PptTheme;
  /**
   * 列ヘッダーの「このページを開く」。
   * 既定はエディタのページ遷移(#/edit/N)。
   * 独自のルーティングを持つ利用側(例: /edit?path=…)はここで差し替える。
   */
  onOpenPage?: (page: number) => void;
  /** 外枠に足すclass。高さは親が持つ前提 */
  className?: string;
};

export function CommentBoardPanel({ theme = 'light', onOpenPage, className }: CommentBoardPanelProps) {
  const deck = useDeck();
  /** 置き場が commentAction を渡していなければ、操作UIは出さず閲覧だけにする */
  const editable = can('commentAction');

  const [author, setAuthor] = useState(loadAuthor);
  const [busy, setBusy] = useState(false);

  const saveAuthor = useCallback((value: string) => {
    setAuthor(value);
    storeAuthor(value);
  }, []);

  /**
   * コメント操作の共通処理(右パネルの run と同じ形)。
   * 違いは戻り値だけ —— 成否を返し、成功したときだけ入力欄を空にする。
   * 失敗しても消えると、書いた返信が飛んで戻せない。
   */
  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      if (busy) return false;
      setBusy(true);
      try {
        await fn();
        await refreshDeck();
        return true;
      } catch (e) {
        window.alert(`コメント操作に失敗しました: ${String(e).slice(0, 120)}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const handleResolve = useCallback(
    (page: number, commentId: string, resolved: boolean) =>
      run(() => commentAction(page, { action: 'resolve', commentId, resolved })),
    [run],
  );

  const handleReply = useCallback(
    (page: number, commentId: string, text: string) =>
      run(() =>
        commentAction(page, {
          action: 'reply',
          commentId,
          author: author.trim() || 'ゲスト',
          text,
        }),
      ),
    [run, author],
  );

  const handleDelete = useCallback(
    async (page: number, commentId: string) => {
      if (!window.confirm('このコメントスレッドを削除しますか?')) return false;
      return run(() => commentAction(page, { action: 'delete', commentId }));
    },
    [run],
  );

  const handleOpenPage = useCallback(
    async (page: number) => {
      if (onOpenPage) {
        onOpenPage(page);
        return;
      }
      // 既定はサムネイル(PptThumbnails)と同じ導線。
      // 未保存があれば保存してから移り、保存できなかったときだけ確認に落とす
      if (!(await flushAutoSave())) {
        if (!window.confirm('保存に失敗しました。変更を破棄して移動しますか?')) return;
      }
      window.location.hash = `#/edit/${page}`;
    },
    [onOpenPage],
  );

  return (
    <CommentBoard
      deck={deck}
      loading={!deck.loaded}
      busy={busy}
      author={author}
      theme={theme}
      className={className}
      onOpenPage={(page) => void handleOpenPage(page)}
      /* 操作は commentAction がある場合だけ渡す。無ければUIごと出ない */
      onAuthorChange={editable ? saveAuthor : undefined}
      onResolve={editable ? handleResolve : undefined}
      onReply={editable ? handleReply : undefined}
      onDelete={editable ? handleDelete : undefined}
    />
  );
}
