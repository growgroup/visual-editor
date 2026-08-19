/**
 * `firebase/functions` のシム。
 *
 * 使っているのは HtmlImportDialog の「URLからHTMLを取り込む」1機能だけで、
 * 実体はサーバー側の Cloud Functions。このエディタはローカル完結のため、
 * 呼ばれたら理由を明示して失敗させる(黙って握り潰さない)。
 */
export function httpsCallable<Req = unknown, Res = unknown>(
  _functions: unknown,
  name: string,
): (data: Req) => Promise<{ data: Res }> {
  return async () => {
    throw new Error(
      `この機能(${name})はサーバー側の処理を必要とするため、ローカル版のワイヤーフレーム編集では使えません。`,
    )
  }
}
