'use client';

/**
 * EditorLayerPanel - レイヤーパネル
 *
 * Phase 2: パフォーマンス最適化
 * - LayerTreeItemコンポーネントを抽出してメモ化
 * - renderTreeNodeをuseCallbackでメモ化
 */

import React, { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import { Input } from '../../components/ui/input';
import { ScrollArea } from '../../components/ui/scroll-area';
import {
  Search,
  Layers,
  ChevronRight,
  ChevronDown,
  Presentation,
  ArrowUpRight,
} from 'lucide-react';
import { useEditorContext, type ContentListItem } from '../EditorContext';
import { computeContentDepths } from '../contexts/EditorArtboardContext';
import { useElementActions } from '../hooks/useElementActions';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { refreshSelectionOverlay, buildDomTree } from '../utils/dom-utils';
import { extractElementInfo } from '../utils/style-utils';
import type { DOMTreeNode } from '../types';
import { LayerTreeItem, type LayerKind } from './LayerTreeItem';

// ========================================
// レイヤー名の生成
// ========================================
//
// なぜ実 DOM から作るか:
// buildDomTree が持たせる className は「先頭のクラス1個だけ」で、このプロジェクトの
// スライドは Tailwind ユーティリティ（absolute / flex / mt-[22px] …）なので、
// 先頭クラスは中身を一切説明しない。text も 20 文字で切られ「...」が焼き込まれている。
// そのため名前はレイヤーツリーのノードではなく iframe 内の実要素から作る。

interface LayerLabel {
  name: string;
  kind: LayerKind;
}

/** コンテナ系タグの日本語名。中身が空でも「何の入れ物か」は分かるようにする */
const SEMANTIC_CONTAINER_NAMES: Record<string, { name: string; kind: LayerKind }> = {
  section: { name: 'セクション', kind: 'group' },
  header: { name: 'ヘッダー', kind: 'group' },
  footer: { name: 'フッター', kind: 'group' },
  nav: { name: 'ナビゲーション', kind: 'group' },
  main: { name: 'メイン', kind: 'group' },
  aside: { name: 'サイド', kind: 'group' },
  article: { name: '記事', kind: 'group' },
  figure: { name: '図版', kind: 'group' },
  figcaption: { name: '図版キャプション', kind: 'text' },
  form: { name: 'フォーム', kind: 'group' },
  ul: { name: 'リスト', kind: 'list' },
  ol: { name: '番号リスト', kind: 'list' },
  dl: { name: '定義リスト', kind: 'list' },
  li: { name: 'リスト項目', kind: 'list' },
  table: { name: 'テーブル', kind: 'table' },
  thead: { name: 'テーブル見出し', kind: 'table' },
  tbody: { name: 'テーブル本体', kind: 'table' },
  tr: { name: 'テーブル行', kind: 'table' },
  td: { name: 'セル', kind: 'table' },
  th: { name: '見出しセル', kind: 'table' },
};

/**
 * 表示幅に収まるところで切る。
 * パネル幅は 200〜400px で、階層インデントとアイコンに 60〜100px 取られるため、
 * 24 文字を超えると右端のタグ名が見切れる。全文は行の title 属性で読める。
 */
const LABEL_MAX = 24;

function truncateLabel(text: string, max = LABEL_MAX): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

/** 直下のテキストノードだけを拾う（子要素のテキストは含めない） */
function getOwnText(el: HTMLElement): string {
  let text = '';
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) text += n.textContent ?? '';
  });
  return text.replace(/\s+/g, ' ').trim();
}

/** src からファイル名だけを取り出す */
function fileNameFromSrc(src: string): string {
  try {
    const path = src.split('?')[0].split('#')[0];
    const name = path.substring(path.lastIndexOf('/') + 1);
    return decodeURIComponent(name);
  } catch {
    return '';
  }
}

/**
 * 実要素からレイヤー行に出す名前と種別を作る。
 *
 * 優先順位:
 *  1. 明示的な名前（data-layer-name / data-name / aria-label）
 *  2. メディア・フォーム要素の固有情報（alt、ファイル名、placeholder）
 *  3. 自分が直接持っているテキスト（見出し・本文・ボタン文言）
 *  4. 入れ物としての意味（セクション/リスト/テーブル…）や中身のテキスト
 *  5. 中身のない装飾要素（罫線・シェイプ）
 */
function buildLayerLabel(el: HTMLElement): LayerLabel {
  const tag = el.tagName.toLowerCase();

  // 1. 明示的な名前が付いていればそれが最優先
  const explicit =
    el.getAttribute('data-layer-name') ||
    el.getAttribute('data-name') ||
    el.getAttribute('aria-label');
  if (explicit && explicit.trim()) {
    return { name: truncateLabel(explicit), kind: tag === 'img' ? 'image' : 'group' };
  }

  // 2. メディア・フォーム
  if (tag === 'img') {
    const alt = el.getAttribute('alt')?.trim();
    const file = fileNameFromSrc(el.getAttribute('src') ?? '');
    return { name: truncateLabel(alt || file || '画像'), kind: 'image' };
  }
  if (tag === 'svg' || tag === 'use' || tag === 'path') {
    return { name: 'アイコン', kind: 'icon' };
  }
  if (tag === 'video' || tag === 'iframe' || tag === 'canvas') {
    return { name: tag === 'video' ? '動画' : tag === 'iframe' ? '埋め込み' : 'キャンバス', kind: 'image' };
  }
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const ph =
      el.getAttribute('placeholder')?.trim() ||
      (el as HTMLInputElement).value?.trim() ||
      el.getAttribute('type')?.trim() ||
      '入力';
    return { name: truncateLabel(ph), kind: 'input' };
  }
  if (tag === 'hr') {
    return { name: '区切り線', kind: 'line' };
  }

  // 3. 自分が直接持っているテキスト
  const ownText = getOwnText(el);
  if (ownText) {
    if (tag === 'button' || el.getAttribute('role') === 'button') {
      return { name: truncateLabel(ownText), kind: 'button' };
    }
    if (tag === 'a') {
      return { name: truncateLabel(ownText), kind: 'link' };
    }
    if (/^h[1-6]$/.test(tag)) {
      return { name: truncateLabel(ownText), kind: 'heading' };
    }
    return { name: truncateLabel(ownText), kind: 'text' };
  }

  const childElementCount = el.children.length;
  const allText = (el.textContent ?? '').replace(/\s+/g, ' ').trim();

  // 4. 入れ物
  if (childElementCount > 0) {
    const semantic = SEMANTIC_CONTAINER_NAMES[tag];

    // 中の見出しがこの入れ物の名前。
    // textContent をそのまま使うと、大きな入れ物ほど中身の連結になり
    // 「よくあるご質問English協力会会員…」のような、どこにも存在しない
    // 文字列が名前になってしまう（先頭24文字で切れるので余計に読めない）
    const heading = el.querySelector('h1, h2, h3, h4, h5, h6');
    const headingText = (heading?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (headingText) {
      return { name: truncateLabel(headingText), kind: semantic ? semantic.kind : 'group' };
    }

    // 見出しが無くても、全体が切らずに収まる短さなら中身の文言で呼べる
    // （ボタン列・キャプション・小さなカードなど）
    if (allText && allText.length <= LABEL_MAX) {
      return { name: allText, kind: semantic ? semantic.kind : 'group' };
    }

    if (semantic) return semantic;
    return { name: `グループ (${childElementCount})`, kind: 'group' };
  }

  // 5. 中身のない要素 = 罫線か装飾シェイプ
  const semanticEmpty = SEMANTIC_CONTAINER_NAMES[tag];
  if (semanticEmpty) return semanticEmpty;

  // offsetWidth/Height はズーム（transform: scale）の影響を受けない実寸なので、
  // 倍率を変えても罫線判定がぶれない
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if ((h > 0 && h <= 4) || (w > 0 && w <= 4)) {
    return { name: '区切り線', kind: 'line' };
  }

  const bg = el.ownerDocument?.defaultView?.getComputedStyle(el).backgroundImage;
  if (bg && bg !== 'none') {
    return { name: '背景画像', kind: 'image' };
  }

  return { name: 'シェイプ', kind: 'shape' };
}

/** 実要素が取れなかったときの保険（ツリーの情報だけで作る） */
function fallbackLabel(node: DOMTreeNode): LayerLabel {
  if (node.text) return { name: truncateLabel(node.text), kind: 'text' };
  return { name: node.tagName, kind: 'group' };
}

// ========================================
// レイヤー行ホバー → キャンバス側ハイライト
// ========================================
//
// キャンバス側の .hover-preview（クリック予告の輪郭）は使い回さない。
// あちらは useIframeSetup が「自分が付けた1要素」を内部に記憶して付け替えるため、
// 外から一括で外すと、あちらの記憶とズレて輪郭が出なくなる（他人の機能を壊す）。
// こちらは独立した属性を使い、毎回「全部外して1個だけ付ける」ので取り残しが起きない。
const LAYER_HOVER_ATTR = 'data-layer-hover';
const LAYER_HOVER_STYLE_ID = 'editor-layer-hover-style';
const LAYER_HOVER_CSS = `
[${LAYER_HOVER_ATTR}="true"] {
  box-shadow:
    inset 0 0 0 9999px rgba(13, 153, 255, 0.10),
    0 0 0 2px rgba(13, 153, 255, 0.55) !important;
}
`;

/** iframe 内にハイライト用スタイルを1度だけ差し込む */
function ensureLayerHoverStyle(doc: Document) {
  if (doc.getElementById(LAYER_HOVER_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = LAYER_HOVER_STYLE_ID;
  style.textContent = LAYER_HOVER_CSS;
  (doc.head || doc.documentElement).appendChild(style);
}

/** ハイライトを掃除してから1要素だけに付け直す */
function applyLayerHover(doc: Document, elementId: string | null) {
  doc
    .querySelectorAll(`[${LAYER_HOVER_ATTR}]`)
    .forEach((el) => el.removeAttribute(LAYER_HOVER_ATTR));
  if (!elementId) return;
  ensureLayerHoverStyle(doc);
  const el = doc.querySelector(`[data-element-id="${elementId}"]`);
  el?.setAttribute(LAYER_HOVER_ATTR, 'true');
}

/**
 * メモ化されたスライドサムネイルコンポーネント
 * 大きなHTMLをレンダリングするため、パフォーマンス最適化が重要
 */
const ContentThumbnail = memo(function ContentThumbnail({ 
  html, 
  slideNumber 
}: { 
  html?: string; 
  slideNumber: number;
}) {
  if (!html) {
    return (
      <div className="w-full h-full flex items-center justify-center text-[8px] text-gray-400 bg-[#2c2c2c]">
        {slideNumber}
      </div>
    );
  }
  
return (
    <div className="w-full h-full overflow-hidden relative bg-white">
      <iframe
        srcDoc={html}
        title={`Thumbnail for slide ${slideNumber}`}
        style={{
          width: '4000%', // 100% / 0.025
          height: '4000%',
          transform: 'scale(0.025)',
          transformOrigin: 'top left',
          border: 'none',
          pointerEvents: 'none',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
        tabIndex={-1}
        sandbox="allow-scripts"
      />
    </div>
  );
});

/**
 * メモ化されたスライドリストアイテム
 */
const ContentListItemComponent = memo(function ContentListItemComponent({
  slide,
  isCurrent,
  depth = 0,
  onClick,
}: {
  slide: ContentListItem;
  isCurrent: boolean;
  /** 階層の深さ(parentId から)。段を付ける */
  depth?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full px-2 py-1.5 flex items-center gap-2 text-xs transition-colors
        ${isCurrent 
          ? 'bg-[#0d99ff]/20 text-[#4fb8ff] border-l-2 border-[#0d99ff]' 
          : 'text-gray-400 hover:bg-[#2c2c2c] border-l-2 border-transparent'
        }
      `}
      style={depth > 0 ? { paddingLeft: 8 + depth * 14 } : undefined}
      data-depth={depth}
      disabled={isCurrent}
      title={slide.title || `スライド ${slide.order}`}
    >

      
      {/* スライド情報 */}
      <div className="flex-1 min-w-0 text-left">
        <div className="truncate font-medium">
          {slide.order}. {slide.title || '無題'}
        </div>
      </div>
      
      {/* カレント表示 */}
      {isCurrent && (
        <span className="text-[10px] px-1 py-0.5 bg-[#0d99ff]/30 rounded text-[#7cc4ff]">
          編集中
        </span>
      )}
    </button>
  );
});

/**
 * メモ化されたスライドリスト
 */
const ContentList = memo(function ContentList({
  slides,
  currentContentId,
  onContentClick,
}: {
  slides: ContentListItem[];
  currentContentId: string | null;
  onContentClick: (slideId: string) => void;
}) {
  const depths = useMemo(() => computeContentDepths(slides), [slides]);
  return (
    <>
      {slides.map((slide) => (
        <ContentListItemComponent
          key={slide.id}
          slide={slide}
          depth={depths.get(slide.id) ?? 0}
          isCurrent={slide.id === currentContentId}
          onClick={() => onContentClick(slide.id)}
        />
      ))}
    </>
  );
});

/**
 * 左パネル: スライドリスト + レイヤー/DOMツリー（Figmaライク）
 *
 * hideSlideList を立てると全スライドの一覧を出さず、編集中ページのレイヤーだけを出す。
 * 上段にプレビュー付きのページ切替(PagesPanel)を置く2段構成では、
 * ページの並びは上段が担うので、ここで同じ一覧を繰り返さない。
 */
export function EditorLayerPanel({ hideSlideList = false }: { hideSlideList?: boolean } = {}) {
  const {
    selectedElement,
    setSelectedElement,
    selectedElementIds,
    setSelectedElementIds,
    domTree,
    expandedNodes,
    setExpandedNodes,
    setDomTree,
    getIframeDoc,
    notifyIframeChange,
    // スライドリスト
    slides,
    currentContentId,
    onContentChange,
  } = useEditorContext();

  const [contentListExpanded, setContentListExpanded] = useState(true);
  // 階層(parentId)の深さ。一覧に段を付ける
  const slideDepths = useMemo(() => computeContentDepths(slides), [slides]);
  // 各スライドのツリー展開状態（スライドID → 展開状態）
  const [slideTreeExpanded, setSlideTreeExpanded] = useState<Map<string, boolean>>(new Map());

  // リサイズ可能なパネル
  const { width, isDragging, resizeHandleProps } = useResizablePanel({
    initialWidth: 256, // w-64 = 16rem = 256px
    minWidth: 200,
    maxWidth: 400,
    direction: 'right', // 右端をドラッグしてリサイズ
    storageKey: 'editor-layer-panel-width',
  });

  const {
    deleteElement,
    duplicateElement,
    bringForward,
    sendBackward,
    bringToFront,
    sendToBack,
    copyStyle,
    pasteStyle,
    hasStyleInClipboard,
  } = useElementActions();

  const [searchQuery, setSearchQuery] = useState('');
  // レイヤー行にカーソルがある要素
  const [rowHoverId, setRowHoverId] = useState<string | null>(null);
  // キャンバス側でホバー中の要素（.hover-preview から拾う）
  const [canvasHoverId, setCanvasHoverId] = useState<string | null>(null);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<'before' | 'after' | 'inside' | null>(null);
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // ノードからルートまでのパスを取得
  const findPathToNode = useCallback((nodes: DOMTreeNode[], targetId: string, path: string[] = []): string[] | null => {
    for (const node of nodes) {
      if (node.id === targetId) {
        return path;
      }
      if (node.children.length > 0) {
        const foundPath = findPathToNode(node.children, targetId, [...path, node.id]);
        if (foundPath) return foundPath;
      }
    }
    return null;
  }, []);

  // 選択された要素が変わったときに自動的にレイヤーを展開・スクロール
  useEffect(() => {
    if (!selectedElement?.id) return;

    // 親ノードを全て展開
    const path = findPathToNode(domTree, selectedElement.id);
    if (path && path.length > 0) {
      setExpandedNodes(prev => {
        const next = new Set(prev);
        path.forEach(id => next.add(id));
        return next;
      });
    }

    // 少し遅延してからスクロール（展開アニメーション後）
    setTimeout(() => {
      const nodeElement = nodeRefs.current.get(selectedElement.id);
      if (nodeElement) {
        nodeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 100);
  }, [selectedElement?.id, domTree, findPathToNode, setExpandedNodes]);

  /**
   * レイヤー名のテーブル（要素ID → 表示名・種別）。
   * domTree が作り直されたら（＝DOM が変わったら）作り直す。
   * labelKey は「名前そのものが変わったか」を子行に伝えるためのキー。
   * テキストを編集しても domTree の構造キーは変わらないので、
   * 名前の中身から作らないと memo に弾かれて古い名前が残る。
   */
  const { labelMap, labelKey } = useMemo(() => {
    const map = new Map<string, LayerLabel>();
    const iframeDoc = getIframeDoc();

    // 実要素を1回の querySelectorAll でまとめて引く（ノードごとの検索より速い）
    const elementById = new Map<string, HTMLElement>();
    if (iframeDoc) {
      iframeDoc.querySelectorAll('[data-element-id]').forEach((el) => {
        const id = el.getAttribute('data-element-id');
        if (!id) return;
        // 選択枠のパンくず(.element-breadcrumb)は、指している実要素と同じ
        // data-element-id を持つ(押すとその要素へ移るため)。文書順では実要素より
        // 後ろに来るので素直に拾うと実要素を上書きし、要素を1つ選んだ瞬間に
        // レイヤー名が軒並みタグ名("div")へ化ける
        if ((el as HTMLElement).closest('.selection-box, .marquee-selection-box')) return;
        elementById.set(id, el as HTMLElement);
      });
    }

    const walk = (nodes: DOMTreeNode[]) => {
      for (const node of nodes) {
        const el = elementById.get(node.id);
        map.set(node.id, el ? buildLayerLabel(el) : fallbackLabel(node));
        if (node.children.length > 0) walk(node.children);
      }
    };
    walk(domTree);

    let key = '';
    map.forEach((value, id) => {
      key += `${id}:${value.name}:${value.kind}|`;
    });

    return { labelMap: map, labelKey: key };
  }, [domTree, getIframeDoc]);

  // 検索にマッチするノードをフィルタ
  const filteredDomTree = useMemo(() => {
    if (!searchQuery.trim()) return domTree;

    const query = searchQuery.toLowerCase();
    const filterNodes = (nodes: DOMTreeNode[]): DOMTreeNode[] => {
      return nodes.reduce<DOMTreeNode[]>((acc, node) => {
        // 画面に出ている名前でも引けるようにする（見えている文字で検索できないと
        // 「検索したのに出ない」という無反応になる）
        const label = labelMap.get(node.id)?.name ?? '';
        const matches =
          label.toLowerCase().includes(query) ||
          node.tagName.toLowerCase().includes(query) ||
          node.className.toLowerCase().includes(query) ||
          node.text.toLowerCase().includes(query);

        const filteredChildren = filterNodes(node.children);

        if (matches || filteredChildren.length > 0) {
          acc.push({
            ...node,
            children: filteredChildren,
          });
        }

        return acc;
      }, []);
    };

    return filterNodes(domTree);
  }, [domTree, searchQuery]);

  // ノードの展開/折りたたみ（旧API互換用、handleToggleExpandを推奨）
  const toggleExpand = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, [setExpandedNodes]);

  // DOMツリーをフラット化して取得（表示順）
  const flattenDomTree = useCallback((nodes: DOMTreeNode[], result: DOMTreeNode[] = []): DOMTreeNode[] => {
    for (const node of nodes) {
      // 親ノードが閉じている場合は子を含めない場合はここを調整するが、
      // 範囲選択は「見えている」ノード間で行うのが一般的。
      // ここでは単純化のため全ノードを対象とするか、expandedNodes を考慮するか。
      // Figmaライクにするなら、ツリー構造上の順序でフラット化する。
      result.push(node);
      if (node.children.length > 0 && expandedNodes.has(node.id)) {
        flattenDomTree(node.children, result);
      }
    }
    return result;
  }, [expandedNodes]);

  // 選択状態をiframeと同期（複数選択対応）
  const updateSelection = useCallback((newSelectedIds: string[]) => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    // 既存の選択解除
    iframeDoc.querySelectorAll('.selected').forEach(e => e.classList.remove('selected'));
    
    // 新しい選択適用
    const selectedElements: HTMLElement[] = [];
    newSelectedIds.forEach(id => {
      const el = iframeDoc.querySelector(`[data-element-id="${id}"]`) as HTMLElement;
      if (el) {
        el.classList.add('selected');
        selectedElements.push(el);
      }
    });

    // 選択ボックス更新（最後の要素または複数要素の境界ボックス）
    if (selectedElements.length > 0) {
      // 最後の要素を基準にpostMessage（プロパティパネル表示用）
      // 複数選択時は共通プロパティを表示するか、最後の要素を表示するか。
      // ここでは最後の要素（フォーカス要素）を使用
      const primaryElement = selectedElements[selectedElements.length - 1];
      const primaryId = newSelectedIds[newSelectedIds.length - 1];
      
      // 選択セット全体から枠を作り直す。
      // 従来は代表1要素分の枠しか作らなかったため、レイヤーパネルで複数選択しても
      // 枠が1個しか出ず、そのままドラッグすると枠が取り残されていた。
      // refreshSelectionOverlay は複数選択時に群バウンディングボックスも描く。
      refreshSelectionOverlay(iframeDoc);

      // プロパティパネル更新用のメッセージ送信
      // extractElementInfoを使用して全プロパティ（isLink等含む）を取得
      const elementInfo = extractElementInfo(primaryElement, iframeDoc);
      if (elementInfo) {
        window.postMessage({
          type: 'ELEMENT_SELECTED',
          element: elementInfo,
        }, '*');
      }
    } else {
      // 選択解除（枠は全て削除する。querySelector 単数だと1個しか消えない）
      refreshSelectionOverlay(iframeDoc);
      window.postMessage({ type: 'SELECTION_CLEARED' }, '*');
    }
  }, [getIframeDoc]);

  // ノードクリックハンドラ
  const handleNodeClick = useCallback((e: React.MouseEvent | React.KeyboardEvent, nodeId: string) => {
    e.stopPropagation(); // バブリング防止

    let newSelectedIds: string[] = [];

    if (e.metaKey || e.ctrlKey) {
      // Cmd/Ctrl: トグル選択
      if (selectedElementIds.includes(nodeId)) {
        newSelectedIds = selectedElementIds.filter(id => id !== nodeId);
      } else {
        newSelectedIds = [...selectedElementIds, nodeId];
      }
    } else if (e.shiftKey && selectedElementIds.length > 0) {
      // Shift: 範囲選択
      const flatNodes = flattenDomTree(domTree);
      const lastSelectedId = selectedElementIds[selectedElementIds.length - 1];
      
      const startIdx = flatNodes.findIndex(n => n.id === lastSelectedId);
      const endIdx = flatNodes.findIndex(n => n.id === nodeId);
      
      if (startIdx !== -1 && endIdx !== -1) {
        const minIdx = Math.min(startIdx, endIdx);
        const maxIdx = Math.max(startIdx, endIdx);
        
        // 既存の選択を維持しつつ、範囲を追加
        // 単純な範囲選択なら既存をクリアして範囲だけにするのが一般的だが、
        // ユーザー体験的には「最後」から「現在」までの範囲を選択状態にする。
        // ここではFigma式に、Shiftクリックは「アンカーからクリック位置までを排他的に選択」ではなく、
        // 「追加範囲選択」とするか、「純粋な範囲選択（他は解除）」とするか。
        // 一般的にはShiftは「範囲選択」で、既存選択は解除されることが多い（エクスプローラー等）。
        // ただし、Ctrl+Clickとの組み合わせもある。
        // ここでは「範囲選択」として実装（既存選択はクリアせず統合する場合はSetを使う）
        
        const rangeIds = flatNodes.slice(minIdx, maxIdx + 1).map(n => n.id);
        // 今回はShiftクリックは「既存選択をリセットして範囲選択」ではなく「既存に追加」ではなく...
        // 多くのアプリ: Shift+Clickは単一選択モードからの拡張。
        // ここでは「前回の選択位置からここまで」を選択に追加する形にします。
        // ただし、もしCmdキーが押されてなければリセット？
        // 複雑さを避けるため、「前回の選択要素」と「今回の要素」の間の範囲を、現在の選択に追加する（Setで重複排除）
        
        const currentSet = new Set(selectedElementIds);
        rangeIds.forEach(id => currentSet.add(id));
        newSelectedIds = Array.from(currentSet);
      } else {
        newSelectedIds = [nodeId];
      }
    } else {
      // 修飾キーなし: 単一選択
      newSelectedIds = [nodeId];
    }

    setSelectedElementIds(newSelectedIds);
    // 単一要素の情報も更新（後方互換性のため）
    if (newSelectedIds.length === 1) {
       // updateSelection内で処理されるためここではIDのみセット
    } else if (newSelectedIds.length === 0) {
       setSelectedElement(null);
    }
    
    // 実際にiframe側を更新
    updateSelection(newSelectedIds);
    
    // primaryElementを設定（プロパティパネル用、最後の選択要素）
    if (newSelectedIds.length > 0) {
      const lastId = newSelectedIds[newSelectedIds.length - 1];
      // setSelectedElement は updateSelection 内の postMessage で受け取った側で処理されるか、
      // ここで明示的に呼ぶ必要があるか確認。
      // useEditorHistoryフックなどが iframe からのメッセージを受け取って setSelectedElement しているなら任せる。
      // しかし、EditorLayerPanel から直接操作しているので、ここで呼ぶのが確実。
      // ただし、SelectedElementInfo を構築するのは大変なので、iframe 側のロジック（updateSelection）に任せるのが良い。
      // updateSelection は postMessage を送るだけで、EditorContext の setSelectedElement を呼んでいない？
      // EditorContext 側で message event listener があるはず。
    }

  }, [selectedElementIds, flattenDomTree, domTree, setSelectedElementIds, setSelectedElement, updateSelection]);



  // ドラッグ開始
  const handleDragStart = useCallback((e: React.DragEvent, nodeId: string) => {
    e.dataTransfer.setData('text/plain', nodeId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedNodeId(nodeId);
  }, []);

  // ドラッグオーバー
  const handleDragOver = useCallback((e: React.DragEvent, nodeId: string, rect: DOMRect) => {
    e.preventDefault();
    e.stopPropagation();

    if (draggedNodeId === nodeId) return;

    const y = e.clientY - rect.top;
    const height = rect.height;

    // 上1/4: before, 下1/4: after, 中央: inside
    if (y < height * 0.25) {
      setDragOverPosition('before');
    } else if (y > height * 0.75) {
      setDragOverPosition('after');
    } else {
      setDragOverPosition('inside');
    }

    setDragOverNodeId(nodeId);
  }, [draggedNodeId]);

  // ドラッグリーブ
  const handleDragLeave = useCallback(() => {
    setDragOverNodeId(null);
    setDragOverPosition(null);
  }, []);

  // ドロップ
  const handleDrop = useCallback((e: React.DragEvent, targetNodeId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const sourceNodeId = e.dataTransfer.getData('text/plain');
    if (!sourceNodeId || sourceNodeId === targetNodeId) {
      setDraggedNodeId(null);
      setDragOverNodeId(null);
      setDragOverPosition(null);
      return;
    }

    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    const sourceEl = iframeDoc.querySelector(`[data-element-id="${sourceNodeId}"]`) as HTMLElement;
    const targetEl = iframeDoc.querySelector(`[data-element-id="${targetNodeId}"]`) as HTMLElement;

    if (!sourceEl || !targetEl) return;

    // ドロップ位置に応じて要素を移動
    switch (dragOverPosition) {
      case 'before':
        targetEl.parentElement?.insertBefore(sourceEl, targetEl);
        break;
      case 'after':
        targetEl.parentElement?.insertBefore(sourceEl, targetEl.nextSibling);
        break;
      case 'inside':
        targetEl.appendChild(sourceEl);
        break;
    }

    // DOMツリーを再構築
    const newTree = buildDomTree(iframeDoc);
    setDomTree(newTree);

    // 変更を通知（履歴に保存）
    notifyIframeChange();

    setDraggedNodeId(null);
    setDragOverNodeId(null);
    setDragOverPosition(null);
  }, [dragOverPosition, getIframeDoc, setDomTree, notifyIframeChange]);

  // ドラッグ終了
  const handleDragEnd = useCallback(() => {
    setDraggedNodeId(null);
    setDragOverNodeId(null);
    setDragOverPosition(null);
  }, []);

  // 要素の表示/非表示切り替え（旧API互換用）
  const toggleVisibility = useCallback((nodeId: string) => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    const el = iframeDoc.querySelector(`[data-element-id="${nodeId}"]`) as HTMLElement;
    if (!el) return;

    if (el.style.visibility === 'hidden') {
      el.style.visibility = '';
      el.style.opacity = '';
    } else {
      el.style.visibility = 'hidden';
      el.style.opacity = '0';
    }
    notifyIframeChange();
  }, [getIframeDoc, notifyIframeChange]);

  // 要素がコンテキストメニューで操作対象として選択されたときに実際に選択状態にする
  const selectForContextMenu = useCallback((nodeId: string) => {
    // コンテキストメニュー用は単一選択にする
    const newSelectedIds = [nodeId];
    setSelectedElementIds(newSelectedIds);
    updateSelection(newSelectedIds);
  }, [setSelectedElementIds, updateSelection]);

  // useCallback化されたハンドラー（LayerTreeItem用）
  const handleToggleExpand = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, [setExpandedNodes]);

  const handleToggleVisibility = useCallback((nodeId: string) => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    const el = iframeDoc.querySelector(`[data-element-id="${nodeId}"]`) as HTMLElement;
    if (!el) return;

    if (el.style.visibility === 'hidden') {
      el.style.visibility = '';
      el.style.opacity = '';
    } else {
      el.style.visibility = 'hidden';
      el.style.opacity = '0';
    }
    notifyIframeChange();
  }, [getIframeDoc, notifyIframeChange]);

  // hiddenNodesの計算（メモ化）
  const hiddenNodes = useMemo(() => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return new Set<string>();

    const hidden = new Set<string>();
    const checkHidden = (nodes: DOMTreeNode[]) => {
      for (const node of nodes) {
        const el = iframeDoc.querySelector(`[data-element-id="${node.id}"]`) as HTMLElement | null;
        if (el?.style.visibility === 'hidden') {
          hidden.add(node.id);
        }
        if (node.children.length > 0) {
          checkHidden(node.children);
        }
      }
    };
    checkHidden(domTree);
    return hidden;
  }, [domTree, getIframeDoc]);

  // ========================================
  // ホバー連動（レイヤー ⇄ キャンバス）
  // ========================================

  const handleRowMouseEnter = useCallback((nodeId: string) => {
    setRowHoverId(nodeId);
  }, []);

  const handleRowMouseLeave = useCallback(() => {
    setRowHoverId(null);
  }, []);

  // レイヤー行 → キャンバス。掃除してから1個だけ付けるので取り残しが起きない
  useEffect(() => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;
    applyLayerHover(iframeDoc, rowHoverId);
  }, [rowHoverId, getIframeDoc]);

  // スライドを切り替えたらホバー状態は無効なので捨てる
  useEffect(() => {
    setRowHoverId(null);
    setCanvasHoverId(null);
  }, [currentContentId]);

  // アンマウント時にキャンバス側のハイライトを残さない
  useEffect(() => {
    return () => {
      const iframeDoc = getIframeDoc();
      if (iframeDoc) applyLayerHover(iframeDoc, null);
    };
  }, [getIframeDoc]);

  // キャンバス → レイヤー行。
  // キャンバス側は useIframeSetup が「クリックしたら選ばれる要素」に .hover-preview を
  // 1個だけ付けている。イベント購読順に依存しないよう、その *結果* を MutationObserver で拾う。
  // rAF は iframe 側の window で取るため、取り消しも同じ window で行う必要がある
  // （親 window の cancelAnimationFrame に他 window の id を渡すと無関係な処理を止めうる）
  const hoverObserverRef = useRef<{
    doc: Document;
    observer: MutationObserver;
    win: Window;
  } | null>(null);
  const hoverRafRef = useRef<number | null>(null);

  useEffect(() => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;
    // 同じドキュメントに対しては貼り直さない（domTree 更新のたびの付け外しを避ける）
    if (hoverObserverRef.current?.doc === iframeDoc) return;

    hoverObserverRef.current?.observer.disconnect();

    const win = iframeDoc.defaultView ?? window;
    const read = () => {
      hoverRafRef.current = null;
      const previewed = iframeDoc.querySelector('.hover-preview');
      const id = previewed?.getAttribute('data-element-id') ?? null;
      // 値が変わらないなら state を触らない。
      // class 変化は選択やドラッグでも毎フレーム飛んでくるため、
      // ここで止めないと全行の memo を無意味に破り続ける。
      setCanvasHoverId((prev) => (prev === id ? prev : id));
    };

    const observer = new MutationObserver(() => {
      if (hoverRafRef.current !== null) return;
      hoverRafRef.current = win.requestAnimationFrame(read);
    });

    observer.observe(iframeDoc.body, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true,
    });
    hoverObserverRef.current = { doc: iframeDoc, observer, win };
    read();
  }, [getIframeDoc, currentContentId, domTree]);

  // アンマウント時のみ購読解除
  useEffect(() => {
    return () => {
      const current = hoverObserverRef.current;
      current?.observer.disconnect();
      if (hoverRafRef.current !== null) {
        current?.win.cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
      hoverObserverRef.current = null;
    };
  }, []);

  // 行のハイライト対象。レイヤー行のホバーを優先する
  const effectiveHoverId = rowHoverId ?? canvasHoverId;
  const hoverKey = effectiveHoverId ?? '';

  // hasStyleInClipboardの値（メモ化）
  const styleInClipboard = useMemo(() => hasStyleInClipboard(), [hasStyleInClipboard]);

  // 選択状態のキー（子要素の再レンダリングをトリガーするため）
  const selectionKey = useMemo(() => selectedElementIds.join(','), [selectedElementIds]);

  // 展開状態のキー（子要素の再レンダリングをトリガーするため）
  const expandedKey = useMemo(() => Array.from(expandedNodes).sort().join(','), [expandedNodes]);

  // DOMツリーの変更を検知するキー（新要素の再レンダリングをトリガーするため）
  const domTreeKey = useMemo(() => {
    const collectIds = (nodes: DOMTreeNode[]): string => {
      return nodes.map(n => `${n.id}:${n.children.length}${collectIds(n.children)}`).join('|');
    };
    return collectIds(domTree);
  }, [domTree]);

  // DOMツリーノードをレンダリング（LayerTreeItemを使用）
  const renderTreeNode = useCallback((node: DOMTreeNode, depth: number = 0) => {
    const isExpanded = expandedNodes.has(node.id);
    // [選択の一致] 元は `selectedElementIds ? A : B` だったが、配列は空でも truthy なので
    // B（selectedElement によるフォールバック）が永久に死んでいた。
    // かといって単純な OR にすると、キャンバスで別要素を選び直した直後に
    // 古い selectedElement が残っていて2行が同時に青くなる（実測）。
    // ids がある間は ids を正とし、ids が空のときだけ selectedElement を見る。
    const isSelected =
      selectedElementIds.length > 0
        ? selectedElementIds.includes(node.id)
        : selectedElement?.id === node.id;
    const isDragging = draggedNodeId === node.id;
    const isDragOver = dragOverNodeId === node.id;
    const isHidden = hiddenNodes.has(node.id);
    const label = labelMap.get(node.id) ?? fallbackLabel(node);

    return (
      <LayerTreeItem
        key={node.id || `node-${depth}-${node.tagName}`}
        node={node}
        depth={depth}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isDragging={isDragging}
        isDragOver={isDragOver}
        dragOverPosition={isDragOver ? dragOverPosition : null}
        isHidden={isHidden}
        hasStyleInClipboard={styleInClipboard}
        label={label.name}
        kind={label.kind}
        isHovered={effectiveHoverId === node.id}
        selectionKey={selectionKey}
        expandedKey={expandedKey}
        hoverKey={hoverKey}
        labelKey={labelKey}
        onToggleExpand={handleToggleExpand}
        onToggleVisibility={handleToggleVisibility}
        onNodeClick={handleNodeClick}
        onRowMouseEnter={handleRowMouseEnter}
        onRowMouseLeave={handleRowMouseLeave}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
        onSelectForContextMenu={selectForContextMenu}
        onDuplicate={duplicateElement}
        onCopyStyle={copyStyle}
        onPasteStyle={pasteStyle}
        onBringToFront={bringToFront}
        onBringForward={bringForward}
        onSendBackward={sendBackward}
        onSendToBack={sendToBack}
        onDelete={deleteElement}
        nodeRef={(ref) => {
          if (ref) nodeRefs.current.set(node.id, ref);
          else nodeRefs.current.delete(node.id);
        }}
        renderChildren={() => (
          <>
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
          </>
        )}
      />
    );
  }, [
    expandedNodes,
    selectedElementIds,
    selectedElement?.id,
    draggedNodeId,
    dragOverNodeId,
    dragOverPosition,
    hiddenNodes,
    styleInClipboard,
    labelMap,
    labelKey,
    effectiveHoverId,
    hoverKey,
    selectionKey,
    expandedKey,
    handleToggleExpand,
    handleToggleVisibility,
    handleNodeClick,
    handleRowMouseEnter,
    handleRowMouseLeave,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    selectForContextMenu,
    duplicateElement,
    copyStyle,
    pasteStyle,
    bringToFront,
    bringForward,
    sendBackward,
    sendToBack,
    deleteElement,
  ]);

  // スライドクリック時のハンドラ
  const handleContentClick = useCallback((slideId: string) => {
    if (onContentChange && slideId !== currentContentId) {
      onContentChange(slideId);
    }
  }, [onContentChange, currentContentId]);

  // スライドツリーの展開/折りたたみ
  const toggleSlideTreeExpanded = useCallback((slideId: string) => {
    setSlideTreeExpanded(prev => {
      const next = new Map(prev);
      const current = next.get(slideId) ?? true; // デフォルトは展開
      next.set(slideId, !current);
      return next;
    });
  }, []);

  // スライドのDOMツリーを取得
  const getSlideTree = useCallback((slideId: string): DOMTreeNode[] => {
    if (slideId === currentContentId) {
      // 現在のスライドはdomTreeを使用
      return domTree;
    }
    // 他のスライドはツリーを表示しない（切り替え後に表示される）
    return [];
  }, [currentContentId, domTree]);

  return (
    <div
      className="ed-layer-panel min-h-0 flex-1 bg-[#2c2c2c] flex flex-col relative"
      // 2段構成(ページ+レイヤー)に埋め込まれているときは幅を親(LeftPanel)が持つ。
      // ここで固定幅を持つと上下の段で幅が食い違い、リサイズも二重になる
      style={hideSlideList ? { width: '100%' } : { width: `${width}px` }}
      // 行の onMouseLeave だけだと、行から一気にパネル外へ抜けたときに
      // ハイライトが残ることがあるので、パネル自体でも確実に消す
      onMouseLeave={handleRowMouseLeave}
    >
      {/* リサイズハンドル(埋め込み時は親のハンドルに任せる) */}
      {!hideSlideList && <div {...resizeHandleProps} />}

      {/* ドラッグ中のオーバーレイ（スムーズな操作のため） */}
      {isDragging && (
        <div className="fixed inset-0 z-50 cursor-col-resize" />
      )}

      {/* 検索バー */}
      <div className="p-2 border-b border-[#444444]">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="文字や要素名で検索"
            aria-label="レイヤーを検索"
            className="h-8 text-xs pl-7 bg-[#383838] border-[#444444] text-white placeholder:text-gray-500"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-1">
          {/* 全スライド/ページをツリー構造で表示 */}
          {!hideSlideList && slides.length > 0 ? (
            slides.map((slide, index) => {
              const isActive = slide.id === currentContentId;
              const depth = slideDepths.get(slide.id) ?? 0;
              const isTreeExpanded = slideTreeExpanded.get(slide.id) ?? isActive;
              const slideTree = searchQuery ?
                // 検索時は該当スライドのフィルタ済みツリーを表示
                (isActive ? filteredDomTree : []) :
                getSlideTree(slide.id);

              return (
                <div key={slide.id} className="mb-1" data-depth={depth}>
                  {/* スライドヘッダー(階層があれば深さぶん段を付ける) */}
                  <div
                    className={`flex items-center gap-1 py-1 px-1 rounded cursor-pointer text-xs transition-colors ${
                      isActive
                        ? 'bg-[#0d99ff]/20 text-[#4fb8ff] border-l-2 border-[#0d99ff]'
                        : 'text-gray-300 hover:bg-[#444444] border-l-2 border-transparent'
                    }`}
                    style={depth > 0 ? { marginLeft: depth * 14 } : undefined}
                    onClick={() => handleContentClick(slide.id)}
                  >
                    {/* 展開/折りたたみボタン */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSlideTreeExpanded(slide.id);
                      }}
                      className={`p-0.5 rounded ${isActive ? 'hover:bg-[#0d99ff]/30' : 'hover:bg-gray-600'}`}
                    >
                      {isTreeExpanded ? (
                        <ChevronDown className="w-3 h-3" />
                      ) : (
                        <ChevronRight className="w-3 h-3" />
                      )}
                    </button>

                    <Presentation className={`w-3.5 h-3.5 ${isActive ? 'text-[#4fb8ff]' : 'text-gray-500'}`} />

                    <span className="font-medium truncate flex-1">
                      {index + 1}. {slide.title || '無題'}
                    </span>

                    {isActive && (
                      <span className="text-[10px] px-1 py-0.5 bg-[#0d99ff]/30 rounded text-[#7cc4ff] flex-shrink-0">
                        編集中
                      </span>
                    )}
                    {slide.href && (
                      <a
                        href={slide.href}
                        target="_blank"
                        rel="noreferrer"
                        className="ed-icon-button !h-5 !w-5 flex-shrink-0 opacity-60 hover:opacity-100"
                        title="別タブで開く(編集しない表示)"
                        aria-label={`${slide.title || '無題'} を別タブで開く`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ArrowUpRight className="w-3 h-3" />
                      </a>
                    )}
                  </div>

                  {/* スライドのDOMツリー */}
                  {isTreeExpanded && (
                    <div className="ml-2 mt-0.5">
                      {slideTree.length > 0 ? (
                        slideTree.map((node) => renderTreeNode(node, 1))
                      ) : (
                        <div className="text-[10px] text-gray-500 py-1 pl-4">
                          {searchQuery ? '検索結果なし' : 'コンテンツなし'}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            // スライドがない場合は従来のレイヤー表示
            <>
              <p className="px-3 py-2 text-xs text-gray-400">クリックで選択・ドラッグで並べ替え</p>
              {filteredDomTree.length > 0 ? (
                filteredDomTree.map((node) => renderTreeNode(node))
              ) : (
                <div className="text-xs text-gray-500 text-center py-4">
                  {searchQuery ? '一致する要素がありません。別の言葉でお試しください。' : 'このページには編集できる要素がありません。'}
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
