/**
 * HTML生成・クリーンアップ関連のユーティリティ関数
 */

import { SLIDE_WIDTH, SLIDE_HEIGHT, WEBPAGE_WIDTH, WEBPAGE_MIN_HEIGHT } from '../constants';
import type { EditorMode } from '../EditorContext';
import { prepareHtmlForSave } from './viewport-utils';
import { classifySaveAndRevert } from './dom-utils';

// キャンバス背景色（Figmaライクなダークグレー）
const CANVAS_BG_COLOR = '#1a1a1a';

/**
 * HTMLコンテンツにTailwind CSSが読み込まれているかチェック
 * @param content - HTMLコンテンツ
 * @returns Tailwind CSSが読み込まれている場合はtrue
 */
export function hasTailwindCss(content: string): boolean {
  // Tailwind CSS CDNリンクのパターン
  const tailwindPatterns = [
    /cdn\.tailwindcss\.com/i,
    /@tailwindcss\/browser/i,
    /tailwindcss-browser/i,
    /tailwind\.min\.css/i,
    /tailwind\.css/i,
    /<style[^>]*>[\s\S]*@tailwind\s+(base|components|utilities)/i,
  ];

  return tailwindPatterns.some(pattern => pattern.test(content));
}

/**
 * HTMLコンテンツが外部サイトからインポートされた可能性があるかチェック
 * 外部CSSリンクや大量のインラインスタイルがある場合はtrue
 * @param content - HTMLコンテンツ
 * @returns 外部サイトからのインポートの可能性がある場合はtrue
 */
export function hasExternalStyles(content: string): boolean {
  // 外部CSSリンクのパターン
  const externalCssPatterns = [
    /<link[^>]*rel=["']stylesheet["'][^>]*href=["']https?:\/\//i,
    /<link[^>]*href=["']https?:\/\/[^>]*rel=["']stylesheet["']/i,
  ];

  // 外部CSSリンクがある
  if (externalCssPatterns.some(pattern => pattern.test(content))) {
    return true;
  }

  // 大量のインラインスタイル（<style>タグ内に100文字以上）
  const styleTagMatch = content.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  if (styleTagMatch) {
    const totalStyleLength = styleTagMatch.reduce((sum, tag) => {
      const innerContent = tag.replace(/<\/?style[^>]*>/gi, '');
      return sum + innerContent.length;
    }, 0);
    // 500文字以上のスタイルがあれば外部コンテンツの可能性が高い
    if (totalStyleLength > 500) {
      return true;
    }
  }

  return false;
}

/**
 * Tailwind CSS Browser スクリプトの注入用HTML
 * blob URLからの読み込みに対応するため、絶対URLを使用
 *
 * 重要: 既存のスタイルを壊さないよう、preflightを無効化
 * - ユーティリティクラスのみを有効化
 * - CSSリセットは適用しない
 *
 * @param safeMode - trueの場合、より安全なモード（preflightを完全に無効化）
 */
function getTailwindScriptHtml(safeMode: boolean = false): string {
  // window.location.originを使用して絶対URLを構築
  // SSR時はデフォルトのCDN URLにフォールバック
  const baseUrl = typeof window !== 'undefined'
    ? window.location.origin
    : '';
  const scriptUrl = baseUrl
    ? `${baseUrl}/vendor/tailwindcss-browser.js`
    : 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4';

  // セーフモード: より厳格にpreflightを無効化し、既存スタイルへの影響を最小化
  if (safeMode) {
    return `
  <!-- Tailwind CSS Browser (safe mode - utilities only) -->
  <script src="${scriptUrl}" data-tailwind-injected="true"></script>
  <style type="text/tailwindcss">
    /* preflightを完全に無効化 - ユーティリティのみ使用 */
    @layer base {
      /* 空のbaseレイヤーでpreflightを上書き */
    }
    @theme {
      /* 最小限のテーマ設定 */
      --font-sans: system-ui, sans-serif;
${collectHostThemeTokens()}
    }
  </style>
  <style>
    /* 既存スタイルを保護: Tailwindのグローバルリセットを無効化 */
    :where([data-tailwind-injected]) ~ * {
      all: revert-layer;
    }
  </style>`;
  }

  // 通常モード
  return `
  <!-- Tailwind CSS Browser (self-hosted with CDN fallback) -->
  <script src="${scriptUrl}" data-tailwind-injected="true"></script>
  <style type="text/tailwindcss">
    @layer base {
      /* CSSリセットを最小化 */
    }
    @theme {
      --font-sans: 'Noto Sans JP', system-ui, sans-serif;
${collectHostThemeTokens()}
    }
  </style>`;
}

/**
 * キャンバス+アートボード構造の編集用HTMLを生成
 * @param content - HTMLコンテンツ
 * @param editorMode - エディタモード（'slide' または 'webpage'）
 *
 * 構造:
 * - html/body: 100%サイズ、キャンバス背景色
 * - #canvas-container: ズーム/パン対象のスクロール領域
 * - #artboard-wrapper: transform適用対象（ズーム/パン）
 * - #artboard: 白背景、コンテンツ配置エリア
 */
export function generateEditableHtml(content: string, editorMode: EditorMode = 'slide'): string {
  const artboardWidth = editorMode === 'webpage' ? WEBPAGE_WIDTH : SLIDE_WIDTH;
  const artboardHeight = editorMode === 'webpage' ? WEBPAGE_MIN_HEIGHT : SLIDE_HEIGHT;
  const artboardHeightStyle = editorMode === 'webpage' ? 'min-height' : 'height';

  // コンテンツにTailwind CSSが含まれていない場合は注入
  // 外部スタイルがある場合はセーフモードを使用（既存スタイルを保護）
  const needsTailwind = !hasTailwindCss(content);
  const useSafeMode = needsTailwind && hasExternalStyles(content);
  const tailwindScript = needsTailwind ? getTailwindScriptHtml(useSafeMode) : '';

  return `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${tailwindScript}
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100;200;300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <!-- スライドの欧文(font-en)。読み込まないと游ゴシックで代替され、
       数字・フッターの幅がビューアと10px以上ずれる(検証で実測) -->
  <link href="https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: ${CANVAS_BG_COLOR};
      /* iframe内のエディタUI(パンくず・ラベル等)用。
         スライド本体は #artboard 内のルートが font-sans(游ゴシック)を持つので影響しない */
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', Meiryo, sans-serif;
    }

    /* スクロール可能なキャンバスコンテナ */
    #canvas-container {
      position: absolute;
      inset: 0;
      overflow: auto;
      background-color: ${CANVAS_BG_COLOR};
    }

    /* パディング用ラッパー（スクロール領域確保） */
    #canvas-scroll-area {
      display: flex;
      align-items: center;
      justify-content: center;
      /* サイズはJSで動的に設定 */
    }

    /* ズーム/パン適用対象 */
    #artboard-wrapper {
      flex-shrink: 0;
      transform-origin: center center;
      /* transform は JS で設定 */
      /* 読み込み直後は非表示。倍率適用前の等倍(巨大)な一瞬を見せない。
         EditorCanvas がロード時に倍率を当ててから可視化する */
      visibility: hidden;
    }

    /* アートボード（コンテンツ領域） */
    #artboard {
      width: ${artboardWidth}px;
      ${artboardHeightStyle}: ${artboardHeight}px;
      background-color: white;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      position: relative;
      overflow: ${editorMode === 'webpage' ? 'visible' : 'hidden'};
    }

    /* ズーム中のスムーズな遷移を無効化（操作のレスポンス向上） */
    #artboard-wrapper.zooming {
      transition: none !important;
    }

    /* パンモード時のカーソル */
    body.pan-mode {
      cursor: grab !important;
    }
    body.pan-mode:active,
    body.panning {
      cursor: grabbing !important;
    }
    body.pan-mode #artboard,
    body.pan-mode [data-editable="true"] {
      pointer-events: none !important;
    }
    body.panning #artboard,
    body.panning [data-editable="true"] {
      pointer-events: none !important;
    }
  </style>
</head>
<body tabindex="-1">
  <div id="canvas-container">
    <div id="canvas-scroll-area">
      <div id="artboard-wrapper">
        <div id="artboard">
          ${content}
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * クリーンなHTMLを取得（保存用）
 * エディタ用の属性やクラスを削除
 * 新しいキャンバス構造から#artboard内のコンテンツを抽出
 * viewport単位（vw, vh等）を復元
 */
export function getCleanHtml(doc: Document): string {
  // 新しい構造: #artboard からコンテンツを取得
  const artboard = doc.getElementById('artboard');
  const sourceElement = artboard || doc.body;

  // viewport単位を復元したHTMLを取得
  // prepareHtmlForSaveは内部でcloneを作成し、data-original-*から元の値を復元する
  const viewportRestoredHtml = prepareHtmlForSave(sourceElement);

  // 復元されたHTMLを再度パースしてクリーンアップ
  const tempContainer = doc.createElement('div');
  tempContainer.innerHTML = viewportRestoredHtml;

  // 選択ボックスを削除
  tempContainer.querySelectorAll('.selection-box').forEach(el => el.remove());

  // マーキー選択ボックスを削除
  tempContainer.querySelectorAll('.marquee-selection-box').forEach(el => el.remove());

  // コメントの吹き出しレイヤー(表示専用)を削除
  tempContainer.querySelectorAll('.gg-comment-layer').forEach(el => el.remove());
  // Alt計測の赤い線(表示専用)も保存しない
  tempContainer.querySelectorAll('#gg-measure-layer').forEach(el => el.remove());
  // ドラッグ中の整列ガイド(表示専用)も保存しない
  tempContainer.querySelectorAll('#gg-smart-guides').forEach(el => el.remove());

  // トリミングモードのUI(枠・ハンドル)。確定/中断で消えるが、保険で除去
  tempContainer.querySelectorAll('.gg-crop-ui').forEach(el => el.remove());

  // 編集用属性を削除
  tempContainer.querySelectorAll('[data-editable]').forEach(el => {
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-editable');
    el.removeAttribute('data-element-id');
    el.removeAttribute('data-original-content');
    el.removeAttribute('data-shape-type');
    el.removeAttribute('data-inline');
    el.classList.remove(
      'selected', 'dragging', 'editing', 'rotating', 'panning',
      'hover-preview', 'marquee-hover', 'marquee-active', 'text-editable-hover', 'drag-ghost',
    );
    if (!el.getAttribute('class')) el.removeAttribute('class');
  });

  // data-original-* 属性は prepareHtmlForSave で既に削除されているが、
  // 念のため残っていれば削除
  tempContainer.querySelectorAll('*').forEach(el => {
    const attrs = Array.from(el.attributes);
    attrs.forEach(attr => {
      if (attr.name.startsWith('data-original-')) {
        el.removeAttribute(attr.name);
      }
    });
  });

  // 触っていない要素の絶対位置変換を巻き戻し、触った要素に data-gg-dirty を付ける。
  // これで保存HTMLは「原本のレイアウト + 実際の編集」だけになり、
  // 原本TSXへの決定的な書き戻し(scripts/slide-writeback.mjs)が成立する
  classifySaveAndRevert(tempContainer);

  return tempContainer.innerHTML;
}

/**
 * HTMLコンテンツから編集可能要素にIDを付与
 */
export function addElementIds(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  let idCounter = 0;
  doc.querySelectorAll('[data-editable="true"]').forEach(el => {
    if (!el.getAttribute('data-element-id')) {
      el.setAttribute('data-element-id', `el-${Date.now()}-${idCounter++}`);
    }
  });

  return doc.body.innerHTML;
}

/**
 * インポートされたHTMLに編集可能属性とIDを付与
 * 直接の子要素にdata-editable="true"とdata-element-idを追加
 * @param container - 親コンテナ要素（通常は#artboard）
 */
/**
 * [移植時の追加] スライドのキャンバス本体かどうか。
 * `#artboard` の直下にあり、ほぼ同じ大きさを占める器を指す。
 * ここは「紙」であって編集対象の要素ではないので、選択・ドラッグさせない。
 */
function isSlideCanvas(el: HTMLElement, parent: HTMLElement): boolean {
  if (parent.id !== 'artboard') return false;
  if (el.parentElement !== parent) return false;
  return el.offsetWidth >= parent.clientWidth - 2 && el.offsetHeight >= parent.clientHeight - 2;
}

export function makeChildrenEditable(container: HTMLElement): number {
  let count = 0;
  const timestamp = Date.now();

  // 直接の子要素をチェック
  Array.from(container.children).forEach((child, index) => {
    const el = child as HTMLElement;

    // スキップする要素
    if (
      el.tagName === 'SCRIPT' ||
      el.tagName === 'STYLE' ||
      el.tagName === 'LINK' ||
      el.classList?.contains('selection-box') ||
      el.classList?.contains('marquee-selection-box') ||
      // [移植時の修正] スライドのキャンバス自体(#artboard と同じ大きさの直下の器)は
      // 編集対象にしない。これを選べてしまうと、掴んだ瞬間にスライドごと動いて
      // 中身が版面の外(overflow:hidden)へ出るため、要素が消えたように見える
      isSlideCanvas(el, container)
    ) {
      return;
    }

    // data-editableがない場合は追加
    if (!el.hasAttribute('data-editable')) {
      el.setAttribute('data-editable', 'true');
    }

    // data-element-idがない場合は追加
    if (!el.hasAttribute('data-element-id')) {
      el.setAttribute('data-element-id', `el-${timestamp}-${index}`);
    }

    count++;

    // 子孫要素も再帰的に処理（ネストされた編集可能要素のため）
    count += makeDescendantsEditable(el, timestamp, index * 1000);
  });

  return count;
}

/**
 * 子孫要素に編集可能属性を付与（再帰処理）
 * 特定の条件を満たす要素のみを編集可能にする
 */
function makeDescendantsEditable(parent: HTMLElement, timestamp: number, baseIndex: number): number {
  let count = 0;
  let localIndex = 0;

  // 編集可能にすべき要素のタグ名
  const EDITABLE_TAGS = new Set([
    'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'MAIN', 'ASIDE',
    'FIGURE', 'FIGCAPTION', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'UL', 'OL', 'LI', 'IMG', 'BUTTON', 'A', 'FORM', 'INPUT', 'TEXTAREA',
    'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'SPAN', 'LABEL',
    'VIDEO', 'AUDIO', 'CANVAS', 'SVG', 'BLOCKQUOTE', 'PRE', 'CODE',
  ]);

  Array.from(parent.children).forEach((child) => {
    const el = child as HTMLElement;

    // スキップする要素
    if (
      el.tagName === 'SCRIPT' ||
      el.tagName === 'STYLE' ||
      el.tagName === 'LINK' ||
      el.classList?.contains('selection-box') ||
      el.classList?.contains('marquee-selection-box') ||
      // [移植時の修正] スライドのキャンバス自体(#artboard と同じ大きさの直下の器)は
      // 編集対象にしない。これを選べてしまうと、掴んだ瞬間にスライドごと動いて
      // 中身が版面の外(overflow:hidden)へ出るため、要素が消えたように見える
      isSlideCanvas(el, parent)
    ) {
      return;
    }

    // 編集可能なタグかチェック
    if (EDITABLE_TAGS.has(el.tagName)) {
      // 既に属性がある場合はスキップ
      if (!el.hasAttribute('data-editable')) {
        el.setAttribute('data-editable', 'true');
      }

      if (!el.hasAttribute('data-element-id')) {
        el.setAttribute('data-element-id', `el-${timestamp}-${baseIndex + localIndex}`);
        localIndex++;
      }

      count++;
    }

    // 再帰的に子要素を処理
    count += makeDescendantsEditable(el, timestamp, baseIndex + localIndex * 100);
  });

  return count;
}

/**
 * [移植時の追加] ホストアプリの Tailwind v4 デザイントークンを iframe へ引き継ぐ。
 * :root の CSS カスタムプロパティ(--color-* / --font-*)を computedStyle から読み取り、
 * iframe 内 Tailwind Browser の @theme に流し込む。これにより
 * bg-gg-green のようなプロジェクト固有クラスがエディタ内でも解決される。
 * (Tailwind v4 は @layer 内にトークンを出力するため styleSheets 走査では取得できない)
 */
function collectHostThemeTokens(): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return '';
  try {
    const cs = getComputedStyle(document.documentElement);
    const lines: string[] = [];
    for (const prop of Array.from(cs)) {
      if (!prop.startsWith('--color-') && !prop.startsWith('--font-')) continue;
      const value = cs.getPropertyValue(prop).trim();
      if (!value) continue;
      lines.push(`      ${prop}: ${value};`);
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}
