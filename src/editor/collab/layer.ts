'use client';

/**
 * 紙面の中に、他人の選択枠(名前札)とカーソルを描く(.gg-collab-layer)。
 * コメントのピン(.gg-comment-layer)と同じ作り: #artboard の中の表示専用の層で、座標は紙面の px。
 * 線の太さ・名前札の大きさは「内側の倍率 × 外側のキャンバス倍率」で割って画面上で一定に保つ。
 * 保存 HTML(getCleanHtml)・履歴・共有する本文には入らない
 */

import { useEffect } from 'react';
import { findAnchored } from '../components/ppt/PptComments';
import { useCanvasViewStateOptional } from '../contexts/MultiPageCanvasContext';
import { collabStore } from './store';

/** 要素の移動・編集にゆるく追従する間隔(ms) */
const RENDER_INTERVAL_MS = 400;

const CURSOR_SVG =
  '<svg viewBox="0 0 16 16" width="16" height="16" style="display:block;overflow:visible">' +
  '<path d="M1 1 L1 13.5 L4.6 10.1 L7.1 15.2 L9.4 14.1 L6.9 9.1 L11.8 9.1 Z" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>';

/** 同じ値の再代入をしない(無駄な再計算を起こさない) */
function applyStyles(el: HTMLElement, styles: Record<string, string>) {
  const style = el.style as unknown as Record<string, string>;
  for (const [key, value] of Object.entries(styles)) {
    if (style[key] !== value) style[key] = value;
  }
}

export function useCollabLayer(doc: Document | null, enabled: boolean): void {
  const outerZoom = useCanvasViewStateOptional()?.canvasZoom ?? 1;

  useEffect(() => {
    if (!enabled || !doc) return;
    let alive = true;

    const render = () => {
      if (!alive || !doc.defaultView) return;
      const artboard = doc.getElementById('artboard');
      if (!artboard) return;
      const peers = collabStore.get().pagePeers;
      let layer = artboard.querySelector<HTMLElement>(':scope > .gg-collab-layer');
      if (!layer) {
        if (peers.length === 0) return;
        layer = doc.createElement('div');
        layer.className = 'gg-collab-layer';
        layer.setAttribute('aria-hidden', 'true');
        layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:9001;overflow:visible;';
        artboard.appendChild(layer);
      }
      const root = artboard.getBoundingClientRect();
      const inner = root.width / (artboard.offsetWidth || 1) || 1;
      const scale = inner * outerZoom || 1;
      const wanted = new Set<string>();
      const ensure = (key: string, build: () => HTMLElement): HTMLElement => {
        let el = layer!.querySelector<HTMLElement>(`:scope > [data-collab-key="${CSS.escape(key)}"]`);
        if (!el) {
          el = build();
          el.setAttribute('data-collab-key', key);
          layer!.appendChild(el);
        }
        wanted.add(key);
        return el;
      };
      const nameTag = (label: string, color: string): HTMLElement => {
        const tag = doc.createElement('span');
        tag.setAttribute('data-collab-name', '');
        tag.textContent = label;
        tag.style.background = color;
        return tag;
      };

      for (const peer of peers) {
        const anchors = [...peer.selection];
        if (peer.editing && !anchors.includes(peer.editing)) anchors.push(peer.editing);
        anchors.forEach((anchor, index) => {
          const target = findAnchored(artboard, anchor);
          if (!target) return;
          const r = target.getBoundingClientRect();
          const editing = anchor === peer.editing;
          const box = ensure(`sel:${peer.clientId}:${index}`, () => {
            const el = doc.createElement('div');
            el.setAttribute('data-collab-selection', String(peer.clientId));
            el.appendChild(nameTag('', peer.user.color));
            return el;
          });
          box.setAttribute('data-collab-user', peer.user.id);
          box.toggleAttribute('data-collab-editing', editing);
          applyStyles(box, {
            position: 'absolute',
            left: `${(r.left - root.left) / inner}px`,
            top: `${(r.top - root.top) / inner}px`,
            width: `${r.width / inner}px`,
            height: `${r.height / inner}px`,
            boxSizing: 'border-box',
            border: `${2 / scale}px ${editing ? 'dashed' : 'solid'} ${peer.user.color}`,
            borderRadius: `${2 / scale}px`,
          });
          const tag = box.firstElementChild as HTMLElement;
          const label = editing ? `${peer.user.name}(入力中)` : peer.user.name;
          if (tag.textContent !== label) tag.textContent = label;
          applyStyles(tag, {
            position: 'absolute',
            left: `${-2 / scale}px`,
            bottom: '100%',
            marginBottom: `${2 / scale}px`,
            background: peer.user.color,
            color: '#fff',
            font: `600 ${11 / scale}px/1.35 system-ui, -apple-system, sans-serif`,
            padding: `${1 / scale}px ${5 / scale}px`,
            borderRadius: `${3 / scale}px`,
            whiteSpace: 'nowrap',
          });
        });

        if (peer.cursor) {
          const cursor = ensure(`cur:${peer.clientId}`, () => {
            const el = doc.createElement('div');
            el.setAttribute('data-collab-cursor', String(peer.clientId));
            el.innerHTML = CURSOR_SVG;
            el.appendChild(nameTag(peer.user.name, peer.user.color));
            return el;
          });
          cursor.setAttribute('data-collab-user', peer.user.id);
          applyStyles(cursor, {
            position: 'absolute',
            left: `${peer.cursor.x}px`,
            top: `${peer.cursor.y}px`,
            transform: `scale(${1 / scale})`,
            transformOrigin: '0 0',
          });
          const path = cursor.querySelector('path');
          if (path && path.getAttribute('fill') !== peer.user.color) path.setAttribute('fill', peer.user.color);
          const tag = cursor.querySelector<HTMLElement>('[data-collab-name]')!;
          if (tag.textContent !== peer.user.name) tag.textContent = peer.user.name;
          applyStyles(tag, {
            position: 'absolute',
            left: '12px',
            top: '15px',
            background: peer.user.color,
            color: '#fff',
            font: '600 11px/1.35 system-ui, -apple-system, sans-serif',
            padding: '1px 5px',
            borderRadius: '3px',
            whiteSpace: 'nowrap',
          });
        }
      }
      layer.querySelectorAll<HTMLElement>(':scope > [data-collab-key]').forEach((el) => {
        if (!wanted.has(el.getAttribute('data-collab-key') ?? '')) el.remove();
      });
    };

    render();
    const unsubscribe = collabStore.subscribe(render);
    const timer = setInterval(render, RENDER_INTERVAL_MS);
    return () => {
      alive = false;
      unsubscribe();
      clearInterval(timer);
      try {
        doc.querySelector('#artboard > .gg-collab-layer')?.remove();
      } catch {
        /* 文書が既に無い */
      }
    };
  }, [doc, enabled, outerZoom]);
}
