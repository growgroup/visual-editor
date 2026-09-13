'use client';

/**
 * ページ設定ダイアログ
 * SEO、OGP、カスタムコード、外部リソースなどを統合管理
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Switch } from '../../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { debugLog } from '../utils/debug';
import {
  Settings,
  Search,
  Share2,
  Code,
  FileCode,
  Link2,
  Image as ImageIcon,
  Plus,
  Trash2,
  Upload,
  ExternalLink,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  PageSettings,
  ProjectPageSettings,
  ExternalResource,
  DEFAULT_PAGE_SETTINGS,
} from '../types/page-settings';

export interface PageSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  pageSettings: PageSettings;
  projectSettings?: ProjectPageSettings;
  onSave: (settings: PageSettings) => void;
  onUploadImage?: (file: File) => Promise<string>;
}

export function PageSettingsDialog({
  isOpen,
  onClose,
  pageSettings,
  projectSettings,
  onSave,
  onUploadImage,
}: PageSettingsDialogProps) {
  const [settings, setSettings] = useState<PageSettings>({ ...DEFAULT_PAGE_SETTINGS, ...pageSettings });
  const [activeTab, setActiveTab] = useState('seo');
  const [hasChanges, setHasChanges] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<'ogp' | 'twitter' | null>(null);

  // ダイアログが開かれたときに設定を初期化
  useEffect(() => {
    if (isOpen) {
      setSettings({ ...DEFAULT_PAGE_SETTINGS, ...pageSettings });
      setHasChanges(false);
    }
  }, [isOpen, pageSettings]);

  // 設定変更ハンドラ
  const updateSettings = useCallback((updates: Partial<PageSettings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
    setHasChanges(true);
  }, []);

  // ネストされた設定の更新
  const updateNestedSettings = useCallback(<K extends keyof PageSettings>(
    key: K,
    updates: Partial<NonNullable<PageSettings[K]>>
  ) => {
    setSettings(prev => ({
      ...prev,
      [key]: { ...(prev[key] as object || {}), ...updates },
    }));
    setHasChanges(true);
  }, []);

  // 保存ハンドラ
  const handleSave = useCallback(() => {
    onSave(settings);
    onClose();
  }, [settings, onSave, onClose]);

  // 画像アップロード
  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUploadImage || !uploadTarget) return;

    setUploadingImage(true);
    try {
      const url = await onUploadImage(file);
      if (uploadTarget === 'ogp') {
        updateNestedSettings('ogp', { image: url });
      } else if (uploadTarget === 'twitter') {
        updateNestedSettings('twitter', { image: url });
      }
    } catch (err) {
      console.error('Image upload failed:', err);
    } finally {
      setUploadingImage(false);
      setUploadTarget(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [onUploadImage, uploadTarget, updateNestedSettings]);

  // 外部リソース追加
  const addExternalResource = useCallback((type: 'css' | 'js') => {
    const newResource: ExternalResource = {
      id: `${type}-${Date.now()}`,
      url: '',
      type,
      position: type === 'js' ? 'body-end' : undefined,
    };
    const key = type === 'css' ? 'externalCss' : 'externalJs';
    updateSettings({
      [key]: [...(settings[key] || []), newResource],
    });
  }, [settings, updateSettings]);

  // 外部リソース更新
  const updateExternalResource = useCallback((
    type: 'css' | 'js',
    id: string,
    updates: Partial<ExternalResource>
  ) => {
    const key = type === 'css' ? 'externalCss' : 'externalJs';
    const resources = settings[key] || [];
    updateSettings({
      [key]: resources.map(r => r.id === id ? { ...r, ...updates } : r),
    });
  }, [settings, updateSettings]);

  // 外部リソース削除
  const removeExternalResource = useCallback((type: 'css' | 'js', id: string) => {
    const key = type === 'css' ? 'externalCss' : 'externalJs';
    const resources = settings[key] || [];
    updateSettings({
      [key]: resources.filter(r => r.id !== id),
    });
  }, [settings, updateSettings]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[900px] w-[95vw] h-[90vh] max-h-[90vh] bg-[#2c2c2c] border-[#444444] text-white flex flex-col p-0">
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-2">
          <DialogTitle className="text-white flex items-center gap-2">
            <Settings className="w-5 h-5" />
            ページ設定
          </DialogTitle>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageUpload}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 px-6">
          <TabsList className="grid w-full grid-cols-5 bg-[#1e1e1e] flex-shrink-0">
            <TabsTrigger value="seo" className="data-[state=active]:bg-[#444444] text-xs">
              <Search className="w-3 h-3 mr-1" />
              SEO
            </TabsTrigger>
            <TabsTrigger value="social" className="data-[state=active]:bg-[#444444] text-xs">
              <Share2 className="w-3 h-3 mr-1" />
              OGP/SNS
            </TabsTrigger>
            <TabsTrigger value="head" className="data-[state=active]:bg-[#444444] text-xs">
              <Code className="w-3 h-3 mr-1" />
              Head
            </TabsTrigger>
            <TabsTrigger value="body" className="data-[state=active]:bg-[#444444] text-xs">
              <FileCode className="w-3 h-3 mr-1" />
              Body
            </TabsTrigger>
            <TabsTrigger value="resources" className="data-[state=active]:bg-[#444444] text-xs">
              <Link2 className="w-3 h-3 mr-1" />
              リソース
            </TabsTrigger>
          </TabsList>

          {/* SEO タブ */}
          <TabsContent value="seo" className="flex-1 overflow-y-auto space-y-4 mt-4 pr-2">
            <div className="flex items-center justify-between p-3 bg-[#1e1e1e] rounded-lg">
              <div>
                <Label className="text-gray-300">プロジェクト設定を継承</Label>
                <p className="text-xs text-gray-500 mt-1">
                  オフにするとプロジェクトのデフォルト設定を使用しません
                </p>
              </div>
              <Switch
                checked={settings.inheritProjectSettings !== false}
                onCheckedChange={(checked) => updateSettings({ inheritProjectSettings: checked })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="title" className="text-gray-300">ページタイトル</Label>
              <Input
                id="title"
                value={settings.title || ''}
                onChange={(e) => updateSettings({ title: e.target.value })}
                placeholder={projectSettings?.titleTemplate?.replace('{page}', 'ページ名') || 'ページタイトル'}
                className="bg-[#1e1e1e] border-[#444444] text-white"
              />
              {projectSettings?.titleTemplate && (
                <p className="text-xs text-gray-500">
                  テンプレート: {projectSettings.titleTemplate}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-gray-300">説明文 (meta description)</Label>
              <Textarea
                id="description"
                value={settings.description || ''}
                onChange={(e) => updateSettings({ description: e.target.value })}
                placeholder={projectSettings?.defaultDescription || 'ページの説明文（120〜160文字推奨）'}
                className="bg-[#1e1e1e] border-[#444444] text-white resize-none h-20"
              />
              <p className="text-xs text-gray-500">
                {(settings.description || '').length} / 160文字
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="keywords" className="text-gray-300">キーワード (カンマ区切り)</Label>
              <Input
                id="keywords"
                value={settings.keywords || ''}
                onChange={(e) => updateSettings({ keywords: e.target.value })}
                placeholder="キーワード1, キーワード2, キーワード3"
                className="bg-[#1e1e1e] border-[#444444] text-white"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="canonical" className="text-gray-300">Canonical URL</Label>
              <Input
                id="canonical"
                type="url"
                value={settings.canonicalUrl || ''}
                onChange={(e) => updateSettings({ canonicalUrl: e.target.value })}
                placeholder="https://example.com/page"
                className="bg-[#1e1e1e] border-[#444444] text-white"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="robots" className="text-gray-300">Robots</Label>
              <Select
                value={settings.robots || 'index,follow'}
                onValueChange={(value) => updateSettings({ robots: value })}
              >
                <SelectTrigger className="bg-[#1e1e1e] border-[#444444] text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#2c2c2c] border-[#444444]">
                  <SelectItem value="index,follow">index, follow（デフォルト）</SelectItem>
                  <SelectItem value="noindex,follow">noindex, follow</SelectItem>
                  <SelectItem value="index,nofollow">index, nofollow</SelectItem>
                  <SelectItem value="noindex,nofollow">noindex, nofollow</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          {/* Social/OGP タブ */}
          <TabsContent value="social" className="flex-1 overflow-y-auto space-y-6 mt-4 pr-2">
            {/* OGP セクション */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                <Share2 className="w-4 h-4" />
                Open Graph (Facebook, LINE等)
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-gray-300">og:title</Label>
                  <Input
                    value={settings.ogp?.title || ''}
                    onChange={(e) => updateNestedSettings('ogp', { title: e.target.value })}
                    placeholder={settings.title || 'ページタイトルを使用'}
                    className="bg-[#1e1e1e] border-[#444444] text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-300">og:type</Label>
                  <Select
                    value={settings.ogp?.type || 'website'}
                    onValueChange={(value) => updateNestedSettings('ogp', { type: value })}
                  >
                    <SelectTrigger className="bg-[#1e1e1e] border-[#444444] text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#2c2c2c] border-[#444444]">
                      <SelectItem value="website">website</SelectItem>
                      <SelectItem value="article">article</SelectItem>
                      <SelectItem value="product">product</SelectItem>
                      <SelectItem value="profile">profile</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-gray-300">og:description</Label>
                <Textarea
                  value={settings.ogp?.description || ''}
                  onChange={(e) => updateNestedSettings('ogp', { description: e.target.value })}
                  placeholder={settings.description || '説明文を使用'}
                  className="bg-[#1e1e1e] border-[#444444] text-white resize-none h-16"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-gray-300">og:image</Label>
                <div className="flex gap-2">
                  <Input
                    value={settings.ogp?.image || ''}
                    onChange={(e) => updateNestedSettings('ogp', { image: e.target.value })}
                    placeholder="https://example.com/ogp-image.jpg"
                    className="bg-[#1e1e1e] border-[#444444] text-white flex-1"
                  />
                  {onUploadImage && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setUploadTarget('ogp');
                        fileInputRef.current?.click();
                      }}
                      disabled={uploadingImage}
                      className="border-[#444444] text-gray-300 hover:text-white"
                    >
                      <Upload className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                {settings.ogp?.image && (
                  <div className="mt-2 relative w-full h-32 bg-[#1e1e1e] rounded overflow-hidden">
                    <img
                      src={settings.ogp.image}
                      alt="OGP Preview"
                      className="w-full h-full object-contain"
                    />
                  </div>
                )}
                <p className="text-xs text-gray-500">推奨サイズ: 1200 x 630 px</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-gray-300">og:url</Label>
                  <Input
                    value={settings.ogp?.url || ''}
                    onChange={(e) => updateNestedSettings('ogp', { url: e.target.value })}
                    placeholder="https://example.com/page"
                    className="bg-[#1e1e1e] border-[#444444] text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-300">og:site_name</Label>
                  <Input
                    value={settings.ogp?.siteName || ''}
                    onChange={(e) => updateNestedSettings('ogp', { siteName: e.target.value })}
                    placeholder={projectSettings?.ogp?.siteName || 'サイト名'}
                    className="bg-[#1e1e1e] border-[#444444] text-white"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-[#444444]" />

            {/* Twitter Card セクション */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                Twitter Card
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-gray-300">twitter:card</Label>
                  <Select
                    value={settings.twitter?.card || 'summary_large_image'}
                    onValueChange={(value) => updateNestedSettings('twitter', { card: value as 'summary' | 'summary_large_image' })}
                  >
                    <SelectTrigger className="bg-[#1e1e1e] border-[#444444] text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#2c2c2c] border-[#444444]">
                      <SelectItem value="summary">summary</SelectItem>
                      <SelectItem value="summary_large_image">summary_large_image</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-300">twitter:site</Label>
                  <Input
                    value={settings.twitter?.site || ''}
                    onChange={(e) => updateNestedSettings('twitter', { site: e.target.value })}
                    placeholder="@username"
                    className="bg-[#1e1e1e] border-[#444444] text-white"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-gray-300">twitter:title（空欄でog:titleを使用）</Label>
                <Input
                  value={settings.twitter?.title || ''}
                  onChange={(e) => updateNestedSettings('twitter', { title: e.target.value })}
                  placeholder="og:titleと同じ場合は空欄"
                  className="bg-[#1e1e1e] border-[#444444] text-white"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-gray-300">twitter:image（空欄でog:imageを使用）</Label>
                <div className="flex gap-2">
                  <Input
                    value={settings.twitter?.image || ''}
                    onChange={(e) => updateNestedSettings('twitter', { image: e.target.value })}
                    placeholder="og:imageと同じ場合は空欄"
                    className="bg-[#1e1e1e] border-[#444444] text-white flex-1"
                  />
                  {onUploadImage && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setUploadTarget('twitter');
                        fileInputRef.current?.click();
                      }}
                      disabled={uploadingImage}
                      className="border-[#444444] text-gray-300 hover:text-white"
                    >
                      <Upload className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Head タブ */}
          <TabsContent value="head" className="flex-1 overflow-y-auto space-y-4 mt-4 pr-2">
            <div className="p-3 bg-[#0d99ff]/10 border border-[#0d99ff]/30 rounded-md text-xs text-[#7cc4ff]">
              <AlertCircle className="w-4 h-4 inline mr-2" />
              &lt;head&gt;タグ内に追加するHTMLを記述できます。
              Analytics、Webフォント、その他のメタタグなどに使用してください。
            </div>

            <div className="space-y-2">
              <Label className="text-gray-300">カスタム &lt;head&gt; HTML</Label>
              <Textarea
                value={settings.customHeadHtml || ''}
                onChange={(e) => updateSettings({ customHeadHtml: e.target.value })}
                placeholder={`<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_MEASUREMENT_ID');
</script>

<!-- Google Fonts -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP&display=swap" rel="stylesheet">`}
                className="bg-[#1e1e1e] border-[#444444] text-white font-mono text-sm resize-none h-64"
              />
            </div>

            {projectSettings?.commonHeadHtml && (
              <div className="space-y-2 opacity-60">
                <Label className="text-gray-400">プロジェクト共通 &lt;head&gt;（継承時に適用）</Label>
                <pre className="bg-[#1e1e1e] border-[#444444] p-3 rounded text-xs text-gray-400 overflow-x-auto">
                  {projectSettings.commonHeadHtml}
                </pre>
              </div>
            )}
          </TabsContent>

          {/* Body タブ */}
          <TabsContent value="body" className="flex-1 overflow-y-auto space-y-4 mt-4 pr-2">
            <div className="space-y-2">
              <Label className="text-gray-300">&lt;body&gt; 開始直後に挿入</Label>
              <Textarea
                value={settings.bodyStartHtml || ''}
                onChange={(e) => updateSettings({ bodyStartHtml: e.target.value })}
                placeholder={`<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXX"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`}
                className="bg-[#1e1e1e] border-[#444444] text-white font-mono text-sm resize-none h-32"
              />
              <p className="text-xs text-gray-500">
                GTMのnoscriptタグ、ローディングインジケーターなどに使用
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-gray-300">&lt;/body&gt; 直前に挿入</Label>
              <Textarea
                value={settings.bodyEndHtml || ''}
                onChange={(e) => updateSettings({ bodyEndHtml: e.target.value })}
                placeholder={`<!-- Chat Widget -->
<script src="https://example.com/chat-widget.js"></script>

<!-- Custom tracking -->
<script>
  // Page view tracking
  console.log('Page loaded');
</script>`}
                className="bg-[#1e1e1e] border-[#444444] text-white font-mono text-sm resize-none h-32"
              />
              <p className="text-xs text-gray-500">
                チャットウィジェット、追加スクリプトなどに使用
              </p>
            </div>

            <div className="border-t border-[#444444] pt-4" />

            {/* カスタムCSS */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-gray-300">カスタム CSS</Label>
                {settings.customCss && (
                  <span className="text-xs text-gray-500">
                    {settings.customCss.length} 文字
                  </span>
                )}
              </div>
              <Textarea
                value={settings.customCss || ''}
                onChange={(e) => updateSettings({ customCss: e.target.value })}
                placeholder={`.custom-class {
  color: #333;
  font-size: 16px;
}

/* インポートされたCSSもここに統合されます */`}
                className="bg-[#1e1e1e] border-[#444444] text-white font-mono text-sm resize-none h-40"
              />
            </div>

            {/* カスタムJS */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-gray-300">カスタム JavaScript</Label>
                {settings.customJs && (
                  <span className="text-xs text-gray-500">
                    {settings.customJs.length} 文字
                  </span>
                )}
              </div>
              <div className="text-xs text-yellow-400 flex items-center gap-2 p-2 bg-yellow-500/10 rounded border border-yellow-500/30 mb-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>
                  JavaScriptはプレビュー時に実行されます。信頼できるソースからのみ使用してください。
                </span>
              </div>
              <Textarea
                value={settings.customJs || ''}
                onChange={(e) => updateSettings({ customJs: e.target.value })}
                placeholder={`// DOMContentLoaded後に実行
document.addEventListener('DOMContentLoaded', function() {
  console.log('Page ready');
});

/* インポートされたJSもここに統合されます */`}
                className="bg-[#1e1e1e] border-[#444444] text-white font-mono text-sm resize-none h-40"
              />
            </div>
          </TabsContent>

          {/* Resources タブ */}
          <TabsContent value="resources" className="flex-1 overflow-y-auto space-y-6 mt-4 pr-2">
            {/* 外部CSS */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-300">外部 CSS</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => addExternalResource('css')}
                  className="text-gray-400 hover:text-white"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  追加
                </Button>
              </div>

              {(settings.externalCss || []).length === 0 ? (
                <p className="text-xs text-gray-500 p-3 bg-[#1e1e1e] rounded">
                  外部CSSファイルはありません
                </p>
              ) : (
                <div className="space-y-2">
                  {(settings.externalCss || []).map((resource) => (
                    <div key={resource.id} className="flex items-center gap-2 p-2 bg-[#1e1e1e] rounded">
                      <Link2 className="w-4 h-4 text-gray-500 flex-shrink-0" />
                      <Input
                        value={resource.url}
                        onChange={(e) => updateExternalResource('css', resource.id, { url: e.target.value })}
                        placeholder="https://cdn.example.com/style.css"
                        className="bg-transparent border-none text-white flex-1 h-8"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeExternalResource('css', resource.id)}
                        className="text-red-400 hover:text-red-300 h-8 w-8 p-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-[#444444]" />

            {/* 外部JS */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-300">外部 JavaScript</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => addExternalResource('js')}
                  className="text-gray-400 hover:text-white"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  追加
                </Button>
              </div>

              {(settings.externalJs || []).length === 0 ? (
                <p className="text-xs text-gray-500 p-3 bg-[#1e1e1e] rounded">
                  外部JavaScriptファイルはありません
                </p>
              ) : (
                <div className="space-y-2">
                  {(settings.externalJs || []).map((resource) => (
                    <div key={resource.id} className="p-3 bg-[#1e1e1e] rounded space-y-2">
                      <div className="flex items-center gap-2">
                        <FileCode className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        <Input
                          value={resource.url}
                          onChange={(e) => updateExternalResource('js', resource.id, { url: e.target.value })}
                          placeholder="https://cdn.example.com/script.js"
                          className="bg-transparent border-none text-white flex-1 h-8"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeExternalResource('js', resource.id)}
                          className="text-red-400 hover:text-red-300 h-8 w-8 p-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-4 pl-6 text-xs">
                        <Select
                          value={resource.position || 'body-end'}
                          onValueChange={(value) => updateExternalResource('js', resource.id, { position: value as ExternalResource['position'] })}
                        >
                          <SelectTrigger className="bg-[#2c2c2c] border-[#444444] text-white h-7 w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-[#2c2c2c] border-[#444444]">
                            <SelectItem value="head">head内</SelectItem>
                            <SelectItem value="body-start">body開始直後</SelectItem>
                            <SelectItem value="body-end">body終了直前</SelectItem>
                          </SelectContent>
                        </Select>
                        <label className="flex items-center gap-1 text-gray-400">
                          <input
                            type="checkbox"
                            checked={resource.async || false}
                            onChange={(e) => updateExternalResource('js', resource.id, { async: e.target.checked })}
                            className="rounded bg-[#2c2c2c] border-[#444444]"
                          />
                          async
                        </label>
                        <label className="flex items-center gap-1 text-gray-400">
                          <input
                            type="checkbox"
                            checked={resource.defer || false}
                            onChange={(e) => updateExternalResource('js', resource.id, { defer: e.target.checked })}
                            className="rounded bg-[#2c2c2c] border-[#444444]"
                          />
                          defer
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* プロジェクト共通リソース表示 */}
            {(projectSettings?.externalCss?.length || projectSettings?.externalJs?.length) && settings.inheritProjectSettings !== false && (
              <>
                <div className="border-t border-[#444444]" />
                <div className="space-y-3 opacity-60">
                  <h3 className="text-sm font-medium text-gray-400">プロジェクト共通リソース（継承）</h3>
                  {projectSettings?.externalCss?.map((css) => (
                    <div key={css.id} className="flex items-center gap-2 p-2 bg-[#1e1e1e] rounded text-gray-400">
                      <Link2 className="w-4 h-4" />
                      <span className="text-xs truncate">{css.url}</span>
                    </div>
                  ))}
                  {projectSettings?.externalJs?.map((js) => (
                    <div key={js.id} className="flex items-center gap-2 p-2 bg-[#1e1e1e] rounded text-gray-400">
                      <FileCode className="w-4 h-4" />
                      <span className="text-xs truncate">{js.url}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex items-center justify-between sm:justify-between gap-2 flex-shrink-0 px-6 py-4 border-t border-[#444444]">
          <div className="text-xs text-gray-500">
            {hasChanges && '変更があります'}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={onClose}
              className="text-gray-400 hover:text-white"
            >
              キャンセル
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges}
              className="bg-[#0d99ff] hover:bg-[#0c8ce9]"
            >
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PageSettingsDialog;
