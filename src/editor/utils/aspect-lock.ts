/**
 * 縦横比ロック（アスペクト比ロック）の共有ストア
 *
 * [なぜ Context ではなくモジュールスコープなのか]
 * ロック状態を読む必要があるのは
 *   1) プロパティパネル（トグル UI と W/H 入力）— React の再描画が要る
 *   2) useDragResize のマウスハンドラ — iframe ロード時のクロージャに閉じ込められる
 * の 2 箇所。2) は「イベントハンドラが古い値を掴む」問題があるため React state を
 * そのまま渡せない（同ファイル冒頭に zoom で同じ注意書きがある）。
 * 関数で最新値を読めるモジュールスコープのストアにしておけば、両方から同じ値を見られる。
 *
 * [なぜ永続化しないのか]
 * Figma と同様、ロックは選択を変えても保たれるがセッションを越えては引き継がない。
 * リロード後に「なぜか比率が固定されている」状態を復元すると事故のもとなのでメモリ内のみ。
 */

import { useSyncExternalStore } from 'react';

let locked = false;
const listeners = new Set<() => void>();

/** 現在のロック状態（イベントハンドラからはこれを呼ぶ） */
export function isAspectRatioLocked(): boolean {
  return locked;
}

/** ロック状態を変更する（変化が無ければ通知しない） */
export function setAspectRatioLocked(next: boolean): void {
  if (locked === next) return;
  locked = next;
  listeners.forEach((listener) => listener());
}

/** 変更購読（useSyncExternalStore 用） */
export function subscribeAspectRatioLock(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/** React からロック状態を購読する */
export function useAspectRatioLock(): boolean {
  return useSyncExternalStore(
    subscribeAspectRatioLock,
    isAspectRatioLocked,
    // SSR / ハイドレーション時は必ず false（サーバに状態は無い）
    () => false,
  );
}
