"use client";

import { useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCcw,
  Import,
  Code,
  Braces,
  Settings,
  FileText,
  FolderArchive,
  ChevronDown,
  MoreHorizontal,
  MessageSquare,
} from "lucide-react";
import { useEditorContext } from "../EditorContext";
import { EditorTopBar } from "./shell/EditorTopBar";
import { MIN_ZOOM, MAX_ZOOM, editorZoomApiRef } from "../hooks/useCanvasControls";
import { generateEditableHtml } from "../utils/html-utils";
import { useDeck } from "../../components/viewer/useDeck";
import { unresolvedCount } from "./ppt/PptComments";
import {
  convertToAbsolutePositioning,
  buildDomTree,
  getArtboardContent,
} from "../utils/dom-utils";
import { can } from "../../io";

interface EditorHeaderProps {
  /** コメントパネルの開閉(Figma風にもPowerPoint同等のコメントを出す) */
  comments?: { open: boolean; toggle: () => void; page: number };
  /** PowerPoint風UIへの切り替え(任意) */
  onSwitchUi?: () => void;
  onSave: (html: string) => Promise<void>;
  onSaveSettings?: () => Promise<void>;
  onClose: () => void;
  /**
   * 自動保存の状態。エディタ本体(FrontendVisualEditor)が算出したものを表示するだけ。
   * dirty=このあと自動保存される / saving=保存中 / saved=保存済み / error=自動保存に失敗
   */
  saveStatus?: 'saved' | 'dirty' | 'saving' | 'error';
  /** キャンバス編集モード: trueの場合、閉じるボタンを「キャンバスに戻る」に変更 */
  isCanvasEditing?: boolean;
  onImport?: () => void;
  onCssEdit?: () => void;
  hasCss?: boolean;
  onJsEdit?: () => void;
  hasJs?: boolean;
  onPageSettings?: () => void;
  hasPageSettings?: boolean;
  onExport?: (format: 'html' | 'zip') => void;
  /** [移植時の追加] 編集中スライドの番号(1始まり)。ビューアと同じ文脈表示に使う */
  contextNumber?: number;
  /** [移植時の追加] 編集中スライドのタイトル */
  contextTitle?: string;
  /** トップバー左端に置く利用側の導線(別画面へのリンク等) */
  headerExtra?: React.ReactNode;
}

export function EditorHeader({
  onSwitchUi,
  onSave,
  onSaveSettings,
  onClose,
  saveStatus = 'saved',
  isCanvasEditing,
  onImport,
  onCssEdit,
  hasCss,
  onJsEdit,
  hasJs,
  onPageSettings,
  hasPageSettings,
  onExport,
  contextNumber,
  comments,
  contextTitle,
  headerExtra,
}: EditorHeaderProps) {
  const {
    iframeRef,
    originalHtml,
    zoom,
    setZoom,
    fitZoom,
    setSelectedElement,
    setSelectedElementIds,
    setHtml,
    getIframeDoc,
    layoutMode,
    setLayoutMode,
    notifyIframeChange,
    setDomTree,
    setExpandedNodes,
    autoLayoutHtml,
    setAutoLayoutHtml,
    editorMode,
  } = useEditorContext();

  // 保存・共有・プレビュー・閉じるは共通トップバー(EditorTopBar)が持つ。
  // ここに実装を残すと、PowerPoint風UIと2本の保存経路ができてしまう

  // リセット処理
  const handleReset = () => {
    const iframe = iframeRef.current;
    if (iframe) {
      const blob = new Blob([generateEditableHtml(originalHtml, editorMode)], {
        type: "text/html",
      });
      iframe.src = URL.createObjectURL(blob);
    }
    setHtml(originalHtml);
    setSelectedElement(null);
    setSelectedElementIds([]);
  };

  // レイアウトモード切替
  const handleLayoutModeChange = (mode: "absolute" | "auto") => {
    // Webページを絶対配置へ倒すと流し込みレイアウトが固定ピクセルに固まるため受け付けない
    if (editorMode === "webpage" && mode === "absolute") return;
    // キャンバスモードでは状態が実際の表示と不整合の場合があるため、
    // 同じモードでもクリック時に強制変換する（isCanvasEditing時）
    if (mode === layoutMode && !isCanvasEditing) return;

    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    if (mode === "absolute") {
      // オートレイアウト → 絶対配置: 変換前のHTMLを保存（リセット用）
      setAutoLayoutHtml(getArtboardContent(iframeDoc));

      // 全要素を絶対配置に変換
      const count = convertToAbsolutePositioning(iframeDoc);
      console.log(
        "[Header] Converted",
        count,
        "elements to absolute positioning",
      );

      // DOMツリーを再構築
      const tree = buildDomTree(iframeDoc);
      setDomTree(tree);
      setExpandedNodes(new Set(tree.map((n) => n.id)));

      // 変更を通知
      notifyIframeChange();
    } else if (mode === "auto") {
      // [移植時の修正] 絶対配置 → オートレイアウト
      // 元実装はインラインstyleを削るだけで、classベースのレイアウト
      // (Tailwind等)が絶対配置変換で崩れたケースを復元できなかった。
      // 変換前に保存した autoLayoutHtml があればそれを復元する。
      if (autoLayoutHtml) {
        const ok = window.confirm(
          "オートレイアウトに戻します。\n絶対配置モードで加えた変更は破棄され、切り替え前の状態に復元されます。よろしいですか?",
        );
        if (!ok) return;
        const artboard = iframeDoc.getElementById("artboard");
        if (artboard) {
          artboard.innerHTML = autoLayoutHtml;
          setAutoLayoutHtml(null);
          const restoredTree = buildDomTree(iframeDoc);
          setDomTree(restoredTree);
          setExpandedNodes(new Set(restoredTree.map((n) => n.id)));
          setSelectedElement(null);
          setSelectedElementIds([]);
          notifyIframeChange();
          setLayoutMode(mode);
          return;
        }
      }

      // フォールバック: 変換前HTMLが無い場合は従来どおりインラインstyleを削除
      let editableElements = iframeDoc.querySelectorAll(
        '[data-editable="true"]',
      );
      // フォールバック: data-editableが無い場合は#artboard直下のdata-element-id要素
      if (editableElements.length === 0) {
        editableElements = iframeDoc.querySelectorAll(
          '#artboard > [data-element-id]',
        );
      }
      editableElements.forEach((el) => {
        const element = el as HTMLElement;
        // 絶対配置関連のスタイルを削除
        element.style.removeProperty("position");
        element.style.removeProperty("left");
        element.style.removeProperty("top");
        // width/heightは削除（autoに戻す）
        element.style.removeProperty("width");
        element.style.removeProperty("height");
        element.style.removeProperty("margin");
        element.style.removeProperty("flex");
        element.style.removeProperty("flex-grow");
        element.style.removeProperty("flex-shrink");
      });
      console.log(
        "[Header] Removed absolute positioning from",
        editableElements.length,
        "elements",
      );

      // 保存したHTMLをクリア
      setAutoLayoutHtml(null);

      // DOMツリーを再構築
      const tree = buildDomTree(iframeDoc);
      setDomTree(tree);
      setExpandedNodes(new Set(tree.map((n) => n.id)));

      // 選択をクリア
      setSelectedElement(null);
      setSelectedElementIds([]);

      // 変更を通知
      notifyIframeChange();
    }

    setLayoutMode(mode);
  };

  // ズーム操作
  //
  // [移植時の修正] 刻みは従来どおり 10% のままにして、頭打ちの値だけ直す。
  // 以前は上限200%/下限25%で止めていたが、キャンバス側(useCanvasControls)の
  // 実際の可動域は 10〜400%。ボタンだけ手前で止まるため、ホイールで250%まで
  // 拡大したあとに「＋を押しても何も起きない」状態が生まれていた。
  const clampZoom = (v: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v));
  const canZoomIn = zoom < MAX_ZOOM - 0.01;
  const canZoomOut = zoom > MIN_ZOOM + 0.01;

  const handleZoomIn = () => setZoom(clampZoom(Math.floor(zoom / 10) * 10 + 10));
  const handleZoomOut = () => setZoom(clampZoom(Math.ceil(zoom / 10) * 10 - 10));
  // 全体表示/100% はキャンバス側(useCanvasControls)の実装に委ねる。
  // Cmd+0 / Cmd+1 と同じ関数を呼ぶことで、「ヘッダーから押したときだけ
  // 固定点の扱いが違う」というズレを作らない。未登録時は従来どおり値を入れる。
  const handleFitZoom = () => {
    const api = editorZoomApiRef.current;
    if (api) api.fit();
    else setZoom(fitZoom);
  };
  const handleActualZoom = () => {
    const api = editorZoomApiRef.current;
    if (api) api.actual();
    else setZoom(100);
  };

  // 倍率表示のメニュー
  //
  // [移植時の修正] ここは以前ただの <span> で、ダブルクリックしたときだけ
  // 100% に戻るという隠し機能があるだけだった。倍率は「見るもの」ではなく
  // 「決めるもの」なので、押せることが分かるボタンにして
  // 全体表示 / 100% / 50% / 200% と直接入力をまとめて置く。
  // 検証・自動操作から掴みやすいよう data-zoom-* を目印に付けている。
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [zoomInput, setZoomInput] = useState("");
  const zoomInputRef = useRef<HTMLInputElement>(null);

  const applyZoomInput = () => {
    const parsed = parseFloat(zoomInput);
    if (!Number.isFinite(parsed)) return;
    setZoom(clampZoom(parsed));
    setZoomMenuOpen(false);
  };

  const openZoomMenu = (open: boolean) => {
    setZoomMenuOpen(open);
    if (!open) return;
    // 開いたときは現在値を初期値にする（そのまま Enter しても倍率が変わらない）
    setZoomInput(String(Math.round(zoom)));
    // Radix のメニューは開くと先頭項目にフォーカスを移すので、
    // その後（2フレーム後）に数値入力へ移し替える。開いてすぐ数字を打てる状態にする。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        zoomInputRef.current?.focus();
        zoomInputRef.current?.select();
      });
    });
  };

  return (
    <EditorTopBar
      variant="figma"
      /* 一覧・PPT風UIはスライドのデッキが前提。Webページでは出さない */
      showBackToList={editorMode !== "webpage"}
      title={contextTitle}
      pageNumber={contextNumber}
      saveStatus={saveStatus}
      onSave={onSave}
      onSaveSettings={onSaveSettings}
      onClose={onClose}
      isCanvasEditing={isCanvasEditing}
      onSwitchUi={editorMode === "webpage" ? undefined : onSwitchUi}
      /* 利用側の導線。一覧へ戻る/UI切替が出ない使い方では左端が空くので、そこに並ぶ */
      leftExtra={headerExtra}
      /* Figma風の固有機能: ズームコントロール */
      rightExtra={
        <div className="flex items-center gap-1">
          {comments && can("commentAction") && (
            <CommentToggleButton open={comments.open} page={comments.page} onToggle={comments.toggle} />
          )}
          {/* [移植時の修正] 押しても何も起きないボタンを作らないため、
              可動域の端では disabled にして「これ以上は無い」ことを見た目で示す。
              title にショートカットを併記して、キー操作の存在も分かるようにした。 */}
          <Button
            variant="ghost"
            size="icon"
            data-zoom-out
            onClick={handleZoomOut}
            disabled={!canZoomOut}
            title={canZoomOut ? "縮小" : `これ以上縮小できません（下限 ${MIN_ZOOM}%）`}
            className="h-7 w-7 text-gray-400 hover:text-white hover:bg-[#444444] disabled:opacity-30"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          {/* 倍率表示（押せる） */}
          <DropdownMenu open={zoomMenuOpen} onOpenChange={openZoomMenu}>
            <DropdownMenuTrigger asChild>
              <button
                data-zoom-menu
                title="表示倍率（クリックでメニュー・⌘0 全体表示 / ⌘1 100% / ⌘2 選択範囲）"
                className="flex h-7 min-w-[3.5rem] items-center justify-center gap-0.5 rounded-md text-xs tabular-nums text-gray-300 transition-colors hover:bg-[#444444] hover:text-white"
              >
                {Math.round(zoom)}%
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-48 bg-[#2c2c2c] border-[#444444]">
              {/* 数値入力。メニューのキー操作（先頭文字ジャンプ等）に数字を食われないよう
                  この階層で keydown を止める */}
              <div
                className="flex items-center gap-1 px-2 py-1.5"
                onKeyDown={(e) => e.stopPropagation()}
              >
                <input
                  ref={zoomInputRef}
                  data-zoom-input
                  type="number"
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  value={zoomInput}
                  onChange={(e) => setZoomInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyZoomInput();
                    }
                    if (e.key === "Escape") setZoomMenuOpen(false);
                  }}
                  className="h-7 w-full rounded border border-[#4a4a4a] bg-[#1e1e1e] px-2 text-xs tabular-nums text-white outline-none focus:border-[#0d99ff]"
                  aria-label={`表示倍率(%) ${MIN_ZOOM}〜${MAX_ZOOM}`}
                />
                <span className="text-xs text-gray-500">%</span>
                <Button
                  variant="ghost"
                  size="sm"
                  data-zoom-apply
                  onClick={applyZoomInput}
                  className="h-7 px-2 text-xs text-gray-300 hover:bg-[#444444] hover:text-white"
                >
                  適用
                </Button>
              </div>
              <DropdownMenuSeparator className="bg-[#444444]" />
              <DropdownMenuItem
                data-zoom-preset="fit"
                onClick={handleFitZoom}
                className="cursor-pointer justify-between text-gray-300 hover:bg-[#444444] hover:text-white"
              >
                全体表示
                <span className="text-[10px] text-gray-500">⌘0</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                data-zoom-preset="100"
                onClick={handleActualZoom}
                className="cursor-pointer justify-between text-gray-300 hover:bg-[#444444] hover:text-white"
              >
                100%
                <span className="text-[10px] text-gray-500">⌘1</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                data-zoom-preset="50"
                onClick={() => setZoom(50)}
                className="cursor-pointer text-gray-300 hover:bg-[#444444] hover:text-white"
              >
                50%
              </DropdownMenuItem>
              <DropdownMenuItem
                data-zoom-preset="200"
                onClick={() => setZoom(200)}
                className="cursor-pointer text-gray-300 hover:bg-[#444444] hover:text-white"
              >
                200%
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            data-zoom-in
            onClick={handleZoomIn}
            disabled={!canZoomIn}
            title={canZoomIn ? "拡大" : `これ以上拡大できません（上限 ${MAX_ZOOM}%）`}
            className="h-7 w-7 text-gray-400 hover:text-white hover:bg-[#444444] disabled:opacity-30"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            data-zoom-fit
            onClick={handleFitZoom}
            className="h-7 w-7 text-gray-400 hover:text-white hover:bg-[#444444]"
            title="全体を表示（⌘0）"
          >
            <Maximize className="h-4 w-4" />
          </Button>
          <div className="mx-1 h-4 w-px bg-[#444444]" />
        </div>
      }
      /*
        [移植時の修正] リセット/インポート/CSS/JS/設定/エクスポートが常時並んでいて
        ヘッダーが横に伸び、編集中スライド名の居場所が無くなっていた。
        主要導線(保存・共有・閉じる)は共通トップバーが持ち、残りは「…」メニューへ畳む。
      */
      menuExtra={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-header-more
              className="h-7 w-7 text-gray-400 hover:bg-[#444444] hover:text-white"
              title="その他の操作"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 bg-[#2c2c2c] border-[#444444]">
            <DropdownMenuItem onClick={handleReset} className="cursor-pointer gap-2 text-gray-300 hover:bg-[#444444] hover:text-white">
              <RotateCcw className="h-4 w-4" />
              変更をリセット
            </DropdownMenuItem>
            {onImport && (
              <DropdownMenuItem onClick={onImport} className="cursor-pointer gap-2 text-gray-300 hover:bg-[#444444] hover:text-white">
                <Import className="h-4 w-4" />
                インポート
              </DropdownMenuItem>
            )}
            {(onCssEdit || onJsEdit || onPageSettings) && <DropdownMenuSeparator className="bg-[#444444]" />}
            {onCssEdit && (
              <DropdownMenuItem onClick={onCssEdit} className={`cursor-pointer gap-2 hover:bg-[#444444] hover:text-white ${hasCss ? 'text-[#4fb8ff]' : 'text-gray-300'}`}>
                <Code className="h-4 w-4" />
                {hasCss ? 'CSSを編集' : 'CSSを追加'}
              </DropdownMenuItem>
            )}
            {onJsEdit && (
              <DropdownMenuItem onClick={onJsEdit} className={`cursor-pointer gap-2 hover:bg-[#444444] hover:text-white ${hasJs ? 'text-yellow-400' : 'text-gray-300'}`}>
                <Braces className="h-4 w-4" />
                {hasJs ? 'JSを編集' : 'JSを追加'}
              </DropdownMenuItem>
            )}
            {onPageSettings && (
              <DropdownMenuItem onClick={onPageSettings} className={`cursor-pointer gap-2 hover:bg-[#444444] hover:text-white ${hasPageSettings ? 'text-green-400' : 'text-gray-300'}`}>
                <Settings className="h-4 w-4" />
                ページ設定
              </DropdownMenuItem>
            )}
            {onExport && (
              <>
                <DropdownMenuSeparator className="bg-[#444444]" />
                <DropdownMenuItem onClick={() => onExport('html')} className="cursor-pointer gap-2 text-gray-300 hover:bg-[#444444] hover:text-white">
                  <FileText className="h-4 w-4" />
                  HTMLで書き出し
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onExport('zip')} className="cursor-pointer gap-2 text-gray-300 hover:bg-[#444444] hover:text-white">
                  <FolderArchive className="h-4 w-4" />
                  ZIPで書き出し（画像含む）
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );
}


/**
 * Figma風トップバーのコメントトグル。実機Figmaの吹き出しアイコンに相当し、
 * 未解決コメント数をバッジで示す(PowerPoint風のコメントピルと同じ情報)。
 */
function CommentToggleButton({
  open, page, onToggle,
}: {
  open: boolean;
  page: number;
  onToggle: () => void;
}) {
  const deck = useDeck();
  const count = unresolvedCount(deck.slides[page - 1]?.comments);
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onToggle}
      title="コメントパネルの表示/非表示"
      className={`relative h-8 w-8 hover:bg-[#444444] ${open ? "text-[#4fb8ff]" : "text-gray-400 hover:text-white"}`}
    >
      <MessageSquare className="h-4 w-4" />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 rounded-full bg-[#0d99ff] px-1 text-[9px] font-bold leading-[14px] text-white">
          {count}
        </span>
      )}
    </Button>
  );
}
