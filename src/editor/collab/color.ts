/**
 * 共同編集の小道具(依存なし)。種まきの clientID と参加者の色。
 */

/** FNV-1a 32bit。UTF-8 のバイト列に掛ける(取り決め §4 の種まきと同じ式) */
export function fnv1a32(str: string): number {
  const bytes = new TextEncoder().encode(str);
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 参加者の色。白い文字を載せても読める濃さの 8 色 */
export const COLLAB_COLORS = ['#E5484D', '#E0661B', '#A77B00', '#2F9E5B', '#0E8F8A', '#1F7AE0', '#8B5CF6', '#D6409F'] as const;

/** 本人が color を渡していなければ id の hash で決める(同じ人はどの画面でも同じ色) */
export function colorFor(id: string, preferred?: string): string {
  if (preferred) return preferred;
  return COLLAB_COLORS[fnv1a32(id) % COLLAB_COLORS.length];
}

/** アバターの文字(名前の頭 1 文字) */
export function initialOf(name: string): string {
  return (name.trim() || '?').slice(0, 1).toUpperCase();
}
