'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../components/ui/dialog';

interface HtmlEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (html: string) => void;
  initialHtml: string;
}

export function HtmlEditorDialog({
  isOpen,
  onClose,
  onSave,
  initialHtml,
}: HtmlEditorDialogProps) {
  const [html, setHtml] = useState(initialHtml);

  useEffect(() => {
    if (isOpen) {
      setHtml(initialHtml);
    }
  }, [isOpen, initialHtml]);

  const handleSave = () => {
    onSave(html);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl z-[100]">
        <DialogHeader>
          <DialogTitle>HTMLを編集</DialogTitle>
        </DialogHeader>
        
        <div className="py-2">
          <textarea
            className="w-full h-96 p-4 font-mono text-sm bg-gray-900 text-gray-100 rounded-md border border-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0d99ff] resize-none"
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            spellCheck={false}
          />
        </div>

        <DialogFooter>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm bg-[#0d99ff] hover:bg-[#0c8ce9] text-white rounded-md transition-colors"
          >
            保存
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
