/**
 * 自動保存のフラッシュ窓口。
 *
 * ページ切替(サムネイルのクリック・新しいスライドの挿入)は殻(PptChrome)側で起きるが、
 * 保存の実体はエディタ本体(FrontendVisualEditor)にしかない。
 * 殻へ props を通すと編集中の他ファイルとぶつかるため、
 * navigation.ts の registerNavCommit と同じくモジュールに窓口を1つ置いて繋ぐ。
 */

/** 未保存の変更を保存しきる関数。保存できた(または保存するものが無い)なら true */
type Flush = () => Promise<boolean>

let flush: Flush | null = null

/** エディタ本体が自身の保存関数を登録する。戻り値は解除関数 */
export function registerAutoSaveFlush(fn: Flush): () => void {
  flush = fn
  return () => {
    if (flush === fn) flush = null
  }
}

/**
 * 未保存の変更を保存しきってから次の操作へ進むために呼ぶ。
 * エディタが開いていなければ何もせず true(遷移を止める理由が無い)。
 */
export async function flushAutoSave(): Promise<boolean> {
  if (!flush) return true
  try {
    return await flush()
  } catch {
    return false
  }
}

/**
 * ページ切替の途中(次の本文を読み込んで iframe を組み直している間)は、
 * 履歴の本文がまだ前のページのものなので、自動保存が走ると
 * **前のページの内容を次のページへ書いてしまう**。切替の始まりと終わりを
 * ここで印し、その間の自動保存を見送る(手動保存も同じ窓口を通る)。
 */
let switching = 0
let switchTimer: ReturnType<typeof setTimeout> | null = null

/** 切替の開始。読み込みが失敗しても永久に止まらないよう 5 秒で自動解除 */
export function beginContentSwitch(): void {
  switching++
  if (switchTimer) clearTimeout(switchTimer)
  switchTimer = setTimeout(() => {
    switching = 0
    switchTimer = null
  }, 5000)
}

/** 切替の終了(iframe の初期化が済んだ時点で EditorCanvas が呼ぶ) */
export function endContentSwitch(): void {
  if (switching > 0) switching--
  if (switching === 0 && switchTimer) {
    clearTimeout(switchTimer)
    switchTimer = null
  }
}

export function isContentSwitching(): boolean {
  return switching > 0
}
