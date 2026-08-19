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
