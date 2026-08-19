/**
 * 一覧のサムネイル等で1件を描く。
 *
 * 何を描くかは利用側しか知らないので io.renderContent に任せる。
 * 渡されていなければ何も描かない（枠だけになる）。
 */
import { io } from "../io";

export function DeckSlideRender({
  page,
}: {
  page: number;
  /** 呼び出し側が渡してくるが、何を描くかは利用側が決めるのでここでは使わない */
  template?: string;
  edited?: boolean;
}) {
  const render = io().renderContent;
  return <>{render ? render(page) : null}</>;
}

export default DeckSlideRender;
