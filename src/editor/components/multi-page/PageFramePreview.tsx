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
 */

import { memo, useEffect, useRef, useState } from 'react';
import { useMultiPageCanvas, type PageFrameLayout } from '../../contexts/MultiPageCanvasContext';
import { generatePreviewHtml } from '../../utils/html-utils';

interface PageFramePreviewProps {
  page: PageFrameLayout;
  /** 画面上の判定に使う容器(IntersectionObserver の root) */
  rootRef: React.RefObject<HTMLDivElement | null>;
}

export const PageFramePreview = memo(function PageFramePreview({ page, rootRef }: PageFramePreviewProps) {
  const { editorMode, ensurePageHtml, setPageHeight, previewStyles, requestPreviewSlot, releasePreviewSlot } = useMultiPageCanvas();
  const hostRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [loaded, setLoaded] = useState(false);

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
  // slide は寸法が決まっているので見えたときだけ。どちらも同時に読む枚数は絞る(順番待ち)
  const wantsMount = editorMode === 'webpage' || nearViewport;
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
  const shouldMount = granted;

  useEffect(() => {
    if (shouldMount && page.html == null && !page.loading && !page.error) void ensurePageHtml(page.id);
  }, [shouldMount, page.html, page.loading, page.error, page.id, ensurePageHtml]);

  // 本文が変わったら描き直す
  const [doc, setDoc] = useState<string | null>(null);
  useEffect(() => {
    if (!shouldMount || page.html == null) return;
    setDoc(generatePreviewHtml(page.html, editorMode, page.size.width, previewStyles));
  }, [shouldMount, page.html, editorMode, page.size.width, previewStyles]);

  // 高さの実測(同一オリジンなので親から読む)
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || doc == null) return;
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
    return () => {
      disposed = true;
      iframe.removeEventListener('load', onLoad);
      observer?.disconnect();
    };
  }, [doc, page.id, setPageHeight]);

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

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 overflow-hidden"
      data-page-preview={page.id}
      style={{ background: '#fff' }}
    >
      {doc != null ? (
        <iframe
          ref={iframeRef}
          title={page.title || page.id}
          srcDoc={doc}
          sandbox="allow-same-origin"
          tabIndex={-1}
          aria-hidden="true"
          className="block border-0"
          style={{
            width: page.size.width,
            height: page.size.height,
            pointerEvents: 'none',
          }}
        />
      ) : (
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
      )}
    </div>
  );
});
