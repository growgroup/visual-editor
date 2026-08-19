/**
 * devサーバーのAPI応答を安全に読む。
 *
 * プラグイン未読込(テンプレ更新後にdevサーバーが古いまま)だと、/__ 系は
 * 404の空応答やSPAのHTMLが返り、素の res.json() は
 * 「Unexpected end of JSON input」で落ちて原因が伝わらない。
 * ここで空/HTMLを検出して「サーバーの再起動が必要」という言葉に変える。
 */
export async function readApiJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim() || text.trimStart().startsWith('<')) {
    throw new Error(
      '開発サーバーが新しい機能を読み込んでいません。devサーバー(npm run dev)を再起動してください',
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`サーバー応答を解釈できません: ${text.slice(0, 80)}`);
  }
}
