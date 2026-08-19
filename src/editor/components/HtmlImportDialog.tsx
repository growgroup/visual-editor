'use client';

/**
 * HTMLインポートダイアログ
 * URLまたはテキスト入力からHTMLをインポート
 * URLインポートはFirebase Functionsを使用（CSS・画像をStorageに保存）
 */

import { useState, useCallback } from 'react';
import { httpsCallable } from '../../vendor/firebase-functions';
import { functions } from '../../lib/firebase/config';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Label } from '../../components/ui/label';
import { Loader2, Globe, Code, AlertCircle, CheckCircle2, Image, FileText } from 'lucide-react';

// インポートリソースの型定義
interface ImportedResource {
  id: string;
  type: 'image' | 'stylesheet' | 'font' | 'script';
  originalUrl: string;
  storagePath: string;
  storageUrl: string;
  contentType: string;
  size: number;
  hash: string;
}

// Firebase Function の型定義
interface HtmlImportResponse {
  success: boolean;
  html: string;
  css: string;
  js: string;
  title?: string;
  resources: {
    images: ImportedResource[];
    stylesheets: ImportedResource[];
    scripts: ImportedResource[];
  };
  error?: string;
}

// インポート結果の型
export interface HtmlImportResult {
  html: string;
  css: string;
  js?: string;
  resources?: {
    images: ImportedResource[];
    stylesheets: ImportedResource[];
    scripts?: ImportedResource[];
  };
}

export interface HtmlImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (result: HtmlImportResult) => void;
  presentationId?: string;
  slideId?: string;
}

export function HtmlImportDialog({
  isOpen,
  onClose,
  onImport,
  presentationId,
  slideId,
}: HtmlImportDialogProps) {
  const [activeTab, setActiveTab] = useState<'url' | 'code'>('url');
  const [url, setUrl] = useState('');
  const [htmlCode, setHtmlCode] = useState('');
  const [cssCode, setCssCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<string>('');
  const [importStats, setImportStats] = useState<{
    images: number;
    cssSize: number;
    jsSize: number;
  } | null>(null);

  // URLからインポート（Firebase Functions使用）
  const handleUrlImport = useCallback(async () => {
    if (!url.trim()) {
      setError('URLを入力してください');
      return;
    }

    // URL形式チェック
    try {
      new URL(url);
    } catch {
      setError('有効なURLを入力してください');
      return;
    }

    setIsLoading(true);
    setError(null);
    setImportStats(null);
    setLoadingStatus('ページを読み込み中...');

    try {
      // Firebase Function を呼び出し
      const importHtmlFromUrl = httpsCallable<
        { url: string; presentationId?: string; slideId?: string },
        HtmlImportResponse
      >(functions, 'importHtmlFromUrl');

      setLoadingStatus('HTMLとCSSを抽出中...');

      const result = await importHtmlFromUrl({
        url,
        presentationId,
        slideId,
      });

      if (result.data.success && result.data.html) {
        setLoadingStatus('完了！');

        // 統計情報を設定
        setImportStats({
          images: result.data.resources?.images?.length || 0,
          cssSize: result.data.css?.length || 0,
          jsSize: result.data.js?.length || 0,
        });

        // 少し待ってから結果を渡す（統計表示のため）
        await new Promise(resolve => setTimeout(resolve, 500));

        onImport({
          html: result.data.html,
          css: result.data.css || '',
          js: result.data.js || '',
          resources: result.data.resources,
        });
        handleClose();
      } else {
        throw new Error(result.data.error || 'インポートに失敗しました');
      }
    } catch (err) {
      console.error('[HtmlImportDialog] Import error:', err);
      // Firebase Functions のエラーメッセージを抽出
      const errorMessage = err instanceof Error
        ? err.message.replace(/^.*?:\s*/, '') // "FirebaseError: " などのプレフィックスを除去
        : 'インポートに失敗しました';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
    }
  }, [url, onImport, presentationId, slideId]);

  // テキストからインポート
  const handleCodeImport = useCallback(() => {
    if (!htmlCode.trim()) {
      setError('HTMLを入力してください');
      return;
    }

    setError(null);

    onImport({
      html: htmlCode.trim(),
      css: cssCode.trim(),
    });
    handleClose();
  }, [htmlCode, cssCode, onImport]);

  // ダイアログを閉じる
  const handleClose = useCallback(() => {
    setUrl('');
    setHtmlCode('');
    setCssCode('');
    setError(null);
    setIsLoading(false);
    setLoadingStatus('');
    setImportStats(null);
    onClose();
  }, [onClose]);

  // ファイルサイズをフォーマット
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[600px] bg-[#2c2c2c] border-[#444444] text-white">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Code className="w-5 h-5" />
            HTMLインポート
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'url' | 'code')}>
          <TabsList className="grid w-full grid-cols-2 bg-[#1e1e1e]">
            <TabsTrigger
              value="url"
              className="data-[state=active]:bg-[#444444] data-[state=active]:text-white"
            >
              <Globe className="w-4 h-4 mr-2" />
              URLから取得
            </TabsTrigger>
            <TabsTrigger
              value="code"
              className="data-[state=active]:bg-[#444444] data-[state=active]:text-white"
            >
              <Code className="w-4 h-4 mr-2" />
              コード入力
            </TabsTrigger>
          </TabsList>

          {/* URLタブ */}
          <TabsContent value="url" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="import-url" className="text-gray-300">
                URL
              </Label>
              <Input
                id="import-url"
                type="url"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="bg-[#1e1e1e] border-[#444444] text-white placeholder:text-gray-500"
                disabled={isLoading}
              />
              <p className="text-xs text-gray-500">
                ページのHTML・CSS・画像を取得し、Firebase Storageに保存します。
              </p>
            </div>

            {/* ローディング状態 */}
            {isLoading && (
              <div className="flex items-center gap-3 p-3 bg-[#0d99ff]/10 border border-[#0d99ff]/30 rounded-md">
                <Loader2 className="w-5 h-5 animate-spin text-[#4fb8ff]" />
                <div className="flex-1">
                  <p className="text-sm text-[#7cc4ff]">{loadingStatus}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    ページの内容によっては1〜2分かかることがあります
                  </p>
                </div>
              </div>
            )}

            {/* インポート統計 */}
            {importStats && !isLoading && (
              <div className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/30 rounded-md">
                <CheckCircle2 className="w-5 h-5 text-green-400" />
                <div className="flex-1 flex items-center gap-4 text-sm flex-wrap">
                  <span className="flex items-center gap-1 text-gray-300">
                    <Image className="w-4 h-4" />
                    {importStats.images} 画像
                  </span>
                  <span className="flex items-center gap-1 text-gray-300">
                    <FileText className="w-4 h-4" />
                    CSS {formatSize(importStats.cssSize)}
                  </span>
                  {importStats.jsSize > 0 && (
                    <span className="flex items-center gap-1 text-gray-300">
                      <Code className="w-4 h-4" />
                      JS {formatSize(importStats.jsSize)}
                    </span>
                  )}
                </div>
              </div>
            )}

            <Button
              onClick={handleUrlImport}
              disabled={isLoading || !url.trim()}
              className="w-full bg-[#0d99ff] hover:bg-[#0c8ce9]"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  インポート中...
                </>
              ) : (
                'インポート'
              )}
            </Button>
          </TabsContent>

          {/* コード入力タブ */}
          <TabsContent value="code" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="import-html" className="text-gray-300">
                HTML
              </Label>
              <Textarea
                id="import-html"
                placeholder="<div>...</div>"
                value={htmlCode}
                onChange={(e) => setHtmlCode(e.target.value)}
                className="bg-[#1e1e1e] border-[#444444] text-white placeholder:text-gray-500 font-mono text-sm min-h-[150px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="import-css" className="text-gray-300">
                CSS（オプション）
              </Label>
              <Textarea
                id="import-css"
                placeholder=".class { ... }"
                value={cssCode}
                onChange={(e) => setCssCode(e.target.value)}
                className="bg-[#1e1e1e] border-[#444444] text-white placeholder:text-gray-500 font-mono text-sm min-h-[100px]"
              />
              <p className="text-xs text-gray-500">
                CSSを入力すると、エディタ内でスタイルが適用されます。
              </p>
            </div>

            <Button
              onClick={handleCodeImport}
              disabled={!htmlCode.trim()}
              className="w-full bg-[#0d99ff] hover:bg-[#0c8ce9]"
            >
              インポート
            </Button>
          </TabsContent>
        </Tabs>

        {/* エラー表示 */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/20 border border-red-500/50 rounded-md text-red-300 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default HtmlImportDialog;
