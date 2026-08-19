'use client';

/**
 * JSエディタダイアログ
 * インポートされたJavaScriptを編集するためのダイアログ
 */

import { useState, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { Braces, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';

export interface JsEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialJs: string;
  onSave: (js: string) => void;
  onClear?: () => void;
}

export function JsEditorDialog({
  isOpen,
  onClose,
  initialJs,
  onSave,
  onClear,
}: JsEditorDialogProps) {
  const [js, setJs] = useState(initialJs);
  const [hasChanges, setHasChanges] = useState(false);

  // ダイアログが開かれたときに初期値をセット
  useEffect(() => {
    if (isOpen) {
      setJs(initialJs);
      setHasChanges(false);
    }
  }, [isOpen, initialJs]);

  // JS変更ハンドラ
  const handleJsChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setJs(e.target.value);
    setHasChanges(e.target.value !== initialJs);
  }, [initialJs]);

  // 保存ハンドラ
  const handleSave = useCallback(() => {
    onSave(js);
    onClose();
  }, [js, onSave, onClose]);

  // クリアハンドラ
  const handleClear = useCallback(() => {
    if (onClear) {
      onClear();
      onClose();
    }
  }, [onClear, onClose]);

  // リセットハンドラ
  const handleReset = useCallback(() => {
    setJs(initialJs);
    setHasChanges(false);
  }, [initialJs]);

  // JSの行数を計算
  const lineCount = js.split('\n').length;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[900px] w-[90vw] h-[90vh] max-h-[90vh] bg-[#2c2c2c] border-[#444444] text-white flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="text-white flex items-center gap-2">
            <Braces className="w-5 h-5" />
            インポートJavaScript編集
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
          {/* 警告 */}
          <div className="text-xs text-yellow-400 flex items-center gap-2 p-2 bg-yellow-500/10 rounded border border-yellow-500/30 flex-shrink-0">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>
              JavaScriptはプレビュー時に実行されます。信頼できるソースからのみインポートしてください。
            </span>
          </div>

          {/* 情報 */}
          <div className="text-xs text-gray-400 flex items-center justify-between flex-shrink-0">
            <span>
              インポート時に抽出されたJavaScriptを編集できます。
              変更はリアルタイムでプレビューに反映されます。
            </span>
            <span className="text-gray-500">
              {lineCount}行 / {js.length}文字
            </span>
          </div>

          {/* JSエディタ */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <Textarea
              value={js}
              onChange={handleJsChange}
              className="w-full h-full bg-[#1e1e1e] border-[#444444] text-white font-mono text-sm resize-none"
              placeholder={`// 変数や関数の定義
const greeting = "Hello, World!";

function handleClick(event) {
  console.log("Clicked:", event.target);
}

// DOM操作
document.addEventListener('DOMContentLoaded', () => {
  const buttons = document.querySelectorAll('.btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', handleClick);
  });
});`}
            />
          </div>

          {/* JSがない場合のヒント */}
          {!initialJs && !js && (
            <div className="text-xs text-gray-500 p-3 bg-[#1e1e1e] rounded border border-[#444444] flex-shrink-0">
              URLからHTMLをインポートすると、ページのJavaScriptも自動的に抽出されます。
              手動でJavaScriptを追加することもできます。
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between gap-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            {onClear && initialJs && (
              <Button
                variant="ghost"
                onClick={handleClear}
                className="text-red-400 hover:text-red-300 hover:bg-red-500/20"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                JSを削除
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

export default JsEditorDialog;
