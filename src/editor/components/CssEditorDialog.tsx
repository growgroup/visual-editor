'use client';

/**
 * CSSエディタダイアログ
 * インポートされたCSSを編集するためのダイアログ
 */

import { useState, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { Code, Trash2, RefreshCw } from 'lucide-react';

export interface CssEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialCss: string;
  onSave: (css: string) => void;
  onClear?: () => void;
}

export function CssEditorDialog({
  isOpen,
  onClose,
  initialCss,
  onSave,
  onClear,
}: CssEditorDialogProps) {
  const [css, setCss] = useState(initialCss);
  const [hasChanges, setHasChanges] = useState(false);

  // ダイアログが開かれたときに初期値をセット
  useEffect(() => {
    if (isOpen) {
      setCss(initialCss);
      setHasChanges(false);
    }
  }, [isOpen, initialCss]);

  // CSS変更ハンドラ
  const handleCssChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCss(e.target.value);
    setHasChanges(e.target.value !== initialCss);
  }, [initialCss]);

  // 保存ハンドラ
  const handleSave = useCallback(() => {
    onSave(css);
    onClose();
  }, [css, onSave, onClose]);

  // クリアハンドラ
  const handleClear = useCallback(() => {
    if (onClear) {
      onClear();
      onClose();
    }
  }, [onClear, onClose]);

  // リセットハンドラ
  const handleReset = useCallback(() => {
    setCss(initialCss);
    setHasChanges(false);
  }, [initialCss]);

  // CSSの行数を計算
  const lineCount = css.split('\n').length;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[900px] w-[90vw] h-[90vh] max-h-[90vh] bg-[#2c2c2c] border-[#444444] text-white flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="text-white flex items-center gap-2">
            <Code className="w-5 h-5" />
            インポートCSS編集
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
          {/* 情報 */}
          <div className="text-xs text-gray-400 flex items-center justify-between flex-shrink-0">
            <span>
              インポート時に抽出されたCSSを編集できます。
              変更はリアルタイムでプレビューに反映されます。
            </span>
            <span className="text-gray-500">
              {lineCount}行 / {css.length}文字
            </span>
          </div>

          {/* CSSエディタ */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <Textarea
              value={css}
              onChange={handleCssChange}
              className="w-full h-full bg-[#1e1e1e] border-[#444444] text-white font-mono text-sm resize-none"
              placeholder={`.class-name {
  property: value;
}

/* ホバー状態 */
.button:hover {
  background-color: #0066ff;
}

/* メディアクエリ */
@media (max-width: 768px) {
  .container {
    padding: 1rem;
  }
}`}
            />
          </div>

          {/* CSSがない場合のヒント */}
          {!initialCss && !css && (
            <div className="text-xs text-gray-500 p-3 bg-[#1e1e1e] rounded border border-[#444444] flex-shrink-0">
              💡 ヒント: URLからHTMLをインポートすると、ページのCSSも自動的に抽出されます。
              手動でCSSを追加することもできます。
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between gap-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            {onClear && initialCss && (
              <Button
                variant="ghost"
                onClick={handleClear}
                className="text-red-400 hover:text-red-300 hover:bg-red-500/20"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                CSSを削除
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <Button
                variant="ghost"
                onClick={handleReset}
                className="text-gray-400 hover:text-white"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                リセット
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={onClose}
              className="text-gray-400 hover:text-white"
            >
              キャンセル
            </Button>
            <Button
              onClick={handleSave}
              className="bg-[#0d99ff] hover:bg-[#0c8ce9]"
            >
              適用
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CssEditorDialog;
