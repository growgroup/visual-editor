'use client';

import { useEffect } from 'react';
import { useEditorContext } from '../../EditorContext';
import type { PptTheme } from '../ppt/PptChrome';

/** 紙面のHTMLにはスタイルを追加せず、保存対象外のキャンバスの器だけを配色する。 */
export function CanvasAppearance({ theme }: { theme: PptTheme }) {
  const { iframeReady, getIframeDoc } = useEditorContext();
  useEffect(() => {
    const doc = getIframeDoc();
    if (!doc) return;
    const color = theme === 'dark' ? '#191d24' : '#eef1f5';
    doc.body.style.backgroundColor = color;
    const container = doc.getElementById('canvas-container');
    if (container) container.style.backgroundColor = color;
  }, [theme, iframeReady, getIframeDoc]);
  return null;
}
