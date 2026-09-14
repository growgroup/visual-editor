'use client';

/**
 * AI プロンプト入力ポップオーバー
 * Figmaライクなミニマムなフローティング入力UI
 * 画像やPDFファイルの添付に対応
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, X, Loader2, Send, Paperclip, FileImage, FileText, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import type { AttachedFile } from '../../lib/agent/slide-agent/types';
import { readStorage, writeStorage } from '../utils/storage';

// サポートするファイルタイプ
const SUPPORTED_FILE_TYPES = {
  'image/png': true,
  'image/jpeg': true,
  'image/gif': true,
  'image/webp': true,
  'application/pdf': true,
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;

export interface AiPromptPopoverProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  onGenerate: (prompt: string, attachedFiles?: AttachedFile[], engine?: 'codex' | 'claude') => Promise<void>;
  isGenerating: boolean;
  selectedElementInfo?: string; // 選択要素の簡易説明
}

export function AiPromptPopover({
  isOpen,
  position,
  onClose,
  onGenerate,
  isGenerating,
  selectedElementInfo,
}: AiPromptPopoverProps) {
  const [prompt, setPrompt] = useState('');
  // [移植時の追加] 生成に使うAIエンジン(ローカルCLI)を選択する
  const [engine, setEngine] = useState<'codex' | 'claude'>(() => {
    const saved = readStorage('gg-ai-engine');
    return saved === 'claude' ? 'claude' : 'codex';
  });
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ファイル添付ハンドラー
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setFileError(null);

    // ファイル数チェック
    if (attachedFiles.length + files.length > MAX_FILES) {
      setFileError(`ファイルは最大${MAX_FILES}個まで添付できます`);
      return;
    }

    const newFiles: AttachedFile[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // ファイルタイプチェック
      if (!SUPPORTED_FILE_TYPES[file.type as keyof typeof SUPPORTED_FILE_TYPES]) {
        setFileError(`${file.name}: サポートされていないファイル形式です（画像またはPDFのみ）`);
        continue;
      }

      // ファイルサイズチェック
      if (file.size > MAX_FILE_SIZE) {
        setFileError(`${file.name}: ファイルサイズが大きすぎます（最大10MB）`);
        continue;
      }

      // Base64に変換
      try {
        const data = await fileToBase64(file);
        newFiles.push({
          name: file.name,
          type: file.type,
          size: file.size,
          data,
        });
      } catch (err) {
        console.error('ファイル読み込みエラー:', err);
        setFileError(`${file.name}: ファイルの読み込みに失敗しました`);
      }
    }

    if (newFiles.length > 0) {
      setAttachedFiles(prev => [...prev, ...newFiles]);
    }

    // input をリセット
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [attachedFiles.length]);

  // ファイル削除ハンドラー
  const handleRemoveFile = useCallback((index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
    setFileError(null);
  }, []);

  // ファイルをBase64に変換
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // ファイル選択ダイアログを開く
  const openFileDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // ポップオーバーが開いたらテキストエリアにフォーカス
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Escキーで閉じる
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
      // Cmd/Ctrl + Enter で送信
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && prompt.trim() && !isGenerating) {
        e.preventDefault();
        handleGenerate();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, prompt, isGenerating]);

  // 外側クリックで閉じる
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // 次のフレームでリスナーを追加（トリガーイベントの完了を待つ）
    requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClickOutside);
    });

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // 生成実行
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;
    
    try {
      await onGenerate(prompt, attachedFiles.length > 0 ? attachedFiles : undefined, engine);
      setPrompt('');
      setAttachedFiles([]);
      setFileError(null);
      onClose();
    } catch (error) {
      console.error('AI generation failed:', error);
    }
  }, [prompt, isGenerating, onGenerate, onClose, attachedFiles, engine]);

  // 位置調整（画面外にはみ出さないように）
  const getPopoverStyle = useCallback(() => {
    const width = 320;
    const height = 200;
    const padding = 16;
    
    let x = position.x;
    let y = position.y;
    
    // 右端チェック
    if (x + width > window.innerWidth - padding) {
      x = window.innerWidth - width - padding;
    }
    
    // 左端チェック
    if (x < padding) {
      x = padding;
    }
    
    // 下端チェック
    if (y + height > window.innerHeight - padding) {
      y = position.y - height - 10; // 上に表示
    }
    
    // 上端チェック
    if (y < padding) {
      y = padding;
    }
    
    return {
      left: `${x}px`,
      top: `${y}px`,
    };
  }, [position]);

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      className="fixed z-[70] bg-[#1e1e1e] border border-[#444444] rounded-xl shadow-2xl overflow-hidden"
      style={{
        ...getPopoverStyle(),
        width: '320px',
      }}
    >
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#444444] bg-[#2c2c2c]">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <span className="text-xs font-medium text-gray-200">AIで生成</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[#444444] text-gray-400 hover:text-gray-200 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 選択要素の情報 */}
      {selectedElementInfo && (
        <div className="px-3 py-2 bg-[#2c2c2c] border-b border-[#444444]">
          <p className="text-[10px] text-gray-500 truncate">
            選択中: {selectedElementInfo}
          </p>
        </div>
      )}

      {/* プロンプト入力 */}
      <div className="p-3">
        <Textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="どのように変更しますか？&#10;例: 青いグラデーション背景のカード、モダンなデザインに..."
          className="min-h-[80px] text-xs bg-[#2c2c2c] border-[#444444] text-white placeholder:text-gray-500 resize-none focus:ring-purple-500 focus:border-purple-500"
          disabled={isGenerating}
        />

        {/* 添付ファイル一覧 */}
        {attachedFiles.length > 0 && (
          <div className="mt-2 space-y-1">
            {attachedFiles.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center gap-2 px-2 py-1.5 bg-[#2c2c2c] border border-[#444444] rounded text-[10px] text-gray-300"
              >
                {file.type.startsWith('image/') ? (
                  <FileImage className="w-3 h-3 text-[#4fb8ff] shrink-0" />
                ) : (
                  <FileText className="w-3 h-3 text-red-400 shrink-0" />
                )}
                <span className="truncate flex-1">{file.name}</span>
                <span className="text-gray-500 shrink-0">
                  {(file.size / 1024).toFixed(0)}KB
                </span>
                <button
                  onClick={() => handleRemoveFile(index)}
                  className="p-0.5 rounded hover:bg-[#444444] text-gray-400 hover:text-red-400 shrink-0"
                  disabled={isGenerating}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ファイルエラー */}
        {fileError && (
          <p className="mt-2 text-[10px] text-red-400">{fileError}</p>
        )}

        {/* フッター */}
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2">
            {/* ファイル添付ボタン */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={openFileDialog}
              disabled={isGenerating || attachedFiles.length >= MAX_FILES}
              className="p-1.5 rounded hover:bg-[#444444] text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
              title="ファイルを添付（画像、PDF）"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center gap-0.5 rounded border border-[#444444] bg-[#2c2c2c] p-0.5">
              {(['codex', 'claude'] as const).map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    setEngine(e);
                    writeStorage('gg-ai-engine', e);
                  }}
                  className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                    engine === e
                      ? 'bg-purple-600 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                  title={`${e === 'codex' ? 'Codex' : 'Claude'} で生成`}
                >
                  {e === 'codex' ? 'Codex' : 'Claude'}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-gray-500">
              ⌘+Enter
            </span>
          </div>
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={!prompt.trim() || isGenerating}
            className="h-7 px-3 text-xs bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                {/* SVGアニメーションはdivラッパーで適用（ハードウェアアクセラレーション対応） */}
                <div className="animate-spin mr-1.5">
                  <Loader2 className="w-3 h-3" />
                </div>
                生成中...
              </>
            ) : (
              <>
                <Send className="w-3 h-3 mr-1.5" />
                生成
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
