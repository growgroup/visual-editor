/**
 * ユーザーのロック(⌘⇧L・レイヤーパネルの鍵)。
 *
 * 属性名は `data-gg-locked`。部品定義の `element.locked` が以前から `data-locked="true"` を
 * 付けている(component-renderer.ts)ので、同じ名前にするとロックの CSS(pointer-events:none)や
 * 鍵の印が部品にまで効いてしまう。`data-gg-*` は部品の定義を作るとき(parts.ts の stripEditorAttrs)に
 * 落ちるので、ロックが部品の定義に持ち込まれることもない。
 *
 * ロック中(本人か祖先がロック)の要素は、選ぶことはできるが(レイヤーパネル・Figma と同じ)、
 * 位置・大きさ・見た目を変える操作の対象からは一律に外す(isLockedEl / withoutLocked)。
 */

export const LOCK_ATTR = 'data-gg-locked';
export const LOCK_SELECTOR = `[${LOCK_ATTR}="true"]`;

/** 本人か祖先がロックされているか */
export function isLockedEl(el: Element): boolean {
  return typeof el.closest === 'function' && !!el.closest(LOCK_SELECTOR);
}

/** 編集の対象からロック中の要素を外す */
export function withoutLocked<T extends Element>(els: T[]): T[] {
  return els.filter((el) => !isLockedEl(el));
}
