/**
 * ページの部屋の本文(Y.Text "html")と、編集中の紙面をつなぐ(取り決め §4)。
 *
 * - 種まき: 部屋と同期して本文が空なら、読み込み直後の姿を FNV-1a の clientID で 1 回だけ入れる
 *   (同じ本文なら何人が同時に撒いても構造体の ID が同じになり、Yjs が重複を捨てる)
 * - 自分の変更: 履歴の present が変わる・打鍵する(input)たびに 120ms 間引いて、
 *   紙面(getCleanHtml → encode)と shadow の差分を 1 つの transaction で送る。同じなら送らない
 * - 他人の変更: idiomorph で紙面に当て、履歴は段を作らずに追従させる。
 *   打鍵中の要素に掛かる分は blur まで保留する。ドラッグ中は離すまで待つ
 * - 取り消し: Y.UndoManager(自分の origin だけを追う)。結果は他人の変更と同じ経路で紙面に当てる
 *
 * shadow と差分の合わせ方は merge.ts を参照
 */

import * as Y from 'yjs';
import { getCleanHtml } from '../utils/html-utils';
import { refreshSelectionOverlay } from '../utils/dom-utils';
import { fnv1a32 } from './color';
import { morphArtboard } from './morph';
import { replacementsOf, transformReplacements } from './merge';
import type { Room } from './connection';

/** 自分の変更を送る間隔(ms)。打鍵中も相手に 1 秒以内に見えるように */
const SEND_THROTTLE_MS = 120;
/** 他人の変更を当てるまでの待ち(ms)。続けて届いた更新を 1 回にまとめる */
const APPLY_DELAY_MS = 16;
/** 取り消しの 1 段にまとめる時間(ms) */
const CAPTURE_TIMEOUT_MS = 500;
/** ポインタを押している間は当てない。離した合図を取りこぼしてもこれ以上は待たない(ms) */
const POINTER_HOLD_MAX_MS = 15000;

export type BindingState = { pending: boolean; canUndo: boolean; canRedo: boolean; localPending: boolean };

export type PageBindingOptions = {
  room: Room;
  doc: Document;
  /** 読み込み直後の紙面の姿(encode 済み)。種まきに使う */
  initialShared: string;
  encode: (cleanHtml: string) => string;
  decode: (shared: string) => string;
  /** 他人の変更を当てた直後の #artboard.innerHTML(履歴の present を段を作らずに追従させる) */
  onApplied: (artboardHtml: string) => void;
  /** 自分の変更を送った(案件の部屋の pages の rev を進める) */
  onLocalSent: () => void;
  onState: (state: BindingState) => void;
};

export class PageBinding {
  private readonly opts: PageBindingOptions;
  private readonly origin = { collab: 'local' };
  private readonly text: Y.Text;
  private readonly undoManager: Y.UndoManager;
  /** 最後に Y.Text と揃えたときの紙面の姿(encode 済み) */
  private shadow: string;
  /** 部屋と一度でも同期した(それまでは送らない・当てない) */
  private synced = false;
  private destroyed = false;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private applyTimer: ReturnType<typeof setTimeout> | null = null;
  private pointerDownAt: number | null = null;
  private applyAfterPointer = false;
  private state: BindingState = { pending: false, canUndo: false, canRedo: false, localPending: false };
  private readonly cleanups: (() => void)[] = [];

  constructor(opts: PageBindingOptions) {
    this.opts = opts;
    this.text = opts.room.doc.getText('html');
    this.shadow = opts.initialShared;
    this.undoManager = new Y.UndoManager(this.text, {
      trackedOrigins: new Set([this.origin]),
      captureTimeout: CAPTURE_TIMEOUT_MS,
    });
    const onStack = () =>
      this.setState({ canUndo: this.undoManager.undoStack.length > 0, canRedo: this.undoManager.redoStack.length > 0 });
    this.undoManager.on('stack-item-added', onStack);
    this.undoManager.on('stack-item-popped', onStack);
    this.undoManager.on('stack-cleared', onStack);

    this.text.observe(this.onTextChange);

    const provider = opts.room.provider;
    const onSynced = () => this.onSynced();
    provider.on('synced', onSynced);
    this.cleanups.push(() => provider.off('synced', onSynced));

    const doc = opts.doc;
    const onInput = () => this.scheduleSend();
    // blur: 打鍵の分を送り、保留していた他人の変更を当てる(contenteditable が外れてから)
    const onFocusOut = () => {
      this.scheduleSend();
      setTimeout(() => this.scheduleApply(), 30);
    };
    const onPointerDown = () => {
      this.pointerDownAt = Date.now();
    };
    const onPointerUp = () => {
      this.pointerDownAt = null;
      if (this.applyAfterPointer) {
        this.applyAfterPointer = false;
        this.scheduleApply();
      }
    };
    doc.addEventListener('input', onInput, true);
    doc.addEventListener('focusout', onFocusOut, true);
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointerup', onPointerUp, true);
    this.cleanups.push(() => {
      doc.removeEventListener('input', onInput, true);
      doc.removeEventListener('focusout', onFocusOut, true);
      doc.removeEventListener('pointerdown', onPointerDown, true);
      doc.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointerup', onPointerUp, true);
    });

    if (provider.synced) this.onSynced();
  }

  /** 自分の変更があったかもしれない(履歴の present が変わった・打鍵した)。間引いて送る */
  scheduleSend(): void {
    if (this.destroyed) return;
    this.setState({ localPending: true });
    if (this.sendTimer) return;
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      this.flushLocal();
    }, SEND_THROTTLE_MS);
  }

  /** まだ送っていない変更を今すぐ送る(ページ切替・保存ボタン・離脱の前) */
  flush(): void {
    if (this.sendTimer) {
      clearTimeout(this.sendTimer);
      this.sendTimer = null;
    }
    this.flushLocal();
  }

  undo(): void {
    if (this.destroyed) return;
    this.flush();
    this.undoManager.undo();
  }

  redo(): void {
    if (this.destroyed) return;
    this.flush();
    this.undoManager.redo();
  }

  /** 部屋の本文(decode 済み)。空なら null */
  sharedHtml(): string | null {
    const text = this.text.toString();
    return text ? this.opts.decode(text) : null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.flush();
    this.destroyed = true;
    if (this.sendTimer) clearTimeout(this.sendTimer);
    if (this.applyTimer) clearTimeout(this.applyTimer);
    this.text.unobserve(this.onTextChange);
    this.undoManager.destroy();
    this.cleanups.forEach((fn) => fn());
  }

  // ------------------------------------------------------------

  private readonly onTextChange = (_event: Y.YTextEvent, tx: Y.Transaction) => {
    // 自分が送った変更は紙面に既にある。それ以外(他人・種まき・取り消し)は紙面へ当てる
    if (tx.origin === this.origin) return;
    this.scheduleApply();
  };

  private onSynced(): void {
    if (this.destroyed || !this.opts.room.provider.synced) return;
    if (!this.synced && this.text.length === 0 && this.opts.initialShared) this.seed(this.opts.initialShared);
    this.synced = true;
    this.flushLocal();
    this.applyRemote();
  }

  /** 空の部屋に最初の本文を入れる(取り決め §4 の手順どおり) */
  private seed(text: string): void {
    const tmp = new Y.Doc();
    tmp.clientID = fnv1a32(text) || 1;
    tmp.getText('html').insert(0, text);
    Y.applyUpdate(this.opts.room.doc, Y.encodeStateAsUpdate(tmp), 'seed');
    tmp.destroy();
  }

  private flushLocal(): void {
    if (this.destroyed) return;
    // 部屋と揃う前は送らない(同期したときに、ここまでの変更をまとめて送る)
    if (!this.synced) return;
    const doc = this.opts.doc;
    if (!doc.defaultView || !doc.getElementById('artboard')) {
      this.setState({ localPending: false });
      return;
    }
    const next = this.opts.encode(getCleanHtml(doc));
    this.setState({ localPending: false });
    if (next === this.shadow) return;
    const current = this.text.toString();
    const ops = transformReplacements(
      replacementsOf(this.shadow, next),
      current === this.shadow ? [] : replacementsOf(this.shadow, current),
    );
    this.shadow = next;
    if (ops.length === 0) return;
    this.opts.room.doc.transact(() => {
      for (const op of ops) {
        if (op.deleteCount > 0) this.text.delete(op.at, op.deleteCount);
        if (op.insert) this.text.insert(op.at, op.insert);
      }
    }, this.origin);
    this.opts.onLocalSent();
  }

  private scheduleApply(): void {
    if (this.destroyed || this.applyTimer) return;
    this.applyTimer = setTimeout(() => {
      this.applyTimer = null;
      this.applyRemote();
    }, APPLY_DELAY_MS);
  }

  private applyRemote(): void {
    if (this.destroyed || !this.synced) return;
    // 掴んで動かしている最中に書き換えると、掴んでいる要素が入れ替わる。離してから当てる
    if (this.pointerDownAt != null && Date.now() - this.pointerDownAt < POINTER_HOLD_MAX_MS) {
      this.applyAfterPointer = true;
      return;
    }
    const doc = this.opts.doc;
    const artboard = doc.getElementById('artboard');
    if (!doc.defaultView || !artboard) return;
    // 自分のまだ送っていない変更を先に送る(当て込みで紙面から消さないため)
    this.flush();
    const shared = this.text.toString();
    if (shared === this.shadow) {
      this.setState({ pending: false });
      return;
    }
    const hold = artboard.querySelector<HTMLElement>('[contenteditable="true"]');
    const { heldChanged } = morphArtboard(artboard, this.opts.decode(shared), hold);
    this.shadow = this.opts.encode(getCleanHtml(doc));
    try {
      refreshSelectionOverlay(doc);
    } catch {
      /* 選択枠が無い */
    }
    this.opts.onApplied(artboard.innerHTML);
    this.setState({ pending: !!hold && heldChanged });
  }

  private setState(patch: Partial<BindingState>): void {
    const next = { ...this.state, ...patch };
    if (
      next.pending === this.state.pending &&
      next.canUndo === this.state.canUndo &&
      next.canRedo === this.state.canRedo &&
      next.localPending === this.state.localPending
    ) return;
    this.state = next;
    this.opts.onState(next);
  }
}
