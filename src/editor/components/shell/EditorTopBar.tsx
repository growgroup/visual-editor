"use client";

/**
 * エディタ共通の最上段バー。
 *
 * Figma風UIとPowerPoint風UIで「殻」は違っても、最上段でやることは同じ:
 *   一覧へ戻る / UI切替 | デッキタイトル | 自動保存の状態 / 保存 / プレビュー / 共有 / 閉じる
 * 同じ操作が2つのUIで別の場所・別の並びにあると、UIを切り替えるたびに探し直しになる。
 * ここに1本化して、variant では**配色だけ**を変える。
 *
 * 【設計の約束】ここは見た目の殻。保存は effectiveSave、書き出しは lib/export、
 * 閉じるは FVE の handleClose を呼ぶだけで、ロジックを二重に持たない。
 * UI固有の操作(PPT: 元に戻す/検索/テーマ, Figma: ズーム/…メニュー)は
 * leftExtra / rightExtra / menuExtra のスロットで受け取り、この並びを崩さない。
 */

import { toast } from 'sonner';
import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import { AlertCircle, CheckCircle2, Clock3, ArrowLeft, ChevronDown, Download, FileText, Loader2, PenTool, Play, Save, X } from 'lucide-react';
import { useEditorContext } from '../../EditorContext';
import { getCleanHtml } from '../../utils/html-utils';
import { startExport, waitForExport, downloadExport, type ExportFormat } from '../../../lib/export';
import { can } from '../../../io';
import { CollabPresence, CollabStatusPill } from '../../collab/CollabPresence';
import { useCollabSelector, selectCollabPageActive } from '../../collab/store';

export type EditorSaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

/**
 * 配色。PowerPoint風は PPT_PALETTES[theme] をそのまま渡してもらう
 * (PptChrome から import すると循環参照になるため、値は呼び出し側から受け取る)。
 */
export type TopBarPalette = {
  chrome: string;
  text: string;
  sub: string;
  border: string;
  hover: string;
  activeBg: string;
  control: string;
  disabled: string;
};

/** Figma風の配色(editor-skin.css のパネル色に合わせる) */
const FIGMA_PALETTE: TopBarPalette = {
  chrome: 'var(--ed-panel)', text: 'var(--ed-text)', sub: 'var(--ed-muted)',
  border: 'var(--ed-line)', hover: 'var(--ed-surface-hover)', activeBg: 'var(--ed-accent-soft)',
  control: 'var(--ed-panel-raised)', disabled: 'var(--ed-muted)',
};

/** 共有ボタンの色だけはUIの「顔」なのでテーマごとに持つ */
const SHARE_COLOR = {
  figma: { bg: 'var(--ed-accent-strong)', fg: '#ffffff' },
  ppt: { bg: 'var(--ed-accent-strong)', fg: '#ffffff' },
} as const;

export interface EditorTopBarProps {
  variant: 'figma' | 'ppt';
  /** PowerPoint風の配色。省略時はFigma風の配色 */
  palette?: TopBarPalette;
  /** 中央に出すデッキ(スライド)のタイトル */
  title?: string;
  /** 編集中スライドの番号(1始まり)。プレビューで開くページにも使う */
  pageNumber?: number;
  saveStatus?: EditorSaveStatus;
  /** 保存の実体。FVEの effectiveSave をそのまま渡す */
  onSave: (html: string) => Promise<void> | void;
  /** ページ設定(CSS/JS等)も併せて保存する場合に渡す */
  onSaveSettings?: () => Promise<void>;
  onClose: () => void;
  /** マルチページキャンバスからの編集。閉じる=「キャンバスに戻る」になる */
  isCanvasEditing?: boolean;
  /** もう一方のUIへ切り替える */
  onSwitchUi?: () => void;
  /** 一覧へ戻る/UI切替の右。UI固有の操作(PPT: 元に戻す・やり直し) */
  leftExtra?: React.ReactNode;
  /** 保存状態の左。UI固有の操作(Figma: ズーム / PPT: 検索・テーマ) */
  rightExtra?: React.ReactNode;
  /** 共有と閉じるの間。UI固有のメニュー(Figma: …) */
  menuExtra?: React.ReactNode;
  /**
   * 「一覧へ戻る」を出すか。
   * 一覧が無い使い方（1ページずつ編集する等）では出さない。
   */
  showBackToList?: boolean;
}

export function EditorTopBar({
  variant,
  palette,
  title,
  pageNumber,
  saveStatus = 'saved',
  onSave,
  onSaveSettings,
  onClose,
  isCanvasEditing,
  onSwitchUi,
  leftExtra,
  rightExtra,
  menuExtra,
  showBackToList = true,
}: EditorTopBarProps) {
  const pal = palette ?? FIGMA_PALETTE;
  const share = SHARE_COLOR[variant];
  const { getIframeDoc, html, saving, hasChanges } = useEditorContext();
  const collabPageActive = useCollabSelector(selectCollabPageActive);
  const [exporting, setExporting] = useState<string | null>(null);

  /**
   * 手動保存。自動保存と同じ入口(effectiveSave)を通すので、
   * 保存中フラグ・書き戻し・状態表示はすべて共通の1本で動く。
   */
  const handleSave = async () => {
    try {
      const doc = getIframeDoc();
      // 保存してもエディタは閉じない。保存は作業の中断ではない
      await onSave(doc ? getCleanHtml(doc) : html);
      if (onSaveSettings) await onSaveSettings();
    } catch (e) {
      console.error('Save error:', e);
    }
  };

  /** プレビュー = 表示専用(?clean)で今のページを別タブに開く */
  const handlePreview = () => {
    const page = pageNumber ?? 1;
    window.open(`${window.location.origin}${window.location.pathname}#/${page}?clean`, '_blank');
  };

  /** 共有 = デッキ全体をPDF/PPTXへ書き出してダウンロード */
  const runExport = async (format: ExportFormat, label: string) => {
    setExporting(label);
    try {
      const jobId = await startExport(format);
      const st = await waitForExport(jobId, () => undefined);
      downloadExport(st);
    } catch (e) {
      toast.error("書き出しに失敗しました", { description: String(e).slice(0, 120) });
    } finally {
      setExporting(null);
    }
  };

  const iconBtn = 'ed-icon-button';
  const textBtn = 'ed-button';
  const hoverIn = (e: React.MouseEvent<HTMLElement>) => {
    if (!(e.currentTarget as HTMLButtonElement).disabled) e.currentTarget.style.backgroundColor = pal.hover;
  };
  const hoverOut = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.backgroundColor = '';
  };

  return (
    <div
      data-editor-topbar={variant}
      className={`flex shrink-0 items-center gap-2 border-b px-3 ${variant === 'ppt' ? 'h-10' : 'h-11'}`}
      style={{ backgroundColor: pal.chrome, borderColor: pal.border, color: pal.text }}
    >
      {/* 左: 一覧へ戻る / UI切替 / UI固有の操作 */}
      {showBackToList && (
        <button
          data-topbar="back"
          onClick={onClose}
          title="保存して一覧へ戻る"
          className={textBtn}
          style={{ borderColor: pal.border, color: pal.sub }}
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          一覧へ
        </button>
      )}
      {onSwitchUi && (
        <button
          data-topbar="switch-ui"
          onClick={onSwitchUi}
          title={
            variant === 'ppt'
              ? 'パネル表示に切り替え'
              : 'リボン表示に切り替え'
          }
          className={textBtn}
          style={{ borderColor: pal.border, color: pal.sub }}
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
        >
          {variant === 'ppt' ? (
            <PenTool className="h-3.5 w-3.5" />
          ) : (
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-[2px] bg-[#C43E1C] text-[9px] font-bold leading-none text-white">
              P
            </span>
          )}
          {variant === 'ppt' ? 'パネル表示' : 'リボン表示'}
        </button>
      )}
      {leftExtra}

      {/* 中央: デッキタイトル + スライド番号 */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {pageNumber != null && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums" style={{ color: pal.sub }}>
            {String(pageNumber).padStart(3, '0')}
          </span>
        )}
        <span data-topbar="title" className="truncate text-[12.5px] font-semibold" style={{ color: pal.text }}>
          {title || 'ビジュアルエディタ'}
        </span>
      </div>

      {/* 右: UI固有の操作 / 自動保存 / 保存 / プレビュー / 共有 / …/ 閉じる */}
      <div className="flex shrink-0 items-center gap-1.5">
        {rightExtra}
        <CollabPresence />
        {/* 共同編集でページの部屋に入っている間は、保存の状態の代わりに接続状態を出す(ファイルに書くのは書き戻し役) */}
        {collabPageActive ? <CollabStatusPill /> : <SaveStatusPill variant={variant} status={saveStatus} pal={pal} />}
        <button
          data-topbar="save"
          onClick={() => void handleSave()}
          disabled={saving}
          title={saving ? '保存中…' : '今すぐ保存（⌘S / Ctrl+S）'}
          aria-label="保存"
          className="ed-button"
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
        >
          <Save className="h-4 w-4" />
          保存
        </button>
        {/* 書き出しは利用側の処理が要る。渡されていなければ出さない
            （押すと失敗するボタンを残さないため） */}
        {can("exportDeck") && (
          <>
          <button
            data-topbar="preview"
            onClick={handlePreview}
            title="プレビュー(表示専用で別タブに開く)"
            className={iconBtn}
            style={{ color: pal.text }}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
          >
            <Play className="h-4 w-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-topbar="share"
                title="書き出して共有"
                className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-[11px] font-semibold transition-opacity hover:opacity-90"
                style={{ backgroundColor: share.bg, color: share.fg }}
              >
                {exporting && <Loader2 className="h-3 w-3 animate-spin" />}
                {exporting ? `${exporting}を書き出し中…` : '書き出し'}
                <ChevronDown className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              data-topbar-menu="share"
              className="w-56"
              style={{ backgroundColor: pal.control, borderColor: pal.border, color: pal.text }}
            >
              <DropdownMenuItem
                onClick={() => void runExport('pdf', 'PDF')}
                className="cursor-pointer gap-2 focus:bg-white/10"
                style={{ color: pal.text }}
              >
                <FileText className="h-4 w-4" />
                PDF を書き出し
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void runExport('pptx', 'PPTX')}
                className="cursor-pointer gap-2 focus:bg-white/10"
                style={{ color: pal.text }}
              >
                <Download className="h-4 w-4" />
                PowerPoint (画像貼り込み)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void runExport('pptx-edit', 'PPTX')}
                className="cursor-pointer gap-2 focus:bg-white/10"
                style={{ color: pal.text }}
              >
                <Download className="h-4 w-4" />
                PowerPoint (編集できる)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </>
        )}
        {menuExtra}
        {isCanvasEditing ? (
          <button
            data-topbar="close"
            onClick={onClose}
            title="キャンバスに戻る"
            className={textBtn}
            style={{ borderColor: pal.border, color: pal.sub }}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            キャンバスに戻る
          </button>
        ) : (
          <button
            data-topbar="close"
            onClick={onClose}
            title="エディタを閉じる" aria-label="エディタを閉じる"
            className={iconBtn}
            style={{ color: pal.sub }}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 自動保存の状態表示。押せるものではないので、色と文言だけで状態を示す。
 * 自動保存は常時オンなので「未保存」は「このあと保存される」の意味。
 */
function SaveStatusPill({
  variant,
  status,
  pal,
}: {
  variant: 'figma' | 'ppt';
  status: EditorSaveStatus;
  pal: TopBarPalette;
}) {
  const view = {
    saved: { label: '保存済み', Icon: CheckCircle2 },
    dirty: { label: '未保存・自動保存待ち', Icon: Clock3 },
    saving: { label: '保存中…', Icon: Loader2 },
    error: { label: '保存失敗・再試行してください', Icon: AlertCircle },
  }[status];
  return (
    <span data-topbar="save-status" data-save-status={status} role="status" aria-live="polite"
      className="ed-save-status" title="編集が止まると自動保存します。保存ボタンからも保存できます。">
      <view.Icon aria-hidden="true" className={`h-4 w-4 ${status === 'saving' ? 'animate-spin' : ''}`} />
      {view.label}
    </span>
  );
}
