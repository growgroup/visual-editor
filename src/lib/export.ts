/**
 * 書き出し（PDF / PPTX）のクライアントAPI。
 *
 * 実体は利用側の io.exportDeck。渡されていなければ書き出しUIを出さないので、
 * ここに来ることは無い（来たら理由を明示して失敗させる）。
 */
import { io, notProvided } from "../io";
import type { ExportFormat } from "../io";

export type { ExportFormat };

export type ExportStatus = {
  state: "running" | "done" | "error";
  done: number;
  total: number;
  message?: string;
  file?: string;
  downloadUrl?: string;
};

/** 利用側の実装に処理ごと委ねる。進捗の見せ方も利用側が持つ */
export async function startExport(format: ExportFormat, pages?: number[]): Promise<string> {
  const fn = io().exportDeck;
  if (!fn) throw notProvided("exportDeck");
  await fn(format, pages);
  return "done";
}

export async function getExportStatus(_jobId?: string): Promise<ExportStatus> {
  return { state: "done", done: 1, total: 1 };
}

/**
 * 進捗の待ち合わせ。
 * 実処理は io.exportDeck の中で完了しているので、ここは即座に「完了」を返す。
 * 引数は呼び出し側の形を変えないために受け取るだけ。
 */
export async function waitForExport(
  _jobId?: string,
  _onProgress?: (s: ExportStatus) => void,
): Promise<ExportStatus> {
  return { state: "done", done: 1, total: 1 };
}

export function downloadExport(status: ExportStatus): void {
  if (status.downloadUrl) window.open(status.downloadUrl, "_blank");
}
