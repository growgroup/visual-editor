/**
 * フロントエンドエディタの型定義
 * (スライド、ページ、コンポーネント等で共用)
 */

// 再エクスポート（既存の型）
export type {
  EditorTool,
  SerializedElement,
  ClipboardData,
  DrawingState,
  BoundingBox,
  EditorToolbarProps,
} from '../types/editor';

export { DEFAULT_SHAPE_STYLES, MOVEMENT_AMOUNTS, TOOL_CONFIGS } from '../types/editor';

// DOMツリーノード
export interface DOMTreeNode {
  id: string;
  tagName: string;
  className: string;
  text: string;
  children: DOMTreeNode[];
  visible: boolean;
  depth: number;
  /** コンポーネントインスタンスID (該当する場合) */
  componentInstanceId?: string;
  /** マスターコンポーネントID (該当する場合) */
  masterComponentId?: string;
}

// 選択された要素の情報
export interface SelectedElementInfo {
  id: string;
  tagName: string;
  text: string;
  // Typography
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  textAlign: string;
  textDecoration: string;
  fontStyle: string;
  color: string;
  // Layout
  x: number;
  y: number;
  width: number;
  height: number;
  widthAuto: boolean;  // width: auto かどうか
  heightAuto: boolean; // height: auto かどうか
  rotation: number;
  // Transform (flip)
  scaleX: number;      // 1 or -1 (horizontal flip)
  scaleY: number;      // 1 or -1 (vertical flip)
  // Padding
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingLinked: boolean; // すべてのpaddingが同じかどうか
  // Margin
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  // Background
  backgroundColor: string;
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  backgroundRepeat: string;
  opacity: number;
  // Image fill settings
  hasBackgroundImage: boolean;
  imageFillMode: ImageFillMode;
  imagePositionX: number;
  imagePositionY: number;
  imageScale: number;
  // Border
  borderWidth: number;
  borderColor: string;
  borderStyle: string;
  borderRadius: number;
  borderRadiusTopLeft: number;
  borderRadiusTopRight: number;
  borderRadiusBottomRight: number;
  borderRadiusBottomLeft: number;
  // Shadow
  boxShadow: string;
  hasShadow: boolean;
  shadowX: number;
  shadowY: number;
  shadowBlur: number;
  shadowSpread: number;
  shadowColor: string;
  // Filter effects
  filter: string;
  filterBlur: number;        // blur(Xpx)
  filterBrightness: number;  // brightness(X)
  filterContrast: number;    // contrast(X)
  filterGrayscale: number;   // grayscale(X)
  filterSaturate: number;    // saturate(X)
  filterSepia: number;       // sepia(X)
  filterHueRotate: number;   // hue-rotate(Xdeg)
  filterInvert: number;      // invert(X)
  mixBlendMode: string;
  // Backdrop filter
  backdropFilter: string;
  backdropBlur: number;      // backdrop-filter: blur(Xpx)
  // Overflow
  overflow: string;          // visible, hidden, scroll, auto
  // Transform settings
  transformOrigin: string;   // transform-origin
  // Auto Layout (Flexbox) settings
  display: string;           // block, flex, grid
  flexDirection: string;     // row, column, row-reverse, column-reverse
  flexWrap: string;          // nowrap, wrap, wrap-reverse
  justifyContent: string;    // flex-start, center, flex-end, space-between, space-around, space-evenly
  alignItems: string;        // flex-start, center, flex-end, stretch, baseline
  gap: number;               // gap between items
  // Child flex properties
  flexGrow: number;          // flex-grow
  flexShrink: number;        // flex-shrink
  flexBasis: string;         // flex-basis (auto, px, %)
  alignSelf: string;         // auto, flex-start, center, flex-end, stretch
  // CSS Grid properties
  gridTemplateColumns: string;  // grid-template-columns
  gridTemplateRows: string;     // grid-template-rows
  gridGap: number;              // gap (for grid)
  gridRowGap: number;           // row-gap
  gridColumnGap: number;        // column-gap
  gridAutoFlow: string;         // grid-auto-flow: row, column, dense
  gridAutoRows: string;         // grid-auto-rows
  gridAutoColumns: string;      // grid-auto-columns
  justifyItems: string;         // justify-items: start, center, end, stretch
  alignContent: string;         // align-content: start, center, end, stretch, space-between, space-around
  // Child grid properties
  gridColumn: string;           // grid-column (e.g., "1 / 3", "span 2")
  gridRow: string;              // grid-row (e.g., "1 / 2", "span 2")
  gridColumnStart: number;      // grid-column-start
  gridColumnEnd: number;        // grid-column-end
  gridRowStart: number;         // grid-row-start
  gridRowEnd: number;           // grid-row-end
  justifySelf: string;          // justify-self: start, center, end, stretch
  // Parent Layout context
  parentDisplay: string;     // 親要素のdisplayプロパティ
  parentFlexDirection: string; // 親要素のflex-direction
  // Link properties (for <a> tags)
  isLink: boolean;
  /** [移植時の追加] <img>要素のsrc(画像差し替えUI用) */
  imageSrc?: string;           // この要素またはその親が<a>タグかどうか
  linkHref: string;          // href属性値
  linkTarget: string;        // target属性値 (_self, _blank, _parent, _top)
  linkTitle: string;         // title属性値
  // CSS Variable references (raw inline style values if they contain var())
  rawWidth?: string;          // width (e.g., "var(--spacing-lg)")
  rawHeight?: string;         // height
  rawMinWidth?: string;       // min-width(サイズ欄の最小・最大。指定が無ければ undefined)
  rawMaxWidth?: string;       // max-width
  rawMinHeight?: string;      // min-height
  rawMaxHeight?: string;      // max-height
  rawPaddingTop?: string;     // padding-top
  rawPaddingRight?: string;   // padding-right
  rawPaddingBottom?: string;  // padding-bottom
  rawPaddingLeft?: string;    // padding-left
  rawMarginTop?: string;      // margin-top
  rawMarginRight?: string;    // margin-right
  rawMarginBottom?: string;   // margin-bottom
  rawMarginLeft?: string;     // margin-left
  rawBackgroundColor?: string; // background-color (e.g., "var(--color-primary)")
  rawColor?: string;          // color (text color)
  rawBorderColor?: string;    // border-color
  // Additional CSS Variable references
  rawBorderRadius?: string;   // border-radius
  rawBorderTopLeftRadius?: string;
  rawBorderTopRightRadius?: string;
  rawBorderBottomLeftRadius?: string;
  rawBorderBottomRightRadius?: string;
  rawOpacity?: string;        // opacity
  rawFontSize?: string;       // font-size
  rawLineHeight?: string;     // line-height
  rawLetterSpacing?: string;  // letter-spacing
  rawBorderWidth?: string;    // border-width
  rawGap?: string;            // gap (flexbox/grid)
  rawLeft?: string;           // left (position)
  rawTop?: string;            // top (position)
}

// 画像フィルモード
export type ImageFillMode = 'fill' | 'fit' | 'crop' | 'tile';

// プロパティパネルのセクション開閉状態
export interface PanelSections {
  position: boolean;    // 位置: 配置、XY座標、回転
  layout: boolean;      // レイアウト: オートレイアウト、サイズ、クリッピング
  appearance: boolean;  // 外見: 不透明度、角丸
  image: boolean;
  typography: boolean;
  link: boolean;        // リンク設定（<a>タグ）
  fill: boolean;
  stroke: boolean;
  effects: boolean;
}

/**
 * スタイルクリップボード（Figmaライクなスタイルコピー&ペースト用）
 * 位置・サイズ以外のスタイルプロパティを保持
 */
export interface StyleClipboard {
  // タイポグラフィ
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  lineHeight?: string;
  letterSpacing?: string;
  textAlign?: string;
  textDecoration?: string;
  fontStyle?: string;
  color?: string;

  // 背景・塗り
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
  opacity?: number;

  // ボーダー
  borderWidth?: number;
  borderColor?: string;
  borderStyle?: string;
  borderRadius?: number;
  borderRadiusTopLeft?: number;
  borderRadiusTopRight?: number;
  borderRadiusBottomRight?: number;
  borderRadiusBottomLeft?: number;

  // シャドウ
  boxShadow?: string;

  // フィルター
  filter?: string;
  mixBlendMode?: string;
  backdropFilter?: string;

  // パディング
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;

  // Flexbox（オートレイアウト）
  display?: string;
  flexDirection?: string;
  flexWrap?: string;
  justifyContent?: string;
  alignItems?: string;
  gap?: number;
}

// エディタのメッセージタイプ
export type EditorMessageType =
  | 'SLIDE_CONTENT_CHANGED'
  | 'ELEMENT_SELECTED'
  | 'ELEMENT_DESELECTED'
  | 'TOOL_FINISHED'
  | 'DOM_TREE_UPDATED';

// エディタのメッセージ
export interface EditorMessage {
  type: EditorMessageType;
  html?: string;
  element?: SelectedElementInfo;
  tree?: DOMTreeNode[];
}

// ドラッグ状態
export interface DragState {
  element: HTMLElement | null;
  elements: HTMLElement[]; // 複数選択時のドラッグ用
  startX: number;
  startY: number;
  origLeft: number;
  origTop: number;
  origPositions: { left: number; top: number }[]; // 複数選択時の元位置
  isDragging: boolean;
  hasMoved: boolean;
  // Flex reorder mode (auto-layout)
  flexReorderMode: boolean;
  flexParent: HTMLElement | null;
  originalIndex: number;
  targetIndex: number;
  // Enhanced auto-layout drag (hierarchy change support)
  autoLayoutDragMode: boolean;      // オートレイアウトドラッグモード
  dragGhost: HTMLElement | null;    // ドラッグゴースト（カーソル追従する縮小コピー）
  originalParent: HTMLElement | null; // ドラッグ元の親要素
  currentDropTarget: HTMLElement | null; // 現在のドロップターゲット
  dropPosition: 'before' | 'after' | 'inside' | null; // ドロップ位置
  dropIndex: number;                // ドロップ先のインデックス
}

// リサイズ状態
export interface ResizeState {
  isResizing: boolean;
  isRotating: boolean; // 回転モード
  element: HTMLElement | null;
  elements: HTMLElement[]; // 複数選択時の対象要素
  handle: string;
  startX: number;
  startY: number;
  origLeft: number;
  origTop: number;
  origWidth: number;
  origHeight: number;
  origRadius: number;
  // 複数選択時のバウンディングボックスと各要素の初期状態
  selectionBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
    right: number;
    bottom: number;
  } | null;
  origElementStates: {
    left: number;
    top: number;
    width: number;
    height: number;
  }[];
  // Scale Tool用状態
  origScaleX: number;
  origScaleY: number;
  rotation: number;
  // 回転用状態
  rotationStartAngle: number;
  centerX: number;
  centerY: number;
}

// 要素キャプチャ（絶対配置変換用）
export interface ElementCapture {
  element: HTMLElement;
  rect: DOMRect;
  parent: HTMLElement | null;
  parentRect: DOMRect | null;
  computedStyle: CSSStyleDeclaration;
  parentComputedStyle: CSSStyleDeclaration | null;
  // 拡張情報（改善版変換用）
  originalTransform?: string;      // 元のtransform
  scale?: number;                  // iframeのズームスケール
  /** 変換前の style 属性(自己検証で崩れを検知したとき巻き戻すため) */
  prevStyle?: string | null;
}

// FrontendVisualEditorのProps
export interface FrontendVisualEditorProps {
  html: string;
  /** コンテンツID（スライドID、ページID等） */
  contentId?: string;
  /** 親ID（プレゼンテーションID、プロジェクトID等） */
  parentId?: string;
  /** @deprecated Use contentId instead */
  slideId?: string;
  /** @deprecated Use parentId instead */
  presentationId?: string;
  onSave: (html: string) => Promise<void>;
  onClose: () => void;
}

/** @deprecated Use FrontendVisualEditorProps instead */
export type SlideVisualEditorProps = FrontendVisualEditorProps;

// マーキー選択（範囲選択）の状態
export interface MarqueeState {
  isActive: boolean;
  startX: number;  // キャンバス座標
  startY: number;
  currentX: number;
  currentY: number;
}
