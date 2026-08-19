/**
 * ページ設定・AI機能などが使う汎用のAPI呼び出し。
 *
 * 実体は利用側が渡す io.apiFetch。渡されていなければ「未提供」として
 * 404相当のエラーを投げる。呼び出し側は 404 を「まだ無い」として
 * 静かに既定値へ落ちる作りになっている。
 */
import { io } from "../../io";

export class AuthFetchError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthFetchError";
    this.status = status;
  }
}

export type AuthFetchOptions = RequestInit;

type Api = {
  get: (path: string) => Promise<any>;
  post: (path: string, body?: unknown) => Promise<any>;
  patch: (path: string, body?: unknown) => Promise<any>;
  put: (path: string, body?: unknown) => Promise<any>;
  delete: (path: string) => Promise<any>;
};

const send = async (path: string, init?: RequestInit) => {
  const fn = io().apiFetch;
  if (!fn) {
    // 利用側がこのAPIを持っていない。呼び出し側は 404 を「無い」として扱う
    throw new AuthFetchError(`HTTP 404: Not Found (apiFetch 未提供): ${path}`, 404);
  }
  return fn(path, init);
};

const withBody = (method: string) => (path: string, body?: unknown) =>
  send(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** 呼び出し側の形を変えないため、引数(getIdToken)は受け取るだけで使わない */
export async function createAuthApi(_getIdToken?: () => Promise<string | null>): Promise<Api> {
  return {
    get: (path) => send(path),
    post: withBody("POST"),
    patch: withBody("PATCH"),
    put: withBody("PUT"),
    delete: (path) => send(path, { method: "DELETE" }),
  };
}

export async function createAuthFetch(_getIdToken?: () => Promise<string | null>) {
  return (path: string, init?: RequestInit) => send(path, init);
}
