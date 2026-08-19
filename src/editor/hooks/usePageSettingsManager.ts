import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorContext } from '../EditorContext';
import { useAuth } from '../../components/auth/AuthProvider';
import { createAuthApi } from '../../lib/api/auth-fetch';
import type { PageSettings, ProjectPageSettings } from '../types/page-settings';
import type { HtmlImportResult } from '../components';
import { buildDomTree, getArtboardContent } from '../utils/dom-utils';
import { makeChildrenEditable } from '../utils/html-utils';

interface UsePageSettingsManagerProps {
  parentId?: string;
  contentId?: string;
}

interface UsePageSettingsManagerReturn {
  // CSS editor
  isCssEditorOpen: boolean;
  setIsCssEditorOpen: (open: boolean) => void;
  importedCss: string;
  handleOpenCssEditor: () => void;
  handleSaveCss: (css: string) => void;
  handleClearCss: () => void;
  // JS editor
  isJsEditorOpen: boolean;
  setIsJsEditorOpen: (open: boolean) => void;
  importedJs: string;
  handleOpenJsEditor: () => void;
  handleSaveJs: (js: string) => void;
  handleClearJs: () => void;
  // Page settings
  isPageSettingsOpen: boolean;
  setIsPageSettingsOpen: (open: boolean) => void;
  pageSettings: PageSettings;
  projectSettings: ProjectPageSettings | undefined;
  handleOpenPageSettings: () => void;
  handleSavePageSettings: (settings: PageSettings) => Promise<void>;
  handleSaveCurrentSettings: () => Promise<void>;
  // Export
  handleExport: (format?: 'html' | 'zip') => Promise<void>;
  // OGP
  handleUploadOgpImage: (file: File) => Promise<string>;
  // HTML Import
  handleHtmlImport: (result: HtmlImportResult) => void;
}

/**
 * ページ設定管理フック
 * CSS/JS編集、ページ設定、エクスポート、OGP画像アップロード、HTMLインポートを管理
 */
export function usePageSettingsManager({
  parentId,
  contentId,
}: UsePageSettingsManagerProps): UsePageSettingsManagerReturn {
  const {
    editorMode,
    getIframeDoc,
    notifyIframeChange,
    iframeReady,
    pushHistory,
    setDomTree,
    setExpandedNodes,
    setSelectedElement,
    setSelectedElementIds,
  } = useEditorContext();

  const { getIdToken } = useAuth();

  // CSS編集ダイアログ状態
  const [isCssEditorOpen, setIsCssEditorOpen] = useState(false);
  const [importedCss, setImportedCss] = useState<string>('');

  // JS編集ダイアログ状態
  const [isJsEditorOpen, setIsJsEditorOpen] = useState(false);
  const [importedJs, setImportedJs] = useState<string>('');

  // ページ設定ダイアログ状態
  const [isPageSettingsOpen, setIsPageSettingsOpen] = useState(false);
  const [pageSettings, setPageSettings] = useState<PageSettings>({
    inheritProjectSettings: true,
  });
  const [isPageSettingsLoaded, setIsPageSettingsLoaded] = useState(false);

  // contentId変更時にページ設定をリセット（再取得を促す）
  const prevContentIdRef = useRef(contentId);
  useEffect(() => {
    if (contentId !== prevContentIdRef.current) {
      prevContentIdRef.current = contentId;
      setIsPageSettingsLoaded(false);
      setImportedCss('');
      setImportedJs('');
      setPageSettings({ inheritProjectSettings: true });
    }
  }, [contentId]);

  // プロジェクトレベル設定（将来的にはFirestoreから取得）
  const [projectSettings] = useState<ProjectPageSettings | undefined>(undefined);

  // ページ設定をFirestoreから読み込み
  useEffect(() => {
    if (!parentId || !contentId || isPageSettingsLoaded) return;

    const loadPageSettings = async () => {
      try {
        const api = await createAuthApi(getIdToken);
        const apiPath = editorMode === 'webpage'
          ? `/api/websites/${parentId}/pages/${contentId}`
          : `/api/presentations/${parentId}/slides/${contentId}`;

        const data = await api.get(apiPath);
        const pageData = editorMode === 'webpage' ? data.page : data.slide;

        if (pageData?.settings) {
          // CSS/JSがStorageにある場合はフェッチ
          let customCss = pageData.settings.customCss || '';
          let customJs = pageData.settings.customJs || '';

          // CSSがStorageにある場合
          if (pageData.settings.customCssUrl) {
            console.log('[loadPageSettings] Fetching CSS from Storage:', pageData.settings.customCssUrl);
            try {
              const response = await fetch(pageData.settings.customCssUrl);
              if (response.ok) {
                customCss = await response.text();
                console.log(`[loadPageSettings] CSS fetched: ${customCss.length} chars`);
              }
            } catch (e) {
              console.error('[loadPageSettings] Failed to fetch CSS from Storage:', e);
            }
          }

          // JSがStorageにある場合
          if (pageData.settings.customJsUrl) {
            console.log('[loadPageSettings] Fetching JS from Storage:', pageData.settings.customJsUrl);
            try {
              const response = await fetch(pageData.settings.customJsUrl);
              if (response.ok) {
                customJs = await response.text();
                console.log(`[loadPageSettings] JS fetched: ${customJs.length} chars`);
              }
            } catch (e) {
              console.error('[loadPageSettings] Failed to fetch JS from Storage:', e);
            }
          }

          // Firestore型をエディタ型に変換
          const loadedSettings: PageSettings = {
            inheritProjectSettings: pageData.settings.inheritProjectSettings ?? true,
            title: pageData.settings.metaTitle,
            description: pageData.settings.metaDescription,
            keywords: pageData.settings.metaKeywords,
            canonicalUrl: pageData.settings.canonicalUrl,
            robots: pageData.settings.robots,
            ogp: pageData.settings.ogp,
            twitter: pageData.settings.twitter,
            customHeadHtml: pageData.settings.customHeadHtml,
            bodyStartHtml: pageData.settings.bodyStartHtml,
            bodyEndHtml: pageData.settings.bodyEndHtml,
            externalCss: pageData.settings.externalCss,
            externalJs: pageData.settings.externalJs,
            customCss: customCss,
            customJs: customJs,
            // Storage参照情報も保持
            customCssUrl: pageData.settings.customCssUrl,
            customCssPath: pageData.settings.customCssPath,
            customCssSize: pageData.settings.customCssSize,
            customJsUrl: pageData.settings.customJsUrl,
            customJsPath: pageData.settings.customJsPath,
            customJsSize: pageData.settings.customJsSize,
          };
          setPageSettings(loadedSettings);

          // CSS/JSがある場合はiframeにも反映
          if (customCss) {
            setImportedCss(customCss);
          }
          if (customJs) {
            setImportedJs(customJs);
          }

          console.log('[loadPageSettings] Loaded settings:', {
            ...loadedSettings,
            customCss: customCss.length + ' chars',
            customJs: customJs.length + ' chars',
          });
        }
        setIsPageSettingsLoaded(true);
      } catch (error) {
        console.error('[loadPageSettings] Failed to load settings:', error);
        setIsPageSettingsLoaded(true);
      }
    };

    loadPageSettings();
  }, [parentId, contentId, editorMode, getIdToken, isPageSettingsLoaded]);

  // ページ設定読み込み後、CSS/JSをiframeに反映
  useEffect(() => {
    if (!isPageSettingsLoaded) return;

    let retryCount = 0;
    const maxRetries = 5;
    const applyStylesToIframe = () => {
      const iframeDoc = getIframeDoc();
      if (!iframeDoc) {
        retryCount++;
        if (retryCount <= maxRetries) {
          setTimeout(applyStylesToIframe, 100);
        }
        return;
      }

      // CSSをiframeに反映
      if (importedCss) {
        let styleElement = iframeDoc.getElementById('imported-styles');
        if (!styleElement) {
          styleElement = iframeDoc.createElement('style');
          styleElement.id = 'imported-styles';
          iframeDoc.head.appendChild(styleElement);
        }
        if (styleElement.textContent !== importedCss) {
          styleElement.textContent = importedCss;
          console.log('[applyStylesToIframe] Applied CSS:', importedCss.length, 'chars');
        }
      }

      // JSをiframeに反映
      if (importedJs) {
        const existingScript = iframeDoc.getElementById('imported-scripts');
        // 先頭にセミコロンを追加してIIFE連結問題を防ぐ
        // また、try-catchでラップしてエラーがページを壊さないようにする
        const safeJs = `;try{${importedJs}}catch(e){console.error('[imported-scripts] Error:',e);}`;
        // 既にスクリプトが存在し、同じ内容であればスキップ
        if (existingScript?.textContent === safeJs) {
          console.log('[applyStylesToIframe] JS already applied, skipping');
          return;
        }
        // 既存のスクリプトを削除
        if (existingScript) {
          existingScript.remove();
        }
        // 新しいスクリプトを追加
        const scriptElement = iframeDoc.createElement('script');
        scriptElement.id = 'imported-scripts';
        scriptElement.textContent = safeJs;
        iframeDoc.body.appendChild(scriptElement);
        console.log('[applyStylesToIframe] Applied JS:', importedJs.length, 'chars');
      }
    };

    applyStylesToIframe();
  }, [isPageSettingsLoaded, importedCss, importedJs, getIframeDoc]);

  // CSS編集ダイアログを開く（現在のCSSを取得）
  const handleOpenCssEditor = useCallback(() => {
    const iframeDoc = getIframeDoc();
    if (iframeDoc) {
      const styleElement = iframeDoc.getElementById('imported-styles');
      const currentCss = styleElement?.textContent || importedCss;
      setImportedCss(currentCss);
    }
    setIsCssEditorOpen(true);
  }, [getIframeDoc, importedCss]);

  // CSSを保存（iframeに反映）
  const handleSaveCss = useCallback((css: string) => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    // 既存のスタイル要素を取得または作成
    let styleElement = iframeDoc.getElementById('imported-styles');
    if (css.trim()) {
      if (!styleElement) {
        styleElement = iframeDoc.createElement('style');
        styleElement.id = 'imported-styles';
        iframeDoc.head.appendChild(styleElement);
      }
      styleElement.textContent = css;
      console.log('[handleSaveCss] Updated CSS:', css.length, 'chars');
    } else if (styleElement) {
      // CSSが空の場合はスタイル要素を削除
      styleElement.remove();
      console.log('[handleSaveCss] Removed empty CSS');
    }

    // 状態を更新
    setImportedCss(css);
    // ページ設定にも保存（Firestore保存用）
    setPageSettings(prev => ({ ...prev, customCss: css }));

    // 変更を通知
    notifyIframeChange();
  }, [getIframeDoc, notifyIframeChange]);

  // CSSをクリア
  const handleClearCss = useCallback(() => {
    const iframeDoc = getIframeDoc();
    if (iframeDoc) {
      const styleElement = iframeDoc.getElementById('imported-styles');
      if (styleElement) {
        styleElement.remove();
        console.log('[handleClearCss] Cleared imported CSS');
      }
    }
    setImportedCss('');
    notifyIframeChange();
  }, [getIframeDoc, notifyIframeChange]);

  // JS編集ダイアログを開く（現在のJSを取得）
  const handleOpenJsEditor = useCallback(() => {
    const iframeDoc = getIframeDoc();
    if (iframeDoc) {
      const scriptElement = iframeDoc.getElementById('imported-scripts');
      const currentJs = scriptElement?.textContent || importedJs;
      setImportedJs(currentJs);
    }
    setIsJsEditorOpen(true);
  }, [getIframeDoc, importedJs]);

  // JSを保存（iframeに反映）
  const handleSaveJs = useCallback((js: string) => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    // 既存のスクリプト要素を取得または作成
    let scriptElement = iframeDoc.getElementById('imported-scripts');
    if (js.trim()) {
      if (!scriptElement) {
        scriptElement = iframeDoc.createElement('script');
        scriptElement.id = 'imported-scripts';
        iframeDoc.body.appendChild(scriptElement);
      }
      // 古いスクリプトを削除して新しいものを追加（JSを再実行するため）
      scriptElement.remove();
      const newScriptElement = iframeDoc.createElement('script');
      newScriptElement.id = 'imported-scripts';
      // 先頭にセミコロンを追加してIIFE連結問題を防ぐ
      // また、try-catchでラップしてエラーがページを壊さないようにする
      const safeJs = `;try{${js}}catch(e){console.error('[imported-scripts] Error:',e);}`;
      newScriptElement.textContent = safeJs;
      iframeDoc.body.appendChild(newScriptElement);
      console.log('[handleSaveJs] Updated JS:', js.length, 'chars');
    } else if (scriptElement) {
      // JSが空の場合はスクリプト要素を削除
      scriptElement.remove();
      console.log('[handleSaveJs] Removed empty JS');
    }

    // 状態を更新
    setImportedJs(js);
    // ページ設定にも保存（Firestore保存用）
    setPageSettings(prev => ({ ...prev, customJs: js }));

    // 変更を通知
    notifyIframeChange();
  }, [getIframeDoc, notifyIframeChange]);

  // JSをクリア
  const handleClearJs = useCallback(() => {
    const iframeDoc = getIframeDoc();
    if (iframeDoc) {
      const scriptElement = iframeDoc.getElementById('imported-scripts');
      if (scriptElement) {
        scriptElement.remove();
        console.log('[handleClearJs] Cleared imported JS');
      }
    }
    setImportedJs('');
    notifyIframeChange();
  }, [getIframeDoc, notifyIframeChange]);

  // ページ設定ダイアログを開く
  const handleOpenPageSettings = useCallback(() => {
    // iframeから現在のCSS/JSを取得して設定に反映
    const iframeDoc = getIframeDoc();
    if (iframeDoc) {
      const styleElement = iframeDoc.getElementById('imported-styles');
      const scriptElement = iframeDoc.getElementById('imported-scripts');
      setPageSettings(prev => ({
        ...prev,
        customCss: styleElement?.textContent || importedCss || prev.customCss,
        customJs: scriptElement?.textContent || importedJs || prev.customJs,
      }));
    }
    setIsPageSettingsOpen(true);
  }, [getIframeDoc, importedCss, importedJs]);

  // ページ設定を保存
  const handleSavePageSettings = useCallback(async (settings: PageSettings) => {
    setPageSettings(settings);

    const iframeDoc = getIframeDoc();
    if (iframeDoc) {
      // CSSをiframeに反映
      if (settings.customCss !== undefined) {
        let styleElement = iframeDoc.getElementById('imported-styles');
        if (settings.customCss.trim()) {
          if (!styleElement) {
            styleElement = iframeDoc.createElement('style');
            styleElement.id = 'imported-styles';
            iframeDoc.head.appendChild(styleElement);
          }
          styleElement.textContent = settings.customCss;
        } else if (styleElement) {
          styleElement.remove();
        }
        setImportedCss(settings.customCss);
      }

      // JSをiframeに反映
      if (settings.customJs !== undefined) {
        let scriptElement = iframeDoc.getElementById('imported-scripts');
        if (settings.customJs.trim()) {
          // 古いスクリプトを削除して新しいものを追加（JSを再実行するため）
          if (scriptElement) {
            scriptElement.remove();
          }
          const newScriptElement = iframeDoc.createElement('script');
          newScriptElement.id = 'imported-scripts';
          // 先頭にセミコロンを追加してIIFE連結問題を防ぐ
          // また、try-catchでラップしてエラーがページを壊さないようにする
          const safeJs = `;try{${settings.customJs}}catch(e){console.error('[imported-scripts] Error:',e);}`;
          newScriptElement.textContent = safeJs;
          iframeDoc.body.appendChild(newScriptElement);
        } else if (scriptElement) {
          scriptElement.remove();
        }
        setImportedJs(settings.customJs);
      }

      notifyIframeChange();
    }

    // Firestoreに保存
    if (parentId && contentId) {
      try {
        const api = await createAuthApi(getIdToken);
        const apiPath = editorMode === 'webpage'
          ? `/api/websites/${parentId}/pages/${contentId}`
          : `/api/presentations/${parentId}/slides/${contentId}`;

        // エディタ型をFirestore型に変換（undefinedを除外）
        const firestoreSettings: Record<string, unknown> = {};

        // 値がundefinedでない場合のみ設定
        if (settings.inheritProjectSettings !== undefined) {
          firestoreSettings.inheritProjectSettings = settings.inheritProjectSettings;
        }
        if (settings.title) firestoreSettings.metaTitle = settings.title;
        if (settings.description) firestoreSettings.metaDescription = settings.description;
        if (settings.keywords) firestoreSettings.metaKeywords = settings.keywords;
        if (settings.canonicalUrl) firestoreSettings.canonicalUrl = settings.canonicalUrl;
        if (settings.robots) firestoreSettings.robots = settings.robots;
        if (settings.ogp) firestoreSettings.ogp = settings.ogp;
        if (settings.twitter) firestoreSettings.twitter = settings.twitter;
        if (settings.customHeadHtml) firestoreSettings.customHeadHtml = settings.customHeadHtml;
        if (settings.bodyStartHtml) firestoreSettings.bodyStartHtml = settings.bodyStartHtml;
        if (settings.bodyEndHtml) firestoreSettings.bodyEndHtml = settings.bodyEndHtml;
        if (settings.externalCss?.length) firestoreSettings.externalCss = settings.externalCss;
        if (settings.externalJs?.length) firestoreSettings.externalJs = settings.externalJs;
        if (settings.customCss) firestoreSettings.customCss = settings.customCss;
        if (settings.customJs) firestoreSettings.customJs = settings.customJs;

        await api.patch(apiPath, { settings: firestoreSettings });
        console.log('[handleSavePageSettings] Saved settings to Firestore:', firestoreSettings);
      } catch (error) {
        console.error('[handleSavePageSettings] Failed to save settings to Firestore:', error);
      }
    }

    console.log('[handleSavePageSettings] Saved settings:', settings);
  }, [getIframeDoc, notifyIframeChange, parentId, contentId, editorMode, getIdToken]);

  // 現在のページ設定を保存（メイン保存ボタンから呼ばれる）
  const handleSaveCurrentSettings = useCallback(async () => {
    if (!parentId || !contentId) return;

    // iframeから最新のCSS/JSを取得
    const iframeDoc = getIframeDoc();
    let currentCss = pageSettings.customCss || '';
    let currentJs = pageSettings.customJs || '';

    if (iframeDoc) {
      const styleElement = iframeDoc.getElementById('imported-styles');
      if (styleElement?.textContent) {
        currentCss = styleElement.textContent;
      }
      const scriptElement = iframeDoc.getElementById('imported-scripts');
      if (scriptElement?.textContent) {
        currentJs = scriptElement.textContent;
      }
    }

    // CSS/JSが空の場合は保存不要
    if (!currentCss && !currentJs && !pageSettings.title && !pageSettings.description) {
      console.log('[handleSaveCurrentSettings] No settings to save');
      return;
    }

    try {
      const api = await createAuthApi(getIdToken);
      const apiPath = editorMode === 'webpage'
        ? `/api/websites/${parentId}/pages/${contentId}`
        : `/api/presentations/${parentId}/slides/${contentId}`;

      // エディタ型をFirestore型に変換（undefinedを除外）
      const firestoreSettings: Record<string, unknown> = {};

      // 値がundefinedでない場合のみ設定
      if (pageSettings.inheritProjectSettings !== undefined) {
        firestoreSettings.inheritProjectSettings = pageSettings.inheritProjectSettings;
      }
      if (pageSettings.title) firestoreSettings.metaTitle = pageSettings.title;
      if (pageSettings.description) firestoreSettings.metaDescription = pageSettings.description;
      if (pageSettings.keywords) firestoreSettings.metaKeywords = pageSettings.keywords;
      if (pageSettings.canonicalUrl) firestoreSettings.canonicalUrl = pageSettings.canonicalUrl;
      if (pageSettings.robots) firestoreSettings.robots = pageSettings.robots;
      if (pageSettings.ogp) firestoreSettings.ogp = pageSettings.ogp;
      if (pageSettings.twitter) firestoreSettings.twitter = pageSettings.twitter;
      if (pageSettings.customHeadHtml) firestoreSettings.customHeadHtml = pageSettings.customHeadHtml;
      if (pageSettings.bodyStartHtml) firestoreSettings.bodyStartHtml = pageSettings.bodyStartHtml;
      if (pageSettings.bodyEndHtml) firestoreSettings.bodyEndHtml = pageSettings.bodyEndHtml;
      if (pageSettings.externalCss?.length) firestoreSettings.externalCss = pageSettings.externalCss;
      if (pageSettings.externalJs?.length) firestoreSettings.externalJs = pageSettings.externalJs;
      if (currentCss) firestoreSettings.customCss = currentCss;
      if (currentJs) firestoreSettings.customJs = currentJs;

      await api.patch(apiPath, { settings: firestoreSettings });
      console.log('[handleSaveCurrentSettings] Saved settings to Firestore:', {
        customCss: currentCss.length + ' chars',
        customJs: currentJs.length + ' chars',
      });
    } catch (error) {
      console.error('[handleSaveCurrentSettings] Failed to save settings:', error);
    }
  }, [parentId, contentId, editorMode, getIdToken, pageSettings, getIframeDoc]);

  // HTMLエクスポート処理
  const handleExport = useCallback(async (format: 'html' | 'zip' = 'html') => {
    if (!parentId || !contentId) {
      console.error('[handleExport] Missing parentId or contentId');
      return;
    }

    try {
      // フォーマットに応じてAPIパラメータを設定
      const formatParam = format === 'zip' ? '&format=zip' : '';
      const apiPath = editorMode === 'webpage'
        ? `/api/websites/${parentId}/pages/${contentId}/export?download=true${formatParam}`
        : `/api/presentations/${parentId}/slides/${contentId}/export?download=true${formatParam}`;

      const response = await fetch(apiPath, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${await getIdToken()}`,
        },
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      // Content-Disposition からファイル名を取得
      const contentDisposition = response.headers.get('Content-Disposition');
      const defaultFilename = format === 'zip' ? 'page.zip' : 'page.html';
      let filename = defaultFilename;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match) {
          filename = decodeURIComponent(match[1]);
        }
      }

      // Blobとしてダウンロード
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log('[handleExport] Downloaded:', filename, 'format:', format);
    } catch (error) {
      console.error('[handleExport] Export failed:', error);
    }
  }, [parentId, contentId, editorMode, getIdToken]);

  // OGP画像アップロード
  const handleUploadOgpImage = useCallback(async (file: File): Promise<string> => {
    // 既存の画像アップロード機能を利用
    // Firebase Storageにアップロードして公開URLを返す
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'ogp');
    if (parentId) {
      formData.append('parentId', parentId);
    }

    try {
      const response = await fetch('/api/upload/image', {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': `Bearer ${await getIdToken()}`,
        },
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();
      return data.url;
    } catch (error) {
      console.error('[handleUploadOgpImage] Upload failed:', error);
      throw error;
    }
  }, [parentId, getIdToken]);

  // HTMLインポート処理（html + css + resources対応）
  const handleHtmlImport = useCallback((result: HtmlImportResult) => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    // アートボードコンテンツを取得して置換
    const artboard = iframeDoc.getElementById('artboard') || iframeDoc.getElementById('slide-artboard') || iframeDoc.body;
    if (artboard) {
      // インポートされたHTMLで内容を置換
      artboard.innerHTML = result.html;

      // CSSをiframeの<head>に注入
      if (result.css) {
        // 既存のインポート済みスタイルがあれば削除
        const existingStyle = iframeDoc.getElementById('imported-styles');
        if (existingStyle) {
          existingStyle.remove();
        }

        // 新しいスタイル要素を作成して追加
        const styleElement = iframeDoc.createElement('style');
        styleElement.id = 'imported-styles';
        styleElement.textContent = result.css;
        iframeDoc.head.appendChild(styleElement);
        console.log('[handleHtmlImport] Injected CSS:', result.css.length, 'chars');

        // CSS状態を保存（編集用）
        setImportedCss(result.css);
        // ページ設定にも保存（Firestore保存用）
        setPageSettings(prev => ({ ...prev, customCss: result.css }));
      }

      // JSをiframeの<body>末尾に注入
      if (result.js) {
        // 既存のインポート済みスクリプトがあれば削除
        const existingScript = iframeDoc.getElementById('imported-scripts');
        if (existingScript) {
          existingScript.remove();
        }

        // 新しいスクリプト要素を作成して追加
        const scriptElement = iframeDoc.createElement('script');
        scriptElement.id = 'imported-scripts';
        // 先頭にセミコロンを追加してIIFE連結問題を防ぐ
        // また、try-catchでラップしてエラーがページを壊さないようにする
        const safeJs = `;try{${result.js}}catch(e){console.error('[imported-scripts] Error:',e);}`;
        scriptElement.textContent = safeJs;
        iframeDoc.body.appendChild(scriptElement);
        console.log('[handleHtmlImport] Injected JS:', result.js.length, 'chars');

        // JS状態を保存（編集用）- 元のJSを保存
        setImportedJs(result.js);
        // ページ設定にも保存（Firestore保存用）
        setPageSettings(prev => ({ ...prev, customJs: result.js }));
      }

      // インポートされた要素に data-editable と data-element-id を付与
      const count = makeChildrenEditable(artboard);
      console.log('[handleHtmlImport] Made', count, 'elements editable');

      // リソース情報をログ
      if (result.resources) {
        console.log('[handleHtmlImport] Resources:', {
          images: result.resources.images?.length || 0,
          stylesheets: result.resources.stylesheets?.length || 0,
          scripts: result.resources.scripts?.length || 0,
        });
      }

      // DOMツリーを再構築
      const tree = buildDomTree(iframeDoc);
      setDomTree(tree);
      setExpandedNodes(new Set(tree.map((n: { id: string }) => n.id)));

      // 履歴に追加
      const newHtml = getArtboardContent(iframeDoc);
      pushHistory(newHtml);

      // 変更通知
      notifyIframeChange();

      // 選択をクリア
      setSelectedElement(null);
      setSelectedElementIds([]);
    }
  }, [getIframeDoc, pushHistory, setDomTree, setExpandedNodes, notifyIframeChange, setSelectedElement, setSelectedElementIds]);

  return {
    // CSS editor
    isCssEditorOpen,
    setIsCssEditorOpen,
    importedCss,
    handleOpenCssEditor,
    handleSaveCss,
    handleClearCss,
    // JS editor
    isJsEditorOpen,
    setIsJsEditorOpen,
    importedJs,
    handleOpenJsEditor,
    handleSaveJs,
    handleClearJs,
    // Page settings
    isPageSettingsOpen,
    setIsPageSettingsOpen,
    pageSettings,
    projectSettings,
    handleOpenPageSettings,
    handleSavePageSettings,
    handleSaveCurrentSettings,
    // Export
    handleExport,
    // OGP
    handleUploadOgpImage,
    // HTML Import
    handleHtmlImport,
  };
}
