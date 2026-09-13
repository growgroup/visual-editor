/**
 * スライドエディタの定数定義
 */

// スライドの基準サイズ（16:9）
export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;

// Webページの基準サイズ（フルハイト対応）
export const WEBPAGE_WIDTH = 1440;
export const WEBPAGE_MIN_HEIGHT = 900; // 最小高さ

// レスポンシブブレイクポイントプリセット（webpageモード用）
export const BREAKPOINT_PRESETS = [
  { id: 'default', name: 'デフォルト', width: 1400, icon: 'monitor', minRange: 1190, maxRange: 1920 },
  { id: 'small', name: 'スモール', width: 1140, icon: 'laptop', minRange: 990, maxRange: 1189 },
  { id: 'tablet', name: 'タブレット', width: 840, icon: 'tablet', minRange: 690, maxRange: 989 },
  { id: 'mobile', name: 'モバイル', width: 540, icon: 'mobile', minRange: 400, maxRange: 689 },
  { id: 'mini', name: 'ミニ', width: 320, icon: 'mobile-small', minRange: 0, maxRange: 399 },
] as const;

export type BreakpointPreset = typeof BREAKPOINT_PRESETS[number];
export type BreakpointId = BreakpointPreset['id'];
export type BreakpointIcon = BreakpointPreset['icon'];

// フォントファミリーリスト
export const FONT_FAMILIES = [
  { value: 'Noto Sans JP', label: 'Noto Sans JP' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Helvetica', label: 'Helvetica' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Courier New', label: 'Courier New' },
  { value: 'Verdana', label: 'Verdana' },
  { value: 'system-ui', label: 'System UI' },
] as const;

// フォントウェイトリスト
export const FONT_WEIGHTS = [
  { value: '100', label: 'Thin (100)' },
  { value: '200', label: 'Extra Light (200)' },
  { value: '300', label: 'Light (300)' },
  { value: '400', label: 'Regular (400)' },
  { value: '500', label: 'Medium (500)' },
  { value: '600', label: 'Semi Bold (600)' },
  { value: '700', label: 'Bold (700)' },
  { value: '800', label: 'Extra Bold (800)' },
  { value: '900', label: 'Black (900)' },
] as const;

// ボーダースタイルリスト
export const BORDER_STYLES = [
  { value: 'none', label: 'なし' },
  { value: 'solid', label: '実線' },
  { value: 'dashed', label: '破線' },
  { value: 'dotted', label: '点線' },
] as const;

// 画像フィルモードリスト
export const IMAGE_FILL_MODES = [
  { value: 'fill', label: '塗り（アスペクト比無視）' },
  { value: 'fit', label: '自動（収める）' },
  { value: 'crop', label: 'トリミング（埋める）' },
  { value: 'tile', label: 'タイル（繰り返し）' },
] as const;

// デフォルトのシャドウ設定
export const DEFAULT_SHADOW = {
  color: 'rgba(0, 0, 0, 0.25)',
  x: 4,
  y: 4,
  blur: 10,
  spread: 0,
} as const;

// マーキー選択のドラッグ閾値（クリックとドラッグを区別）
export const MARQUEE_DRAG_THRESHOLD = 5;

// プロパティパネルのデフォルト開閉状態
export const DEFAULT_PANEL_SECTIONS = {
  layout: true,
  position: true,
  appearance: true,
  image: true,
  typography: true,
  link: true,
  fill: true,
  stroke: false,
  effects: false,
} as const;

// エディタ内のiframeに注入するスタイル
export const EDITOR_IFRAME_STYLES = `
  html, body {
    touch-action: none !important;
    overscroll-behavior: none !important;
    -webkit-text-size-adjust: none !important;
  }
  body {
    background-color: transparent !important;
    overflow: hidden !important; /* スクロールバー非表示 */
  }
  [data-editable="true"] {
    outline: 2px solid transparent;
    outline-offset: 0px;
    transition: outline-color 0.15s ease;
    cursor: pointer;
    /* [移植時の修正] min-height:1em は罫線(h-px)や細い装飾要素を
       16px相当に膨らませて表示が崩れるため撤去。代わりに空要素だけ
       選択しやすい最小高さを与える(:empty かつ高さ指定なしのもの) */
  }
  [data-editable="true"]:empty:not([style*="height"]):not([class*="h-"]) {
    min-height: 1em;
  }
  /*
   * [選択セマンティクスの一本化] ホバー輪郭は CSS の :hover をやめる。
   * :hover はカーソル下の「祖先チェーン全体」に当たるため、緑カードの上では
   * 実測5本の輪郭が同時に出ていた。クリックで選ばれるのは最外の1つだけなので、
   * 輪郭がクリック結果の予告になっていなかった。
   * どの要素に付けるかは JS 側（useIframeSetup の hover mousemove）が
   * クリックとまったく同じ resolver で決め、.hover-preview を1要素だけに付け替える。
   * [暫定] 見た目の最終定義は item4 が上書きする前提の値。
   */
  /*
   * [ホバーと選択の描き分け]
   * ホバー = 「いまクリックしたら選ばれる要素」の予告なので、細く・淡く。
   * 選択  = 2px の実線 + ハンドル（.selection-outline / .resize-handle）。
   * 以前は両方とも 2px #0d99ff で、選択中かホバー中かが判別できなかった。
   * 太さだけだと既定ズーム(51%)では 1px と 2px の差が画面上 0.5px しかないため、
   * 色も変えて区別する。太さは --overlay-scale でズーム非依存にしている。
   */
  /*
   * !important を付けるのは、スライド側が Tailwind の outline 系ユーティリティを
   * 持っている場合に「同じ詳細度で後から読み込まれた側」に負けて、
   * ホバー予告が黒い太線になってしまうのを防ぐため。
   * 直後の .selected も !important なので、選択中の要素にカーソルが乗ったときは
   * （後勝ちで）選択枠だけが出る。
   */
  [data-editable="true"].hover-preview {
    outline: calc(1px * var(--overlay-scale, 1)) solid #66c0ff !important;
    outline-offset: 0px !important;
  }
  [data-editable="true"].selected {
    outline: none !important;
    cursor: move;
  }
  /* 編集中の目印に背景色を敷いてはいけない。要素自身の塗り(ラベルの緑など)を
     上書きしてしまい、編集を始めた瞬間に色が消える。目印は下の .editing の
     outline が担う */
  [data-editable="true"].editing {
    cursor: text !important;
  }
  [data-editable="true"].dragging {
    opacity: 0.7;
    cursor: grabbing !important;
  }
  ::selection {
    background-color: rgba(13, 153, 255, 0.3);
  }
  body.move-mode {
    cursor: grab !important;
  }
  body.move-mode:active {
    cursor: grabbing !important;
  }
  body.move-mode [data-editable="true"] {
    pointer-events: none;
  }
  /* トリミング中: エディタの選択枠を隠す(操作はcrop-modeが持つ) */
  body.gg-cropping .selection-box {
    display: none !important;
  }

  body.draw-mode {
    cursor: crosshair !important;
  }
  body.draw-mode [data-editable="true"] {
    pointer-events: none;
  }
  body.text-mode {
    cursor: text !important;
  }
  body.text-mode [data-editable="true"] {
    pointer-events: none;
  }
  body:not(.draw-mode):not(.text-mode):not(.move-mode) [data-editable="true"] {
    pointer-events: auto !important;
    cursor: pointer;
  }
  .drawing-preview {
    position: absolute;
    pointer-events: none;
    opacity: 0.7;
    border: 2px dashed #0d99ff;
    background-color: rgba(13, 153, 255, 0.1);
  }
  .drawing-preview.ellipse {
    border-radius: 50%;
  }
  .drawing-preview.frame {
    border: 2px dashed #9CA3AF;
    background-color: transparent;
  }
  .drawing-preview svg {
    overflow: visible;
  }
  /* ==========================================================
   * 選択オーバーレイ（枠 / ハンドル / 当たり判定）
   * ==========================================================
   * [なぜ CSS変数でズームを打ち消すか]
   * オーバーレイは #artboard の中に置かれるので #artboard-wrapper の
   * transform: scale() を要素と一緒に受ける。8px 固定にすると既定ズーム(51%)では
   * 画面上 4.1px しか無く、掴み代として成立しない（実測: NEハンドル 4.08px）。
   * dom-utils の applyOverlayScale() が <html> に
   *   --overlay-scale = 1 / zoom
   * を書き込み、すべての寸法にこれを掛けることで「画面上の実寸」を一定にする。
   * 変数が未設定でも壊れないよう既定値 1 をフォールバックに持たせる。
   *
   * [なぜ見た目と当たり判定を分けるか]
   * 見た目 8px のままでは掴みにくく、逆にハンドルを大きく描くと紙面が見えない。
   * そこで .resize-handle 自体を「透明な12px の当たり判定」にし、
   * 見える四角は ::after で描く。
   * ハンドルを子要素にせず疑似要素にしているのは、mousedown 側
   * (useElementSelection / useIframeInitializer / MultiPageCanvasView) が
   * e.target の data-handle を「直接」読む実装で、子要素だと属性が取れず
   * 無反応になるため。
   *
   * [z-index について]
   * .selection-box は position:absolute + z-index を持つので stacking context に
   * なる。中の 10001 は「箱の中の順序」でしかなく、以前は追加順で
   * 角丸ハンドルが NE を完全に覆っていた（実測: NE中心の elementFromPoint が
   * border-radius-handle を返す）。順序を明示的な値で固定する:
   *   角/中点ハンドル 30 > 辺の帯 20 > 角丸 10 > 回転 5
   */
  .selection-box {
    position: absolute;
    pointer-events: none;
    z-index: 10000;
    /* 画面上の実寸(px) → CSS px 換算値 */
    --ov: var(--overlay-scale, 1);
    --handle-visual: calc(8px * var(--ov));   /* 見える四角 8px */
    --handle-hit: calc(12px * var(--ov));     /* 掴み代 12px */
    --handle-hit-half: calc(6px * var(--ov));
    --edge-hit: calc(8px * var(--ov));        /* 辺の帯 8px */
    --edge-hit-half: calc(4px * var(--ov));
    --outline-w: calc(2px * var(--ov));
    --rot-gap: calc(10px * var(--ov));        /* 角ハンドル(±6px)の外側に4pxの隙間 */
    --rot-size: calc(22px * var(--ov));
  }
  .resize-handle {
    position: absolute;
    width: var(--handle-hit);
    height: var(--handle-hit);
    background: transparent;
    border: none;
    border-radius: 0;
    box-sizing: border-box;
    pointer-events: auto;
    z-index: 30;
  }
  .resize-handle::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: var(--handle-visual);
    height: var(--handle-visual);
    margin: calc(var(--handle-visual) / -2) 0 0 calc(var(--handle-visual) / -2);
    background: #ffffff;
    /* border-width は 1px 未満に下がらない（Chrome が切り上げる）ので、
       400%ズームでは 8px の四角が枠線で埋まって真っ青になる。
       spread が小数のまま効く box-shadow で縁取りする。 */
    box-shadow: 0 0 0 calc(1px * var(--ov)) #0d99ff;
    border: none;
    border-radius: calc(1px * var(--ov));
    box-sizing: border-box;
  }
  /* 角・辺中点: 当たり判定の中心を枠の角/中点に合わせる */
  .resize-handle.nw { top: calc(var(--handle-hit-half) * -1); left: calc(var(--handle-hit-half) * -1); cursor: nwse-resize; }
  .resize-handle.ne { top: calc(var(--handle-hit-half) * -1); right: calc(var(--handle-hit-half) * -1); cursor: nesw-resize; }
  .resize-handle.sw { bottom: calc(var(--handle-hit-half) * -1); left: calc(var(--handle-hit-half) * -1); cursor: nesw-resize; }
  .resize-handle.se { bottom: calc(var(--handle-hit-half) * -1); right: calc(var(--handle-hit-half) * -1); cursor: nwse-resize; }
  .resize-handle.n { top: calc(var(--handle-hit-half) * -1); left: 50%; margin-left: calc(var(--handle-hit-half) * -1); cursor: ns-resize; }
  .resize-handle.s { bottom: calc(var(--handle-hit-half) * -1); left: 50%; margin-left: calc(var(--handle-hit-half) * -1); cursor: ns-resize; }
  .resize-handle.w { left: calc(var(--handle-hit-half) * -1); top: 50%; margin-top: calc(var(--handle-hit-half) * -1); cursor: ew-resize; }
  .resize-handle.e { right: calc(var(--handle-hit-half) * -1); top: 50%; margin-top: calc(var(--handle-hit-half) * -1); cursor: ew-resize; }
  /*
   * 辺（エッジ）の当たり判定。Figma と同じく「辺を掴んで1軸リサイズ」できるようにする。
   * 見た目は持たない（枠線は .selection-outline が描く）。
   * data-handle は n/e/s/w のまま。useDragResize が name.includes('e') 等で軸を
   * 判定しているため、独自の値（edge-n 等）にすると軸判定が壊れる。
   * 位置指定用のクラス名だけ edge-top/right/bottom/left にして、
   * 上の .resize-handle.n などの指定と衝突しないようにしている。
   */
  .resize-handle.edge {
    z-index: 20;
    border-radius: 0;
  }
  .resize-handle.edge::after { content: none; }
  .resize-handle.edge.edge-top { top: calc(var(--edge-hit-half) * -1); left: 0; width: 100%; height: var(--edge-hit); margin: 0; cursor: ns-resize; }
  .resize-handle.edge.edge-bottom { bottom: calc(var(--edge-hit-half) * -1); left: 0; width: 100%; height: var(--edge-hit); margin: 0; cursor: ns-resize; }
  .resize-handle.edge.edge-left { left: calc(var(--edge-hit-half) * -1); top: 0; width: var(--edge-hit); height: 100%; margin: 0; cursor: ew-resize; }
  .resize-handle.edge.edge-right { right: calc(var(--edge-hit-half) * -1); top: 0; width: var(--edge-hit); height: 100%; margin: 0; cursor: ew-resize; }
  /*
   * 角丸ハンドル。
   * 以前は NE ハンドルと同じ z-index で NE の後に append され、
   * border-radius:0 の要素では top/right:0px となって NE を完全に覆っていた。
   * 位置(内側オフセットの下限)は dom-utils 側で角ハンドルと重ならない値に
   * クランプし、ここでは重なった場合でも必ず負けるよう z-index を下げる。
   */
  .border-radius-handle {
    position: absolute;
    width: var(--handle-hit);
    height: var(--handle-hit);
    background: transparent;
    border: none;
    box-sizing: border-box;
    pointer-events: auto;
    z-index: 10;
    cursor: pointer;
  }
  .border-radius-handle::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: var(--handle-visual);
    height: var(--handle-visual);
    margin: calc(var(--handle-visual) / -2) 0 0 calc(var(--handle-visual) / -2);
    background: #ffffff;
    box-shadow: 0 0 0 calc(1px * var(--ov)) #f97316;
    border: none;
    border-radius: 50%;
    box-sizing: border-box;
  }
  /* transform:scale は当たり判定の位置をずらすので、色だけ変える */
  .border-radius-handle:hover::after {
    background: #f97316;
  }
  /*
   * 複数選択時の「群バウンディングボックス」(Figma相当)
   * 選択中の全要素の矩形の和集合を1枚の枠として描く。
   * .selection-box を兼ねているので、保存時のサニタイズ処理に自動的に拾われる。
   * メンバーの枠(10000)より前面に置き、群のハンドルが必ず掴めるようにする。
   */
  .selection-box.selection-bounds {
    z-index: 10002;
    background: transparent;
  }
  /* 群の枠は少し外側に出して、メンバーの枠と重ならないようにする */
  .selection-box.selection-bounds > .selection-outline {
    inset: calc(-2px * var(--ov));
  }
  /*
   * [なぜ outline ではなく box-shadow か]
   * outline-width の使用値は整数CSSpxに切り捨てられる（実測: 2px×1.96 = 3.92px が
   * "3px" になり、ズーム51%では画面上1.5pxまで痩せる）。
   * box-shadow の spread は小数のまま描かれるので、
   * 「画面上ちょうど2px」を保てる。この要素はオーバーレイ専用の div なので、
   * スライド側の box-shadow を壊す心配もない。
   */
  .selection-box .selection-outline {
    position: absolute;
    inset: 0;
    border: none;
    outline: none;
    box-shadow: 0 0 0 var(--outline-w) #0d99ff;
    pointer-events: none;
  }
  /*
   * 複数選択時のメンバーは「細い輪郭のみ」。
   * ハンドルとサイズラベルは群バウンディングボックス1枚に集約する
   * （40件マーキーすると 40個のサイズラベルが重なって紙面が読めなくなるため）。
   */
  .selection-box.selection-member .selection-outline {
    box-shadow: 0 0 0 calc(1px * var(--ov)) rgba(13, 153, 255, 0.75);
  }
  /*
   * 部品(data-part)のインスタンスは紫(Figma のコンポーネントと同じ色)。
   * ルートを選んだら枠・ハンドル・サイズラベルが紫、中のスロットを選んだら枠は青のまま
   * 「部品の中」の札だけ出す。札はパンくず(上 -22px)の左上に重ならないよう、その上に置く
   */
  .selection-box.selection-part .selection-outline { box-shadow: 0 0 0 var(--outline-w) #7b61ff; }
  .selection-box.selection-part .resize-handle::after { border-color: #7b61ff; }
  .selection-box.selection-part .size-label { background: #7b61ff; }
  .selection-box.selection-member.selection-part .selection-outline { box-shadow: 0 0 0 calc(1px * var(--ov)) rgba(123, 97, 255, 0.8); }
  .selection-box .part-badge {
    position: absolute;
    top: calc(-44px * var(--ov));
    left: 0;
    padding: calc(2px * var(--ov)) calc(6px * var(--ov));
    border-radius: calc(3px * var(--ov));
    background: #7b61ff;
    color: #fff;
    font-size: calc(10px * var(--ov));
    line-height: 1.4;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', sans-serif;
    white-space: nowrap;
    pointer-events: none;
    z-index: 40;
  }
  .selection-box.selection-in-part .part-badge { background: rgba(123, 97, 255, 0.85); }
  /* 選んでいる部品のスロット(編集できる範囲)は点線。中を選んでいるときは部品の外周を薄い点線で示す */
  [data-part].selected [data-slot] { outline: calc(1px * var(--overlay-scale, 1)) dashed rgba(123, 97, 255, 0.75); outline-offset: calc(-1px * var(--overlay-scale, 1)); }
  [data-part]:not(.selected):has(.selected) { outline: calc(1px * var(--overlay-scale, 1)) dashed rgba(123, 97, 255, 0.55); outline-offset: calc(2px * var(--overlay-scale, 1)); }
  .size-label {
    position: absolute;
    bottom: calc(-22px * var(--ov));
    left: 50%;
    transform: translateX(-50%);
    background: #0d99ff;
    color: white;
    font-size: calc(10px * var(--ov));
    line-height: 1.4;
    padding: calc(2px * var(--ov)) calc(6px * var(--ov));
    border-radius: calc(2px * var(--ov));
    white-space: nowrap;
    pointer-events: none;
    z-index: 40;
  }
  /*
   * 回転ハンドル。角ハンドルの当たり判定(±6px)の外側に 4px の隙間を空けて置く。
   * 以前は角から 6px 外に出た時点で回転域に入り、掴んだつもりが無言で
   * transform:rotate() を書き込んでいた。
   */
  .rotation-handle {
    position: absolute;
    width: var(--rot-size);
    height: var(--rot-size);
    background: transparent;
    border: none;
    pointer-events: auto;
    z-index: 5;
    cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%230d99ff' stroke-width='2'%3E%3Cpath d='M21 12a9 9 0 1 1-9-9'/%3E%3Cpath d='M21 3v9h-9'/%3E%3C/svg%3E") 12 12, pointer;
  }
  .rotation-handle.nw { top: calc((var(--rot-gap) + var(--rot-size)) * -1); left: calc((var(--rot-gap) + var(--rot-size)) * -1); }
  .rotation-handle.ne { top: calc((var(--rot-gap) + var(--rot-size)) * -1); right: calc((var(--rot-gap) + var(--rot-size)) * -1); }
  .rotation-handle.sw { bottom: calc((var(--rot-gap) + var(--rot-size)) * -1); left: calc((var(--rot-gap) + var(--rot-size)) * -1); }
  .rotation-handle.se { bottom: calc((var(--rot-gap) + var(--rot-size)) * -1); right: calc((var(--rot-gap) + var(--rot-size)) * -1); }
  .rotation-handle:hover {
    background: rgba(13, 153, 255, 0.12);
    border-radius: 50%;
  }
  /*
   * 右上だけ ⟳ を出して回転域の在り処を示す(PowerPointの回転ハンドル相当)。
   * 印は表示専用。当たり判定は親の .rotation-handle が持ったままにする
   * (mousedown は e.target の data-handle だけを見るため)。
   */
  /* 印は掴み代(22px)より小さく描く。当たり判定は広く、見た目は邪魔しない */
  .rotation-handle-glyph {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: calc(14px * var(--ov));
    height: calc(14px * var(--ov));
    display: flex;
    align-items: center;
    justify-content: center;
    background: #ffffff;
    border-radius: 50%;
    box-shadow: 0 0 0 calc(1px * var(--ov)) #0d99ff;
    color: #0d99ff;
    font-size: calc(9px * var(--ov));
    line-height: 1;
    pointer-events: none;
    user-select: none;
  }
  body.rotating {
    cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%230d99ff' stroke-width='2'%3E%3Cpath d='M21 12a9 9 0 1 1-9-9'/%3E%3Cpath d='M21 3v9h-9'/%3E%3C/svg%3E") 12 12, pointer !important;
  }
  .marquee-selection-box {
    position: absolute;
    border: 1px dashed #0d99ff;
    background-color: rgba(13, 153, 255, 0.1);
    pointer-events: none;
    z-index: 10000;
  }
  [data-editable="true"].marquee-hover {
    outline: calc(2px * var(--overlay-scale, 1)) solid rgba(13, 153, 255, 0.6) !important;
    outline-offset: calc(1px * var(--overlay-scale, 1));
  }
  /* テキスト要素ホバー時の下線（Figmaスタイル） */
  [data-editable="true"].text-editable-hover {
    text-decoration: underline !important;
    text-decoration-color: #0d99ff !important;
    text-decoration-thickness: 2px !important;
    text-underline-offset: 2px !important;
  }
  /* 編集中のテキスト要素 */
  [data-editable="true"].editing {
    outline: calc(2px * var(--overlay-scale, 1)) solid #0d99ff !important;
    outline-offset: calc(2px * var(--overlay-scale, 1));
    cursor: text !important;
  }
`;
