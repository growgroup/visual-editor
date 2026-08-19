/**
 * エディタの幾何計算ユーティリティ
 *
 * [なぜ独立させたか]
 * ドラッグ移動・リサイズ・キーボード移動は「同じ座標をどう丸めるか」「最小サイズをいくつにするか」
 * という規則を共有していないと、操作のたびに 0.3px 単位の誤差が積み上がって
 * 「群で動かすと要素ごとに位置がズレる」「同じ操作なのに結果が違う」が起きる。
 * 丸め規則・最小サイズ・軸拘束・リサイズのアンカー計算をここに一本化し、
 * 各フックは import して使うだけにする。
 */

/**
 * 要素に書き込む最小サイズ(px)
 *
 * 従来は 10px でクランプしていたため、罫線(h-px)や 1〜9px の細い装飾要素を
 * リサイズすると勝手に 10px まで太らされて元に戻せなかった。
 * CSS 上 1px 未満の指定は実質意味を持たないので下限は 1px とする。
 */
export const MIN_ELEMENT_SIZE = 1;

/**
 * クリックとドラッグを区別する移動量(px, アートボード座標)
 * これを超えて初めて「ドラッグが始まった」とみなす。
 */
export const DRAG_START_THRESHOLD = 2;

/** px値の丸め規則（座標・サイズを書き込む直前に必ず通す） */
export function roundPx(value: number): number {
  return Math.round(value);
}

/** 丸めた px 文字列を返す */
export function pxValue(value: number): string {
  return `${roundPx(value)}px`;
}

/**
 * computed position が「フローから外れている」か
 * left/top を書いて自由に動かせるのは absolute / fixed だけ。
 * static / relative / sticky は書いても意味が違う（relative は流し込み位置からの
 * オフセットなので offsetLeft を書き戻すと飛ぶ）ため、自由移動の対象にしない。
 */
export function isOutOfFlowPosition(position: string | null | undefined): boolean {
  return position === 'absolute' || position === 'fixed';
}

/** 要素がフローから外れているか（computed style を見る） */
export function isElementOutOfFlow(element: HTMLElement, doc: Document): boolean {
  const cs = doc.defaultView?.getComputedStyle(element);
  return isOutOfFlowPosition(cs?.position);
}

/**
 * Shift による軸拘束
 *
 * 「Shiftを押した瞬間の軸に固定」ではなく、毎フレーム
 * ドラッグ開始点からの |dx| と |dy| を比べて支配軸を決める。
 * こうすると Shift を押しっぱなしのまま方向を変えても素直に追従する（Figma と同じ）。
 */
export function constrainAxis(
  dx: number,
  dy: number,
  enabled: boolean | undefined
): { dx: number; dy: number } {
  if (!enabled) return { dx, dy };
  return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };
}

/** リサイズハンドルの向き（-1: 左/上, 0: 動かさない, 1: 右/下） */
export function handleDirection(handle: string): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  const x: -1 | 0 | 1 = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const y: -1 | 0 | 1 = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  return { x, y };
}

/** リサイズの基準値（掴んだ時点の値。すべてスケール前の CSS px） */
export interface ResizeOrigin {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** リサイズの修飾キー */
export interface ResizeModifiers {
  /** Shift: 縦横比維持 */
  shiftKey?: boolean;
  /** Alt: 中心固定（両側に伸びる） */
  altKey?: boolean;
  /** 最小サイズ（既定 MIN_ELEMENT_SIZE） */
  minSize?: number;
}

/**
 * リサイズ後の矩形を計算する
 *
 * [計算順序]
 * 1. 掴んだハンドルの向きから「幅・高さの増分」に読み替える
 * 2. Alt（中心固定）なら増分を2倍にする（掴んだ辺と対辺の両方が動くため）
 * 3. Shift（縦横比維持）なら支配辺から従属辺を決める
 * 4. 最小サイズでクランプする
 * 5. **クランプ後の実増分**からアンカー（対辺）を決める
 *    → 先に left/top を生の delta から決めると、クランプや比率維持が効いたときに
 *      「対辺が固定される」という不変条件が静かに壊れる
 *
 * [丸め] 端(left/right, top/bottom)をそれぞれ丸めてから幅を引き算で出す。
 * 幅と位置を独立に丸めると、対辺が 1px ずれることがあるため。
 */
export function computeResizeGeometry(
  orig: ResizeOrigin,
  handle: string,
  deltaX: number,
  deltaY: number,
  mods: ResizeModifiers = {}
): ResizeOrigin {
  const minSize = mods.minSize ?? MIN_ELEMENT_SIZE;
  const dir = handleDirection(handle);

  // 1. ハンドルの向き → 幅・高さの増分
  let dw = dir.x * deltaX;
  let dh = dir.y * deltaY;

  // 2. Alt: 中心固定（掴んだ辺と対辺が同時に動くので、増分は2倍）
  if (mods.altKey) {
    dw *= 2;
    dh *= 2;
  }

  // 3. Shift: 縦横比維持
  if (mods.shiftKey && orig.width > 0 && orig.height > 0) {
    const aspect = orig.width / orig.height;
    if (dir.x !== 0 && dir.y !== 0) {
      // 角ハンドル: 相対変化の大きいほうを支配辺にする
      if (Math.abs(dw) * orig.height >= Math.abs(dh) * orig.width) {
        dh = dw / aspect;
      } else {
        dw = dh * aspect;
      }
    } else if (dir.x !== 0) {
      dh = dw / aspect;
    } else if (dir.y !== 0) {
      dw = dh * aspect;
    }
  }

  // 4. クランプ
  const rawWidth = Math.max(minSize, orig.width + dw);
  const rawHeight = Math.max(minSize, orig.height + dh);

  // 5. クランプ後の実増分でアンカーを決める
  const appliedDw = rawWidth - orig.width;
  const appliedDh = rawHeight - orig.height;

  let rawLeft = orig.left;
  let rawTop = orig.top;
  if (mods.altKey) {
    // 中心固定: 両側に半分ずつ広がる
    rawLeft = orig.left - appliedDw / 2;
    rawTop = orig.top - appliedDh / 2;
  } else {
    // 対辺固定: 左/上を掴んだときだけ位置が動く
    if (dir.x < 0) rawLeft = orig.left - appliedDw;
    if (dir.y < 0) rawTop = orig.top - appliedDh;
  }

  // 丸め: 端を丸めてから幅・高さを引き算で出す（対辺の位置を1px単位で保つ）
  const left = roundPx(rawLeft);
  const top = roundPx(rawTop);
  const right = roundPx(rawLeft + rawWidth);
  const bottom = roundPx(rawTop + rawHeight);

  return {
    left,
    top,
    width: Math.max(minSize, right - left),
    height: Math.max(minSize, bottom - top),
  };
}

/**
 * style.width / style.height に書くべき現在サイズを実測する
 *
 * offsetWidth/offsetHeight はスケール前の CSS px（border-box）を返す。
 * getBoundingClientRect().width / zoom と違い、artboard のスケールや
 * 要素自身の transform の影響を受けないので基準として素直。
 * box-sizing: content-box の要素だけ padding/border を差し引いて
 * 「style.width に書いた値 = 実際に効く値」を一致させる。
 */
export function measureStyleSize(
  element: HTMLElement,
  doc: Document
): { width: number; height: number } {
  const cs = doc.defaultView?.getComputedStyle(element);
  let width = element.offsetWidth;
  let height = element.offsetHeight;

  // インライン要素などで offsetWidth が 0 のときは矩形から拾う（保険）
  if (width === 0 && height === 0) {
    const rect = element.getBoundingClientRect();
    const scale = getArtboardRenderScale(doc);
    width = rect.width / scale;
    height = rect.height / scale;
    return { width, height };
  }

  if (cs && cs.boxSizing === 'content-box') {
    const num = (v: string) => parseFloat(v) || 0;
    width -=
      num(cs.paddingLeft) +
      num(cs.paddingRight) +
      num(cs.borderLeftWidth) +
      num(cs.borderRightWidth);
    height -=
      num(cs.paddingTop) +
      num(cs.paddingBottom) +
      num(cs.borderTopWidth) +
      num(cs.borderBottomWidth);
  }

  return { width: Math.max(0, width), height: Math.max(0, height) };
}

/** アートボードが実際に描画されている倍率（保険用。取れなければ 1） */
function getArtboardRenderScale(doc: Document): number {
  const wrapper = doc.getElementById('artboard-wrapper');
  if (!wrapper || !doc.defaultView) return 1;
  const transform = doc.defaultView.getComputedStyle(wrapper).transform;
  if (!transform || transform === 'none') return 1;
  const match = transform.match(/matrix\(([^,]+),/);
  const scale = match ? parseFloat(match[1]) : 1;
  return scale > 0 ? scale : 1;
}
