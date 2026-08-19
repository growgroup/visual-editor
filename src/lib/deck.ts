/**
 * 一覧（デッキ）とコメントのクライアントAPI。
 *
 * 実体は利用側が渡す io。ここは呼び出し側の形を変えないための薄い層。
 * 未提供の操作は理由を明示して失敗させる（黙って何も起きないのを避ける）。
 */
import { io, notProvided, EMPTY_DECK } from "../io";
import type { EditorComment, EditorContent, EditorDeck, CommentAction } from "../io";

export type SlideComment = EditorComment;
export type DeckEntry = EditorContent;
export type Deck = EditorDeck;

export async function getDeck(): Promise<Deck> {
  const load = io().loadDeck;
  return load ? load() : EMPTY_DECK;
}

export async function commentAction(page: number, action: CommentAction): Promise<Deck> {
  const fn = io().commentAction;
  if (!fn) throw notProvided("commentAction");
  return fn(page, action);
}

const ops = () => io().deckOps ?? {};

export async function moveSlide(from: number, to: number): Promise<Deck> {
  const fn = ops().move;
  if (!fn) throw notProvided("deckOps.move");
  return fn(from, to);
}

export async function duplicateSlide(page: number): Promise<Deck> {
  const fn = ops().duplicate;
  if (!fn) throw notProvided("deckOps.duplicate");
  return fn(page);
}

export async function deleteSlide(page: number): Promise<Deck> {
  const fn = ops().remove;
  if (!fn) throw notProvided("deckOps.remove");
  return fn(page);
}

export async function updateSlideMeta(
  page: number,
  patch: { hidden?: boolean; transition?: "fade" | "push" | "zoom" | null },
): Promise<Deck> {
  const fn = ops().updateMeta;
  if (!fn) throw notProvided("deckOps.updateMeta");
  return fn(page, patch);
}

export async function insertSlide(template: string, at: number): Promise<Deck> {
  const fn = ops().insert;
  if (!fn) throw notProvided("deckOps.insert");
  return fn(template, at);
}

export async function resetSlide(page: number): Promise<Deck> {
  const fn = ops().reset;
  if (!fn) throw notProvided("deckOps.reset");
  return fn(page);
}

export async function getTemplates(): Promise<{ id: string; title: string }[]> {
  const fn = ops().templates;
  return fn ? fn() : [];
}
