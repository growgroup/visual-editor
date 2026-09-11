/**
 * 部品モード(?mode=parts)の見本。
 * Tailwind に依存しないよう inline style で書く(playground は CSS を持たない)。
 * ページには ContactBand が 1 つ実体化されている(data-part / data-slot 付き)。
 */
import type { EditorPartDef, EditorPartsLibrary, CSSVariableDefinition } from '../src/index';

const sec = (extra = '') => `padding:48px 64px;border-top:1px solid #ddd;${extra}`;

export const partsLibrary: EditorPartsLibrary = {
  categories: [
    { id: 'block', name: 'ブロック', description: '本文のセクション' },
    { id: 'annotation', name: '注釈', description: '右カラムの注釈' },
  ],
  parts: [
    {
      id: 'ContactBand',
      name: 'お問合せ帯',
      category: 'block',
      description: '全ページ共通の CTA 帯。見出しと説明がスロット',
      version: 1,
      html: `<section style="${sec('background:#f5f5f5;text-align:center')}"><h2 data-slot="heading" style="font-size:28px;margin:0 0 12px">お問い合わせ</h2><div data-slot="body"><p style="font-size:16px;color:#555;margin:0 0 24px">お気軽にご相談ください。</p></div><a style="display:inline-block;padding:14px 40px;background:#222;color:#fff;text-decoration:none">お問合せフォームへ</a></section>`,
    },
    {
      id: 'SectionHeading',
      name: 'セクション見出し',
      category: 'block',
      version: 2,
      html: `<div style="padding:32px 64px 0"><p data-slot="eyebrow" style="font-size:12px;letter-spacing:.1em;color:#888;margin:0 0 8px">EYEBROW</p><h2 data-slot="heading" style="font-size:26px;margin:0">見出しが入ります</h2></div>`,
    },
    {
      id: 'AnnotationSection',
      name: '注釈セクション',
      category: 'annotation',
      description: '右カラム。1〜3 本まで',
      version: 1,
      html: `<article style="border:1px solid #d4d4d4;padding:20px;background:#fff"><h3 data-slot="title" style="font-size:14px;margin:0 0 8px">注釈の見出し</h3><div data-slot="body"><p style="font-size:12px;line-height:1.7;margin:0">この部分の意図を 1〜2 文で書く。</p></div></article>`,
    },
  ],
};

/** ページ。ContactBand の実体化インスタンスが 1 つ入っている */
export const partsPage = `<main style="display:grid;grid-template-columns:minmax(0,1fr) 420px;width:100%;font-family:system-ui,sans-serif;color:#242424;background:white">
<div data-wf-body style="min-width:0">
<header style="padding:24px 64px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between"><strong style="font-size:22px">サンプル工業</strong><nav style="font-size:15px">事業紹介　　会社情報　　採用情報　　お問合せ</nav></header>
<section style="${sec()}"><h1 style="font-size:40px;margin:0 0 16px">部品モードの動作確認</h1><p style="font-size:18px;line-height:1.8;margin:0">左の部品パネルからドロップすると、定義が実体化されてページに残ります。<br>下の CTA 帯はすでに実体化されたインスタンスで、見出しと説明(スロット)だけ編集できます。</p></section>
<section data-part="ContactBand" data-part-v="1" style="${sec('background:#f5f5f5;text-align:center')}"><h2 data-slot="heading" style="font-size:28px;margin:0 0 12px">採用に関するお問い合わせ</h2><div data-slot="body"><p style="font-size:16px;color:#555;margin:0 0 24px">中途採用・新卒採用のご相談を受け付けています。</p></div><a style="display:inline-block;padding:14px 40px;background:#222;color:#fff;text-decoration:none">お問合せフォームへ</a></section>
<footer style="padding:40px 64px;font-size:14px;border-top:1px solid #ddd">サンプル工業株式会社</footer>
</div>
<aside data-wf-annotations style="padding:32px;background:#f5f5f5;border-left:1px solid #ddd;display:flex;flex-direction:column;gap:20px"><p style="margin:0;font-size:16px;line-height:1.7;color:#a42323">※デザイン部分は次工程で定めていきます</p></aside>
</main>`;

/** CSS 変数の見本(io.loadVariables / saveVariables のメモリ実装が返す) */
export const variablesSeed: CSSVariableDefinition[] = [
  { id: 'color-wf-ink', name: '文字', cssName: '--color-wf-ink', value: '#1a1a1a', category: 'color' },
  { id: 'color-wf-line', name: '罫線', cssName: '--color-wf-line', value: '#e0e0e0', category: 'color' },
  { id: 'color-wf-red', name: '赤字(ダミー)', cssName: '--color-wf-red', value: '#cc0000', category: 'color' },
  { id: 'spacing-gutter', name: 'ガター', cssName: '--spacing-gutter', value: '40px', category: 'spacing', numericMeta: { unit: 'px', numericValue: 40 } },
];

export type PartsStore = {
  parts: Map<string, EditorPartDef>;
  variables: CSSVariableDefinition[];
  log: { op: string; id?: string; at: string }[];
};

export function createPartsStore(): PartsStore {
  return {
    parts: new Map(partsLibrary.parts.map((p) => [p.id, structuredClone(p)])),
    variables: structuredClone(variablesSeed),
    log: [],
  };
}
