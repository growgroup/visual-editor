/**
 * ページ設定の型定義
 * プロジェクトレベルのデフォルト設定とページ単位の上書き設定をサポート
 */

/**
 * OGP (Open Graph Protocol) 設定
 */
export interface OgpSettings {
  /** og:title */
  title?: string;
  /** og:description */
  description?: string;
  /** og:image URL */
  image?: string;
  /** og:type (website, article, product など) */
  type?: 'website' | 'article' | 'product' | 'profile' | string;
  /** og:url */
  url?: string;
  /** og:site_name */
  siteName?: string;
  /** og:locale */
  locale?: string;
}

/**
 * Twitter Card 設定
 */
export interface TwitterCardSettings {
  /** twitter:card (summary, summary_large_image, app, player) */
  card?: 'summary' | 'summary_large_image' | 'app' | 'player';
  /** twitter:site (@username) */
  site?: string;
  /** twitter:creator (@username) */
  creator?: string;
  /** twitter:title */
  title?: string;
  /** twitter:description */
  description?: string;
  /** twitter:image URL */
  image?: string;
}

/**
 * 外部リソース
 */
export interface ExternalResource {
  /** リソースID */
  id: string;
  /** リソースURL */
  url: string;
  /** リソースタイプ */
  type: 'css' | 'js';
  /** 読み込み位置 (JSのみ) */
  position?: 'head' | 'body-start' | 'body-end';
  /** async属性 (JSのみ) */
  async?: boolean;
  /** defer属性 (JSのみ) */
  defer?: boolean;
  /** 説明・メモ */
  description?: string;
}

/**
 * Favicon設定
 */
export interface FaviconSettings {
  /** 標準favicon (ICO/PNG) */
  ico?: string;
  /** Apple Touch Icon */
  appleTouchIcon?: string;
  /** 32x32 PNG */
  png32?: string;
  /** 16x16 PNG */
  png16?: string;
  /** SVG favicon */
  svg?: string;
  /** manifest.json URL */
  manifest?: string;
}

/**
 * プロジェクト/プレゼンテーション レベルのデフォルト設定
 */
export interface ProjectPageSettings {
  // ===== 基本SEO =====
  /** デフォルトのtitleテンプレート (例: "{page} | サイト名") */
  titleTemplate?: string;
  /** デフォルトのdescription */
  defaultDescription?: string;
  /** デフォルトのkeywords */
  defaultKeywords?: string;
  /** 言語設定 */
  language?: string;
  /** 文字エンコーディング */
  charset?: string;

  // ===== OGP デフォルト =====
  ogp?: OgpSettings;

  // ===== Twitter Card デフォルト =====
  twitter?: TwitterCardSettings;

  // ===== Favicon =====
  favicon?: FaviconSettings;

  // ===== 共通挿入コンテンツ =====
  /** 全ページ共通の<head>追加HTML (analytics, fonts等) */
  commonHeadHtml?: string;
  /** 全ページ共通の<body>開始直後HTML */
  commonBodyStartHtml?: string;
  /** 全ページ共通の</body>直前HTML */
  commonBodyEndHtml?: string;

  // ===== 外部リソース =====
  /** 全ページ共通の外部CSS */
  externalCss?: ExternalResource[];
  /** 全ページ共通の外部JS */
  externalJs?: ExternalResource[];

  // ===== 共通スタイル・スクリプト =====
  /** 全ページ共通のカスタムCSS */
  commonCss?: string;
  /** 全ページ共通のカスタムJS */
  commonJs?: string;
}

/**
 * ページ/スライド レベルの設定（プロジェクト設定を上書き可能）
 */
export interface PageSettings {
  // ===== 継承設定 =====
  /** プロジェクト設定を継承するか (default: true) */
  inheritProjectSettings?: boolean;

  // ===== 基本SEO =====
  /** ページタイトル */
  title?: string;
  /** ページ説明文 */
  description?: string;
  /** キーワード */
  keywords?: string;
  /** canonical URL */
  canonicalUrl?: string;
  /** robots設定 */
  robots?: string;

  // ===== OGP (上書き) =====
  ogp?: OgpSettings;

  // ===== Twitter Card (上書き) =====
  twitter?: TwitterCardSettings;

  // ===== ページ固有の挿入コンテンツ =====
  /** ページ固有の<head>追加HTML */
  customHeadHtml?: string;
  /** ページ固有の<body>開始直後HTML */
  bodyStartHtml?: string;
  /** ページ固有の</body>直前HTML */
  bodyEndHtml?: string;

  // ===== ページ固有リソース =====
  /** ページ固有の外部CSS */
  externalCss?: ExternalResource[];
  /** ページ固有の外部JS */
  externalJs?: ExternalResource[];

  // ===== カスタムコード =====
  /** ページ固有のカスタムCSS (インポートCSSもここに統合) */
  customCss?: string;
  /** カスタムCSSのStorage URL (大きい場合) */
  customCssUrl?: string;
  /** カスタムCSSのStorage Path (削除用) */
  customCssPath?: string;
  /** カスタムCSSのサイズ */
  customCssSize?: number;
  /** ページ固有のカスタムJS (インポートJSもここに統合) */
  customJs?: string;
  /** カスタムJSのStorage URL (大きい場合) */
  customJsUrl?: string;
  /** カスタムJSのStorage Path (削除用) */
  customJsPath?: string;
  /** カスタムJSのサイズ */
  customJsSize?: number;

  // ===== 更新日時 =====
  updatedAt?: Date;
}

/**
 * マージされた最終設定
 * プロジェクト設定とページ設定をマージした結果
 */
export interface MergedPageSettings {
  title: string;
  description: string;
  keywords: string;
  canonicalUrl?: string;
  robots?: string;
  language: string;
  charset: string;
  ogp: OgpSettings;
  twitter: TwitterCardSettings;
  favicon: FaviconSettings;
  headHtml: string;
  bodyStartHtml: string;
  bodyEndHtml: string;
  externalCss: ExternalResource[];
  externalJs: ExternalResource[];
  customCss: string;
  customJs: string;
}

/**
 * プロジェクト設定とページ設定をマージする
 */
export function mergePageSettings(
  projectSettings: ProjectPageSettings | null | undefined,
  pageSettings: PageSettings | null | undefined,
  pageTitle?: string
): MergedPageSettings {
  const project = projectSettings || {};
  const page = pageSettings || {};

  // 継承しない場合はページ設定のみを使用
  const inherit = page.inheritProjectSettings !== false;

  // タイトルのマージ（テンプレート適用）
  let finalTitle = page.title || pageTitle || '';
  if (inherit && project.titleTemplate && finalTitle) {
    finalTitle = project.titleTemplate.replace('{page}', finalTitle);
  }

  return {
    title: finalTitle,
    description: page.description || (inherit ? project.defaultDescription : '') || '',
    keywords: page.keywords || (inherit ? project.defaultKeywords : '') || '',
    canonicalUrl: page.canonicalUrl,
    robots: page.robots,
    language: (inherit ? project.language : undefined) || 'ja',
    charset: (inherit ? project.charset : undefined) || 'UTF-8',

    ogp: {
      ...(inherit ? project.ogp : {}),
      ...page.ogp,
      title: page.ogp?.title || page.title || (inherit ? project.ogp?.title : undefined) || finalTitle,
      description: page.ogp?.description || page.description || (inherit ? project.ogp?.description : undefined),
    },

    twitter: {
      ...(inherit ? project.twitter : {}),
      ...page.twitter,
      title: page.twitter?.title || page.title || (inherit ? project.twitter?.title : undefined) || finalTitle,
      description: page.twitter?.description || page.description || (inherit ? project.twitter?.description : undefined),
    },

    favicon: inherit ? (project.favicon || {}) : {},

    // HTML挿入コンテンツ（共通 + ページ固有を結合）
    headHtml: [
      inherit ? project.commonHeadHtml : '',
      page.customHeadHtml
    ].filter(Boolean).join('\n'),

    bodyStartHtml: [
      inherit ? project.commonBodyStartHtml : '',
      page.bodyStartHtml
    ].filter(Boolean).join('\n'),

    bodyEndHtml: [
      page.bodyEndHtml,
      inherit ? project.commonBodyEndHtml : ''
    ].filter(Boolean).join('\n'),

    // 外部リソース（共通 + ページ固有）
    externalCss: [
      ...(inherit ? (project.externalCss || []) : []),
      ...(page.externalCss || [])
    ],

    externalJs: [
      ...(inherit ? (project.externalJs || []) : []),
      ...(page.externalJs || [])
    ],

    // カスタムコード（共通 + ページ固有）
    customCss: [
      inherit ? project.commonCss : '',
      page.customCss
    ].filter(Boolean).join('\n\n'),

    customJs: [
      inherit ? project.commonJs : '',
      page.customJs
    ].filter(Boolean).join('\n\n'),
  };
}

/**
 * 完全なHTMLドキュメントを生成する
 */
export function generateFullHtml(
  bodyContent: string,
  settings: MergedPageSettings
): string {
  const lines: string[] = [];

  lines.push('<!DOCTYPE html>');
  lines.push(`<html lang="${settings.language}">`);
  lines.push('<head>');
  lines.push(`  <meta charset="${settings.charset}">`);
  lines.push('  <meta name="viewport" content="width=device-width, initial-scale=1.0">');

  // Title
  if (settings.title) {
    lines.push(`  <title>${escapeHtml(settings.title)}</title>`);
  }

  // Description
  if (settings.description) {
    lines.push(`  <meta name="description" content="${escapeHtml(settings.description)}">`);
  }

  // Keywords
  if (settings.keywords) {
    lines.push(`  <meta name="keywords" content="${escapeHtml(settings.keywords)}">`);
  }

  // Robots
  if (settings.robots) {
    lines.push(`  <meta name="robots" content="${escapeHtml(settings.robots)}">`);
  }

  // Canonical
  if (settings.canonicalUrl) {
    lines.push(`  <link rel="canonical" href="${escapeHtml(settings.canonicalUrl)}">`);
  }

  // OGP
  if (settings.ogp.title) {
    lines.push(`  <meta property="og:title" content="${escapeHtml(settings.ogp.title)}">`);
  }
  if (settings.ogp.description) {
    lines.push(`  <meta property="og:description" content="${escapeHtml(settings.ogp.description)}">`);
  }
  if (settings.ogp.image) {
    lines.push(`  <meta property="og:image" content="${escapeHtml(settings.ogp.image)}">`);
  }
  if (settings.ogp.type) {
    lines.push(`  <meta property="og:type" content="${escapeHtml(settings.ogp.type)}">`);
  }
  if (settings.ogp.url) {
    lines.push(`  <meta property="og:url" content="${escapeHtml(settings.ogp.url)}">`);
  }
  if (settings.ogp.siteName) {
    lines.push(`  <meta property="og:site_name" content="${escapeHtml(settings.ogp.siteName)}">`);
  }
  if (settings.ogp.locale) {
    lines.push(`  <meta property="og:locale" content="${escapeHtml(settings.ogp.locale)}">`);
  }

  // Twitter Card
  if (settings.twitter.card) {
    lines.push(`  <meta name="twitter:card" content="${escapeHtml(settings.twitter.card)}">`);
  }
  if (settings.twitter.site) {
    lines.push(`  <meta name="twitter:site" content="${escapeHtml(settings.twitter.site)}">`);
  }
  if (settings.twitter.creator) {
    lines.push(`  <meta name="twitter:creator" content="${escapeHtml(settings.twitter.creator)}">`);
  }
  if (settings.twitter.title) {
    lines.push(`  <meta name="twitter:title" content="${escapeHtml(settings.twitter.title)}">`);
  }
  if (settings.twitter.description) {
    lines.push(`  <meta name="twitter:description" content="${escapeHtml(settings.twitter.description)}">`);
  }
  if (settings.twitter.image) {
    lines.push(`  <meta name="twitter:image" content="${escapeHtml(settings.twitter.image)}">`);
  }

  // Favicon
  if (settings.favicon.ico) {
    lines.push(`  <link rel="icon" href="${escapeHtml(settings.favicon.ico)}">`);
  }
  if (settings.favicon.svg) {
    lines.push(`  <link rel="icon" type="image/svg+xml" href="${escapeHtml(settings.favicon.svg)}">`);
  }
  if (settings.favicon.png32) {
    lines.push(`  <link rel="icon" type="image/png" sizes="32x32" href="${escapeHtml(settings.favicon.png32)}">`);
  }
  if (settings.favicon.png16) {
    lines.push(`  <link rel="icon" type="image/png" sizes="16x16" href="${escapeHtml(settings.favicon.png16)}">`);
  }
  if (settings.favicon.appleTouchIcon) {
    lines.push(`  <link rel="apple-touch-icon" href="${escapeHtml(settings.favicon.appleTouchIcon)}">`);
  }
  if (settings.favicon.manifest) {
    lines.push(`  <link rel="manifest" href="${escapeHtml(settings.favicon.manifest)}">`);
  }

  // External CSS
  for (const css of settings.externalCss) {
    lines.push(`  <link rel="stylesheet" href="${escapeHtml(css.url)}">`);
  }

  // External JS (head position)
  for (const js of settings.externalJs.filter(j => j.position === 'head')) {
    const attrs = [
      `src="${escapeHtml(js.url)}"`,
      js.async ? 'async' : '',
      js.defer ? 'defer' : ''
    ].filter(Boolean).join(' ');
    lines.push(`  <script ${attrs}></script>`);
  }

  // Custom CSS
  if (settings.customCss) {
    lines.push('  <style>');
    lines.push(settings.customCss);
    lines.push('  </style>');
  }

  // Custom head HTML
  if (settings.headHtml) {
    lines.push(settings.headHtml);
  }

  lines.push('</head>');
  lines.push('<body>');

  // Body start HTML
  if (settings.bodyStartHtml) {
    lines.push(settings.bodyStartHtml);
  }

  // External JS (body-start position)
  for (const js of settings.externalJs.filter(j => j.position === 'body-start')) {
    const attrs = [
      `src="${escapeHtml(js.url)}"`,
      js.async ? 'async' : '',
      js.defer ? 'defer' : ''
    ].filter(Boolean).join(' ');
    lines.push(`<script ${attrs}></script>`);
  }

  // Body content
  lines.push(bodyContent);

  // External JS (body-end position or default)
  for (const js of settings.externalJs.filter(j => !j.position || j.position === 'body-end')) {
    const attrs = [
      `src="${escapeHtml(js.url)}"`,
      js.async ? 'async' : '',
      js.defer ? 'defer' : ''
    ].filter(Boolean).join(' ');
    lines.push(`<script ${attrs}></script>`);
  }

  // Custom JS
  if (settings.customJs) {
    lines.push('<script>');
    lines.push(settings.customJs);
    lines.push('</script>');
  }

  // Body end HTML
  if (settings.bodyEndHtml) {
    lines.push(settings.bodyEndHtml);
  }

  lines.push('</body>');
  lines.push('</html>');

  return lines.join('\n');
}

/**
 * HTML特殊文字をエスケープ
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * デフォルトのプロジェクト設定
 */
export const DEFAULT_PROJECT_SETTINGS: ProjectPageSettings = {
  titleTemplate: '{page}',
  defaultDescription: '',
  defaultKeywords: '',
  language: 'ja',
  charset: 'UTF-8',
  ogp: {
    type: 'website',
    locale: 'ja_JP',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

/**
 * デフォルトのページ設定
 */
export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  inheritProjectSettings: true,
};
