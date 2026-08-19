/**
 * Tailwind CSS マッピング定義
 *
 * CSSプロパティ値をTailwindクラスに変換するためのマッピングルール
 */

/**
 * プロパティグループ定義（競合クラス管理用）
 * 同じプロパティを更新する際、古いクラスを削除するために使用
 */
export const TAILWIND_CONFLICT_GROUPS: Record<string, string[]> = {
  // Position & Layout
  position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  display: [
    'block',
    'inline-block',
    'inline',
    'flex',
    'inline-flex',
    'grid',
    'inline-grid',
    'hidden',
  ],
  visibility: ['visible', 'invisible', 'collapse'],

  // Size
  width: ['w-'],
  minWidth: ['min-w-'],
  maxWidth: ['max-w-'],
  height: ['h-'],
  minHeight: ['min-h-'],
  maxHeight: ['max-h-'],

  // Position offsets
  top: ['top-'],
  right: ['right-'],
  bottom: ['bottom-'],
  left: ['left-'],
  inset: ['inset-'],

  // Flexbox
  flexDirection: ['flex-row', 'flex-col'],
  flexWrap: ['flex-wrap', 'flex-nowrap'],
  justifyContent: ['justify-'],
  alignItems: ['items-'],
  alignContent: ['content-'],
  alignSelf: ['self-'],
  flexGrow: ['grow', 'grow-0'],
  flexShrink: ['shrink', 'shrink-0'],
  flexBasis: ['basis-'],
  order: ['order-'],

  // Grid
  gridTemplateColumns: ['grid-cols-'],
  gridTemplateRows: ['grid-rows-'],
  gridColumn: ['col-'],
  gridRow: ['row-'],
  gridColumnStart: ['col-start-'],
  gridColumnEnd: ['col-end-'],
  gridRowStart: ['row-start-'],
  gridRowEnd: ['row-end-'],
  gridAutoFlow: ['grid-flow-'],
  gridAutoColumns: ['auto-cols-'],
  gridAutoRows: ['auto-rows-'],

  // Gap
  gap: ['gap-'],
  rowGap: ['gap-y-'],
  columnGap: ['gap-x-'],

  // Spacing
  padding: ['p-'],
  paddingTop: ['pt-'],
  paddingRight: ['pr-'],
  paddingBottom: ['pb-'],
  paddingLeft: ['pl-'],
  paddingX: ['px-'],
  paddingY: ['py-'],
  margin: ['m-'],
  marginTop: ['mt-'],
  marginRight: ['mr-'],
  marginBottom: ['mb-'],
  marginLeft: ['ml-'],
  marginX: ['mx-'],
  marginY: ['my-'],

  // Background
  backgroundColor: ['bg-'],
  backgroundOpacity: ['bg-opacity-'],

  // Border
  borderRadius: ['rounded-'],
  borderTopLeftRadius: ['rounded-tl-'],
  borderTopRightRadius: ['rounded-tr-'],
  borderBottomRightRadius: ['rounded-br-'],
  borderBottomLeftRadius: ['rounded-bl-'],
  borderWidth: ['border-'],
  borderTopWidth: ['border-t-'],
  borderRightWidth: ['border-r-'],
  borderBottomWidth: ['border-b-'],
  borderLeftWidth: ['border-l-'],
  borderColor: ['border-'],
  borderStyle: ['border-solid', 'border-dashed', 'border-dotted', 'border-none'],

  // Typography
  // 注意: fontSize と color は両方 text- プレフィックスを使用するが、
  // 競合を避けるため、より具体的なパターンで管理する
  // fontSize は text-xs, text-sm, text-base, text-lg, text-xl, text-2xl, etc. と text-[数値]
  // color は text-[色名], text-[#hex], text-[rgb()] 等
  // twMerge がこれらを適切に処理するため、ここでは空配列にして
  // twMerge に任せる（removeConflictingClasses で誤って削除されないようにする）
  fontSize: [], // twMerge handles text size vs color conflicts
  fontWeight: ['font-thin', 'font-extralight', 'font-light', 'font-normal', 'font-medium', 'font-semibold', 'font-bold', 'font-extrabold', 'font-black'],
  fontFamily: ['font-sans', 'font-serif', 'font-mono', 'font-['],
  fontStyle: ['italic', 'not-italic'],
  textAlign: ['text-left', 'text-center', 'text-right', 'text-justify', 'text-start', 'text-end'],
  textDecoration: ['underline', 'overline', 'line-through', 'no-underline'],
  textTransform: ['uppercase', 'lowercase', 'capitalize', 'normal-case'],
  lineHeight: ['leading-'],
  letterSpacing: ['tracking-'],
  color: [], // twMerge handles text color vs size conflicts
  whiteSpace: ['whitespace-'],
  wordBreak: ['break-'],
  textOverflow: ['truncate', 'text-ellipsis', 'text-clip'],

  // Effects
  opacity: ['opacity-'],
  boxShadow: ['shadow-'],
  mixBlendMode: ['mix-blend-'],
  backgroundBlendMode: ['bg-blend-'],

  // Layout
  overflow: ['overflow-'],
  overflowX: ['overflow-x-'],
  overflowY: ['overflow-y-'],
  zIndex: ['z-'],
  objectFit: ['object-'],
  objectPosition: ['object-'],

  // Aspect Ratio
  aspectRatio: ['aspect-'],

  // Cursor
  cursor: ['cursor-'],

  // Pointer Events
  pointerEvents: ['pointer-events-'],

  // User Select
  userSelect: ['select-'],
};

/**
 * 列挙型マッピング
 * CSS値からTailwindクラスへの直接マッピング
 */
export const ENUM_MAPPINGS: Record<string, Record<string, string>> = {
  position: {
    static: 'static',
    relative: 'relative',
    absolute: 'absolute',
    fixed: 'fixed',
    sticky: 'sticky',
  },

  display: {
    block: 'block',
    'inline-block': 'inline-block',
    inline: 'inline',
    flex: 'flex',
    'inline-flex': 'inline-flex',
    grid: 'grid',
    'inline-grid': 'inline-grid',
    none: 'hidden',
  },

  visibility: {
    visible: 'visible',
    hidden: 'invisible',
    collapse: 'collapse',
  },

  flexDirection: {
    row: 'flex-row',
    'row-reverse': 'flex-row-reverse',
    column: 'flex-col',
    'column-reverse': 'flex-col-reverse',
  },

  flexWrap: {
    wrap: 'flex-wrap',
    'wrap-reverse': 'flex-wrap-reverse',
    nowrap: 'flex-nowrap',
  },

  justifyContent: {
    'flex-start': 'justify-start',
    start: 'justify-start',
    'flex-end': 'justify-end',
    end: 'justify-end',
    center: 'justify-center',
    'space-between': 'justify-between',
    'space-around': 'justify-around',
    'space-evenly': 'justify-evenly',
    stretch: 'justify-stretch',
  },

  alignItems: {
    'flex-start': 'items-start',
    start: 'items-start',
    'flex-end': 'items-end',
    end: 'items-end',
    center: 'items-center',
    baseline: 'items-baseline',
    stretch: 'items-stretch',
  },

  alignContent: {
    'flex-start': 'content-start',
    start: 'content-start',
    'flex-end': 'content-end',
    end: 'content-end',
    center: 'content-center',
    'space-between': 'content-between',
    'space-around': 'content-around',
    'space-evenly': 'content-evenly',
    stretch: 'content-stretch',
    baseline: 'content-baseline',
  },

  alignSelf: {
    auto: 'self-auto',
    'flex-start': 'self-start',
    start: 'self-start',
    'flex-end': 'self-end',
    end: 'self-end',
    center: 'self-center',
    stretch: 'self-stretch',
    baseline: 'self-baseline',
  },

  gridAutoFlow: {
    row: 'grid-flow-row',
    column: 'grid-flow-col',
    dense: 'grid-flow-dense',
    'row dense': 'grid-flow-row-dense',
    'column dense': 'grid-flow-col-dense',
  },

  textAlign: {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
    justify: 'text-justify',
    start: 'text-start',
    end: 'text-end',
  },

  textDecoration: {
    underline: 'underline',
    overline: 'overline',
    'line-through': 'line-through',
    none: 'no-underline',
  },

  textTransform: {
    uppercase: 'uppercase',
    lowercase: 'lowercase',
    capitalize: 'capitalize',
    none: 'normal-case',
  },

  fontStyle: {
    italic: 'italic',
    normal: 'not-italic',
  },

  fontWeight: {
    '100': 'font-thin',
    '200': 'font-extralight',
    '300': 'font-light',
    '400': 'font-normal',
    '500': 'font-medium',
    '600': 'font-semibold',
    '700': 'font-bold',
    '800': 'font-extrabold',
    '900': 'font-black',
    thin: 'font-thin',
    extralight: 'font-extralight',
    light: 'font-light',
    normal: 'font-normal',
    medium: 'font-medium',
    semibold: 'font-semibold',
    bold: 'font-bold',
    extrabold: 'font-extrabold',
    black: 'font-black',
  },

  overflow: {
    auto: 'overflow-auto',
    hidden: 'overflow-hidden',
    clip: 'overflow-clip',
    visible: 'overflow-visible',
    scroll: 'overflow-scroll',
  },

  overflowX: {
    auto: 'overflow-x-auto',
    hidden: 'overflow-x-hidden',
    clip: 'overflow-x-clip',
    visible: 'overflow-x-visible',
    scroll: 'overflow-x-scroll',
  },

  overflowY: {
    auto: 'overflow-y-auto',
    hidden: 'overflow-y-hidden',
    clip: 'overflow-y-clip',
    visible: 'overflow-y-visible',
    scroll: 'overflow-y-scroll',
  },

  objectFit: {
    contain: 'object-contain',
    cover: 'object-cover',
    fill: 'object-fill',
    none: 'object-none',
    'scale-down': 'object-scale-down',
  },

  objectPosition: {
    bottom: 'object-bottom',
    center: 'object-center',
    left: 'object-left',
    'left bottom': 'object-left-bottom',
    'left top': 'object-left-top',
    right: 'object-right',
    'right bottom': 'object-right-bottom',
    'right top': 'object-right-top',
    top: 'object-top',
  },

  borderStyle: {
    solid: 'border-solid',
    dashed: 'border-dashed',
    dotted: 'border-dotted',
    double: 'border-double',
    hidden: 'border-hidden',
    none: 'border-none',
  },

  whiteSpace: {
    normal: 'whitespace-normal',
    nowrap: 'whitespace-nowrap',
    pre: 'whitespace-pre',
    'pre-line': 'whitespace-pre-line',
    'pre-wrap': 'whitespace-pre-wrap',
    'break-spaces': 'whitespace-break-spaces',
  },

  wordBreak: {
    normal: 'break-normal',
    'break-all': 'break-all',
    'keep-all': 'break-keep',
  },

  cursor: {
    auto: 'cursor-auto',
    default: 'cursor-default',
    pointer: 'cursor-pointer',
    wait: 'cursor-wait',
    text: 'cursor-text',
    move: 'cursor-move',
    help: 'cursor-help',
    'not-allowed': 'cursor-not-allowed',
    none: 'cursor-none',
    'context-menu': 'cursor-context-menu',
    progress: 'cursor-progress',
    cell: 'cursor-cell',
    crosshair: 'cursor-crosshair',
    'vertical-text': 'cursor-vertical-text',
    alias: 'cursor-alias',
    copy: 'cursor-copy',
    'no-drop': 'cursor-no-drop',
    grab: 'cursor-grab',
    grabbing: 'cursor-grabbing',
    'all-scroll': 'cursor-all-scroll',
    'col-resize': 'cursor-col-resize',
    'row-resize': 'cursor-row-resize',
    'n-resize': 'cursor-n-resize',
    'e-resize': 'cursor-e-resize',
    's-resize': 'cursor-s-resize',
    'w-resize': 'cursor-w-resize',
    'ne-resize': 'cursor-ne-resize',
    'nw-resize': 'cursor-nw-resize',
    'se-resize': 'cursor-se-resize',
    'sw-resize': 'cursor-sw-resize',
    'ew-resize': 'cursor-ew-resize',
    'ns-resize': 'cursor-ns-resize',
    'nesw-resize': 'cursor-nesw-resize',
    'nwse-resize': 'cursor-nwse-resize',
    'zoom-in': 'cursor-zoom-in',
    'zoom-out': 'cursor-zoom-out',
  },

  pointerEvents: {
    none: 'pointer-events-none',
    auto: 'pointer-events-auto',
  },

  userSelect: {
    none: 'select-none',
    text: 'select-text',
    all: 'select-all',
    auto: 'select-auto',
  },

  mixBlendMode: {
    normal: 'mix-blend-normal',
    multiply: 'mix-blend-multiply',
    screen: 'mix-blend-screen',
    overlay: 'mix-blend-overlay',
    darken: 'mix-blend-darken',
    lighten: 'mix-blend-lighten',
    'color-dodge': 'mix-blend-color-dodge',
    'color-burn': 'mix-blend-color-burn',
    'hard-light': 'mix-blend-hard-light',
    'soft-light': 'mix-blend-soft-light',
    difference: 'mix-blend-difference',
    exclusion: 'mix-blend-exclusion',
    hue: 'mix-blend-hue',
    saturation: 'mix-blend-saturation',
    color: 'mix-blend-color',
    luminosity: 'mix-blend-luminosity',
    'plus-darker': 'mix-blend-plus-darker',
    'plus-lighter': 'mix-blend-plus-lighter',
  },

  backgroundBlendMode: {
    normal: 'bg-blend-normal',
    multiply: 'bg-blend-multiply',
    screen: 'bg-blend-screen',
    overlay: 'bg-blend-overlay',
    darken: 'bg-blend-darken',
    lighten: 'bg-blend-lighten',
    'color-dodge': 'bg-blend-color-dodge',
    'color-burn': 'bg-blend-color-burn',
    'hard-light': 'bg-blend-hard-light',
    'soft-light': 'bg-blend-soft-light',
    difference: 'bg-blend-difference',
    exclusion: 'bg-blend-exclusion',
    hue: 'bg-blend-hue',
    saturation: 'bg-blend-saturation',
    color: 'bg-blend-color',
    luminosity: 'bg-blend-luminosity',
  },

  aspectRatio: {
    auto: 'aspect-auto',
    '1 / 1': 'aspect-square',
    '16 / 9': 'aspect-video',
  },
};

/**
 * 数値変換プレフィックス
 * px値や%値を任意値形式（例: w-[123px]）に変換するためのマッピング
 */
export const NUMERIC_PREFIXES: Record<string, string> = {
  // Size
  width: 'w',
  minWidth: 'min-w',
  maxWidth: 'max-w',
  height: 'h',
  minHeight: 'min-h',
  maxHeight: 'max-h',

  // Position offsets
  top: 'top',
  right: 'right',
  bottom: 'bottom',
  left: 'left',
  inset: 'inset',

  // Gap
  gap: 'gap',
  rowGap: 'gap-y',
  columnGap: 'gap-x',

  // Padding
  padding: 'p',
  paddingTop: 'pt',
  paddingRight: 'pr',
  paddingBottom: 'pb',
  paddingLeft: 'pl',

  // Margin
  margin: 'm',
  marginTop: 'mt',
  marginRight: 'mr',
  marginBottom: 'mb',
  marginLeft: 'ml',

  // Typography
  fontSize: 'text',
  lineHeight: 'leading',
  letterSpacing: 'tracking',

  // Border
  borderRadius: 'rounded',
  borderTopLeftRadius: 'rounded-tl',
  borderTopRightRadius: 'rounded-tr',
  borderBottomRightRadius: 'rounded-br',
  borderBottomLeftRadius: 'rounded-bl',
  borderWidth: 'border',
  borderTopWidth: 'border-t',
  borderRightWidth: 'border-r',
  borderBottomWidth: 'border-b',
  borderLeftWidth: 'border-l',

  // Effects
  opacity: 'opacity',

  // Layout
  zIndex: 'z',

  // Flex
  flexBasis: 'basis',
  order: 'order',

  // Grid
  gridColumn: 'col-span',
  gridRow: 'row-span',
  gridColumnStart: 'col-start',
  gridColumnEnd: 'col-end',
  gridRowStart: 'row-start',
  gridRowEnd: 'row-end',
};

/**
 * 色プロパティのプレフィックス
 */
export const COLOR_PREFIXES: Record<string, string> = {
  backgroundColor: 'bg',
  color: 'text',
  borderColor: 'border',
  outlineColor: 'outline',
  textDecorationColor: 'decoration',
  caretColor: 'caret',
  accentColor: 'accent',
  fill: 'fill',
  stroke: 'stroke',
};

/**
 * style属性にフォールバックするプロパティ
 * Tailwindで表現困難または複雑な値を持つプロパティ
 */
export const STYLE_ONLY_PROPERTIES: string[] = [
  'transform',
  'transformOrigin',
  'filter',
  'backdropFilter',
  'boxShadow',
  'textShadow',
  'backgroundImage',
  'backgroundPosition',
  'backgroundSize',
  'backgroundRepeat',
  'backgroundAttachment',
  'clipPath',
  'transition',
  'transitionProperty',
  'transitionDuration',
  'transitionTimingFunction',
  'transitionDelay',
  'animation',
  'animationName',
  'animationDuration',
  'animationTimingFunction',
  'animationDelay',
  'animationIterationCount',
  'animationDirection',
  'animationFillMode',
  'animationPlayState',
  'perspective',
  'perspectiveOrigin',
  'backfaceVisibility',
  'transformStyle',
  'willChange',
  'outline',
  'outlineWidth',
  'outlineStyle',
  'outlineOffset',
  'content',
  'quotes',
  'counterReset',
  'counterIncrement',
  'listStyleType',
  'listStylePosition',
  'listStyleImage',
];

/**
 * 特殊な値マッピング（auto, 100%, 50%など）
 */
export const SPECIAL_VALUES: Record<string, Record<string, string>> = {
  width: {
    auto: 'w-auto',
    '100%': 'w-full',
    '100vw': 'w-screen',
    '50%': 'w-1/2',
    '33.333333%': 'w-1/3',
    '66.666667%': 'w-2/3',
    '25%': 'w-1/4',
    '75%': 'w-3/4',
    'fit-content': 'w-fit',
    'min-content': 'w-min',
    'max-content': 'w-max',
  },
  height: {
    auto: 'h-auto',
    '100%': 'h-full',
    '100vh': 'h-screen',
    '100dvh': 'h-dvh',
    '50%': 'h-1/2',
    '33.333333%': 'h-1/3',
    '66.666667%': 'h-2/3',
    '25%': 'h-1/4',
    '75%': 'h-3/4',
    'fit-content': 'h-fit',
    'min-content': 'h-min',
    'max-content': 'h-max',
  },
  minWidth: {
    '0': 'min-w-0',
    '100%': 'min-w-full',
    'fit-content': 'min-w-fit',
    'min-content': 'min-w-min',
    'max-content': 'min-w-max',
  },
  maxWidth: {
    none: 'max-w-none',
    '100%': 'max-w-full',
    'fit-content': 'max-w-fit',
    'min-content': 'max-w-min',
    'max-content': 'max-w-max',
  },
  minHeight: {
    '0': 'min-h-0',
    '100%': 'min-h-full',
    '100vh': 'min-h-screen',
    '100dvh': 'min-h-dvh',
    'fit-content': 'min-h-fit',
    'min-content': 'min-h-min',
    'max-content': 'min-h-max',
  },
  maxHeight: {
    none: 'max-h-none',
    '100%': 'max-h-full',
    '100vh': 'max-h-screen',
    '100dvh': 'max-h-dvh',
    'fit-content': 'max-h-fit',
    'min-content': 'max-h-min',
    'max-content': 'max-h-max',
  },
  top: {
    auto: 'top-auto',
    '0': 'top-0',
    '50%': 'top-1/2',
    '100%': 'top-full',
  },
  right: {
    auto: 'right-auto',
    '0': 'right-0',
    '50%': 'right-1/2',
    '100%': 'right-full',
  },
  bottom: {
    auto: 'bottom-auto',
    '0': 'bottom-0',
    '50%': 'bottom-1/2',
    '100%': 'bottom-full',
  },
  left: {
    auto: 'left-auto',
    '0': 'left-0',
    '50%': 'left-1/2',
    '100%': 'left-full',
  },
  inset: {
    auto: 'inset-auto',
    '0': 'inset-0',
  },
  margin: {
    auto: 'm-auto',
    '0': 'm-0',
  },
  marginTop: {
    auto: 'mt-auto',
    '0': 'mt-0',
  },
  marginRight: {
    auto: 'mr-auto',
    '0': 'mr-0',
  },
  marginBottom: {
    auto: 'mb-auto',
    '0': 'mb-0',
  },
  marginLeft: {
    auto: 'ml-auto',
    '0': 'ml-0',
  },
  padding: {
    '0': 'p-0',
  },
  paddingTop: {
    '0': 'pt-0',
  },
  paddingRight: {
    '0': 'pr-0',
  },
  paddingBottom: {
    '0': 'pb-0',
  },
  paddingLeft: {
    '0': 'pl-0',
  },
  gap: {
    '0': 'gap-0',
  },
  rowGap: {
    '0': 'gap-y-0',
  },
  columnGap: {
    '0': 'gap-x-0',
  },
  borderRadius: {
    '0': 'rounded-none',
    '9999px': 'rounded-full',
  },
  borderWidth: {
    '0': 'border-0',
    '1px': 'border',
  },
  opacity: {
    '0': 'opacity-0',
    '1': 'opacity-100',
    '0.5': 'opacity-50',
  },
  zIndex: {
    auto: 'z-auto',
    '0': 'z-0',
  },
  flexGrow: {
    '0': 'grow-0',
    '1': 'grow',
  },
  flexShrink: {
    '0': 'shrink-0',
    '1': 'shrink',
  },
  flexBasis: {
    auto: 'basis-auto',
    '0': 'basis-0',
    '100%': 'basis-full',
    '50%': 'basis-1/2',
  },
  order: {
    '0': 'order-none',
    '1': 'order-1',
    '2': 'order-2',
    '-1': '-order-1',
    '9999': 'order-last',
    '-9999': 'order-first',
  },
};
