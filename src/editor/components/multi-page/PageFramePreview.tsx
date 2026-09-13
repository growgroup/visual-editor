'use client';

/**
 * 見るだけの紙面(編集していないページ)。
 *
 * 生きているエディタは 1 つだけなので、他のページは srcdoc の iframe で描く。
 * - 編集用の属性は付けない(触れない。クリックはフレーム側が受けて、そのページへ編集を移す)
 * - 同一オリジンなので #artboard の高さを親から直接測る(ResizeObserver)。
 *   フォントや画像の読み込みで高さが変わっても追従する
 * - 画面から遠いものは描かない(IntersectionObserver)。webpage は高さの実測が
 *   レイアウトに要るので、順番に少しずつ先読みする(eagerMountCount)
 * - iframe に sandbox は付けない。script は本文から外してある(generatePreviewHtml)。
 *   sandbox で script を禁じると、ページへ script を差し込むブラウザ拡張(React DevTools 等)が
 *   1 枚ごとに「Blocked script execution in 'about:srcdoc'」をコンソールへ出す(実測 26 枚 = 26 件)
 * - 本文が外から変わった(revision / invalidatePages)ときは、次の本文が来るまで前の姿を出したまま読み直す
 * - 文書の属性(documentAttributes)は読み直さずに <html> へ付け替える
 *
 * [大きく縮小している間は画像]
 * 全体が見えるところまで縮めると、26 枚の iframe を倍率が変わるたびにラスタライズし直す
 * のが一番重い。利用側が contentList[].thumbnail(ページ全体を写した画像)を渡していれば、
 * 倍率が PREVIEW_IMAGE_ZOOM 未満の間は iframe を外して画像 1 枚にする(本文も読まない)。
 * 画像が無いページ・画像が読めなかったページは今までどおり iframe
 */

import { memo, useEffect, useRef, useState } from 'react';
import { useMultiPageCanvas, type PageFrameLayout } from '../../contexts/MultiPageCanvasContext';
import type { DocumentAttributes } from '../../contexts/EditorArtboardContext';
import { generatePreviewHtml } from '../../utils/html-utils';

/** 文書の <html> に属性を付ける(null / undefined は外す)。エディタ本体(EditorCanvas)も同じ関数を使う */
export function applyDocumentAttributes(doc: Document | null | undefined, attrs: DocumentAttributes): void {
  const root = doc?.documentElement;
  if (!root) return;
  for (const [name, value] of Object.entries(attrs)) {
    if (!/^[A-Za-z_:][\w:.-]*$/.test(name)) continue;
    if (value == null) root.removeAttribute(name);
    else if (root.getAttribute(name) !== value) root.setAttribute(name, value);
  }
}

interface PageFramePreviewProps {
  page: PageFrameLayout;
  /** 画面上の判定に使う容器(IntersectionObserver の root) */
  rootRef: React.RefObject<HTMLDivElement | null>;
  /** キャンバスが大きく縮小されている(親が操作の終わりに決める。段ごとには変わらない) */
  imageMode?: boolean;
  /**
   * 画像を裏で先に読んでおく。縮小の途中(倍率 0.4 未満)で iframe を止めて画像を前に出すのは
   * CSS の仕事だが、そのとき画像が読めていないと空白のフレームになる。だから先に読ませる
   */
  preloadImage?: boolean;
}

export const PageFramePreview = memo(function PageFramePreview({ page, rootRef, imageMode = false, preloadImage = false }: PageFramePreviewProps) {
  const { editorMode, ensurePageHtml, setPageHeight, previewStyles, requestPreviewSlot, releasePreviewSlot, documentAttributes, reportThumbnailWidth } = useMultiPageCanvas();
  const documentAttributesRef = useRef(documentAttributes);
  documentAttributesRef.current = documentAttributes;
  const hostRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // 画像の URL が変わったら、前の URL で失敗した記録は捨てる(直った画像が二度と出ないのを防ぐ)
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setImageFailed(false); }, [page.thumbnail]);
  const [imageLoaded, setImageLoaded] = useState(false);
  useEffect(() => { setImageLoaded(false); }, [page.thumbnail]);
  const useImage = imageMode && !!page.thumbnail && !imageFailed;

  // 画面に近づいたら描く(遠ざかっても消さない: 戻ったときに白く抜けないため)
  useEffect(() => {
    const host = hostRef.current;
    const root = rootRef.current;
    if (!host || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNearViewport(true);
      },
      { root, rootMargin: '150% 150%' },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [rootRef]);

  // webpage は高さの実測がレイアウトに要る(未測定だと仮の高さで並ぶ)ので、見えていなくても読む。
  // slide は寸法が決まっているので見えたときだけ。どちらも同時に読む枚数は絞る(順番待ち)。
  // 画像で描いている間は本文を読まない(iframe も載せない)
  const wantsMount = !useImage && (editorMode === 'webpage' || nearViewport);
  const [granted, setGranted] = useState(false);
  const grantedRef = useRef(false);
  useEffect(() => {
    if (!wantsMount || grantedRef.current) return;
    requestPreviewSlot(page.id, () => {
      grantedRef.current = true;
      setGranted(true);
    });
    // 見えなくなった: 順番待ちから外す(読み始めていれば載せたまま)
    return () => {
      if (!grantedRef.current) releasePreviewSlot(page.id);
    };
  }, [wantsMount, page.id, requestPreviewSlot, releasePreviewSlot]);
  useEffect(() => () => releasePreviewSlot(page.id), [page.id, releasePreviewSlot]);

  // 画像に落ちたら iframe を外してメモリを返す(戻ってきたら順番待ちから取り直す)
  useEffect(() => {
    if (!useImage) return;
    grantedRef.current = false;
    setGranted(false);
    setLoaded(false);
    releasePreviewSlot(page.id);
  }, [useImage, page.id, releasePreviewSlot]);

  const shouldMount = granted && !useImage;

  useEffect(() => {
    if (shouldMount && page.html == null && !page.loading && !page.error) void ensurePageHtml(page.id);
  }, [shouldMount, page.html, page.loading, page.error, page.id, ensurePageHtml]);

  // 本文が変わったら描き直す
  const [doc, setDoc] = useState<string | null>(null);
  useEffect(() => {
    if (!shouldMount || page.html == null) return;
    setDoc(generatePreviewHtml(page.html, editorMode, page.size.width, previewStyles));
  }, [shouldMount, page.html, editorMode, page.size.width, previewStyles]);

  // 高さの実測(同一オリジンなので親から読む)。
  // shouldMount を deps に入れるのは、画像から iframe に戻ったとき(doc は前のまま)にも
  // 新しい iframe へ load を張り直すため
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || doc == null || !shouldMount) return;
    let observer: ResizeObserver | null = null;
    let disposed = false;
    const measure = () => {
      try {
        const body = iframe.contentDocument?.body;
        const artboard = iframe.contentDocument?.getElementById('artboard');
        const h = artboard?.getBoundingClientRect().height || body?.scrollHeight || 0;
        if (h > 0) setPageHeight(page.id, h, 'preview');
      } catch {
        /* 読めなければ仮の高さのまま */
      }
    };
    const onLoad = () => {
      if (disposed) return;
      setLoaded(true);
      applyDocumentAttributes(iframe.contentDocument, documentAttributesRef.current);
      measure();
      try {
        const artboard = iframe.contentDocument?.getElementById('artboard');
        if (artboard && typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => measure());
          observer.observe(artboard);
        }
        // フォントの読み込みが終わってから測り直す(折り返しが変わる)
        void iframe.contentDocument?.fonts?.ready.then(() => { if (!disposed) measure(); });
      } catch {
        /* cross-origin ではない想定 */
      }
    };
    iframe.addEventListener('load', onLoad);
    // 画像から戻ったときは srcdoc が同じなので load が来ないことがある。読めていればその場で測る
    if (iframe.contentDocument?.readyState === 'complete') onLoad();
    return () => {
      disposed = true;
      iframe.removeEventListener('load', onLoad);
      observer?.disconnect();
    };
  }, [doc, shouldMount, page.id, setPageHeight]);

  // 文書の属性が変わったら、読み直さずに <html> へ付け替える(読み込み前なら onLoad が付ける)
  useEffect(() => {
    if (!loaded) return;
    try {
      applyDocumentAttributes(iframeRef.current?.contentDocument, documentAttributes);
    } catch {
      /* 読めなければ次の読み込みで付く */
    }
  }, [documentAttributes, loaded]);

  // 読み終わった(または読めない)ら枠を返して次へ。本文が来ない場合の安全弁つき
  useEffect(() => {
    if (!granted) return;
    if (loaded || page.error) {
      releasePreviewSlot(page.id);
      return;
    }
    const timer = setTimeout(() => releasePreviewSlot(page.id), 8000);
    return () => clearTimeout(timer);
  }, [granted, loaded, page.error, page.id, releasePreviewSlot]);

  /**
   * 画像を出す(または iframe の下に敷いておく)か。敷いておく理由は 2 つ:
   * - 画像 → iframe に戻る途中、本文が描けるまで下に見せる(26 枚が一度白く抜けない)
   * - 縮小の途中で 0.4 を割ったとき、CSS が iframe を止めるだけで画像に切り替わる
   *   (読めていない画像は data-image-ready が付かないので、iframe を見せたまま)
   */
  const showImage = !!page.thumbnail && !imageFailed && (useImage || preloadImage || !loaded);

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 overflow-hidden"
      data-page-preview={page.id}
      data-preview-mode={useImage ? 'image' : 'iframe'}
      // 画像が読めている = 縮小の途中でも iframe を止めて前に出せる(skin.css が拾う)
      data-image-ready={showImage && imageLoaded ? '1' : undefined}
      style={{ background: '#fff' }}
    >
      {showImage && (
        <img
          src={page.thumbnail}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
          className="absolute inset-0 block"
          style={{
            width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none',
            // iframe と同じ理由。無いと倍率が変わるたびに 26 枚の画像がラスタライズし直され、
            // 画像に落としたのに縮小 p95 が 19〜23ms のままになる(付けると 16ms 台。実測)
            willChange: 'transform',
          }}
          onLoad={(e) => {
            setImageLoaded(true);
            // 画像しか出していないページは iframe が高さを測れない。画像はページと同じ縦横比
            // (利用側との約束)なので、フレームの幅から高さを出して並びを正す
            const img = e.currentTarget;
            if (!img.naturalWidth || !img.naturalHeight) return;
            setPageHeight(page.id, (page.size.width * img.naturalHeight) / img.naturalWidth, 'preview');
            // 画像を出してよい倍率の上限は、いちばん粗い画像に合わせて決まる(にじませないため)
            reportThumbnailWidth(page.id, img.naturalWidth);
          }}
          onError={() => setImageFailed(true)}
        />
      )}
      {useImage ? (
        // 画像がまだ来ていない間は骨組みを下に敷く(白く抜けない)
        !imageLoaded && <div className="ed-frame-skeleton" aria-hidden="true" />
      ) : doc != null ? (
        <iframe
          ref={iframeRef}
          title={page.title || page.id}
          srcDoc={doc}
          tabIndex={-1}
          aria-hidden="true"
          className="relative block border-0"
          style={{
            width: page.size.width,
            height: page.size.height,
            pointerEvents: 'none',
            // ズームで重くならないように。iframe の中身は外側の transform で拡大縮小されるが、
            // will-change が無いと倍率が変わるたびに 26 枚の紙面がラスタライズし直され、
            // 縮小中に 100〜340ms のフレームが混じる(実測)。付けるとラスタが保たれ p95 117ms → 24ms
            willChange: 'transform',
          }}
        />
      ) : (
        !showImage && (
          <div className="ed-frame-skeleton" aria-hidden="true">
            {page.error ? (
              <span className="ed-frame-skeleton-note">読み込めませんでした</span>
            ) : (
              <>
                <span className="ed-frame-skeleton-bar" style={{ width: '38%' }} />
                <span className="ed-frame-skeleton-bar" style={{ width: '72%' }} />
                <span className="ed-frame-skeleton-bar" style={{ width: '56%' }} />
              </>
            )}
          </div>
        )
      )}
    </div>
  );
});
