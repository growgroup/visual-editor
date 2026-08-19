/**
 * 保存結果の通知。
 *
 * どう見せるかは利用側の作法があるので io.notifySave に任せる。
 * 渡されていなければ何もしない。
 */
import { io } from "../io";

export type WritebackResult = {
  status: "tsx" | "partial" | "override" | "noop" | "pending";
  message?: string;
  notes?: string[];
};

export function startCleanup(page: number): void {
  io().notifySave?.({ page });
}

export function SaveNote() {
  return null;
}
