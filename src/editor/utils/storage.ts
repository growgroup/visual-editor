/**
 * ブラウザの記憶(localStorage / sessionStorage)への安全な出入口。
 *
 * 【なぜ関数越しにするのか】
 * 共有ドロップに置く静的なエディタは `Content-Security-Policy: sandbox`(allow-same-origin 無し)で
 * 配られる。この文脈は **opaque origin** で、`localStorage` は読むだけで SecurityError を投げる
 * (`typeof localStorage` でも投げる ── プロパティの getter が走るため)。
 * 「サイトデータをブロック」設定や、srcdoc / sandbox の紙面の中でも同じことが起きる。
 *
 * 記憶できるかどうかで挙動を変えないこと。ここは全部「読めなければ既定値、書けなければ黙って続行」。
 */

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    const s = kind === 'local' ? window.localStorage : window.sessionStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/** 読む。使えない・入っていなければ null */
export function readStorage(key: string, kind: 'local' | 'session' = 'local'): string | null {
  try {
    return storage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** 書く。使えない・容量が一杯なら黙って諦める(表示や編集は続ける) */
export function writeStorage(key: string, value: string, kind: 'local' | 'session' = 'local'): void {
  try {
    storage(kind)?.setItem(key, value);
  } catch {
    /* 記憶できなくても動作は継続 */
  }
}

/** 消す */
export function removeStorage(key: string, kind: 'local' | 'session' = 'local'): void {
  try {
    storage(kind)?.removeItem(key);
  } catch {
    /* 消せなくても動作は継続 */
  }
}
