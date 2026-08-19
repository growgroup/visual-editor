'use client';

/**
 * Alt(Option)ホバーの距離メジャー(Figmaと同じ操作)。
 *
 * 要素を選択した状態でAltを押しながらカーソルを動かすと、
 * カーソル下の要素との距離を赤い線で表示する(measure-distance.ts)。
 * - 選択要素自身(またはその内側)の上では親要素と測る(Figmaの余白表示に相当)
 * - Altを離す・カーソルが外へ出る・選択が消えると消える
 */

import { useEffect } from 'react';
import { useEditorContext } from '../EditorContext';
import { drawMeasure, clearMeasure } from '../utils/measure-distance';

export function useAltMeasure() {
  const { getIframeDoc, iframeReady } = useEditorContext();

  useEffect(() => {
    const doc = getIframeDoc();
    if (!doc) return;

    const onMouseMove = (e: MouseEvent) => {
      if (!e.altKey) {
        clearMeasure(doc);
        return;
      }
      // 選択はReact状態でなくDOMを見る(伝播ラグと依存の張り直しを避ける)
      const sel = doc.querySelector<HTMLElement>('.selected');
      if (!sel || doc.body.classList.contains('gg-cropping')) {
        clearMeasure(doc);
        return;
      }
      let target =
        (e.target as HTMLElement)?.closest?.<HTMLElement>('[data-element-id], [data-editable="true"]') ?? null;
      // 選択要素の上(または内側)では親と測る = 余白の確認
      if (!target || target === sel || sel.contains(target)) {
        target =
          (sel.parentElement?.closest<HTMLElement>('[data-element-id], [data-editable="true"]') as HTMLElement) ??
          doc.getElementById('artboard');
      }
      if (!target || target === sel) {
        clearMeasure(doc);
        return;
      }
      drawMeasure(doc, sel, target);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') clearMeasure(doc);
    };
    const onLeaveOrBlur = () => clearMeasure(doc);

    doc.addEventListener('mousemove', onMouseMove);
    doc.addEventListener('keyup', onKeyUp);
    doc.addEventListener('mouseleave', onLeaveOrBlur);
    doc.defaultView?.addEventListener('blur', onLeaveOrBlur);

    return () => {
      clearMeasure(doc);
      doc.removeEventListener('mousemove', onMouseMove);
      doc.removeEventListener('keyup', onKeyUp);
      doc.removeEventListener('mouseleave', onLeaveOrBlur);
      doc.defaultView?.removeEventListener('blur', onLeaveOrBlur);
    };
  }, [getIframeDoc, iframeReady]);
}
