/**
 * Editor Types - Figma-like visual editor type definitions
 */

// Tool types available in the editor
export type EditorTool =
  | 'select'      // V - Selection tool
  | 'move'        // H - Hand/pan tool
  | 'frame'       // F - Frame tool
  | 'rectangle'   // R - Rectangle shape
  | 'ellipse'     // O - Ellipse/circle shape
  | 'line'        // L - Line
  | 'arrow'       // Shift+L - Arrow line
  | 'pen'         // P - Pen tool (bezier curves)
  | 'pencil'      // Shift+P - Freehand drawing
  | 'text'        // T - Text tool
  | 'scale'       // K - Scale tool
  | 'eraser'      // E - Eraser (ペン/鉛筆ストロークを消す)
  | 'shape'       // 図形ギャラリーで選んだ図形(ドラッグでサイズ指定)
  | 'comment';    // C - コメント(紙面をドラッグして範囲を指定。クリックで点)

// Shape types that can be drawn
export type ShapeType = 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'text' | 'pen' | 'pencil' | 'frame';

// History state for undo/redo
export interface HistoryState {
  html: string;
  selectedElementId: string | null;
  timestamp: number;
}

// Editor history structure
export interface EditorHistory {
  past: HistoryState[];
  present: HistoryState;
  future: HistoryState[];
}

// Point for drawing operations
export interface PathPoint {
  x: number;
  y: number;
  pressure?: number; // For pressure-sensitive drawing
}

// Serialized element for clipboard operations
export interface SerializedElement {
  tagName: string;
  id: string;
  className: string;
  style: string;
  innerHTML: string;
  attributes: Record<string, string>;
  /**
   * コピーした時点の位置と大きさ(親の中の left/top。絶対配置の要素だけ)。
   * 器を選んで貼るとき、同じ位置に入りきるか(入らなければ中央)の判定に使う
   */
  box?: { left: number; top: number; width: number; height: number };
}

// Clipboard data structure
export interface ClipboardData {
  elements: SerializedElement[];
  offset: { x: number; y: number };
  /**
   * OSクリップボードへの書き込みが成功したか。
   * 成功していれば paste イベント側がOSクリップボード(スライド跨ぎ可)を正とし、
   * 失敗環境でのみ内部クリップボードへフォールバックする。
   * これが無いと「昔の内部コピー」と「新しいOSコピー」の区別が付かない
   */
  osWritten?: boolean;
}

// Bounding box for grouping
export interface BoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

// Drawing state during shape creation
export interface DrawingState {
  isDrawing: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  previewElement: HTMLElement | null;
  points: PathPoint[]; // For pen/pencil tools
}

// Shortcut action types
export type ShortcutAction =
  // Tool switching
  | 'select'
  | 'move'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'eraser'
  | 'pen'
  | 'pencil'
  | 'text'
  | 'frame'
  | 'scale'
  | 'comment'
  // Edit operations
  | 'undo'
  | 'redo'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'duplicate'
  | 'delete'
  // Style operations
  | 'copyStyle'
  | 'pasteStyle'
  // Grouping
  | 'group'
  | 'ungroup'
  // Selection
  | 'selectAll'
  | 'deselect'
  // 兄弟要素の巡回選択(Tab / Shift+Tab)
  | 'selectNextSibling'
  | 'selectPrevSibling'
  // Clipboard (external)
  | 'copyToFigma'
  // Zoom（実処理はエディタ側のズームAPIに委譲する）
  | 'zoomFit'
  | 'zoomActual'
  | 'zoomSelection'
  // Movement
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'moveUpLarge'
  | 'moveDownLarge'
  | 'moveLeftLarge'
  | 'moveRightLarge'
  // Resize (Figmaと同じ: Cmd+矢印=1px / Cmd+Shift+矢印=10px。→↓で広がり←↑で縮む)
  | 'resizeGrowX'
  | 'resizeShrinkX'
  | 'resizeGrowY'
  | 'resizeShrinkY'
  | 'resizeGrowXLarge'
  | 'resizeShrinkXLarge'
  | 'resizeGrowYLarge'
  | 'resizeShrinkYLarge'
  // Layer ordering
  | 'bringForward'
  | 'sendBackward'
  | 'bringToFront'
  | 'sendToBack'
  // 選択の階層移動(Figma: Enter で子へ / Shift+Enter で親へ)
  | 'selectChildren'
  | 'selectParent'
  // 整列(Figma: ⌥A/⌥D/⌥W/⌥S/⌥H/⌥V)と等間隔(⌃⌥H/⌃⌥V)
  | 'alignLeft'
  | 'alignRight'
  | 'alignTop'
  | 'alignBottom'
  | 'alignHCenter'
  | 'alignVCenter'
  | 'distributeH'
  | 'distributeV'
  // 表示/ロックの切り替え(Figma: ⌘⇧H / ⌘⇧L)
  | 'toggleHidden'
  | 'toggleLocked'
  // 数字キーで不透明度(Figma: 1=10% … 9=90%, 0=100%)
  | 'opacity1'
  | 'opacity2'
  | 'opacity3'
  | 'opacity4'
  | 'opacity5'
  | 'opacity6'
  | 'opacity7'
  | 'opacity8'
  | 'opacity9'
  | 'opacity0'
  // 文字の太字/斜体/下線を要素ごと切り替える(文字編集中はブラウザ既定に任せる)
  | 'toggleBold'
  | 'toggleItalic'
  | 'toggleUnderline'
  // 文字の大きさを 1px 上げる/下げる(Figma・PowerPoint: ⌘⇧> / ⌘⇧<)
  | 'fontSizeUp'
  | 'fontSizeDown'
  // ⌘⇧V: その場に貼る(Figma の Paste over selection)
  | 'pasteInPlace'
  // ⇧H / ⇧V: 左右反転・上下反転(Figma と同じキー)
  | 'flipH'
  | 'flipV'
  // ⌘R: レイヤー名を変える(Figma の Rename)
  | 'renameLayer'
  // ⌘\: UI を隠す / 出す(Figma の Hide/Show UI)
  | 'toggleUi'
  // ⌘⇧O: アウトライン表示(Figma の Show outlines。塗りを消して枠線だけにする)
  | 'toggleOutline';

// Shortcut callbacks interface
export type ShortcutCallbacks = Partial<Record<ShortcutAction, () => void>>;

// Editor toolbar props
export interface EditorToolbarProps {
  activeTool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  selectedCount: number;
  onGroup?: () => void;
  onUngroup?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onBringForward?: () => void;
  onSendBackward?: () => void;
  onBringToFront?: () => void;
  onSendToBack?: () => void;
  onImageUpload?: () => void;
  onAiRegenerate?: () => void;
  /** CSS変数管理ダイアログを開くコールバック */
  onOpenVariables?: () => void;
  /** CSS変数が定義されているかどうか */
  hasVariables?: boolean;
  /** コンポーネントパネルを開くコールバック */
  onOpenComponents?: () => void;
  /** コンポーネントが定義されているかどうか */
  hasComponents?: boolean;
}

// Tool configuration
export interface ToolConfig {
  id: EditorTool;
  label: string;
  shortcut: string;
  icon: string; // Lucide icon name
  group: 'selection' | 'shapes' | 'drawing' | 'text' | 'frame' | 'comment';
}

// Default tool configurations
export const TOOL_CONFIGS: ToolConfig[] = [
  { id: 'select', label: '選択・移動', shortcut: 'V', icon: 'MousePointer2', group: 'selection' },
  { id: 'scale', label: '拡大縮小', shortcut: 'K', icon: 'Scaling', group: 'selection' },
  { id: 'move', label: 'ハンド（パン）', shortcut: 'H', icon: 'Hand', group: 'selection' },
  { id: 'frame', label: 'フレーム', shortcut: 'F', icon: 'Frame', group: 'frame' },
  { id: 'rectangle', label: '長方形', shortcut: 'R', icon: 'Square', group: 'shapes' },
  { id: 'ellipse', label: '楕円', shortcut: 'O', icon: 'Circle', group: 'shapes' },
  { id: 'line', label: '直線', shortcut: 'L', icon: 'Minus', group: 'shapes' },
  { id: 'arrow', label: '矢印', shortcut: '⇧L', icon: 'ArrowRight', group: 'shapes' },
  { id: 'pen', label: 'ペン', shortcut: 'P', icon: 'Pen', group: 'drawing' },
  { id: 'pencil', label: 'フリーハンド', shortcut: '⇧P', icon: 'Pencil', group: 'drawing' },
  { id: 'text', label: 'テキスト', shortcut: 'T', icon: 'Type', group: 'text' },
  { id: 'comment', label: 'コメント（範囲を指定）', shortcut: 'C', icon: 'MessageSquare', group: 'comment' },
];

/**
 * キーボードショートカットの唯一のキーマップ。
 *
 * [移植時の修正] 以前はここ以外に
 *  - FrontendVisualEditor の window capture ハンドラ
 *  - useKeyboardShortcuts(iframeDoc) の独自 if 羅列
 * という2系統の判定が併存していて、同じキーが二重発火したり
 * （Cmd+D で複製が2個できる）、フォーカス位置で効くキーが入れ替わったりしていた。
 * ツールキー・Cmd+A・Cmd+G・ズームまで全部この表に載せ、
 * ディスパッチャ（useEditorShortcuts）1本だけがこの表を読む構成にしている。
 */
export const KEYBOARD_SHORTCUTS: Record<string, ShortcutAction> = {
  // Tool switching (single keys)
  'v': 'select',
  'k': 'scale', // 追加
  'h': 'move',
  'r': 'rectangle',
  'o': 'ellipse',
  'l': 'line',
  'shift+l': 'arrow',
  'p': 'pen',
  'e': 'eraser',
  'shift+p': 'pencil',
  't': 'text',
  'f': 'frame',
  'c': 'comment',

  // Edit operations (Cmd/Ctrl + key)
  'meta+z': 'undo',
  'ctrl+z': 'undo',
  'meta+shift+z': 'redo',
  'ctrl+shift+z': 'redo',
  'meta+y': 'redo',
  'ctrl+y': 'redo',
  'meta+c': 'copy',
  'ctrl+c': 'copy',
  'meta+x': 'cut',
  'ctrl+x': 'cut',
  'meta+v': 'paste',
  'ctrl+v': 'paste',
  'meta+d': 'duplicate',
  'ctrl+d': 'duplicate',
  'delete': 'delete',
  'backspace': 'delete',

  // Style operations
  'meta+alt+c': 'copyStyle',
  'ctrl+alt+c': 'copyStyle',
  'meta+alt+v': 'pasteStyle',
  'ctrl+alt+v': 'pasteStyle',

  // Grouping
  'meta+g': 'group',
  'ctrl+g': 'group',
  'meta+shift+g': 'ungroup',
  'ctrl+shift+g': 'ungroup',

  // Selection
  'meta+a': 'selectAll',
  'ctrl+a': 'selectAll',
  'escape': 'deselect',
  // Tab で兄弟要素を順に選ぶ(Figma準拠)。ブラウザ既定のフォーカス移動より
  // キャンバス上の選択移動のほうが期待される操作なので、こちらへ割り当てる
  'tab': 'selectNextSibling',
  'shift+tab': 'selectPrevSibling',

  // Movement (arrow keys)
  // リサイズ(Cmd/Ctrl+矢印)。→↓で広がり、←↑で縮む
  'meta+arrowright': 'resizeGrowX',
  'ctrl+arrowright': 'resizeGrowX',
  'meta+arrowleft': 'resizeShrinkX',
  'ctrl+arrowleft': 'resizeShrinkX',
  'meta+arrowdown': 'resizeGrowY',
  'ctrl+arrowdown': 'resizeGrowY',
  'meta+arrowup': 'resizeShrinkY',
  'ctrl+arrowup': 'resizeShrinkY',
  'meta+shift+arrowright': 'resizeGrowXLarge',
  'ctrl+shift+arrowright': 'resizeGrowXLarge',
  'meta+shift+arrowleft': 'resizeShrinkXLarge',
  'ctrl+shift+arrowleft': 'resizeShrinkXLarge',
  'meta+shift+arrowdown': 'resizeGrowYLarge',
  'ctrl+shift+arrowdown': 'resizeGrowYLarge',
  'meta+shift+arrowup': 'resizeShrinkYLarge',
  'ctrl+shift+arrowup': 'resizeShrinkYLarge',
  'arrowup': 'moveUp',
  'arrowdown': 'moveDown',
  'arrowleft': 'moveLeft',
  'arrowright': 'moveRight',
  'shift+arrowup': 'moveUpLarge',
  'shift+arrowdown': 'moveDownLarge',
  'shift+arrowleft': 'moveLeftLarge',
  'shift+arrowright': 'moveRightLarge',

  // Figma形式でコピー
  'meta+shift+c': 'copyToFigma',
  'ctrl+shift+c': 'copyToFigma',

  // Zoom（Figma準拠: 0=全体表示 / 1=100% / 2=選択範囲にズーム）
  'meta+0': 'zoomFit',
  'ctrl+0': 'zoomFit',
  'meta+1': 'zoomActual',
  'ctrl+1': 'zoomActual',
  'meta+2': 'zoomSelection',
  'ctrl+2': 'zoomSelection',

  // Layer ordering
  'meta+]': 'bringForward',
  'ctrl+]': 'bringForward',
  'meta+[': 'sendBackward',
  'ctrl+[': 'sendBackward',
  'meta+shift+]': 'bringToFront',
  'ctrl+shift+]': 'bringToFront',
  'meta+shift+[': 'sendToBack',
  'ctrl+shift+[': 'sendToBack',
  // Figma の Mac 割り当ては ⌥⌘] / ⌥⌘[(Windows は Ctrl+Shift+] / [)。
  // ⌘⇧] / ⌘⇧[ は PowerPoint(Mac) と同じなので両方残す
  'meta+alt+]': 'bringToFront',
  'meta+alt+[': 'sendToBack',

  // 選択の階層移動(Figma: Enter=子を選ぶ / Shift+Enter=親を選ぶ)
  'enter': 'selectChildren',
  'shift+enter': 'selectParent',

  // 整列(Figma: Alt+A/D/W/S/H/V)。Mac の Option 併用で e.key が特殊文字になっても
  // useEditorShortcuts の keyFromCode が event.code から引き直す
  'alt+a': 'alignLeft',
  'alt+d': 'alignRight',
  'alt+w': 'alignTop',
  'alt+s': 'alignBottom',
  'alt+h': 'alignHCenter',
  'alt+v': 'alignVCenter',
  // 等間隔。Figma は Mac ⌃⌥H / ⌃⌥V、Windows Alt+Shift+H / V(記憶にもとづく・未確認)。
  // ⌃⌥V は Windows の「スタイルをペースト」(Ctrl+Alt+V)と同じキーになるので、縦は ⇧⌥V に寄せ、横も揃えて ⇧⌥H を持つ
  'ctrl+alt+h': 'distributeH',
  'shift+alt+h': 'distributeH',
  'shift+alt+v': 'distributeV',

  // 表示/ロック(Figma: ⌘⇧H / ⌘⇧L)
  'meta+shift+h': 'toggleHidden',
  'ctrl+shift+h': 'toggleHidden',
  'meta+shift+l': 'toggleLocked',
  'ctrl+shift+l': 'toggleLocked',

  // 不透明度(Figma: 1〜9 で 10〜90%、0 で 100%)
  '1': 'opacity1',
  '2': 'opacity2',
  '3': 'opacity3',
  '4': 'opacity4',
  '5': 'opacity5',
  '6': 'opacity6',
  '7': 'opacity7',
  '8': 'opacity8',
  '9': 'opacity9',
  '0': 'opacity0',

  // 文字の書式(要素を選んだ状態で要素全体に効かせる。編集中は横取りしない)
  'meta+b': 'toggleBold',
  'ctrl+b': 'toggleBold',
  'meta+i': 'toggleItalic',
  'ctrl+i': 'toggleItalic',
  'meta+u': 'toggleUnderline',
  'ctrl+u': 'toggleUnderline',

  // 文字の大きさ。US 配列の Shift+. は '>'、Shift+, は '<'。配列で e.key が違うときは code から引く('.' / ',')
  'meta+shift+>': 'fontSizeUp',
  'meta+shift+.': 'fontSizeUp',
  'ctrl+shift+>': 'fontSizeUp',
  'ctrl+shift+.': 'fontSizeUp',
  'meta+shift+<': 'fontSizeDown',
  'meta+shift+,': 'fontSizeDown',
  'ctrl+shift+<': 'fontSizeDown',
  'ctrl+shift+,': 'fontSizeDown',

  'meta+shift+v': 'pasteInPlace',
  'ctrl+shift+v': 'pasteInPlace',

  'shift+h': 'flipH',
  'shift+v': 'flipV',
  'meta+r': 'renameLayer',
  'ctrl+r': 'renameLayer',
  'meta+\\': 'toggleUi',
  'ctrl+\\': 'toggleUi',
  'meta+shift+o': 'toggleOutline',
  'ctrl+shift+o': 'toggleOutline',
};

// Movement amounts in pixels
export const MOVEMENT_AMOUNTS = {
  normal: 1,
  large: 10,
};

// Maximum history stack size
export const MAX_HISTORY_SIZE = 50;

// Debounce delay for history saves (ms)
export const HISTORY_DEBOUNCE_MS = 300;

// Image fill modes (Figma-like)
export type ImageFillMode =
  | 'fill'      // 塗り - 要素全体を埋める（アスペクト比無視）
  | 'fit'       // 自動 - アスペクト比維持で収める（contain）
  | 'crop'      // トリミング - アスペクト比維持で埋める（cover）
  | 'tile';     // タイル - 繰り返し

// Image fill settings
export interface ImageFillSettings {
  url: string;
  mode: ImageFillMode;
  opacity: number; // 0-100
  position: {
    x: number; // -100 to 100 (percentage offset)
    y: number; // -100 to 100 (percentage offset)
  };
  scale: number; // 1-500 (percentage)
  rotation: number; // 0-360 degrees
}

// Element fill type
export type FillType = 'solid' | 'image' | 'gradient' | 'none';

// Element fill settings
export interface ElementFill {
  type: FillType;
  color?: string; // for solid
  image?: ImageFillSettings; // for image
  gradient?: {
    type: 'linear' | 'radial';
    angle: number;
    stops: Array<{ color: string; position: number }>;
  }; // for gradient
}

// Default image fill settings
export const DEFAULT_IMAGE_FILL: ImageFillSettings = {
  url: '',
  mode: 'crop',
  opacity: 100,
  position: { x: 0, y: 0 },
  scale: 100,
  rotation: 0,
};

// Default shape styles
export const DEFAULT_SHAPE_STYLES = {
  rectangle: {
    backgroundColor: '#3B82F6',
    borderRadius: '4px',
  },
  ellipse: {
    backgroundColor: '#3B82F6',
    borderRadius: '50%',
  },
  line: {
    stroke: '#1F2937',
    strokeWidth: 2,
  },
  arrow: {
    stroke: '#1F2937',
    strokeWidth: 2,
  },
  text: {
    fontSize: '16px',
    color: '#1F2937',
    fontFamily: 'inherit',
  },
  frame: {
    backgroundColor: 'transparent',
    border: '1px dashed #9CA3AF',
  },
  pen: {
    stroke: '#1F2937',
    strokeWidth: 2,
    fill: 'none',
  },
  pencil: {
    stroke: '#1F2937',
    strokeWidth: 2,
    fill: 'none',
  },
  scale: {},
};
