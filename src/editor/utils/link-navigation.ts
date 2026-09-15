/**
 * ⌘ / Ctrl + クリックで、紙面の中のリンク(`<a href>`)の先へ移る。
 *
 * - 同じサイトのページ(contentList[].href と照らし合わせる) … そのページを編集中にする
 * - 同じページのアンカー(`#id`) … その要素が見える位置へ紙面を移す
 * - 別のオリジンの http(s) … 新しいタブ(noopener)
 * - `mailto:` / `tel:` / `javascript:` など … 何もしない
 * - ページ一覧に無い同じオリジンの URL … 短く知らせる
 *
 * [既存の ⌘ / Ctrl クリックとの両立]
 * useElementSelection の mousedown では ⌘ / Ctrl は「階層を無視して最深要素を選ぶ」、
 * ⌘ + Shift は「最深要素の追加・解除」、⌘ + ドラッグは自由配置(useDragResize)、
 * ⌘ + ダブルクリックはテキスト編集。押した瞬間にはどれになるか決められないので、
 * ここは mousedown で候補を覚えるだけにして選択には手を出さず、
 *   - 動かさずに離した(ドラッグではない)
 *   - Shift / Alt を押していない
 *   - 2 回目の mousedown(ダブルクリック)が LINK_NAV_DELAY_MS 以内に来なかった
 *   - 押した点がテキスト編集中の要素の中ではない
 * ときだけ移る。リンクの中の深い要素を移らずに選びたいときは ⌘ + Alt + クリック。
 *
 * Mac は ⌘ だけ。Mac の Ctrl + クリックは右クリック扱い(contextmenu が出て click が来ない)で、
 * エディタのコンテキストメニューが開く。Windows などは Ctrl(と Meta)。
 */
import { MARQUEE_DRAG_THRESHOLD } from '../constants';

// ------------------------------------------------------------
// リンク先の解決(DOM に触らない)
// ------------------------------------------------------------

export interface LinkNavPage {
  id: string;
  title?: string;
  href?: string;
}

export type LinkTarget =
  | { kind: 'page'; id: string; title: string; hash: string | null }
  | { kind: 'anchor'; hash: string }
  | { kind: 'external'; url: string }
  | { kind: 'ignore' }
  | { kind: 'unresolved' };

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/** `/company/`・`/company/index.html`・`/company` を同じ形にそろえる */
function normalizePath(pathname: string): string {
  let p = pathname;
  try {
    p = decodeURI(p);
  } catch {
    /* 壊れた % はそのまま比べる */
  }
  p = p.replace(/\/{2,}/g, '/').replace(/\/index\.html?$/i, '/');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p || '/';
}

/**
 * ページの中の相対リンクの基準。`/company` の中身は `company/index.html` なので、
 * `./access` は `/company/access`、`../` は `/` を指す(末尾に / を補う)。
 * `/about.html` のように拡張子のある URL はそのまま基準にする
 */
function baseOf(pageHref: string | undefined, origin: string): string {
  const root = `${origin}/`;
  if (!pageHref) return root;
  try {
    const u = new URL(pageHref, root);
    const last = u.pathname.split('/').pop() ?? '';
    if (!u.pathname.endsWith('/') && !last.includes('.')) u.pathname += '/';
    u.search = '';
    u.hash = '';
    return u.href;
  } catch {
    return root;
  }
}

export function resolveLinkTarget(
  rawHref: string,
  options: { pages: readonly LinkNavPage[]; currentId: string | null | undefined; origin: string },
): LinkTarget {
  const href = rawHref.trim();
  if (href === '') return { kind: 'anchor', hash: '' };
  if (href.startsWith('#')) return { kind: 'anchor', hash: href.slice(1) };
  const scheme = SCHEME_RE.exec(href)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') return { kind: 'ignore' };

  const { pages, currentId, origin } = options;
  const current = pages.find((p) => p.id === currentId);
  let url: URL;
  try {
    url = new URL(href, baseOf(current?.href, origin));
  } catch {
    return { kind: 'unresolved' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'ignore' };

  const hash = url.hash ? url.hash.slice(1) : null;
  const key = url.origin + normalizePath(url.pathname);
  const stripExt = (k: string) => k.replace(/\.html?$/i, '');
  // `/company.html` と `/company` は、完全に一致するページが無いときだけ同じと見なす
  let loose: LinkNavPage | undefined;
  for (const page of pages) {
    if (!page.href) continue;
    let pageUrl: URL;
    try {
      pageUrl = new URL(page.href, `${origin}/`);
    } catch {
      continue;
    }
    const pageKey = pageUrl.origin + normalizePath(pageUrl.pathname);
    if (pageKey === key) return { kind: 'page', id: page.id, title: page.title || page.id, hash };
    if (!loose && stripExt(pageKey) === stripExt(key)) loose = page;
  }
  if (loose) return { kind: 'page', id: loose.id, title: loose.title || loose.id, hash };
  if (url.origin !== origin) return { kind: 'external', url: url.href };
  return { kind: 'unresolved' };
}

/**
 * アンカーの行き先。`#` だけ・`#top`(同じ id が無いとき)は紙面の先頭('top')。
 * 紙面(#artboard)の外にある要素(エディタの部品)は拾わない
 */
export function findAnchorTarget(doc: Document, hash: string): HTMLElement | 'top' | null {
  const artboard = doc.getElementById('artboard');
  if (!artboard) return null;
  let decoded = hash;
  try {
    decoded = decodeURIComponent(hash);
  } catch {
    /* そのまま */
  }
  for (const name of new Set([hash, decoded])) {
    if (!name) continue;
    const byId = doc.getElementById(name);
    if (byId && artboard.contains(byId)) return byId;
    const byName = Array.from(doc.getElementsByName(name)).find(
      (el) => el.tagName === 'A' && artboard.contains(el),
    );
    if (byName) return byName as HTMLElement;
  }
  if (!decoded || decoded.toLowerCase() === 'top') return 'top';
  return null;
}

// ------------------------------------------------------------
// ページを移ったあとで開くアンカー(`/company#access`)
// ------------------------------------------------------------
// 1 ページ表示ではページを移るとエディタが作り直されるので、フックの ref ではなく
// モジュールに持つ。移り先のエディタが紙面を読み込んだら使う

const PENDING_ANCHOR_TTL_MS = 8000;
let pendingAnchor: { id: string; hash: string; until: number } | null = null;

export function setPendingAnchor(id: string, hash: string | null): void {
  pendingAnchor = hash ? { id, hash, until: Date.now() + PENDING_ANCHOR_TTL_MS } : null;
}

export function peekPendingAnchor(id: string | null | undefined): string | null {
  if (!pendingAnchor) return null;
  if (Date.now() > pendingAnchor.until) {
    pendingAnchor = null;
    return null;
  }
  return pendingAnchor.id === id ? pendingAnchor.hash : null;
}

export function clearPendingAnchor(id?: string): void {
  if (!id || pendingAnchor?.id === id) pendingAnchor = null;
}

// ------------------------------------------------------------
// 紙面のイベント
// ------------------------------------------------------------

/**
 * 1 回目のクリックから移るまでの待ち。この間に 2 回目の mousedown が来たら
 * ダブルクリック(⌘ + ダブルクリック = テキスト編集)として移動を取り消す
 */
export const LINK_NAV_DELAY_MS = 350;

/** ⌘ / Ctrl を押してリンクの上にいる間、紙面の <html> に付ける(カーソルを指にする) */
export const LINK_NAV_ATTR = 'data-gg-link-nav';

const OVERLAY_SELECTOR =
  '.selection-box,.marquee-selection-box,[data-editor-overlay],#gg-smart-guides,#gg-measure-layer';
/** 描画・テキスト・コメント・手のひら・トリミングの間は、クリックに別の意味がある */
const BLOCKING_BODY_CLASSES = ['draw-mode', 'text-mode', 'comment-mode', 'move-mode', 'pan-mode', 'panning', 'gg-cropping'];

const isMac = () => {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent || '');
};

function describe(target: LinkTarget, mod: string): string | null {
  switch (target.kind) {
    case 'page':
      return `${mod}クリックで移動: ${target.title}`;
    case 'anchor':
      return `${mod}クリックで移動: このページの${target.hash ? ` #${target.hash}` : '先頭'}`;
    case 'external': {
      let host = target.url;
      try {
        host = new URL(target.url).host;
      } catch {
        /* URL のまま */
      }
      return `${mod}クリックで新しいタブ: ${host}`;
    }
    case 'unresolved':
      return 'このリンク先はページ一覧にありません';
    default:
      return null;
  }
}

export interface LinkNavigationOptions {
  /** href(属性の値そのまま)をリンク先に解く。呼ぶたびに最新のページ一覧で解く */
  resolve: (href: string) => LinkTarget;
  /**
   * 移る。知らせたいこと(移れなかった理由など)があれば文字列を返す。
   * iframeDoc はクリックされた紙面
   */
  navigate: (target: LinkTarget, iframeDoc: Document) => string | void | Promise<string | void>;
}

/**
 * 紙面(iframe の文書)に ⌘ / Ctrl + クリックの移動を付ける。戻り値は後始末
 */
export function attachLinkNavigation(iframeDoc: Document, options: LinkNavigationOptions): () => void {
  const win = iframeDoc.defaultView;
  const frameEl = (win?.frameElement as HTMLElement | null) ?? null;
  const hostDoc = frameEl?.ownerDocument ?? null;
  const hostWin = hostDoc?.defaultView ?? null;
  const mac = isMac();
  const mod = mac ? '⌘ ' : 'Ctrl + ';
  const navKey = (e: MouseEvent | KeyboardEvent) => (mac ? e.metaKey : e.ctrlKey || e.metaKey);
  const isNavKeyName = (key: string) => key === 'Meta' || (!mac && key === 'Control');

  let pointer: { x: number; y: number } | null = null;
  let modifier = false;
  let pending: { href: string; link: HTMLAnchorElement; x: number; y: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hint: HTMLDivElement | null = null;
  let notice: HTMLDivElement | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  /** 後始末の後に(非同期の navigate の結果で)吹き出しを作り直さない */
  let disposed = false;

  // ---- 案内の吹き出し(親の文書に置く: キャンバスの外側の倍率で文字が縮まないように)
  const bubble = (role: 'hint' | 'notice'): HTMLDivElement | null => {
    if (disposed || !hostDoc?.body) return null;
    const el = hostDoc.createElement('div');
    el.setAttribute('data-link-nav-' + role, '');
    if (role === 'notice') {
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
    }
    Object.assign(el.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      zIndex: '2147483000',
      pointerEvents: 'none',
      maxWidth: '360px',
      padding: '4px 8px',
      borderRadius: '6px',
      background: role === 'notice' ? 'rgba(30, 30, 30, 0.95)' : 'rgba(0, 0, 0, 0.85)',
      color: '#fff',
      font: '500 12px/1.5 system-ui, -apple-system, "Hiragino Sans", "Segoe UI", sans-serif',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
    } satisfies Partial<CSSStyleDeclaration>);
    el.hidden = true;
    hostDoc.body.appendChild(el);
    return el;
  };
  /** 紙面の座標(iframe のビューポート) → 親の画面の座標。キャンバスでは iframe ごと縮んでいる */
  const toHost = (x: number, y: number) => {
    if (!frameEl) return { x, y };
    const r = frameEl.getBoundingClientRect();
    const s = r.width / (frameEl.clientWidth || r.width) || 1;
    return { x: r.left + x * s, y: r.top + y * s };
  };
  const place = (el: HTMLElement, x: number, y: number) => {
    const p = toHost(x, y);
    const vw = hostWin?.innerWidth ?? 0;
    const vh = hostWin?.innerHeight ?? 0;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(4, Math.min(p.x + 14, vw - w - 4));
    const top = p.y + 20 + h > vh - 4 ? p.y - h - 8 : p.y + 20;
    el.style.left = `${left}px`;
    el.style.top = `${Math.max(4, top)}px`;
  };
  const showNotice = (text: string, x: number, y: number) => {
    notice ??= bubble('notice');
    if (!notice) return;
    notice.textContent = text;
    notice.hidden = false;
    place(notice, x, y);
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      if (notice) notice.hidden = true;
    }, 2400);
  };

  const blocked = () => BLOCKING_BODY_CLASSES.some((c) => iframeDoc.body?.classList.contains(c));

  /** 点の下のリンク。選択枠の上から押しても、その下の紙面のリンクを拾う */
  const linkAt = (x: number, y: number) => {
    const stack =
      typeof iframeDoc.elementsFromPoint === 'function'
        ? iframeDoc.elementsFromPoint(x, y)
        : [iframeDoc.elementFromPoint(x, y)].filter((e): e is Element => !!e);
    const under = stack.find((el) => !el.closest(OVERLAY_SELECTOR));
    const link = under?.closest<HTMLAnchorElement>('a[href]');
    if (!under || !link || !link.closest('#artboard')) return null;
    // テキスト編集中の要素の中では移らない(文字を直している途中にページが変わらないように)
    if (under.closest('[contenteditable="true"]')) return null;
    return link;
  };

  const disarm = () => {
    iframeDoc.documentElement?.removeAttribute(LINK_NAV_ATTR);
    if (hint) hint.hidden = true;
  };

  /** ⌘ / Ctrl を押してリンクの上にいれば、指のカーソルと行き先の案内を出す */
  const update = (buttons = 0) => {
    if (!modifier || !pointer || buttons !== 0 || blocked()) {
      disarm();
      return;
    }
    const link = linkAt(pointer.x, pointer.y);
    const target = link ? options.resolve(link.getAttribute('href') ?? '') : null;
    const label = target ? describe(target, mod) : null;
    if (!target || !label) {
      disarm();
      return;
    }
    if (target.kind === 'unresolved') iframeDoc.documentElement?.removeAttribute(LINK_NAV_ATTR);
    else iframeDoc.documentElement?.setAttribute(LINK_NAV_ATTR, '');
    hint ??= bubble('hint');
    if (!hint) return;
    if (hint.textContent !== label) hint.textContent = label;
    hint.hidden = false;
    place(hint, pointer.x, pointer.y);
  };

  const cancel = () => {
    pending = null;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    pointer = { x: e.clientX, y: e.clientY };
    const next = navKey(e);
    if (next || modifier) {
      modifier = next;
      update(e.buttons);
    }
  };
  const onMouseLeave = () => {
    pointer = null;
    disarm();
  };
  // mouseleave は文書に届かないことがあるので、文書の外へ出た mouseout(relatedTarget が無い)でも消す
  const onMouseOut = (e: MouseEvent) => {
    if (!e.relatedTarget) onMouseLeave();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cancel();
    if (!isNavKeyName(e.key)) {
      // ⌘ を離したことに気づけなかった(別のウィンドウで離した等)ときの戻し
      if (modifier && !navKey(e)) {
        modifier = false;
        disarm();
      }
      return;
    }
    modifier = e.type === 'keydown' ? true : navKey(e);
    update();
  };
  const onBlur = () => {
    modifier = false;
    disarm();
  };

  const onMouseDown = (e: MouseEvent) => {
    // 2 回目の mousedown(ダブルクリック)・別のクリックが来たら、前の移動は取り消す
    cancel();
    if (e.button !== 0 || !navKey(e) || e.shiftKey || e.altKey) return;
    if (e.detail > 1 || blocked()) return;
    // 選択枠のハンドル(リサイズ・回転)を押したのはハンドルの操作。下にリンクがあっても移らない
    if ((e.target as Element | null)?.closest?.('[data-handle]')) return;
    const link = linkAt(e.clientX, e.clientY);
    if (!link) return;
    pending = { href: link.getAttribute('href') ?? '', link, x: e.clientX, y: e.clientY };
  };
  const moved = (e: MouseEvent, p: { x: number; y: number }) =>
    Math.abs(e.clientX - p.x) > MARQUEE_DRAG_THRESHOLD || Math.abs(e.clientY - p.y) > MARQUEE_DRAG_THRESHOLD;
  const onMouseUp = (e: MouseEvent) => {
    // ⌘ + ドラッグ(自由配置)だった
    if (pending && moved(e, pending)) pending = null;
  };
  const onClick = (e: MouseEvent) => {
    const p = pending;
    pending = null;
    if (!p || e.button !== 0 || e.detail > 1) return;
    if (!navKey(e) || e.shiftKey || e.altKey || moved(e, p)) return;
    timer = setTimeout(() => {
      timer = null;
      // 待っている間にテキスト編集に入った・紙面が差し替わった・モードが変わった
      if (!p.link.isConnected || p.link.closest('[contenteditable="true"]') || blocked()) return;
      if (linkAt(p.x, p.y) !== p.link) return;
      disarm();
      const target = options.resolve(p.href);
      void Promise.resolve(options.navigate(target, iframeDoc)).then((message) => {
        if (message) showNotice(message, p.x, p.y);
      });
    }, LINK_NAV_DELAY_MS);
  };

  const capture = { capture: true } as const;
  iframeDoc.addEventListener('mousemove', onMouseMove, { capture: true, passive: true });
  iframeDoc.addEventListener('mouseleave', onMouseLeave);
  iframeDoc.addEventListener('mouseout', onMouseOut);
  iframeDoc.addEventListener('keydown', onKey, capture);
  iframeDoc.addEventListener('keyup', onKey, capture);
  iframeDoc.addEventListener('mousedown', onMouseDown, capture);
  iframeDoc.addEventListener('mouseup', onMouseUp, capture);
  iframeDoc.addEventListener('click', onClick, capture);
  iframeDoc.addEventListener('dblclick', cancel, capture);
  iframeDoc.addEventListener('contextmenu', cancel, capture);
  win?.addEventListener('blur', onBlur);
  hostWin?.addEventListener('keydown', onKey, capture);
  hostWin?.addEventListener('keyup', onKey, capture);
  hostWin?.addEventListener('blur', onBlur);

  return () => {
    disposed = true;
    cancel();
    iframeDoc.removeEventListener('mousemove', onMouseMove, capture);
    iframeDoc.removeEventListener('mouseleave', onMouseLeave);
    iframeDoc.removeEventListener('mouseout', onMouseOut);
    iframeDoc.removeEventListener('keydown', onKey, capture);
    iframeDoc.removeEventListener('keyup', onKey, capture);
    iframeDoc.removeEventListener('mousedown', onMouseDown, capture);
    iframeDoc.removeEventListener('mouseup', onMouseUp, capture);
    iframeDoc.removeEventListener('click', onClick, capture);
    iframeDoc.removeEventListener('dblclick', cancel, capture);
    iframeDoc.removeEventListener('contextmenu', cancel, capture);
    win?.removeEventListener('blur', onBlur);
    hostWin?.removeEventListener('keydown', onKey, capture);
    hostWin?.removeEventListener('keyup', onKey, capture);
    hostWin?.removeEventListener('blur', onBlur);
    if (noticeTimer) clearTimeout(noticeTimer);
    try {
      iframeDoc.documentElement?.removeAttribute(LINK_NAV_ATTR);
    } catch {
      /* 文書が既に捨てられている */
    }
    hint?.remove();
    notice?.remove();
  };
}
