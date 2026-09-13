/**
 * 他人の変更(共有する本文)を、編集中の紙面(#artboard)へ当てる。idiomorph で差分だけを書き換え、
 * エディタが紙面に持っているもの(選択・編集用の属性・一時クラス・選択枠などの表示専用ノード)は残す。
 */

import { Idiomorph } from 'idiomorph';

/** 紙面の中身ではなく、エディタが差し込んでいる表示専用のノード。当て込みの間だけ外して、あとで戻す */
const PRESERVE_SELECTOR = [
  '.selection-box',
  '.marquee-selection-box',
  '.drag-ghost',
  '.flex-drop-indicator',
  '.nesting-drop-indicator',
  '.auto-layout-drop-indicator',
  '.drawing-preview',
  '.gg-comment-layer',
  '.gg-collab-layer',
  '.gg-crop-ui',
  '#gg-measure-layer',
  '#gg-smart-guides',
  '#gg-reorder-indicator',
].join(',');

/**
 * エディタだけが付ける属性。共有する本文(getCleanHtml)には無いので、当てるときに消させない。
 * data-gg-base / data-gg-prestyle / data-gg-pre-overflow は開いた直後の指紋(保存時の書き戻しの判定に使う)
 */
const EDITOR_ATTRS = new Set([
  'contenteditable',
  'data-editable',
  'data-element-id',
  'data-shape-type',
  'data-inline',
  'data-gg-base',
  'data-gg-prestyle',
  'data-gg-pre-overflow',
]);

/** getCleanHtml が消す一時クラス。class 属性は丸ごと置き換わるので、当てたあとに付け直す */
const TRANSIENT_CLASSES = [
  'selected', 'dragging', 'editing', 'rotating', 'panning',
  'hover-preview', 'marquee-hover', 'marquee-active', 'text-editable-hover', 'drag-ghost',
];

const isEditorAttr = (name: string) => EDITOR_ATTRS.has(name) || name.startsWith('data-original-');

/** 比べるための姿(エディタの属性・一時クラス・表示専用ノード・書き戻しの印を除く) */
function comparableHtml(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(PRESERVE_SELECTOR).forEach((n) => n.remove());
  for (const node of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const attr of Array.from(node.attributes)) {
      if (isEditorAttr(attr.name) || attr.name === 'data-gg-dirty') node.removeAttribute(attr.name);
    }
    node.classList.remove(...TRANSIENT_CLASSES);
    if (node.getAttribute('class') === '') node.removeAttribute('class');
  }
  return clone.outerHTML;
}

/**
 * 紙面を html の姿にする。
 * hold(打鍵中の要素)には触らない。hold に掛かる変更があったら heldChanged が立つ(blur のあとにもう一度当てる)
 */
export function morphArtboard(artboard: HTMLElement, html: string, hold: HTMLElement | null): { heldChanged: boolean } {
  // 表示専用のノード(一番外側だけ)を外す。消させないだけだと、似た形の本文の要素として使い回されることがある
  const chrome = Array.from(artboard.querySelectorAll<HTMLElement>(PRESERVE_SELECTOR)).filter(
    (el) => !el.parentElement?.closest(PRESERVE_SELECTOR),
  );
  const placements = chrome.map((el) => ({ el, parent: el.parentElement, next: el.nextSibling }));
  chrome.forEach((el) => el.remove());

  const transient: [Element, string[]][] = [];
  artboard.querySelectorAll(TRANSIENT_CLASSES.map((c) => `.${c}`).join(',')).forEach((el) => {
    transient.push([el, TRANSIENT_CLASSES.filter((c) => el.classList.contains(c))]);
  });

  let heldChanged = false;
  try {
    Idiomorph.morph(artboard, html, {
      morphStyle: 'innerHTML',
      callbacks: {
        beforeNodeMorphed: (oldNode, newNode) => {
          if (hold && oldNode === hold) {
            if (!heldChanged && (newNode.nodeType !== 1 || comparableHtml(hold) !== comparableHtml(newNode as Element))) {
              heldChanged = true;
            }
            return false;
          }
          return true;
        },
        beforeNodeRemoved: (node) => {
          if (hold && (node === hold || node.contains?.(hold))) {
            heldChanged = true;
            return false;
          }
          return true;
        },
        beforeAttributeUpdated: (name, _node, mutation) => !(mutation === 'remove' && isEditorAttr(name)),
      },
    });
  } finally {
    for (const [el, classes] of transient) {
      if (el.isConnected) el.classList.add(...classes);
    }
    for (const { el, parent, next } of placements) {
      const target = parent && artboard.contains(parent) ? parent : artboard;
      target.insertBefore(el, next && next.parentNode === target ? next : null);
    }
  }
  return { heldChanged };
}
