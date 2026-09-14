/**
 * 共有する本文(文字列)の差分と、同時の変更の合わせ方。
 *
 * エディタは「最後に Y.Text と揃えた紙面の姿」(shadow)を持つ。自分の変更は
 * shadow → いまの紙面 の差分(local)で、その間に届いた他人の変更は shadow → Y.Text の差分(remote)。
 * local の位置を remote に通して Y.Text の位置へ写し、1 つの transaction で当てる。
 *
 * こうするのは、紙面と Y.Text が 1 文字も違わないとは限らないため:
 * - 打鍵中の要素に掛かる他人の変更は blur まで紙面に入れない(その間も自分の打鍵は送る)
 * - 他人の本文を当てた紙面を getCleanHtml すると、属性の並び・書き戻しの印(data-gg-dirty)などが
 *   元の文字列と少し違うことがある
 * 「Y.Text と今の紙面の差分」をそのまま送ると、前者では他人の変更を消し、後者では
 * 同じ整形を何人もが送って挿入が重なる。
 */

import diff from 'fast-diff';

/** base の [from, to) を insert に置き換える */
export type Replacement = { from: number; to: number; insert: string };

/** Y.Text に当てる 1 手(at は当てる前の Y.Text の位置) */
export type TextOp = { at: number; deleteCount: number; insert: string };

/** base → next の差分を、base の位置での置き換えの列にする(位置の昇順・重ならない) */
export function replacementsOf(base: string, next: string): Replacement[] {
  if (base === next) return [];
  const out: Replacement[] = [];
  let pos = 0;
  let current: Replacement | null = null;
  for (const [type, text] of diff(base, next)) {
    if (type === diff.EQUAL) {
      if (current) out.push(current);
      current = null;
      pos += text.length;
    } else if (type === diff.DELETE) {
      if (!current) current = { from: pos, to: pos, insert: '' };
      current.to += text.length;
      pos += text.length;
    } else {
      if (!current) current = { from: pos, to: pos, insert: '' };
      current.insert += text;
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * base の位置 → remote を当てたあとの位置。
 * remote に置き換えられた範囲の中は、その置き換えの先頭へ寄せる。
 * 同じ位置への挿入は remote が先(自分の挿入はその後ろ)
 */
function mapPosition(pos: number, remote: Replacement[]): number {
  let delta = 0;
  for (const r of remote) {
    if (pos < r.from) break;
    if (pos >= r.to) {
      delta += r.insert.length - (r.to - r.from);
      continue;
    }
    return r.from + delta;
  }
  return pos + delta;
}

/**
 * local(base の位置)を remote を当てたあとの文字列の手に写す。
 * - local の削除のうち、remote が既に置き換えた範囲は消さない(他人の挿入も消さない)
 * - local の挿入は、写した位置に入れる
 * 戻り値は位置の降順(前から当てると後ろの位置がずれるため)。同じ位置では削除 → 挿入の順
 */
export function transformReplacements(local: Replacement[], remote: Replacement[]): TextOp[] {
  const ops: (TextOp & { order: number })[] = [];
  let order = 0;
  for (const l of local) {
    // 削除: [from, to) から remote の範囲を抜いた残り。remote の挿入(幅 0)は切れ目にする
    if (l.to > l.from) {
      let start = l.from;
      for (const r of remote) {
        if (r.to < l.from || r.from > l.to) continue;
        if (r.from === r.to) {
          if (r.from > l.from && r.from < l.to) {
            if (r.from > start) ops.push({ at: mapPosition(start, remote), deleteCount: r.from - start, insert: '', order: order++ });
            start = r.from;
          }
          continue;
        }
        const cutFrom = Math.max(r.from, l.from);
        const cutTo = Math.min(r.to, l.to);
        if (cutTo <= cutFrom) continue;
        if (cutFrom > start) ops.push({ at: mapPosition(start, remote), deleteCount: cutFrom - start, insert: '', order: order++ });
        start = Math.max(start, cutTo);
      }
      if (l.to > start) ops.push({ at: mapPosition(start, remote), deleteCount: l.to - start, insert: '', order: order++ });
    }
    if (l.insert) ops.push({ at: mapPosition(l.from, remote), deleteCount: 0, insert: l.insert, order: order++ });
  }
  ops.sort((a, b) => {
    if (a.at !== b.at) return b.at - a.at;
    // 同じ位置: 削除を先に(挿入してから消すと、入れた文字を消してしまう)。挿入どうしは後のものを先に入れる
    if ((a.deleteCount > 0) !== (b.deleteCount > 0)) return a.deleteCount > 0 ? -1 : 1;
    return b.order - a.order;
  });
  return ops.map(({ at, deleteCount, insert }) => ({ at, deleteCount, insert }));
}

/** 文字列に手を当てる(検証と、Y.Text に当てる前の確かめに使う) */
export function applyTextOps(text: string, ops: TextOp[]): string {
  let out = text;
  for (const op of ops) out = out.slice(0, op.at) + op.insert + out.slice(op.at + op.deleteCount);
  return out;
}
