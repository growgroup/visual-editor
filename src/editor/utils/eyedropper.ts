/**
 * スポイト(画面から色を1点拾う)。ChromeのEyeDropper APIの薄いラッパー。
 *
 * 【呼び出しの決まり】
 * EyeDropper.open() は**ユーザー操作(クリック等)から直接**呼ばないとブラウザに拒否される。
 * setTimeout や await をはさんだ後から呼ばないこと。
 *
 * 【未対応ブラウザ】
 * Safari / Firefox には無い。ボタン自体を出さないよう isEyeDropperSupported() で分岐する
 * (押せるのに何も起きないボタンを置かない)。
 */

import { debugLog } from './debug';

/** この環境でスポイトが使えるか */
export function isEyeDropperSupported(): boolean {
  return typeof window !== 'undefined' && 'EyeDropper' in window;
}

type EyeDropperLike = { open(): Promise<{ sRGBHex: string }> };

/**
 * 画面から色を1点拾って #rrggbb で返す。
 * 未対応・ユーザーが Esc で取り消した場合は null(どちらも異常ではない)。
 */
export async function pickScreenColor(): Promise<string | null> {
  if (!isEyeDropperSupported()) return null;
  try {
    const Ctor = (window as unknown as { EyeDropper: new () => EyeDropperLike }).EyeDropper;
    const result = await new Ctor().open();
    return result?.sRGBHex || null;
  } catch (e) {
    // Escでの取り消しもここに来るので、握りつぶしてよい
    debugLog('EyeDropper canceled or failed', e);
    return null;
  }
}
