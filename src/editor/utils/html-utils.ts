/**
 * HTML生成・クリーンアップ関連のユーティリティ関数
 */

import { SLIDE_WIDTH, SLIDE_HEIGHT, WEBPAGE_WIDTH, WEBPAGE_MIN_HEIGHT } from '../constants';
import type { PreviewStyle } from '../../io';
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
export interface EditableHtmlOptions {
  /**
   * マルチフレームのキャンバスに埋め込む姿。
   * 倍率は外側(親)の CSS transform が持つので、iframe の中は等倍・スクロール無しにする。
   * #canvas-container 等の id は残す(数十か所の getElementById を壊さないため)
   */
  embedded?: boolean;
  /** webpage の版面の幅。省略時は WEBPAGE_WIDTH(EditorCanvas が後から viewportWidth で上書きする) */
  artboardWidth?: number;
}

/**
 * 紙面の外側で共通に読む <head> の中身(Tailwind の注入判定・フォント)。
 * 編集用(generateEditableHtml)と見るだけ(generatePreviewHtml)で同じ判定を使う。
 * 別々に持つと、片方だけ Tailwind を二重注入して見え方が食い違う
 */
function buildCommonHead(content: string): string {
  // コンテンツにTailwind CSSが含まれていない場合は注入
  // 外部スタイルがある場合はセーフモードを使用（既存スタイルを保護）
  const needsTailwind = !hasTailwindCss(content);
  const useSafeMode = needsTailwind && hasExternalStyles(content);
  const tailwindScript = needsTailwind ? getTailwindScriptHtml(useSafeMode) : '';
  return `
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${tailwindScript}
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100;200;300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <!-- スライドの欧文(font-en)。読み込まないと游ゴシックで代替され、
       数字・フッターの幅がビューアと10px以上ずれる(検証で実測) -->
  <link href="https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600;700&display=swap" rel="stylesheet">`;
}

/**
 * 見るだけの紙面(マルチフレームのキャンバスで、編集していないページの姿)。
 * 編集用と同じ head を使い、body は等倍・白地・スクロール無し。
 * 編集用の属性は付けない(選択も編集も、このページを開いてから)
 */
export function generatePreviewHtml(
  content: string,
  editorMode: EditorMode = 'slide',
  artboardWidth?: number,
  styles: PreviewStyle[] = [],
): string {
  // 利用側が渡したスタイル(コンパイル済み Tailwind など)。head の共通部分の後、紙面の基本 CSS の前
  const extraStyles = styles
    .map((s) => ('href' in s ? `<link rel="stylesheet" href="${s.href.replace(/"/g, '&quot;')}">` : `<style data-preview-style>${s.css.replace(/<\/style/gi, '<\\/style')}</style>`))
    .join('\n  ');
  const width = editorMode === 'webpage' ? (artboardWidth ?? WEBPAGE_WIDTH) : SLIDE_WIDTH;
  const heightRule = editorMode === 'webpage' ? '' : `height: ${SLIDE_HEIGHT}px; overflow: hidden;`;
  // 見るだけの紙面では script を動かさない(ブラウザ版 Tailwind の JIT やページの script は要らない)。
  // <script> と、勝手に発火しうるインラインハンドラ(onload / onerror 等)を本文からも head からも外す。
  // iframe に sandbox は付けない: sandbox で script を禁じると、ページへ script を差し込む
  // ブラウザ拡張(React DevTools 等)が 1 枚ごとに「Blocked script execution」をコンソールへ出す(実測 26 枚 = 26 件)
  const stripScripts = (html: string) =>
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/\son(?:load|error|abort|click|dblclick|mouse\w*|pointer\w*|touch\w*|key\w*|focus\w*|blur|change|input|submit|reset|scroll|wheel|animation\w*|transition\w*|toggle|play\w*|pause|ended|canplay\w*|loaded\w*)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  return `<!DOCTYPE html>
<html lang="ja">
<head>${stripScripts(buildCommonHead(content))}
  ${extraStyles}
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
    body { width: ${width}px; }
    #artboard { position: relative; width: ${width}px; ${heightRule} background: white; }
    /* 見るだけなので、リンク・入力を触れなくする */
    #artboard a, #artboard button, #artboard input, #artboard textarea, #artboard select { pointer-events: none; }
  </style>
</head>
<body data-editor-mode="${editorMode}" data-preview="1">
  <div id="artboard">${stripScripts(content)}</div>
</body>
</html>`;
}

export function generateEditableHtml(
  content: string,
  editorMode: EditorMode = 'slide',
  options: EditableHtmlOptions = {},
): string {
  const embedded = !!options.embedded;
  const artboardWidth = editorMode === 'webpage' ? (options.artboardWidth ?? WEBPAGE_WIDTH) : SLIDE_WIDTH;
  const artboardHeight = editorMode === 'webpage' ? WEBPAGE_MIN_HEIGHT : SLIDE_HEIGHT;
  const artboardHeightStyle = editorMode === 'webpage' ? 'min-height' : 'height';

  // 埋め込み: 倍率もスクロールも外側が持つ。中は「紙面がそのまま置いてある」だけの姿にする。
  // id は残し(getElementById の呼び出しを壊さない)、役割だけ CSS で外す
  const embeddedCss = embedded
    ? `
    html, body { overflow: visible; height: auto; background: transparent; }
    #canvas-container { position: static; overflow: visible; background: transparent; }
    #canvas-scroll-area { display: block; padding: 0 !important; width: auto !important; height: auto !important; min-width: 0 !important; min-height: 0 !important; }
    #artboard-wrapper { transform: none !important; visibility: visible; }
    #artboard { box-shadow: none; ${editorMode === 'webpage' ? 'min-height: 200px;' : ''} }`
    : '';

  return `
<!DOCTYPE html>
<html lang="ja">
<head>${buildCommonHead(content)}
  <style>
    * { box-sizing: border-box; }
    /* 既定の書体はカスケードレイヤーに入れて置く(レイヤーに入れた宣言は、レイヤー外の宣言と、
       後から宣言されたレイヤーの両方に負ける)。ページ側の CSS が html { font-family } を
       素で書いていても、Tailwind v4 のように @layer base に書いていても、そちらが勝つ。
       以前は html, body に直接書いていたため、構成ラフの @layer base の html { font-family: "Noto Sans JP" } が
       負けて、エディタだけシステム書体で表示されていた(実測。:where() でも @layer には勝ってしまう)。
       スライド本体は #artboard 内のルートが font-sans を持つのでどちらでも影響しない */
    @layer gg-editor-defaults {
      html {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', Meiryo, sans-serif;
      }
    }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: ${CANVAS_BG_COLOR};
    }

    /* スクロール可能なキャンバスコンテナ */
    #canvas-container {
      position: absolute;
      inset: 0;
      overflow: auto;
      background-color: ${CANVAS_BG_COLOR};
    }

    /* パディング用ラッパー（スクロール領域確保）
       webpage は上端固定にする。中央寄せだと、テキスト入力や並べ替えでページの
       高さが変わるたびに紙面が上下へ動き、見ていた場所が飛ぶ(実測 84〜729px)。
       ブラウザのページと同じで、高さが変わっても上端は動かないのが正しい */
    #canvas-scroll-area {
      display: flex;
      align-items: ${editorMode === 'webpage' ? 'flex-start' : 'center'};
      justify-content: center;
      /* サイズはJSで動的に設定 */
    }

    /* ズーム/パン適用対象。
       webpage は上端固定なので、縮小も上端を基準にする(center だと縮んだ分だけ
       紙面が下へずれ、上端固定の意味が無くなる) */
    #artboard-wrapper {
      flex-shrink: 0;
      transform-origin: ${editorMode === 'webpage' ? 'top center' : 'center center'};
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
    }${embeddedCss}
  </style>
</head>
<body tabindex="-1" data-editor-mode="${editorMode}"${embedded ? ' data-embedded="1"' : ''}>
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
  // 共同編集の他人の選択枠・カーソル(表示専用)も保存しない(共有する本文にも混ぜない)
  tempContainer.querySelectorAll('.gg-collab-layer').forEach(el => el.remove());
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
