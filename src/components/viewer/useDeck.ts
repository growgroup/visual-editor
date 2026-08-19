/**
 * 一覧（デッキ）の購読。
 *
 * エディタは「今どんな一覧か」を複数の場所（コメント数の表示・ページ一覧）で見る。
 * 取得は io に任せ、ここでは結果をアプリ全体で1つだけ持つ。
 */
import { useEffect, useSyncExternalStore } from "react";
import { getDeck } from "../../lib/deck";
import type { Deck } from "../../lib/deck";
import { EMPTY_DECK } from "../../io";

let snapshot: Deck = EMPTY_DECK;
let loaded = false;
let inflight: Promise<Deck> | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const getSnapshot = () => snapshot;

/** 取得結果をそのまま反映する（再取得は不要） */
export function applyDeck(deck: Deck) {
  snapshot = deck;
  loaded = true;
  emit();
}

/** 取り直す */
export function refreshDeck(): Promise<Deck> {
  if (inflight) return inflight;
  inflight = getDeck()
    .then((deck) => {
      applyDeck(deck);
      return deck;
    })
    .catch(() => snapshot)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export type DeckView = Deck & { loaded: boolean };

export function useDeck(): DeckView {
  const deck = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (!loaded) void refreshDeck();
  }, []);
  return { ...deck, loaded };
}
