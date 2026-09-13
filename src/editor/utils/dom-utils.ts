/**
 * DOM操作関連のユーティリティ関数
 *
 * Phase 2: パフォーマンス最適化
 * - buildDomTree にWeakMapキャッシュを追加
 */

import type { ElementCapture, DOMTreeNode, MarqueeState } from '../types';
import { removeConflictingClasses } from './tailwind-utils';

// ========================================
// buildDomTree キャッシュ（Phase 2 最適化）
// ========================================

/**
 * DOMツリーキャッシュ
 * WeakMapを使用してDocumentごとにキャッシュを保持
 * Documentがガベージコレクションされると自動的にキャッシュも解放される
 */
const domTreeCache = new WeakMap<Document, {
  html: string;
  tree: DOMTreeNode[];
}>();

/**
 * キャッシュをクリア（テスト用またはDOM構造が大きく変更された場合）
 */
export function clearDomTreeCache(iframeDoc?: Document): void {
  if (iframeDoc) {
    domTreeCache.delete(iframeDoc);
  }
}

/**
 * artboard-wrapperからズームスケールを取得
 */
export function getArtboardScale(iframeDoc: Document): number {
  const wrapper = iframeDoc.getElementById('artboard-wrapper');
  if (!wrapper) return 1;

  // まずインラインスタイルを確認
  let transform = wrapper.style.transform;

  // インラインスタイルがない場合はcomputedStyleを使用
  if (!transform) {
    const computedStyle = iframeDoc.defaultView?.getComputedStyle(wrapper);
    transform = computedStyle?.transform || '';
  }

  // scale(x) 形式をパース
  const scaleMatch = transform.match(/scale\(([^)]+)\)/);
  if (scaleMatch) {
    return parseFloat(scaleMatch[1]) || 1;
  }

  // matrix(a, b, c, d, e, f) 形式からスケールを抽出
  const matrixMatch = transform.match(/matrix\(([^,]+),/);
  if (matrixMatch) {
    return parseFloat(matrixMatch[1]) || 1;
  }

  return 1;
}

// ========================================
// グループ解除判定用の定数と関数
// ========================================

/**
 * グループ解除可能なコンテナタグ
 * これらのタグは、編集可能な子要素を持つ場合にグループ解除を許可
 */
const ALLOWED_CONTAINER_TAGS = new Set([
  'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER',
  'NAV', 'MAIN', 'ASIDE', 'FIGURE', 'FIGCAPTION',
  'FORM', 'FIELDSET', 'DETAILS', 'SUMMARY',
  'UL', 'OL', 'DL', // リストコンテナ
]);

/**
 * グループ解除を禁止するタグ
 * これらのタグは内部構造が壊れる可能性があるため保護
 */
const PROTECTED_TAGS = new Set([
  'BUTTON', 'A', 'LABEL',                    // インタラクティブ要素
  'INPUT', 'SELECT', 'TEXTAREA',              // フォーム入力
  'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'SVG',   // メディア
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', // テーブル
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SPAN', // テキスト要素
  'CODE', 'PRE', 'BLOCKQUOTE',                // コードブロック
]);

/**
 * 要素が編集可能な子要素を持つかどうかを判定
 * UI要素（selection-box等）は除外
 */
export function hasEditableChildren(element: HTMLElement): boolean {
  return Array.from(element.children).some(child => {
    const el = child as HTMLElement;
    // UI要素を除外
    if (el.classList?.contains('selection-box') ||
        el.classList?.contains('resize-handle') ||
        el.tagName === 'SCRIPT' ||
        el.tagName === 'STYLE') {
      return false;
    }
    // data-editable または data-element-id があれば編集可能な子
    return el.getAttribute('data-editable') === 'true' ||
           el.hasAttribute('data-element-id');
  });
}

/**
 * 要素がグループ解除可能かどうかを判定
 *
 * 【許可条件】以下のいずれかを満たす:
 * 1. data-is-group="true" 属性がある（明示的なグループ）
 * 2. 以下の全てを満たすコンテナ要素:
 *    - 許可されたコンテナタグである
 *    - data-editable="true" を持つ子要素が1つ以上ある
 *    - 禁止タグリストに含まれない
 */
export function canUngroup(element: HTMLElement): boolean {
  // 条件1: 明示的なグループは常に解除可能（子要素があれば）
  if (element.getAttribute('data-is-group') === 'true') {
    return hasEditableChildren(element);
  }

  // 条件2: 禁止タグは絶対不可
  if (PROTECTED_TAGS.has(element.tagName)) {
    return false;
  }

  // 条件3: 許可されたコンテナタグ + 編集可能な子要素あり
  if (ALLOWED_CONTAINER_TAGS.has(element.tagName)) {
    return hasEditableChildren(element);
  }

  // その他: 不許可
  return false;
}

/**
 * transformからtranslate部分を除去してrotate/scaleを保持
 */
function preserveTransformWithoutTranslate(transform: string): string {
  if (!transform || transform === 'none') return '';

  // translate関連を削除
  const preserved = transform
    .replace(/translate3d\([^)]+\)/g, '')
    .replace(/translateX\([^)]+\)/g, '')
    .replace(/translateY\([^)]+\)/g, '')
    .replace(/translate\([^)]+\)/g, '')
    .trim();

  return preserved && preserved !== 'none' ? preserved : '';
}

/**
 * iframe内の要素を取得
 */
export function getIframeElement(
  iframeDoc: Document | null,
  elementId: string
): HTMLElement | null {
  if (!iframeDoc) return null;
  return iframeDoc.querySelector(`[data-element-id="${elementId}"]`) as HTMLElement | null;
}

/**
 * artboard内のコンテンツHTMLを取得
 * キャンバス構造（#canvas-container等）を含めず、純粋なコンテンツのみを返す
 * SLIDE_CONTENT_CHANGEDメッセージで送信する際は必ずこの関数を使用すること
 */
export function getArtboardContent(iframeDoc: Document | null): string {
  if (!iframeDoc) return '';
  const artboard = iframeDoc.getElementById('artboard');
  return artboard ? artboard.innerHTML : iframeDoc.body.innerHTML;
}

// インライン要素のタグ名リスト（絶対配置に変換しない）
const INLINE_TAGS = new Set([
  'SPAN', 'A', 'STRONG', 'EM', 'B', 'I', 'U', 'S', 'MARK', 'CODE',
  'SMALL', 'SUB', 'SUP', 'ABBR', 'CITE', 'DFN', 'KBD', 'SAMP', 'VAR',
  'TIME', 'Q', 'BR', 'WBR', 'LABEL',
]);

/**
 * 要素がインライン要素かどうかを判定
 */
export function isInlineElement(element: HTMLElement, computedStyle?: CSSStyleDeclaration): boolean {
  // タグ名でチェック
  if (INLINE_TAGS.has(element.tagName)) {
    return true;
  }
  
  // display プロパティでチェック
  if (computedStyle) {
    const display = computedStyle.display;
    if (display === 'inline' || display === 'inline-block') {
      // ただし、テキストを含まない場合（アイコンなど）は除外
      const hasOnlyTextContent = element.childNodes.length === 0 || 
        Array.from(element.childNodes).every(n => n.nodeType === Node.TEXT_NODE);
      if (hasOnlyTextContent && element.closest('p, h1, h2, h3, h4, h5, h6, li, td, th, span')) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * 単一の要素を絶対配置に変換（改善版）
 * AI再生成後など、単一要素を変換する場合に使用
 * @param iframeDoc iframeのドキュメント
 * @param element 変換対象の要素
 * @returns 変換が成功したかどうか
 */
/**
 * ズームのDOM反映(トランスフォーム+スクロール領域サイズ+収まる軸の中央寄せ)。
 *
 * 【なぜReactを介さないか】ホイール/ピンチは毎秒数十回来る。1ティックごとに
 * setZoom→全ツリー再レンダー(サムネイル150枚を含む)を回すと確実にガタつく。
 * 入力ハンドラはこの関数で**その場でDOMに反映**し、Reactの状態へは
 * 間引いてコミットする(useCanvasControlsのzoomAtPoint参照)。
 * EditorCanvas側のエフェクト(スライダー等の状態駆動の経路)も同じ関数を使い、
 * 適用ロジックの二重実装を作らない。
 */
export function applyCanvasZoomDom(iframeDoc: Document, zoomPct: number): void {
  // 埋め込み(マルチフレームのキャンバス内)では倍率は外側の CSS transform が持つ。
  // iframe の中は常に等倍で、スクロール領域も作らない
  if (iframeDoc.body?.dataset.embedded === '1') return;
  const wrapper = iframeDoc.getElementById('artboard-wrapper');
  const scrollArea = iframeDoc.getElementById('canvas-scroll-area');
  const container = iframeDoc.getElementById('canvas-container');
  const artboard = iframeDoc.getElementById('artboard');
  if (!wrapper || !scrollArea || !container || !artboard) return;

  const scale = zoomPct / 100;
  wrapper.style.willChange = 'transform';
  wrapper.style.transform = `scale(${scale})`;

  const w = artboard.offsetWidth;
  const h = artboard.offsetHeight;
  const padding = 200;
  const cw = container.clientWidth || iframeDoc.defaultView?.innerWidth || 0;
  const ch = container.clientHeight || iframeDoc.defaultView?.innerHeight || 0;
  scrollArea.style.width = `${Math.max(w * scale + padding * 2, cw)}px`;
  scrollArea.style.height = `${Math.max(h * scale + padding * 2, ch)}px`;
  scrollArea.style.minWidth = `${cw}px`;
  scrollArea.style.minHeight = `${ch}px`;

  // webpage は上端固定(#canvas-scroll-area が flex-start、変形の基準も top)。
  // 上の余白は中央寄せでは自然に生まれたが、上端固定では自分で確保する。
  // 縦方向の中央寄せもしない(ページの高さが変わるたびに紙面が動く原因だった)
  const topAnchored = iframeDoc.body.dataset.editorMode === 'webpage';
  scrollArea.style.paddingTop = topAnchored ? `32px` : '';

  // 紙面が容器に収まる軸はスクロールを中央へ(拡大時のパンには干渉しない)
  if (w * scale <= cw) container.scrollLeft = Math.max(0, (scrollArea.offsetWidth - cw) / 2);
  if (!topAnchored && h * scale <= ch) container.scrollTop = Math.max(0, (scrollArea.offsetHeight - ch) / 2);
}

/* ============================ 原本への書き戻し支援 ============================
 *
 * エディタは開いた時点で全要素を絶対配置へ変換する。この変換はエディタ内の
 * 都合であって「ユーザーの編集」ではないので、保存HTMLにそのまま焼き込むと
 * 原本TSXとの差分が変換ノイズで埋まり、書き戻し(scripts/slide-writeback.mjs)が
 * 成立しない。そこで:
 *   1. 変換で style を書く直前に、元の style 属性を data-gg-prestyle へ退避する
 *   2. 開いた直後(変換後)の姿を data-gg-base(指紋)として全要素に刻む
 *   3. 保存時、指紋が変わっていない要素は style を退避値へ巻き戻す
 * 結果、保存HTMLは「原本のレイアウト + 本当に編集した内容」だけになる。
 */

/** 変換前の style 属性を退避する(最初の1回だけ。'__none__' = 属性なし) */
export function capturePrestyle(element: HTMLElement): void {
  if (element.hasAttribute('data-gg-prestyle')) return;
  element.setAttribute('data-gg-prestyle', element.getAttribute('style') ?? '__none__');
}

/** 指紋の計算から外す属性(エディタの管理用・退避用) */
const SIG_SKIP_ATTRS = new Set([
  'style', 'class', 'contenteditable', 'spellcheck', 'draggable',
  'data-editable', 'data-element-id', 'data-shape-type', 'data-inline',
  'data-gg-base', 'data-gg-prestyle', 'data-gg-dirty', 'data-gg-pre-overflow',
]);

/** 指紋の計算から外すクラス(エディタが一時的に付けるもの) */
const SIG_SKIP_CLASSES = new Set([
  'selected', 'dragging', 'editing', 'rotating', 'panning',
  'hover-preview', 'marquee-hover', 'marquee-active', 'text-editable-hover', 'drag-ghost',
]);

/** 変換が書き込むスタイル(=幾何)。ユーザーの移動・リサイズもここに現れる */
const SIG_GEO_PROPS = new Set([
  'position', 'left', 'top', 'right', 'bottom', 'width', 'height',
  // ブラウザは left/top/right/bottom を inset 短縮形へ直列化することがある。
  // これを幾何に数えないと「移動」が style 側の変更として誤分類される
  'inset', 'inset-block', 'inset-inline',
  'margin', 'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'transform',
]);

const sigHash = (s: string): string => {
  let x = 5381;
  for (let i = 0; i < s.length; i++) x = ((x * 33) ^ s.charCodeAt(i)) >>> 0;
  return x.toString(36);
};

/**
 * 要素の指紋。「幾何.その他スタイルと属性.直下の文字.子タグ列」の4部で、
 * 保存時にどの側面を触ったか(geometry / style / text / children)を切り分ける。
 * 検査は自分自身のみ(子孫の変更は子孫自身と、親の children 部で捕まえる)。
 */
export function elementSignature(el: HTMLElement): string {
  const style = el.getAttribute('style') ?? '';
  const geo: string[] = [];
  const rest: string[] = [];
  for (const decl of style.split(';')) {
    const c = decl.indexOf(':');
    if (c < 0) continue;
    const k = decl.slice(0, c).trim().toLowerCase();
    const v = decl.slice(c + 1).trim();
    if (!k) continue;
    // ブラウザは right:auto 等が加わると left/top を inset 短縮形へまとめ直す。
    // 表記が変わっただけで「幾何を触った」と誤判定しないよう、
    // inset は縦横へ展開し、auto(=指定なしと同義)は指紋から落とす
    if (k === 'inset') {
      const parts = v.split(/\s+/);
      const [t, r, b, l] =
        parts.length === 1 ? [parts[0], parts[0], parts[0], parts[0]]
        : parts.length === 2 ? [parts[0], parts[1], parts[0], parts[1]]
        : parts.length === 3 ? [parts[0], parts[1], parts[2], parts[1]]
        : parts;
      for (const [kk, vv] of [['top', t], ['right', r], ['bottom', b], ['left', l]] as const) {
        if (vv && vv !== 'auto') geo.push(`${kk}:${vv}`);
      }
      continue;
    }
    if ((k === 'right' || k === 'bottom' || k === 'left' || k === 'top') && v === 'auto') continue;
    (SIG_GEO_PROPS.has(k) ? geo : rest).push(`${k}:${v}`);
  }
  const classes = (el.getAttribute('class') ?? '')
    .split(/\s+/)
    .filter((t) => t && !SIG_SKIP_CLASSES.has(t))
    .sort();
  const attrs: string[] = [];
  for (const a of Array.from(el.attributes)) {
    if (SIG_SKIP_ATTRS.has(a.name) || a.name.startsWith('data-original-')) continue;
    attrs.push(`${a.name}=${a.value}`);
  }
  let text = '';
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) text += n.textContent ?? '';
  });
  const childTags: string[] = [];
  for (const c of Array.from(el.children)) childTags.push(c.tagName);
  return [
    sigHash(geo.sort().join(';')),
    sigHash(rest.sort().join(';') + '|' + classes.join(' ') + '|' + attrs.sort().join(' ')),
    sigHash(text.replace(/\s+/g, ' ').trim()),
    sigHash(childTags.join(',')),
  ].join('.');
}

/** 開いた直後の姿を全要素に刻む(EditorCanvas の初期化末尾で呼ぶ) */
export function stampBaselines(iframeDoc: Document): number {
  const artboard = iframeDoc.getElementById('artboard');
  if (!artboard) return 0;
  let n = 0;
  artboard.querySelectorAll<HTMLElement>('*').forEach((el) => {
    if (el.closest('.selection-box, .marquee-selection-box')) return;
    el.setAttribute('data-gg-base', elementSignature(el));
    n++;
  });
  return n;
}

/**
 * 保存用クローンに対して:
 * - 指紋が変わっていない要素 → style を変換前(data-gg-prestyle)へ巻き戻す
 * - 変わった要素 → data-gg-dirty="geometry,text,…" を付ける(書き戻しの手掛かり)
 * - ただし「元は流し込み(in-flow)だった要素の幾何」を触った場合、その親と兄弟は
 *   巻き戻さない。1つだけ絶対配置に変えると兄弟が詰まり、編集画面の見た目と
 *   保存結果が食い違うため(親子まとめて絶対配置のまま原本へ書く)
 * 最後に data-gg-base / data-gg-prestyle を剥がす。
 */
/**
 * 幾何プロパティは変換前(pres)の値、それ以外は現在(cur)の値でスタイルを組み直す。
 * 「色は変えたが位置は触っていない」要素から変換の焼き込みだけを取り除くために使う。
 */
function mergeStyleKeepingPresGeometry(pres: string, cur: string): string {
  const parse = (css: string): [string, string][] => {
    const out: [string, string][] = [];
    for (const decl of css.split(';')) {
      const c = decl.indexOf(':');
      if (c < 0) continue;
      const k = decl.slice(0, c).trim().toLowerCase();
      const v = decl.slice(c + 1).trim();
      if (k) out.push([k, v]);
    }
    return out;
  };
  const presProps = parse(pres);
  const curProps = parse(cur);
  const out: string[] = [];
  // 変換前の並びを土台に: 幾何は変換前の値、他は現在の値(消されたものは落とす)
  const curMap = new Map(curProps);
  for (const [k, v] of presProps) {
    if (SIG_GEO_PROPS.has(k)) out.push(`${k}: ${v}`);
    else if (curMap.has(k)) out.push(`${k}: ${curMap.get(k)}`);
  }
  const seen = new Set(presProps.map(([k]) => k));
  for (const [k, v] of curProps) {
    if (seen.has(k) || SIG_GEO_PROPS.has(k)) continue;
    out.push(`${k}: ${v}`);
  }
  return out.join('; ');
}

export function classifySaveAndRevert(container: HTMLElement): void {
  const infos: { el: HTMLElement; dirty: string[] }[] = [];
  container.querySelectorAll<HTMLElement>('[data-gg-base]').forEach((el) => {
    const base = (el.getAttribute('data-gg-base') ?? '').split('.');
    const now = elementSignature(el).split('.');
    const names = ['geometry', 'style', 'text', 'children'];
    infos.push({ el, dirty: names.filter((_, i) => base[i] !== now[i]) });
  });

  const keep = new Set<HTMLElement>();
  for (const { el, dirty } of infos) {
    if (!dirty.includes('geometry')) continue;
    const pres = el.getAttribute('data-gg-prestyle');
    const presStyle = pres === '__none__' ? '' : (pres ?? '');
    const wasFlow =
      !/position\s*:\s*(absolute|fixed)/.test(presStyle) &&
      !el.classList.contains('absolute') &&
      !el.classList.contains('fixed');
    if (!wasFlow) continue;
    const parent = el.parentElement;
    if (!parent || parent === container) continue;
    keep.add(parent);
    for (const sib of Array.from(parent.children)) keep.add(sib as HTMLElement);
  }

  for (const { el, dirty } of infos) {
    const geoDirty = dirty.includes('geometry') || keep.has(el);
    const styleDirty = dirty.includes('style');
    const pres = el.getAttribute('data-gg-prestyle');
    // 幾何を触っていないなら、変換が焼き込んだ幾何スタイルは全部ノイズ。
    // 文字だけ直した要素に width:345px が固定されて残ると、原本TSXの
    // レイアウト(auto幅)が壊れるので、ここで必ず戻す
    if (!geoDirty && pres !== null) {
      const presStyle = pres === '__none__' ? '' : pres;
      if (!styleDirty) {
        // 何もスタイルを触っていない → 丸ごと変換前へ
        if (presStyle) el.setAttribute('style', presStyle);
        else el.removeAttribute('style');
      } else {
        // 色などは触ったが幾何は触っていない → 幾何だけ変換前へ戻し、他は今の値
        const merged = mergeStyleKeepingPresGeometry(presStyle, el.getAttribute('style') ?? '');
        if (merged) el.setAttribute('style', merged);
        else el.removeAttribute('style');
      }
    }
    if (dirty.length) el.setAttribute('data-gg-dirty', dirty.join(','));
    else if (keep.has(el)) el.setAttribute('data-gg-dirty', 'keep');
  }

  container.querySelectorAll('[data-gg-base], [data-gg-prestyle], [data-gg-pre-overflow]').forEach((el) => {
    el.removeAttribute('data-gg-base');
    el.removeAttribute('data-gg-prestyle');
    el.removeAttribute('data-gg-pre-overflow');
  });
}

export function convertSingleElementToAbsolute(iframeDoc: Document, element: HTMLElement): boolean {
  const computedStyle = iframeDoc.defaultView!.getComputedStyle(element);

  // インライン要素はスキップ
  if (isInlineElement(element, computedStyle)) {
    console.log('[convertSingleElementToAbsolute] Skipping inline element:', element.tagName);
    return false;
  }

  // ズームスケールを取得
  const scale = getArtboardScale(iframeDoc);

  const rect = element.getBoundingClientRect();
  const parent = element.parentElement;
  const parentRect = parent ? parent.getBoundingClientRect() : null;
  const parentComputedStyle = parent ? iframeDoc.defaultView!.getComputedStyle(parent) : null;

  // 親要素の処理
  if (parent && parent !== iframeDoc.body && parentComputedStyle) {
    // position: relativeに設定（絶対配置の基準点として必要）
    if (parentComputedStyle.position === 'static') {
      capturePrestyle(parent);
      parent.style.position = 'relative';
    }
  }

  const position = computedStyle.position;
  const isAlreadyPositioned = position === 'absolute' || position === 'fixed';

  // 座標計算
  let left: number;
  let top: number;

  if (parent && parent !== iframeDoc.body && parentRect) {
    // 親要素基準で座標を計算（スケール考慮）
    const parentStyle = iframeDoc.defaultView!.getComputedStyle(parent);
    const parentBorderLeft = parseFloat(parentStyle.borderLeftWidth) || 0;
    const parentBorderTop = parseFloat(parentStyle.borderTopWidth) || 0;
    const parentScrollLeft = parent.scrollLeft || 0;
    const parentScrollTop = parent.scrollTop || 0;

    // スケールを考慮した座標変換
    // getBoundingClientRect()はスケール適用後の値を返すため、スケールで割る
    // 注意: position: absolute の座標は padding box を基準とする
    // marginは引かない（rectは視覚位置を返し、margin:0にリセットするため）
    left = (rect.left - parentRect.left) / scale - parentBorderLeft + parentScrollLeft;
    top = (rect.top - parentRect.top) / scale - parentBorderTop + parentScrollTop;
  } else {
    // body または artboard 基準
    const artboard = iframeDoc.getElementById('artboard');
    const containerRect = artboard ? artboard.getBoundingClientRect() : iframeDoc.body.getBoundingClientRect();
    const scrollX = iframeDoc.defaultView?.scrollX || 0;
    const scrollY = iframeDoc.defaultView?.scrollY || 0;

    // marginは引かない（rectは視覚位置を返し、margin:0にリセットするため）
    left = (rect.left - containerRect.left) / scale + scrollX;
    top = (rect.top - containerRect.top) / scale + scrollY;
  }

  // 幅と高さ（スケールを考慮）
  const width = rect.width / scale;
  const height = rect.height / scale;

  // 元のtransformを保持（rotate/scaleのみ）
  const originalTransform = computedStyle.transform;
  const preservedTransform = preserveTransformWithoutTranslate(originalTransform);

  // スタイルを適用
  capturePrestyle(element);
  if (!isAlreadyPositioned) {
    element.style.position = 'absolute';
  }
  element.style.left = `${Math.round(left * 100) / 100}px`;
  element.style.top = `${Math.round(top * 100) / 100}px`;
  element.style.width = `${Math.round(width * 100) / 100}px`;
  element.style.height = `${Math.round(height * 100) / 100}px`;

  // marginをリセット（絶対配置では不要）
  element.style.margin = '0';

  // flex関連のプロパティを無効化
  element.style.flex = 'none';
  element.style.flexGrow = '0';
  element.style.flexShrink = '0';

  // transformを保持（rotate/scaleがある場合）
  if (preservedTransform) {
    element.style.transform = preservedTransform;
  }

  console.log('[convertSingleElementToAbsolute] Converted:', {
    tagName: element.tagName,
    left: Math.round(left * 100) / 100,
    top: Math.round(top * 100) / 100,
    width: Math.round(width * 100) / 100,
    height: Math.round(height * 100) / 100,
    scale,
    preservedTransform,
  });

  return true;
}

/**
 * 全ての編集可能要素を絶対配置に変換（改善版）
 * document.fonts.ready後に呼び出すこと
 * インライン要素（span, strong, emなど）はスキップ
 *
 * 改善点:
 * - 親要素のpadding考慮
 * - flex/grid親のdisplayリセット
 * - ズームスケール考慮
 * - transform（rotate/scale）保持
 * - margin: auto 対応
 */
export function convertToAbsolutePositioning(iframeDoc: Document): number {
  let editableElements = iframeDoc.querySelectorAll('[data-editable="true"]');
  // フォールバック: data-editableが無い場合（キャンバスモード等）
  if (editableElements.length === 0) {
    editableElements = iframeDoc.querySelectorAll('#artboard > [data-element-id]');
  }
  if (editableElements.length === 0) return 0;

  // ズームスケールを取得
  const scale = getArtboardScale(iframeDoc);
  console.log('[convertToAbsolutePositioning] Scale:', scale);

  // artboardの現在の高さをキャプチャして固定（絶対配置後も高さを維持するため）
  const artboard = iframeDoc.getElementById('artboard');
  if (artboard) {
    const artboardRect = artboard.getBoundingClientRect();
    const artboardHeight = artboardRect.height / scale;
    // 元の高さが設定されていない場合のみ保存
    if (!artboard.hasAttribute('data-original-height')) {
      artboard.setAttribute('data-original-height', artboard.style.height || 'auto');
    }
    artboard.style.height = `${Math.round(artboardHeight)}px`;
    console.log('[convertToAbsolutePositioning] Set artboard height:', artboardHeight);
  }

  // 1. まず全要素の現在の位置・サイズをキャプチャ（インライン要素は除外）
  const captures: ElementCapture[] = [];

  editableElements.forEach((el) => {
    const element = el as HTMLElement;
    const computedStyle = iframeDoc.defaultView!.getComputedStyle(element);

    // [移植時の修正] flex/grid コンテナの子は「一部だけ変換」すると
    // 残った子がレイアウトの先頭に詰められ、絶対配置した兄弟と重なる
    // (例: アイコン<img>だけ変換され、隣の<span>が左端へ寄って重なる)。
    // flexアイテム/gridアイテムは blockify されるため、インライン扱いせず
    // すべて同じ基準で変換して見た目を保つ。
    const parentEl = element.parentElement;
    const parentDisplay = parentEl
      ? iframeDoc.defaultView!.getComputedStyle(parentEl).display
      : '';
    const isFlexOrGridItem = /(^|\s)(inline-)?(flex|grid)($|\s)/.test(parentDisplay);

    // インライン要素はスキップ(ただし flex/grid アイテムは除く)
    if (!isFlexOrGridItem && isInlineElement(element, computedStyle)) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const parent = element.parentElement;
    const parentRect = parent ? parent.getBoundingClientRect() : null;
    const parentComputedStyle = parent ? iframeDoc.defaultView!.getComputedStyle(parent) : null;

    // 元のtransformを保存
    const originalTransform = computedStyle.transform;

    if (
      element.scrollWidth - element.clientWidth > 2 ||
      element.scrollHeight - element.clientHeight > 2
    ) {
      element.setAttribute('data-gg-pre-overflow', 'true');
    }
    captures.push({
      element,
      rect,
      parent,
      parentRect,
      computedStyle,
      parentComputedStyle,
      // 拡張情報
      originalTransform,
      scale,
      prevStyle: element.getAttribute('style'),
    });
  });

  // 2. 親要素を処理（position: relative設定）
  //
  // [採寸より前にやる] offsetLeft/offsetTop は offsetParent 基準の値なので、
  // 親を relative にしてからでないと「直近の親からの座標」にならない。
  // position:relative を入れるだけでは要素は動かないので、採寸前に実行して安全。
  const processedParents = new Set<HTMLElement>();
  captures.forEach(({ parent, parentComputedStyle }) => {
    if (parent && !processedParents.has(parent) && parent !== iframeDoc.body) {
      const artboard = iframeDoc.getElementById('artboard');
      // artboard自体は変更しない
      if (parent === artboard) {
        processedParents.add(parent);
        return;
      }

      // position: staticの場合はrelativeに（絶対配置の基準点として必要）
      if (parentComputedStyle?.position === 'static') {
        capturePrestyle(parent);
        parent.style.position = 'relative';
      }
      processedParents.add(parent);
    }
  });

  // 2.5 offset* をまとめて採寸する
  //
  // **書き込みの前に全部測りきる**のが肝。1要素ずつ「測って書く」を繰り返すと、
  // 先に絶対配置へ倒した要素が流れから抜け、その分だけ後続の兄弟の offsetTop が
  // 変わってしまう(版面が上へ詰まっていく)。
  // offsetParent が直近の親になっている素直なケースだけをここで拾い、
  // それ以外は従来の rect ベースの計算に任せる。
  const offsets = new Map<HTMLElement, { left: number; top: number; width: number; height: number }>();
  captures.forEach(({ element, parent, rect, scale: capScale }) => {
    if (!parent || parent === iframeDoc.body) return;
    if (element.offsetParent !== parent) return;
    // 寸法は offsetWidth(整数へ丸める)ではなく、rect の小数値を**切り上げ**て使う。
    // 例: 必要幅1227.4pxの文字列を1227pxで固定すると最後の1文字だけが折り返す
    // (284pxの「テキスト」で実害)。位置は1px未満の誤差が折り返しを生まないので offset で良い
    const s = capScale || 1;
    offsets.set(element, {
      left: element.offsetLeft,
      top: element.offsetTop,
      width: Math.ceil(rect.width / s),
      height: Math.ceil(rect.height / s),
    });
  });

  // 3. 各要素を絶対配置に変換
  captures.forEach(({
    element,
    rect,
    parent,
    parentRect,
    computedStyle,
    scale: capturedScale,
    originalTransform,
  }) => {
    const position = computedStyle.position;
    const isAlreadyPositioned = position === 'absolute' || position === 'fixed';
    const currentScale = capturedScale || 1;

    // 座標計算
    let left: number;
    let top: number;

    // [まず offset* を使う]
    // getBoundingClientRect をズーム倍率で割り戻す方式は、端数と transform の影響で
    // 1〜2px ずれる。要素数が多いと版面全体が滲むので、offsetParent が直近の親に
    // なっている素直なケースでは offsetLeft/offsetTop をそのまま使う。
    // (offset* は CSSピクセルの値で、ズームや transform の影響を受けない)
    const off = offsets.get(element);
    if (off) {
      capturePrestyle(element);
      element.style.position = 'absolute';
      element.style.left = `${off.left}px`;
      element.style.top = `${off.top}px`;
      element.style.width = `${off.width}px`;
      element.style.height = `${off.height}px`;
      element.style.margin = '0';
      element.style.flex = 'none';
      element.style.flexGrow = '0';
      element.style.flexShrink = '0';
      const keep = preserveTransformWithoutTranslate(originalTransform || '');
      if (keep) element.style.transform = keep;
      return;
    }

    if (parent && parent !== iframeDoc.body && parentRect) {
      const artboard = iframeDoc.getElementById('artboard');

      // 親要素基準で座標を計算（スケール考慮）
      // parentRectは変換前にキャプチャした値を使用
      const parentStyle = iframeDoc.defaultView!.getComputedStyle(parent);
      const parentBorderLeft = parseFloat(parentStyle.borderLeftWidth) || 0;
      const parentBorderTop = parseFloat(parentStyle.borderTopWidth) || 0;
      const parentScrollLeft = parent.scrollLeft || 0;
      const parentScrollTop = parent.scrollTop || 0;

      // artboard直下の場合は特別処理
      if (parent === artboard) {
        // artboard基準：スケールを考慮
        // marginは引かない（rectは視覚位置を返し、margin:0にリセットするため）
        left = (rect.left - parentRect.left) / currentScale;
        top = (rect.top - parentRect.top) / currentScale;
      } else {
        // 通常の親要素基準：スケールを考慮し、border のみ を引く
        // 注意: position: absolute の座標は padding box を基準とする
        // marginは引かない（rectは視覚位置を返し、margin:0にリセットするため）
        left = (rect.left - parentRect.left) / currentScale - parentBorderLeft + parentScrollLeft;
        top = (rect.top - parentRect.top) / currentScale - parentBorderTop + parentScrollTop;
      }
    } else {
      // body または artboard 基準
      const artboard = iframeDoc.getElementById('artboard');
      const containerRect = artboard ? artboard.getBoundingClientRect() : iframeDoc.body.getBoundingClientRect();
      const scrollX = iframeDoc.defaultView?.scrollX || 0;
      const scrollY = iframeDoc.defaultView?.scrollY || 0;

      // marginは引かない（rectは視覚位置を返し、margin:0にリセットするため）
      left = (rect.left - containerRect.left) / currentScale + scrollX;
      top = (rect.top - containerRect.top) / currentScale + scrollY;
    }

    // 幅と高さ（スケールを考慮）
    const width = rect.width / currentScale;
    const height = rect.height / currentScale;

    // 元のtransformを保持（rotate/scaleのみ、translateは削除）
    const preservedTransform = preserveTransformWithoutTranslate(originalTransform || '');

    // スタイルを適用
    capturePrestyle(element);
    if (!isAlreadyPositioned) {
      element.style.position = 'absolute';
    }
    element.style.left = `${Math.round(left * 100) / 100}px`;
    element.style.top = `${Math.round(top * 100) / 100}px`;
    element.style.width = `${Math.round(width * 100) / 100}px`;
    element.style.height = `${Math.round(height * 100) / 100}px`;

    // marginをリセット（絶対配置では不要）
    element.style.margin = '0';

    // flex関連のプロパティを無効化
    element.style.flex = 'none';
    element.style.flexGrow = '0';
    element.style.flexShrink = '0';

    // transformを保持（rotate/scaleがある場合）
    if (preservedTransform) {
      element.style.transform = preservedTransform;
    }
  });

  // ── 自己検証: 変換で見た目が動いていないか ──
  // 採寸のタイミング(画像・書体・Tailwindの遅延適用)が悪いと、間違った座標で
  // 固定されて版面が崩れる。1つでも位置がずれた要素があれば**変換ごと巻き戻す**。
  // 崩れた編集画面より、変換されていない編集画面のほうがはるかにまし
  // (in-flow のままでも、動かした要素は遅延変換で扱える)。
  const moved = captures.filter(({ element, rect }) => {
    const now = element.getBoundingClientRect();
    if (
      Math.abs(now.left - rect.left) > 1.5 ||
      Math.abs(now.top - rect.top) > 1.5 ||
      Math.abs(now.width - rect.width) > 2 ||
      Math.abs(now.height - rect.height) > 2
    ) {
      return true;
    }
    // 幅と高さを固定した要素は、文字が折り返しても矩形が動かない。
    // 「変換で新たに中身がはみ出した」= 折り返しや欠けが起きたサインとして検知する
    const overX = element.scrollWidth - element.clientWidth > 2;
    const overY = element.scrollHeight - element.clientHeight > 2;
    return (overX || overY) && element.getAttribute('data-gg-pre-overflow') !== 'true';
  });
  if (moved.length > 0) {
    console.warn(
      '[convertToAbsolutePositioning] 変換で',
      moved.length,
      '要素がずれたため巻き戻します(採寸タイミングの問題の可能性)',
    );
    captures.forEach(({ element, prevStyle }) => {
      if (prevStyle == null) element.removeAttribute('style');
      else element.setAttribute('style', prevStyle);
      element.removeAttribute('data-gg-pre-overflow');
    });
    if (artboard) {
      const orig = artboard.getAttribute('data-original-height');
      if (orig !== null) {
        artboard.style.height = orig === 'auto' ? '' : orig;
        artboard.removeAttribute('data-original-height');
      }
    }
    return 0;
  }

  captures.forEach(({ element }) => element.removeAttribute('data-gg-pre-overflow'));
  console.log('[convertToAbsolutePositioning] Converted', captures.length, 'elements');
  return captures.length;
}

/**
 * artboardの高さを元に戻す（オートレイアウトに戻す際に使用）
 * convertToAbsolutePositioningで設定された固定高さを削除する
 */
export function restoreArtboardAutoHeight(iframeDoc: Document): void {
  const artboard = iframeDoc.getElementById('artboard');
  if (!artboard) return;

  // 元の高さを復元
  const originalHeight = artboard.getAttribute('data-original-height');
  if (originalHeight) {
    if (originalHeight === 'auto' || originalHeight === '') {
      artboard.style.removeProperty('height');
    } else {
      artboard.style.height = originalHeight;
    }
    artboard.removeAttribute('data-original-height');
    console.log('[restoreArtboardAutoHeight] Restored artboard height to:', originalHeight);
  } else {
    // data-original-heightがない場合は単純に高さを削除
    artboard.style.removeProperty('height');
    console.log('[restoreArtboardAutoHeight] Removed artboard height style');
  }
}

/**
 * DOMツリー構築の内部実装
 * キャッシュを使用しない純粋な構築処理
 */
function buildDomTreeInternal(iframeDoc: Document, rootElement?: Element): DOMTreeNode[] {
  const traverse = (el: Element, depth: number): DOMTreeNode[] => {
    const result: DOMTreeNode[] = [];

    Array.from(el.children).forEach(child => {
      // iframeの要素は親ウィンドウのHTMLElementとは異なるため、nodeTypeでチェック
      if (!child || child.nodeType !== 1) return;
      const htmlChild = child as HTMLElement;

      // スキップする要素
      if (htmlChild.tagName === 'SCRIPT' || htmlChild.tagName === 'STYLE') return;
      if (htmlChild.classList?.contains('selection-box')) return;
      if (htmlChild.classList?.contains('resize-handle')) return;
      if (htmlChild.classList?.contains('drawing-preview')) return;

      const elementId = htmlChild.getAttribute('data-element-id');

      if (elementId) {
        // IDを持つ要素はノードとして追加
        const childNodes = traverse(htmlChild, depth + 1);
        const textContent = htmlChild.textContent?.trim() || '';
        const classNameStr = htmlChild.className?.toString() || '';
        const className = classNameStr.split(' ')
          .filter(c => c && !c.startsWith('selected') && !c.startsWith('dragging') && !c.startsWith('editing'))[0] || '';

        // コンポーネントインスタンス情報を取得(HTML 部品の data-part も同じ印として扱う)
        const partId = htmlChild.getAttribute('data-part') || undefined;
        const componentInstanceId = htmlChild.getAttribute('data-component-instance') || partId;
        const masterComponentId = htmlChild.getAttribute('data-component-master') || partId;

        result.push({
          id: elementId,
          tagName: htmlChild.tagName.toLowerCase(),
          className,
          text: textContent.substring(0, 20) + (textContent.length > 20 ? '...' : ''),
          children: childNodes,
          visible: true,
          depth,
          componentInstanceId,
          masterComponentId,
        });
      } else {
        // IDを持たない要素は子要素を再帰的に検索
        const childNodes = traverse(htmlChild, depth);
        result.push(...childNodes);
      }
    });

    return result;
  };

  // ルート要素を決定（指定されていれば使用、なければ artboard または body）
  const root = rootElement || iframeDoc.getElementById('artboard') || iframeDoc.body;
  return traverse(root, 0);
}

/**
 * DOMツリーを構築（キャッシュ付き）
 * data-element-idを持つ要素を収集し、階層構造を保持
 *
 * Phase 2 最適化:
 * - HTMLが変更されていなければキャッシュを返す
 * - WeakMapを使用してメモリリークを防止
 *
 * @param iframeDoc - iframe ドキュメント
 * @param rootElement - オプション: ルート要素（指定しない場合は body、キャンバス構造では #artboard を指定）
 * @param skipCache - キャッシュをスキップして強制的に再構築（デフォルト: false）
 */
export function buildDomTree(
  iframeDoc: Document,
  rootElement?: Element,
  skipCache: boolean = false
): DOMTreeNode[] {
  const artboard = iframeDoc.getElementById('artboard');
  const root = rootElement || artboard || iframeDoc.body;

  // キャッシュチェック（rootElementが指定されている場合や、skipCacheの場合はキャッシュを使用しない）
  if (!skipCache && !rootElement && artboard) {
    const currentHtml = artboard.innerHTML;
    const cached = domTreeCache.get(iframeDoc);

    // HTMLが変わっていなければキャッシュを返す
    if (cached && cached.html === currentHtml) {
      console.log('[buildDomTree] Cache hit, returning cached tree with', cached.tree.length, 'root nodes');
      return cached.tree;
    }

    // 新規計算
    const tree = buildDomTreeInternal(iframeDoc, root);
    domTreeCache.set(iframeDoc, { html: currentHtml, tree });
    console.log('[buildDomTree] Cache miss, built tree with', tree.length, 'root nodes from', root.id || root.tagName);
    return tree;
  }

  // キャッシュを使用しない場合
  const nodes = buildDomTreeInternal(iframeDoc, root);
  console.log('[buildDomTree] Built tree (no cache) with', nodes.length, 'root nodes from', root.id || root.tagName);
  return nodes;
}

/**
 * 要素のパス情報（パンくずリスト用）
 */
export interface ElementPathItem {
  elementId: string;
  tagName: string;
  className: string;
  displayName: string;
}

/**
 * 要素からルートまでのパスを取得
 * @param element 対象要素
 * @param iframeDoc iframeのドキュメント
 * @returns ルートから要素までのパス（配列の最後が対象要素）
 */
export function getElementPath(element: HTMLElement, iframeDoc: Document): ElementPathItem[] {
  const path: ElementPathItem[] = [];
  let current: HTMLElement | null = element;
  const artboard = iframeDoc.getElementById('artboard');

  while (current && current !== artboard && current !== iframeDoc.body) {
    const elementId = current.getAttribute('data-element-id');
    if (elementId) {
      const tagName = current.tagName.toLowerCase();

      path.unshift({
        elementId,
        tagName,
        className: '',
        displayName: tagName,
      });
    }
    current = current.parentElement;
  }

  return path;
}

/**
 * 選択オーバーレイ（選択枠）の配置先を返す
 * #artboard があればその中、なければ body
 */
function getSelectionContainer(iframeDoc: Document): HTMLElement {
  return iframeDoc.getElementById('artboard') || iframeDoc.body;
}

/** 選択オーバーレイの矩形（artboard 相対のCSS座標） */
export interface OverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 要素の「選択枠を置くべき矩形」を artboard 相対のCSS座標で返す
 *
 * [なぜ切り出したか]
 * これまで updateSelectionBox の中にだけ座標変換が埋まっていたため、
 * ドラッグ中に枠を「作り直さず位置だけ同期する」ことができなかった。
 * 群バウンディングボックスの計算とも共有するので独立した関数にしている。
 *
 * getBoundingClientRect() はビューポート座標（= #artboard-wrapper の
 * transform:scale() 適用後）を返すため、必ず同じスケールで割り戻して
 * CSS座標へ変換する。ここでの基準は getArtboardScale() に統一する。
 */
export function getOverlayRect(iframeDoc: Document, element: HTMLElement): OverlayRect {
  const selectionContainer = getSelectionContainer(iframeDoc);
  const rect = element.getBoundingClientRect();
  const containerRect = selectionContainer.getBoundingClientRect();
  const scale = getArtboardScale(iframeDoc) || 1;

  return {
    left: (rect.left - containerRect.left) / scale,
    top: (rect.top - containerRect.top) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

// ========================================
// オーバーレイの寸法（すべて「画面上のpx」で定義する）
// ========================================
//
// オーバーレイは #artboard の中にあり、#artboard-wrapper の transform:scale() を
// 一緒に受ける。CSS側は --overlay-scale (= 1/zoom) を掛けて画面上の実寸を
// 一定に保つので、JSから位置を計算するときも同じ倍率を掛ける必要がある。

/** 角・辺中点ハンドルの掴み代（画面上px） */
const HANDLE_HIT_SCREEN = 12;
/**
 * 角丸ハンドルの内側オフセットの下限（画面上px）
 * 角ハンドルの当たり判定は角を中心に ±6px なので、
 * 角丸ハンドル(±6px)の中心が 14px 内側にあれば両者は重ならない。
 */
const RADIUS_MIN_INSET_SCREEN = 14;

/**
 * オーバーレイの寸法をズーム非依存にするための倍率を <html> に書き込む
 *
 * [なぜ <html> か]
 * #artboard に書くと保存対象（#artboard の innerHTML）ではないので実害は無いが、
 * 将来 outerHTML ベースの保存が入ったときに漏れる。<html> はどの保存経路でも
 * 直列化されないので安全で、かつ全要素に継承される（ホバー輪郭の太さにも効く）。
 *
 * 選択オーバーレイを触るすべての入口から呼ばれるので、ズーム変更時にも
 * 必ず更新される（EditorCanvas のズーム適用 useEffect が
 * refreshSelectionOverlay を呼んでいる）。
 */
export function applyOverlayScale(iframeDoc: Document): number {
  // 埋め込み(マルチフレームのキャンバス)では iframe の外側にも倍率が掛かる。
  // 画面上で 1px にするには内側 × 外側の倍率で割る(EditorCanvas が data-outer-zoom に書く)
  const outerZoom = Number(iframeDoc.documentElement?.dataset.outerZoom) || 1;
  const scale = (getArtboardScale(iframeDoc) || 1) * outerZoom;
  const overlayScale = 1 / scale;
  const root = iframeDoc.documentElement;
  if (!root) return overlayScale;
  // --overlay-scale = 1/zoom。オーバーレイの寸法はすべてこれを掛けて書く。
  root.style.setProperty('--overlay-scale', String(overlayScale));
  // --ed-overlay-scale = zoom そのもの。
  // 「画面上の1px」を calc(1px / var(--ed-overlay-scale)) で表す書き方も
  // 併存しうるので、書き込み口を1箇所にまとめる意味で同時に更新しておく。
  // （片方だけ更新されると、線の太さとハンドルの大きさがズーム時にズレる）
  root.style.setProperty('--ed-overlay-scale', String(scale));
  return overlayScale;
}

/**
 * オーバーレイのスケール変数を現在のズームに同期する（別名）
 * 実体は applyOverlayScale。呼び名が揺れても迷わないよう両方を公開している。
 */
export function syncOverlayScaleVar(iframeDoc: Document): number {
  return applyOverlayScale(iframeDoc);
}

/** 選択枠の描画モード */
type SelectionBoxMode =
  /** 単一選択: 枠 + ハンドル + サイズラベル + パンくず */
  | 'full'
  /** 複数選択のメンバー: 細い輪郭のみ（ハンドル類は群バウンディングボックスに集約） */
  | 'member';

/**
 * リサイズハンドル（角4 + 辺中点4 + 辺の帯4）を選択枠に追加する
 *
 * @param elementId 対象要素のID。空文字の場合 data-element-id を付けない
 *        （= 群バウンディングボックス用。mousedown 側は elementId が無ければ
 *          何もせず return するので、誤って別要素をリサイズすることがない）
 */
function appendResizeHandles(
  iframeDoc: Document,
  box: HTMLElement,
  elementId: string,
  options?: { includeEdges?: boolean }
): void {
  const includeEdges = options?.includeEdges !== false;
  const setIds = (el: HTMLElement, handle: string) => {
    el.setAttribute('data-handle', handle);
    if (elementId) {
      el.setAttribute('data-element-id', elementId);
    } else {
      // 群のハンドルであることを示す印（後段で群リサイズを実装する際の目印）
      el.setAttribute('data-group-handle', 'true');
    }
  };

  // 角 + 辺中点（見える四角）
  ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'].forEach(pos => {
    const handle = iframeDoc.createElement('div');
    handle.className = `resize-handle ${pos}`;
    setIds(handle, pos);
    box.appendChild(handle);
  });

  if (!includeEdges) return;

  // 辺の帯（見た目なし・当たり判定のみ）
  // data-handle は n/e/s/w のまま渡す。useDragResize が name.includes('e') 等で
  // 軸を判定しているため、独自の値にすると軸判定が壊れる。
  const edges: Array<[handle: string, cls: string]> = [
    ['n', 'edge-top'],
    ['e', 'edge-right'],
    ['s', 'edge-bottom'],
    ['w', 'edge-left'],
  ];
  edges.forEach(([handle, cls]) => {
    const band = iframeDoc.createElement('div');
    band.className = `resize-handle edge ${cls}`;
    setIds(band, handle);
    box.appendChild(band);
  });
}

/**
 * 角丸ハンドルの位置を更新（無ければ作る / 置けない大きさなら消す）
 *
 * [なぜ位置をJSで計算するか]
 * 角丸ハンドルは「現在の border-radius の分だけ内側」に置くのが直感的だが、
 * border-radius:0 の要素では内側オフセットが 0 になり、NEハンドルを完全に
 * 覆ってしまう（実測: NE中心の elementFromPoint が border-radius-handle を返す）。
 * そこで内側オフセットに下限（角ハンドルと重ならない値）を設け、
 * 要素が小さすぎて下限すら確保できない場合はハンドル自体を出さない。
 */
function updateRadiusHandle(
  iframeDoc: Document,
  box: HTMLElement,
  element: HTMLElement,
  rect: OverlayRect,
  overlayScale: number
): void {
  const elementId = element.getAttribute('data-element-id') || '';
  let handle = box.querySelector<HTMLElement>('.border-radius-handle');

  const minInset = RADIUS_MIN_INSET_SCREEN * overlayScale;
  const maxInset = Math.min(rect.width, rect.height) / 2;

  // 下限すら確保できない小さな要素では角丸ハンドルを出さない
  if (!Number.isFinite(maxInset) || maxInset < minInset) {
    handle?.remove();
    return;
  }

  if (!handle) {
    handle = iframeDoc.createElement('div');
    handle.className = 'border-radius-handle';
    handle.setAttribute('data-handle', 'radius');
    if (elementId) handle.setAttribute('data-element-id', elementId);
    box.appendChild(handle);
  }

  const borderRadius =
    parseFloat(iframeDoc.defaultView?.getComputedStyle(element).borderRadius || '0') || 0;
  const inset = Math.min(Math.max(borderRadius, minInset), maxInset);
  // 当たり判定の中心が inset に来るよう、半分だけ戻す
  const offset = inset - (HANDLE_HIT_SCREEN / 2) * overlayScale;
  handle.style.top = `${offset}px`;
  handle.style.right = `${offset}px`;
}

/**
 * 選択ボックスを更新
 *
 * [統一入口]
 * 外部からはこの関数か refreshSelectionOverlay / syncSelectionOverlayRects だけを
 * 呼ぶ契約にする。この関数は「対象が選択中なら選択セット全体から作り直す」ため、
 * 1要素ずつ呼んでも枠の集合と .selected の集合が食い違わない。
 * 複数選択時にメンバーへハンドルが13個ずつ生えるのも、この一本化で防いでいる。
 *
 * @param iframeDoc iframeのドキュメント
 * @param element 対象要素
 * @param keepOthers trueの場合、他の選択ボックスを保持（複数選択用・後方互換）
 */
export function updateSelectionBox(
  iframeDoc: Document,
  element: HTMLElement,
  keepOthers: boolean = false
): void {
  if (element.classList.contains('selected')) {
    // 選択セット全体を正として作り直す（群バウンディングボックスもここで更新される）
    refreshSelectionOverlay(iframeDoc);
    return;
  }
  // .selected が付いていない要素への呼び出しは従来どおり単体の枠を描く
  drawSelectionBox(iframeDoc, element, keepOthers, 'full');
}

/**
 * 選択枠を1枚描く（内部実装）
 */
function drawSelectionBox(
  iframeDoc: Document,
  element: HTMLElement,
  keepOthers: boolean,
  mode: SelectionBoxMode
): void {
  const elementId = element.getAttribute('data-element-id') || '';

  // 選択ボックスの配置先（#artboard があればその中、なければ body）
  const selectionContainer = getSelectionContainer(iframeDoc);
  const overlayScale = applyOverlayScale(iframeDoc);

  if (!keepOthers) {
    // [バグ修正] 以前は querySelector（単数）で「先頭の1個だけ」を消していたため、
    // 「先頭を1個消して末尾に1個足す」という玉突きが起きていた。
    // 枠の個数と選択要素の個数がずれると、ずれた分の枠が古い位置に永久に残る。
    // コメント通り「全て削除」に直す。
    iframeDoc.querySelectorAll('.selection-box').forEach(box => box.remove());
  } else {
    // この要素の既存の選択ボックスのみ削除
    const existingBox = iframeDoc.querySelector(`.selection-box[data-for-element="${elementId}"]`);
    if (existingBox) {
      existingBox.remove();
    }
  }

  const overlayRect = getOverlayRect(iframeDoc, element);
  const { left: relativeLeft, top: relativeTop, width, height } = overlayRect;

  // 選択ボックスを作成
  const selectionBox = iframeDoc.createElement('div');
  selectionBox.className =
    mode === 'member' ? 'selection-box selection-member' : 'selection-box';
  selectionBox.setAttribute('data-for-element', elementId);
  // 部品(data-part)のインスタンスは枠を紫にして、名前と版を枠の上に出す(部品だと一目で分かる)。
  // 部品の中のスロットを選んでいるときも、どの部品の中かを出す
  const partRoot = element.hasAttribute('data-part') ? element : (element.parentElement?.closest('[data-part]') as HTMLElement | null) ?? null;
  if (partRoot) {
    const isRoot = partRoot === element;
    selectionBox.classList.add(isRoot ? 'selection-part' : 'selection-in-part');
    if (mode !== 'member') {
      const badge = iframeDoc.createElement('div');
      badge.className = 'part-badge';
      const slot = isRoot ? null : (element.closest('[data-slot]') as HTMLElement | null);
      const slotName = slot && partRoot.contains(slot) && slot !== partRoot ? slot.getAttribute('data-slot') : null;
      const version = partRoot.getAttribute('data-part-v');
      badge.textContent = `${isRoot ? '部品' : '部品の中'} ${partRoot.getAttribute('data-part') ?? ''}${version ? ` v${version}` : ''}${slotName ? ` › ${slotName}` : ''}`;
      selectionBox.appendChild(badge);
    }
  }
  selectionBox.style.cssText = `
    left: ${relativeLeft}px;
    top: ${relativeTop}px;
    width: ${width}px;
    height: ${height}px;
  `;

  // 外枠
  const outline = iframeDoc.createElement('div');
  outline.className = 'selection-outline';
  selectionBox.appendChild(outline);

  if (mode === 'member') {
    // 複数選択のメンバーは細い輪郭だけ。
    // ハンドル・サイズラベル・パンくずは群バウンディングボックスに集約する。
    selectionContainer.appendChild(selectionBox);
    return;
  }

  // リサイズハンドル（角4 + 辺中点4 + 辺の帯4）
  appendResizeHandles(iframeDoc, selectionBox, elementId);

  // 角丸ハンドル（角ハンドルと重ならない位置に置く）
  updateRadiusHandle(iframeDoc, selectionBox, element, overlayRect, overlayScale);

  // サイズラベル（スケール前の実際のサイズを表示）
  const sizeLabel = iframeDoc.createElement('div');
  sizeLabel.className = 'size-label';
  sizeLabel.textContent = overlayLabelText(width, height);
  selectionBox.appendChild(sizeLabel);

  // 回転ハンドル（4つのコーナー外側）- Figmaスタイル（不可視、カーソル変更のみ）
  //
  // [追加] 右上の1つだけ ⟳ を出して見えるようにする。
  // 4隅の回転域は昔から在ったが完全に透明で、知らなければ一生見つからない。
  // PowerPointは回転ハンドルが1つ見えているので、それに倣って右上を目印にする
  // （左上はパンくず、下中央はサイズラベルが居るので右上が空いている）。
  const rotationHandles = ['nw', 'ne', 'sw', 'se'];
  rotationHandles.forEach(pos => {
    const rotHandle = iframeDoc.createElement('div');
    rotHandle.className = `rotation-handle ${pos}`;
    rotHandle.setAttribute('data-handle', `rotate-${pos}`);
    rotHandle.setAttribute('data-element-id', elementId);
    // インラインスタイルで確実に透明に（スタイルシート適用前対策）
    rotHandle.style.background = 'transparent';
    rotHandle.style.border = 'none';
    rotHandle.style.outline = 'none';
    if (pos === 'ne') {
      rotHandle.classList.add('rotation-handle-visible');
      const glyph = iframeDoc.createElement('span');
      glyph.className = 'rotation-handle-glyph';
      glyph.textContent = '⟳';
      // 掴んだ先は必ず .rotation-handle 本体でなければならない
      // （mousedown 側は e.target の data-handle しか見ないので、
      //   印が当たり判定を横取りすると回転が始まらない）
      glyph.style.pointerEvents = 'none';
      rotHandle.appendChild(glyph);
    }
    selectionBox.appendChild(rotHandle);
  });

  // パンくずリスト（要素パス）を追加
  const elementPath = getElementPath(element, iframeDoc);
  if (elementPath.length > 1) {
    const breadcrumb = iframeDoc.createElement('div');
    breadcrumb.className = 'element-breadcrumb';
    // ズームで文字が潰れない/巨大化しないよう、寸法は --ov（1/zoom）を掛ける
    breadcrumb.style.cssText = `
      position: absolute;
      top: calc(-22px * var(--ov, 1));
      left: 0;
      display: flex;
      align-items: center;
      gap: calc(2px * var(--ov, 1));
      font-size: calc(10px * var(--ov, 1));
      line-height: 1.4;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      white-space: nowrap;
      pointer-events: auto;
      z-index: 40;
    `;

    elementPath.forEach((item, index) => {
      // セパレータ（最初の要素以外）
      if (index > 0) {
        const separator = iframeDoc.createElement('span');
        separator.textContent = '›';
        separator.style.cssText = `
          color: rgba(59, 130, 246, 0.5);
          font-size: 10px;
        `;
        breadcrumb.appendChild(separator);
      }

      // パス要素
      const pathItem = iframeDoc.createElement('span');
      pathItem.textContent = item.displayName;
      pathItem.setAttribute('data-element-id', item.elementId);

      const isCurrentElement = index === elementPath.length - 1;
      pathItem.style.cssText = `
        padding: calc(2px * var(--ov, 1)) calc(4px * var(--ov, 1));
        border-radius: calc(3px * var(--ov, 1));
        cursor: ${isCurrentElement ? 'default' : 'pointer'};
        color: ${isCurrentElement ? '#fff' : 'rgba(255, 255, 255, 0.8)'};
        background: ${isCurrentElement ? 'rgba(59, 130, 246, 0.9)' : 'rgba(59, 130, 246, 0.6)'};
        transition: background 0.15s ease;
      `;

      if (!isCurrentElement) {
        pathItem.addEventListener('mouseenter', () => {
          pathItem.style.background = 'rgba(59, 130, 246, 0.85)';
          // 該当要素にホバーアウトラインを表示
          const targetEl = iframeDoc.querySelector(`[data-element-id="${item.elementId}"]`) as HTMLElement;
          if (targetEl) {
            targetEl.setAttribute('data-breadcrumb-hover', 'true');
            targetEl.style.outline = '2px dashed rgba(59, 130, 246, 0.7)';
            targetEl.style.outlineOffset = '2px';
          }
        });
        pathItem.addEventListener('mouseleave', () => {
          pathItem.style.background = 'rgba(59, 130, 246, 0.6)';
          // ホバーアウトラインを削除
          const targetEl = iframeDoc.querySelector(`[data-element-id="${item.elementId}"]`) as HTMLElement;
          if (targetEl) {
            targetEl.removeAttribute('data-breadcrumb-hover');
            targetEl.style.outline = '';
            targetEl.style.outlineOffset = '';
          }
        });
        // 選択は mousedown で走るので、click だけ止めても間に合わない。
        // チップを押した時点で「今選択中の要素のドラッグ」が始まってしまい、
        // その後の click による親の選択が上書きされていた。
        const swallow = (e: Event) => {
          e.stopPropagation();
          e.preventDefault();
        };
        pathItem.addEventListener('mousedown', swallow);
        pathItem.addEventListener('pointerdown', swallow);
        pathItem.addEventListener('click', (e) => {
          e.stopPropagation();
          // ホバーアウトラインを削除してから選択
          const targetEl = iframeDoc.querySelector(`[data-element-id="${item.elementId}"]`) as HTMLElement;
          if (targetEl) {
            targetEl.style.outline = '';
            targetEl.style.outlineOffset = '';
          }
          // 親ウィンドウにメッセージを送信して要素選択
          window.parent.postMessage({
            type: 'breadcrumb-select',
            elementId: item.elementId,
          }, '*');
        });
      }

      breadcrumb.appendChild(pathItem);
    });

    selectionBox.appendChild(breadcrumb);
  }

  selectionContainer.appendChild(selectionBox);
}

/**
 * 選択ボックスを削除
 * @param iframeDoc iframeのドキュメント
 * @param element 特定の要素の選択ボックスのみ削除する場合に指定
 */
export function removeSelectionBox(iframeDoc: Document, element?: HTMLElement): void {
  if (element) {
    const elementId = element.getAttribute('data-element-id');
    if (elementId) {
      const existingBox = iframeDoc.querySelector(`.selection-box[data-for-element="${elementId}"]`);
      if (existingBox) {
        existingBox.remove();
      }
    }
  } else {
    // 全ての選択ボックスを削除
    iframeDoc.querySelectorAll('.selection-box').forEach(box => box.remove());
  }
}

// ========================================
// 選択オーバーレイ（要素ごとの枠 + 群バウンディングボックス）
// ========================================
//
// [設計方針]
// 従来は「要素1個ずつ add / remove」で枠を管理していたため、
// 枠の集合と .selected の集合が容易に食い違い、
//   - 古い位置に枠が取り残される
//   - 同じ要素の枠が二重に生成される
// といった破綻が日常的に起きていた。
//
// そこで、
//   refreshSelectionOverlay()   … 選択セット全体から作り直す（選択が変わったとき）
//   syncSelectionOverlayRects() … 既存の枠の位置・サイズだけを書き換える（ドラッグ中など）
// の2本に集約する。ドラッグ中に毎フレーム作り直さないのは、
// パンくずに mouseenter/mouseleave を張っており、カーソルがパンくず上にある状態で
// ノードを差し替えると mouseleave が飛ばず、スライド側の要素に
// インライン outline が焼き付いて保存HTMLに漏れるため。

/** 群バウンディングボックスのクラス名 */
const SELECTION_BOUNDS_CLASS = 'selection-bounds';

/**
 * サイズラベル(W × H)の表示を一時的に差し替える文字列
 *
 * ドラッグ中は X, Y、回転中は角度を、Figmaと同じくサイズと同じ場所に出す。
 * 枠はドラッグ中も毎フレーム syncSelectionOverlayRects で書き直されるので、
 * 呼び出し側が textContent を直接書いても次のフレームで消される。
 * 「今どのラベルを出すか」をここに1つ持ち、ラベルを書く場所すべてがこれを見る。
 * ドラッグ/回転を終えたら必ず null に戻すこと(refreshSelectionOverlay でも戻る)。
 */
let overlayLabelOverride: string | null = null;

/** ドラッグ中のX,Y・回転中の角度をサイズラベルの位置に出す(null で通常のW × Hに戻る) */
export function setOverlayLabel(text: string | null): void {
  overlayLabelOverride = text;
}

/** サイズラベルに書く文字列(差し替えがあればそちらを優先) */
function overlayLabelText(width: number, height: number): string {
  return overlayLabelOverride ?? `${Math.round(width)} × ${Math.round(height)}`;
}

/**
 * 個別要素の選択枠だけを取得する
 * （群バウンディングボックスは .selection-box を兼ねているので除外する。
 *   兼ねているのは、保存時のサニタイズ（html-utils 等）が .selection-box を
 *   前提に組まれており、そこに自動的に乗せるため）
 */
function getElementSelectionBoxes(iframeDoc: Document): HTMLElement[] {
  return Array.from(
    iframeDoc.querySelectorAll<HTMLElement>(`.selection-box:not(.${SELECTION_BOUNDS_CLASS})`)
  );
}

/** 現在選択中（.selected）の要素一覧 */
function getSelectedElements(iframeDoc: Document): HTMLElement[] {
  return Array.from(iframeDoc.querySelectorAll<HTMLElement>('.selected'));
}

/**
 * 群バウンディングボックスを削除
 */
export function removeSelectionBounds(iframeDoc: Document): void {
  iframeDoc
    .querySelectorAll(`.${SELECTION_BOUNDS_CLASS}`)
    .forEach(box => box.remove());
}

/**
 * 複数選択時の「群バウンディングボックス」を更新（Figma相当）
 * 選択中の全要素の矩形の和集合を1枚の枠として描画する。
 * 2要素以上のときだけ表示し、1要素以下なら削除する。
 */
export function updateSelectionBounds(iframeDoc: Document, elements: HTMLElement[]): void {
  if (elements.length < 2) {
    removeSelectionBounds(iframeDoc);
    return;
  }

  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;

  elements.forEach(el => {
    const r = getOverlayRect(iframeDoc, el);
    minLeft = Math.min(minLeft, r.left);
    minTop = Math.min(minTop, r.top);
    maxRight = Math.max(maxRight, r.left + r.width);
    maxBottom = Math.max(maxBottom, r.top + r.height);
  });

  if (!Number.isFinite(minLeft) || !Number.isFinite(minTop)) {
    removeSelectionBounds(iframeDoc);
    return;
  }

  applyOverlayScale(iframeDoc);

  const container = getSelectionContainer(iframeDoc);
  let bounds = iframeDoc.querySelector<HTMLElement>(`.${SELECTION_BOUNDS_CLASS}`);
  if (!bounds) {
    bounds = iframeDoc.createElement('div');
    // .selection-box も付けることで既存のサニタイズ処理に自動的に拾われる
    bounds.className = `selection-box ${SELECTION_BOUNDS_CLASS}`;

    // 外枠
    const outline = iframeDoc.createElement('div');
    outline.className = 'selection-outline';
    bounds.appendChild(outline);

    // ハンドルは群バウンディングボックス1枚に集約する。
    // data-element-id を付けないので、既存の mousedown ハンドラは
    // 「handle はあるが elementId が無い」ため何もせず return する。
    // = 誤って別の要素をリサイズしてしまうことがない（群リサイズの実装は後段）。
    //
    // 辺の帯は付けない: 群リサイズが未実装のうちは、群の外周に沿った長い帯が
    // クリックを飲み込むだけになるため。角・辺中点の8個だけを出す。
    appendResizeHandles(iframeDoc, bounds, '', { includeEdges: false });

    // サイズラベルも1枚だけ（メンバー全員に出すと40件マーキーで紙面が読めない）
    const label = iframeDoc.createElement('div');
    label.className = 'size-label';
    bounds.appendChild(label);

    container.appendChild(bounds);
  } else if (bounds.parentElement !== container) {
    container.appendChild(bounds);
  }

  const width = maxRight - minLeft;
  const height = maxBottom - minTop;
  bounds.style.left = `${minLeft}px`;
  bounds.style.top = `${minTop}px`;
  bounds.style.width = `${width}px`;
  bounds.style.height = `${height}px`;

  const label = bounds.querySelector('.size-label');
  if (label) {
    label.textContent = overlayLabelText(width, height);
  }
}

/**
 * 選択オーバーレイを選択セット全体から作り直す
 *
 * 「1要素ずつ足し引きする」設計をやめ、常に .selected を正とする。
 * 選択が変化した直後・ドラッグ終了直後（Tailwindクラスへの丸め込みで
 * 位置がわずかに変わるため）に呼ぶこと。
 */
export function refreshSelectionOverlay(iframeDoc: Document): void {
  // 選択枠を作り直す = 操作が終わった合図。ラベルは通常のW × Hに戻す
  overlayLabelOverride = null;
  removeSelectionBox(iframeDoc); // 群バウンディングボックスも .selection-box なのでここで消える
  applyOverlayScale(iframeDoc);
  const selected = getSelectedElements(iframeDoc);

  // 複数選択のときはメンバーを「細い輪郭のみ」にし、
  // ハンドル・サイズラベル・パンくずは群バウンディングボックス1枚に集約する。
  const mode: SelectionBoxMode = selected.length > 1 ? 'member' : 'full';
  selected.forEach(el => drawSelectionBox(iframeDoc, el, true, mode));
  updateSelectionBounds(iframeDoc, selected);
}

/**
 * 選択オーバーレイの更新入口（唯一の公開API）
 *
 * 位置・サイズを変える処理は、処理の最後に必ずこれを呼ぶこと。
 * 「作り直し」と「位置だけ同期」の使い分けは中で判断するので、
 * 呼び出し側はどちらを使うか考えなくてよい。
 *
 * @param options.rebuild true を渡すと必ず作り直す（選択セットが変わったとき）
 */
export function updateSelectionOverlay(
  iframeDoc: Document,
  options?: { rebuild?: boolean }
): void {
  if (options?.rebuild) {
    refreshSelectionOverlay(iframeDoc);
    return;
  }
  syncSelectionOverlayRects(iframeDoc);
}

/**
 * 既存の選択枠の位置・サイズだけを同期する（ドラッグ / リサイズ / 回転中用）
 *
 * DOMを作り直さないので、パンくずのイベントリスナーや掴んでいるリサイズハンドルが
 * 生き残る。枠の集合と .selected の集合が食い違っている場合のみ作り直しにフォールバックする。
 */
export function syncSelectionOverlayRects(iframeDoc: Document): void {
  const selected = getSelectedElements(iframeDoc);
  const boxes = getElementSelectionBoxes(iframeDoc);

  // 個数が合わない ＝ どこかで枠がリークしている。作り直して整合させる
  if (boxes.length !== selected.length) {
    refreshSelectionOverlay(iframeDoc);
    return;
  }

  // 単一 ⇄ 複数 で枠の中身（ハンドルの有無）が変わるので、
  // 装飾モードが今の選択数と食い違っていたら作り直す
  const shouldBeMember = selected.length > 1;
  if (boxes.some(box => box.classList.contains('selection-member') !== shouldBeMember)) {
    refreshSelectionOverlay(iframeDoc);
    return;
  }

  const overlayScale = applyOverlayScale(iframeDoc);

  for (const el of selected) {
    const elementId = el.getAttribute('data-element-id') || '';
    const box = iframeDoc.querySelector<HTMLElement>(
      `.selection-box[data-for-element="${elementId}"]`
    );
    if (!box) {
      // 対応する枠が無い ＝ 対応関係が壊れている
      refreshSelectionOverlay(iframeDoc);
      return;
    }

    const rect = getOverlayRect(iframeDoc, el);
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    const sizeLabel = box.querySelector('.size-label');
    if (sizeLabel) {
      sizeLabel.textContent = overlayLabelText(rect.width, rect.height);
    }

    // 角丸ハンドルの位置は要素サイズと border-radius に依存するので、
    // リサイズ中も追従させる（小さくなりすぎたら自動的に消える）
    if (!shouldBeMember) {
      updateRadiusHandle(iframeDoc, box, el, rect, overlayScale);
    }
  }

  updateSelectionBounds(iframeDoc, selected);
}

// ========================================
// ドラッグ開始時の座標基準（origin）の決定
// ========================================

/**
 * この要素を left/top 駆動でドラッグできるか
 *
 * テキストフロー内の純粋なインライン要素は left/top を書いても動かないため、
 * 群ドラッグの対象から外す（対象に入れると「動かないのに枠だけ動く」ことになる）。
 */
export function canDragElementByPosition(element: HTMLElement, iframeDoc: Document): boolean {
  const computedStyle = iframeDoc.defaultView?.getComputedStyle(element);
  if (!computedStyle) return true;

  if (!isInlineElement(element, computedStyle)) return true;

  const position = computedStyle.position;
  const display = computedStyle.display;
  return (
    position === 'absolute' ||
    position === 'fixed' ||
    display === 'block' ||
    display === 'inline-block' ||
    display === 'flex' ||
    display === 'inline-flex' ||
    display === 'grid' ||
    display === 'inline-grid'
  );
}

/**
 * ドラッグ開始時の座標基準（origin）を決定する
 *
 * [なぜ offsetLeft / offsetTop を使うか]
 * 従来は `parseFloat(el.style.left) || 0` でインラインstyleだけを見ていたため、
 * Tailwindの任意値クラス（`absolute left-[96px]`）で配置された要素は origin=0 と
 * 誤読され、移動量に「その要素自身の座標 × ズーム倍率」の誤差が乗っていた。
 * これが「同じドラッグ量なのに要素ごとに移動量が違う」の直接の原因。
 *
 * offsetLeft/offsetTop は offsetParent のパディングボックス基準の
 * 「スケール前のCSSピクセル」を返す。絶対配置要素の包含ブロックは offsetParent と
 * 一致するので、そのまま style.left/top に書き戻せる。
 * getBoundingClientRect と違ってズーム倍率で割る必要がなく、
 * 要素自身の transform:rotate() の影響も受けない。
 *
 * @param options.convertToAbsolute static/relative の要素を absolute へ変換してよいか
 *        （オートレイアウトモードでは false。周囲の兄弟がリフローしてしまうため）
 */
/**
 * ドラッグ対象をまとめて絶対配置へ変換する。
 *
 * **移動が始まってから**呼ぶこと。mousedown の時点で変換すると、要素が流れから外れて
 * 後続の兄弟が一斉に詰め上がり、「選択しただけで版面が動く」ように見える。
 *
 * 1要素ずつ変換すると、先に外した要素の分だけ後続要素の offsetTop が変わってしまう。
 * そのため **採寸を全部先に済ませてから** 書き込む。位置は mousedown 時に読んでおいた
 * origin をそのまま使うので、変換の前後で見た目は動かない。
 */
export function convertDragTargetsToAbsolute(
  targets: { element: HTMLElement; origin: { left: number; top: number } }[],
  iframeDoc: Document
): void {
  const win = iframeDoc.defaultView;
  if (!win) return;

  const pending = targets
    .map(({ element, origin }) => {
      const cs = win.getComputedStyle(element);
      if (cs.position === 'absolute' || cs.position === 'fixed') return null;
      const box = readOffsetBox(element, iframeDoc);
      return {
        element,
        origin,
        width: box.width,
        height: box.height,
        parent: element.parentElement,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (!pending.length) return;

  // 親を offsetParent に確定させる(position:relative を入れるだけでは要素は動かない)
  for (const p of pending) {
    if (p.parent && p.parent !== iframeDoc.body) {
      if (win.getComputedStyle(p.parent).position === 'static') {
        capturePrestyle(p.parent);
        p.parent.style.position = 'relative';
      }
    }
  }

  for (const p of pending) {
    capturePrestyle(p.element);
    p.element.style.width = `${p.width}px`;
    p.element.style.height = `${p.height}px`;
    p.element.style.margin = '0';
    p.element.style.position = 'absolute';
    p.element.style.left = `${p.origin.left}px`;
    p.element.style.top = `${p.origin.top}px`;
  }
}

/**
 * 要素の寸法を中身にフィットさせる(Figmaのハンドルのダブルクリック相当)。
 *
 * - 横(e/w): 幅を中身の最長行に合わせる。<br>による改行は保ち、自動折り返しだけが解ける
 * - 縦(n/s): いまの幅のまま、高さを中身に合わせる
 * - 角(ne等): 両方
 * 掴んだハンドルの**反対側の辺を固定**する(左辺のハンドルなら右端が動かない)。
 *
 * 中身が絶対配置の子だけの場合、auto採寸は0になるので子の外接矩形にフィットさせる。
 */
export function fitElementToContent(
  element: HTMLElement,
  iframeDoc: Document,
  handle: string,
): { changed: boolean } {
  const win = iframeDoc.defaultView;
  if (!win) return { changed: false };
  const fitW = handle.includes('e') || handle.includes('w');
  const fitH = handle.includes('n') || handle.includes('s');
  if (!fitW && !fitH) return { changed: false };

  // 流し込みの子(カードやリスト項目)を並べている器は対象外。
  // 「最長行に幅を合わせる」はテキスト箱のための採寸で、器に掛けると
  // 中の文の長さまで幅が縮み、カードが折れてページ高さまで変わる
  // (Webページの商品一覧で、ハンドルを2回押しただけで 490→337px に潰れた)。
  // 絶対配置の子だけを持つ器は下の childExtent で正しく扱えるので通す
  const INLINE_TEXT_TAGS = new Set(['SPAN', 'A', 'B', 'I', 'EM', 'STRONG', 'BR', 'SMALL', 'SUP', 'SUB', 'MARK', 'CODE']);
  const hasFlowChildren = [...element.children].some((c) => {
    if (INLINE_TEXT_TAGS.has(c.tagName)) return false;
    const pos = win.getComputedStyle(c).position;
    return pos !== 'absolute' && pos !== 'fixed';
  });
  if (hasFlowChildren) return { changed: false };

  const before = { w: element.offsetWidth, h: element.offsetHeight,
                   left: element.offsetLeft, top: element.offsetTop };

  // 絶対配置の子の外接矩形(フォールバック用)
  const absChildren = [...element.children].filter((c) => {
    const pos = win.getComputedStyle(c).position;
    return pos === 'absolute';
  }) as HTMLElement[];
  const childExtent = absChildren.length
    ? {
        w: Math.max(...absChildren.map((c) => c.offsetLeft + c.offsetWidth)),
        h: Math.max(...absChildren.map((c) => c.offsetTop + c.offsetHeight)),
      }
    : null;

  // 実際の行数(y位置のクラスタ数)。折り返し検証に使う
  const countLines = (): number => {
    const range = iframeDoc.createRange();
    range.selectNodeContents(element);
    const ys: number[] = [];
    for (const r of range.getClientRects()) {
      if (r.width <= 0 || r.height <= 0) continue;
      if (!ys.some((y) => Math.abs(y - r.top) < 3)) ys.push(r.top);
    }
    return ys.length;
  };

  // 一時的に auto / max-content で採寸して戻す
  const prev = { width: element.style.width, height: element.style.height };
  let newW = before.w;
  let newH = before.h;
  if (fitW) {
    element.style.width = 'max-content';
    const m = element.offsetWidth;
    const naturalLines = countLines(); // <br>による本来の行数
    // テキストが無く子も無いと 0 になる。その場合は子の外接、それも無ければ現状維持
    newW = m > 4 ? m : childExtent ? childExtent.w : before.w;
    if (m > 4) {
      // 測定値ちょうどで固定すると、letter-spacing の末尾分や丸めで1px足りず
      // 最後の1文字だけが折り返することがある(実害あり)。
      // 固定してみて行数が増えていたら、増えなくなるまで少しずつ広げる
      newW = Math.ceil(newW);
      element.style.width = `${newW}px`;
      let guard = 12;
      while (countLines() > naturalLines && guard-- > 0) {
        newW += 1;
        element.style.width = `${newW}px`;
      }
    }
  }
  if (fitH) {
    // 幅を確定させてから高さを測る(横フィットと同時なら新しい幅で折り返す)
    element.style.width = fitW ? `${Math.ceil(newW)}px` : prev.width;
    element.style.height = 'auto';
    const m = element.offsetHeight;
    newH = m > 4 ? m : childExtent ? childExtent.h : before.h;
  }
  element.style.width = prev.width;
  element.style.height = prev.height;

  newW = Math.ceil(newW);
  newH = Math.ceil(newH);
  const changed = newW !== before.w || newH !== before.h;
  if (!changed) return { changed: false };

  // 反対側の辺を固定する。w側を掴んだら右端、n側を掴んだら下端を保つ
  if (fitW) {
    element.style.width = `${newW}px`;
    if (handle.includes('w')) element.style.left = `${before.left + (before.w - newW)}px`;
  }
  if (fitH) {
    element.style.height = `${newH}px`;
    if (handle.includes('n')) element.style.top = `${before.top + (before.h - newH)}px`;
  }
  return { changed: true };
}

/**
 * テキスト編集中、ブラウザのキャレット追従で紙面が飛ぶのを防ぐ。
 *
 * 編集に入る・文字を打つ・End/Home でキャレットが動くたびに、ブラウザは
 * キャレットを「見える位置」へスクロールさせる。紙面は #artboard-wrapper の
 * transform で縮小されているため、その計算が狂い、見えているのに大きく
 * スクロールしてしまう(実測: スライドで 53px、Webページで 1900px 飛んだ)。
 * ダブルクリックした場所は既に見えているので、キャレット起因のスクロールは要らない。
 *
 * 追従は打鍵の後、次の描画更新の中で走る(rAF より後)ので、scroll イベントで
 * 捕まえて描画される前に戻す。overflow:hidden の html/body/#artboard も
 * プログラム的にはスクロールされ得るので、要素からルートまでの祖先を全部見る。
 * ユーザー自身のスクロール(ホイール・パン・スクロールバー)は直前の入力で見分け、
 * その直後の scroll は「意図した移動」として覚え直す。
 * 編集を抜けたら(contenteditable が外れたら)自分で外れる。
 */
export function lockCaretScroll(element: HTMLElement, iframeDoc: Document): void {
  const scrollers: HTMLElement[] = [];
  for (let a = element.parentElement; a; a = a.parentElement) scrollers.push(a);
  const remembered = scrollers.map((s) => ({ left: s.scrollLeft, top: s.scrollTop }));
  const remember = () => {
    scrollers.forEach((s, i) => {
      remembered[i].left = s.scrollLeft;
      remembered[i].top = s.scrollTop;
    });
  };
  const restore = () => {
    scrollers.forEach((s, i) => {
      if (s.scrollLeft !== remembered[i].left) s.scrollLeft = remembered[i].left;
      if (s.scrollTop !== remembered[i].top) s.scrollTop = remembered[i].top;
    });
  };

  let userScrollUntil = 0;
  const markUserScroll = () => {
    userScrollUntil = performance.now() + 400;
  };
  const onScroll = () => {
    if (element.getAttribute('contenteditable') !== 'true') return detach();
    if (performance.now() < userScrollUntil) remember();
    else restore();
  };
  const detach = () => {
    iframeDoc.removeEventListener('wheel', markUserScroll, true);
    iframeDoc.removeEventListener('mousedown', markUserScroll, true);
    iframeDoc.removeEventListener('touchstart', markUserScroll, true);
    iframeDoc.removeEventListener('scroll', onScroll, true);
  };
  iframeDoc.addEventListener('wheel', markUserScroll, true);
  iframeDoc.addEventListener('mousedown', markUserScroll, true);
  iframeDoc.addEventListener('touchstart', markUserScroll, true);
  iframeDoc.addEventListener('scroll', onScroll, true);
  // フォーカスや全選択で既に動いていたら、その場で戻す
  restore();
}

/**
 * offsetLeft/offsetTop/offsetWidth/offsetHeight 相当を、SVG でも取れる形で読む。
 *
 * [なぜ必要か] `<svg>` と その中身は SVGElement で、offsetLeft 等を**持たない**
 * (undefined)。そのまま origin にすると `left: NaNpx` が書かれて無視され、
 * 掴んでも1pxも動かない(スライドのロゴ・図形で実測)。
 * HTMLElement は従来どおり offset 系(スケール前の CSS px、transform の影響なし)を
 * 使い、持たない要素だけ矩形から割り戻す。基準は offsetParent と同じ
 * 「最も近い position が static でない祖先」(無ければ body)。
 */
export function readOffsetBox(
  element: HTMLElement,
  iframeDoc: Document,
): { left: number; top: number; width: number; height: number } {
  if (typeof element.offsetLeft === 'number') {
    return {
      left: element.offsetLeft,
      top: element.offsetTop,
      width: element.offsetWidth,
      height: element.offsetHeight,
    };
  }
  const win = iframeDoc.defaultView;
  const artboard = iframeDoc.getElementById('artboard');
  const scale = artboard ? artboard.getBoundingClientRect().width / (artboard.offsetWidth || 1) || 1 : 1;
  let parent: HTMLElement | null = element.parentElement;
  while (parent && parent !== iframeDoc.body && win?.getComputedStyle(parent).position === 'static') {
    parent = parent.parentElement;
  }
  const base = parent ?? iframeDoc.body;
  const baseRect = base.getBoundingClientRect();
  const baseStyle = win?.getComputedStyle(base);
  const borderLeft = parseFloat(baseStyle?.borderLeftWidth || '0') || 0;
  const borderTop = parseFloat(baseStyle?.borderTopWidth || '0') || 0;
  const rect = element.getBoundingClientRect();
  return {
    left: (rect.left - baseRect.left) / scale - borderLeft,
    top: (rect.top - baseRect.top) / scale - borderTop,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

export function prepareElementDragOrigin(
  element: HTMLElement,
  iframeDoc: Document,
  options: { convertToAbsolute: boolean }
): { left: number; top: number } {
  const win = iframeDoc.defaultView;
  const computedStyle = win?.getComputedStyle(element);
  const position = computedStyle?.position;
  const isOutOfFlow = position === 'absolute' || position === 'fixed';

  if (!isOutOfFlow) {
    if (!options.convertToAbsolute) {
      // 変換が許されていない（オートレイアウト等）。
      // 値だけ返して要素は一切触らない。
      const box = readOffsetBox(element, iframeDoc);
      return { left: box.left, top: box.top };
    }

    // 親を offsetParent に確定させてから採寸する。
    // （position:relative を入れるだけでは要素は移動しない）
    const parent = element.parentElement;
    if (parent && parent !== iframeDoc.body) {
      const parentStyle = win?.getComputedStyle(parent);
      if (parentStyle?.position === 'static') {
        capturePrestyle(parent);
        parent.style.position = 'relative';
      }
    }

    // 採寸はスタイルを書き換える前に行う（margin:0 を入れると値が変わるため）
    const { left, top, width, height } = readOffsetBox(element, iframeDoc);

    capturePrestyle(element);
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    element.style.margin = '0';
    element.style.position = 'absolute';
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    return { left, top };
  }

  // すでに絶対配置。offsetLeft/offsetTop がそのまま left/top の基準になる
  // (SVG は offset 系を持たないので矩形から割り戻す)
  const box = readOffsetBox(element, iframeDoc);
  const left = box.left;
  const top = box.top;

  // right / bottom で位置決めされている要素（例: `absolute bottom-[24px] left-[96px]`）に
  // そのまま top を書くと、top と bottom が同時に効いて「移動」ではなく「伸長」になる。
  // 対向オフセットを auto に落とし、サイズを固定してから left/top 駆動に切り替える。
  // 「right/bottom で位置決めされているか」は**指定値**で判定する。
  // computedStyle.right は left+width が決まっていれば使用値(px)を返すため、
  // それで判定すると絶対配置の全要素が該当し、クリックしただけの要素へ
  // right:auto / bottom:auto が書き込まれてしまう(=触っていないのに
  // 指紋が変わり、原本への書き戻しで幾何が焼き込まれる誤爆の原因になった)
  const hasRight =
    (element.style.right !== '' && element.style.right !== 'auto') ||
    /(^|\s)-?right-/.test(element.className);
  const hasBottom =
    (element.style.bottom !== '' && element.style.bottom !== 'auto') ||
    /(^|\s)-?bottom-/.test(element.className);
  if (hasRight || hasBottom) {
    element.style.width = `${box.width}px`;
    element.style.height = `${box.height}px`;
    if (hasRight) {
      element.style.right = 'auto';
      // インラインの auto だけでは `right-[24px]` クラスが保存HTMLに残り、
      // 再読み込み時に再びアンカーが復活してしまうためクラスごと剥がす
      removeConflictingClasses(element, 'right');
    }
    if (hasBottom) {
      element.style.bottom = 'auto';
      removeConflictingClasses(element, 'bottom');
    }
  }

  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
  return { left, top };
}

/** 群ドラッグの初期状態 */
export interface GroupDragOrigin {
  /** 実際に移動させる要素（子孫や移動不可の要素を除外済み） */
  elements: HTMLElement[];
  /** 各要素の開始座標 */
  origPositions: { left: number; top: number }[];
}

/**
 * 複数選択の群ドラッグを開始できる状態にする
 *
 * 1. 「他の選択要素の子孫」を移動対象から除外する
 *    （親と子の両方に同じ delta を足すと、子は親と一緒に動いた分と合わせて2倍動く）
 * 2. left/top で動かせない要素を除外する
 * 3. 各要素の origin を offsetLeft/offsetTop で採り、必要なら absolute へ変換する
 *
 * @returns 群移動できない場合は null（呼び出し側でヒントを出す）
 */
export function prepareElementsForGroupDrag(
  rawElements: HTMLElement[],
  iframeDoc: Document,
  layoutMode: 'absolute' | 'auto'
): GroupDragOrigin | null {
  const elementSet = new Set(rawElements);

  // 1. 祖先が同じ選択に含まれる要素を除外（子は親と一緒に動くので delta を足さない）
  const topLevel = rawElements.filter(el => {
    let parent = el.parentElement;
    while (parent) {
      if (elementSet.has(parent)) return false;
      parent = parent.parentElement;
    }
    return true;
  });

  // 2. left/top で動かせない要素を除外
  const draggable = topLevel.filter(el => canDragElementByPosition(el, iframeDoc));
  if (draggable.length === 0) return null;

  const win = iframeDoc.defaultView;
  const isComponentEditMode = iframeDoc.body.classList.contains('component-edit-mode');
  const mayConvert = layoutMode === 'absolute' && !isComponentEditMode;

  // 3. コンポーネント編集中は絶対配置へ変換できない。変換すると未選択の兄弟が
  //    空いた場所へリフローしてスライド全体が崩れる。
  //    全要素がすでにフローから外れている（absolute/fixed）なら、動かしても
  //    リフローは起きないので群移動を許可する。
  if (!mayConvert) {
    const allOutOfFlow = draggable.every(el => {
      const position = win?.getComputedStyle(el).position;
      return position === 'absolute' || position === 'fixed';
    });
    if (!allOutOfFlow) return null;
  }

  // ここでは**採寸だけ**する。mousedown の時点で絶対配置へ変換すると、
  // 選んだ要素が流れから外れて未選択の兄弟が詰め上がり、
  // 「選択しただけで位置やサイズが変わる」ように見える。
  // 変換は実際に動き始めた時点（useDragResize）で行う。
  const origPositions = draggable.map(el =>
    prepareElementDragOrigin(el, iframeDoc, { convertToAbsolute: false })
  );

  return { elements: draggable, origPositions };
}

/**
 * 要素にユニークIDを付与
 */
export function generateElementId(prefix: string = 'el'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ========================================
// マーキー選択（範囲選択）関連のユーティリティ
// ========================================

/**
 * マーキー選択ボックスを作成
 */
export function createMarqueeBox(iframeDoc: Document): HTMLDivElement {
  const box = iframeDoc.createElement('div');
  box.className = 'marquee-selection-box';
  box.style.display = 'none';
  iframeDoc.body.appendChild(box);
  return box;
}

/**
 * マーキー選択ボックスの位置・サイズを更新
 * 座標はiframe内のビューポート座標（e.clientX/e.clientY）をそのまま使用
 */
export function updateMarqueeBox(
  box: HTMLDivElement,
  startX: number,
  startY: number,
  currentX: number,
  currentY: number
): void {
  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);
  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);

  box.style.display = 'block';
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.style.width = `${width}px`;
  box.style.height = `${height}px`;
}

/**
 * マーキー選択ボックスを非表示
 */
export function hideMarqueeBox(box: HTMLDivElement): void {
  box.style.display = 'none';
}

/**
 * マーキー状態から境界座標を取得
 */
export function getMarqueeBounds(state: MarqueeState): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  return {
    left: Math.min(state.startX, state.currentX),
    top: Math.min(state.startY, state.currentY),
    right: Math.max(state.startX, state.currentX),
    bottom: Math.max(state.startY, state.currentY),
  };
}

/**
 * 要素が完全にマーキー範囲内にあるか判定
 * @param element 判定対象の要素
 * @param marquee マーキー境界（iframe内ビューポート座標）
 */
export function isElementFullyInMarquee(
  element: HTMLElement,
  marquee: { left: number; top: number; right: number; bottom: number }
): boolean {
  const rect = element.getBoundingClientRect();

  // getBoundingClientRectはビューポート座標を返す
  // マーキー境界も同じビューポート座標なので直接比較可能
  return (
    rect.left >= marquee.left &&
    rect.top >= marquee.top &&
    rect.right <= marquee.right &&
    rect.bottom <= marquee.bottom
  );
}

/**
 * マーキー範囲内の全要素のIDを取得
 */
export function findElementsInMarquee(
  iframeDoc: Document,
  marquee: { left: number; top: number; right: number; bottom: number }
): string[] {
  const selectedIds: string[] = [];
  const elements = iframeDoc.querySelectorAll('[data-element-id]');

  elements.forEach((el) => {
    const htmlEl = el as HTMLElement;
    const id = htmlEl.getAttribute('data-element-id');

    // 選択ボックスやプレビュー要素はスキップ
    if (htmlEl.classList.contains('selection-box') ||
        htmlEl.classList.contains('marquee-selection-box') ||
        htmlEl.classList.contains('drawing-preview')) {
      return;
    }

    if (id && isElementFullyInMarquee(htmlEl, marquee)) {
      selectedIds.push(id);
    }
  });

  return selectedIds;
}

/**
 * 全ての子が選択されている場合、親要素に折りたたむ
 * 選択された要素のうち、全ての直接の子が選択されている親要素を見つけて置き換える
 */
export function collapseToParentIfAllChildrenSelected(
  iframeDoc: Document,
  selectedIds: Set<string>
): string[] {
  const result = new Set(selectedIds);

  // 親子関係をマップ: parentId -> 直接の子IDの配列
  const parentChildMap = new Map<string, string[]>();

  const allElements = iframeDoc.querySelectorAll('[data-element-id]');

  allElements.forEach((el) => {
    const id = el.getAttribute('data-element-id');
    if (!id) return;

    // 直接の親（data-element-idを持つ最も近い先祖）を探す
    const parent = el.parentElement?.closest('[data-element-id]');
    if (parent) {
      const parentId = parent.getAttribute('data-element-id');
      if (parentId) {
        if (!parentChildMap.has(parentId)) {
          parentChildMap.set(parentId, []);
        }
        parentChildMap.get(parentId)!.push(id);
      }
    }
  });

  // ボトムアップで処理（葉から根へ）
  // 全ての子が選択されている親を見つけて置き換え
  let changed = true;
  while (changed) {
    changed = false;

    parentChildMap.forEach((childIds, parentId) => {
      // 親自体がすでに選択されている場合はスキップ
      if (result.has(parentId)) return;

      // 全ての子が選択されているか確認
      if (childIds.length > 0 && childIds.every(id => result.has(id))) {
        // 全ての子が選択されている → 子を削除して親を追加
        childIds.forEach(id => result.delete(id));
        result.add(parentId);
        changed = true;
      }
    });
  }

  return Array.from(result);
}
