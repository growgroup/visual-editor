/**
 * 「台帳から挿入」(?mode=inserts)の見本。
 *
 * 利用側(デザインシステムの台帳)の代わりに、目録と 1 件ぶんの HTML をメモリで返す。
 * playground は CSS を持たないので中身は inline style で書く
 * (本番の利用側は Tailwind のクラスが付いたままの HTML を返す)。
 *
 * 見本(previewUrl)は blob: の URL。iframe に読ませるだけなので、
 * 台帳のページをサーバーに用意しなくても確かめられる。
 */
import type { EditorInsertCatalog, EditorInsertItem } from '../src/index';

const sec = (extra = '') => `padding:48px 64px;border-top:1px solid #ddd;${extra}`;

/** 利用側が包む器。エディタはこれを包み直さない */
const wrap = (id: string, inner: string) =>
  `<section class="wf-ds" data-ds="${id}" data-ds-v="1" style="${sec()}">${inner}</section>`;

/** 赤字ダミー(dummy: true)のときに見出し・リード文へ当てる色 */
const DUMMY_COLOR = '#a42323';

type Entry = {
  item: EditorInsertItem;
  /** heading / lead を受け取って中身を作る(dummy の出し分けをここで行う) */
  build: (dummy: boolean) => string;
};

const t = (dummy: boolean, real: string, dummyText: string) => (dummy ? dummyText : real);
const headStyle = (dummy: boolean, size: number) =>
  `font-size:${size}px;margin:0 0 16px;${dummy ? `color:${DUMMY_COLOR}` : ''}`;
const leadStyle = (dummy: boolean) =>
  `font-size:18px;line-height:1.8;margin:0;${dummy ? `color:${DUMMY_COLOR}` : ''}`;

const entries: Entry[] = [
  {
    item: {
      id: 'sec-hero-center',
      name: 'ヒーロー(中央揃え)',
      family: 'ヒーロー',
      level: 'SEC',
      description: '見出し・リード文・ボタンを中央に置く冒頭のセクション。',
      source: 'ledger',
    },
    build: (dummy) =>
      wrap(
        'sec-hero-center',
        `<div style="text-align:center;max-width:840px;margin:0 auto">` +
          `<h1 style="${headStyle(dummy, 40)}">${t(dummy, '新しい一歩を、この街から。', '【見出し】ここに主題が入る')}</h1>` +
          `<p style="${leadStyle(dummy)}">${t(dummy, '日常の中で、好きなことを見つける。はじめての方も気軽に参加できます。', '【リード文】このページで何が分かるかを 1〜2 文で書く')}</p>` +
          `<a href="#contact" style="display:inline-block;margin-top:24px;padding:16px 40px;background:#222;color:#fff;text-decoration:none">詳しく見る</a>` +
          `</div>`,
      ),
  },
  {
    item: {
      id: 'sec-cards-3',
      name: 'カード 3 枚',
      family: '一覧',
      level: 'SEC',
      description: '同じ形のカードを 3 枚並べる。項目の増減はページ側で行う。',
      source: 'ledger',
    },
    build: (dummy) =>
      wrap(
        'sec-cards-3',
        `<h2 style="${headStyle(dummy, 28)}">${t(dummy, '3 つのご案内', '【見出し】並べるものの総称')}</h2>` +
          `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px">` +
          [1, 2, 3]
            .map(
              (n) =>
                `<article style="border:1px solid #d4d4d4;padding:24px;background:#fff"><h3 style="font-size:20px;margin:0 0 12px">見出し ${n}</h3><p style="font-size:16px;line-height:1.8;margin:0">説明文が入ります。</p></article>`,
            )
            .join('') +
          `</div>`,
      ),
  },
  {
    item: {
      id: 'sec-news',
      name: 'お知らせ一覧',
      family: '一覧',
      level: 'SEC',
      description: '日付と見出しを 1 行ずつ並べる。',
      source: 'ledger',
    },
    build: (dummy) =>
      wrap(
        'sec-news',
        `<h2 style="${headStyle(dummy, 28)}">${t(dummy, 'お知らせ', '【見出し】お知らせ')}</h2>` +
          `<ul style="list-style:none;margin:0;padding:0">` +
          ['2026.09.01　秋の体験講座の申し込みを開始しました', '2026.08.20　新しい教室がオープンしました']
            .map((line) => `<li style="padding:20px 0;border-bottom:1px solid #ccc;font-size:18px">${line}</li>`)
            .join('') +
          `</ul>`,
      ),
  },
  {
    item: {
      id: 'sec-contact-band',
      name: 'お問合せ帯',
      family: 'CTA',
      level: 'SEC',
      description: '全ページ共通の問い合わせ導線。',
      source: 'ledger',
    },
    build: (dummy) =>
      `<section class="wf-ds" data-ds="sec-contact-band" data-ds-v="1" style="${sec('background:#f5f5f5;text-align:center')}">` +
      `<h2 style="${headStyle(dummy, 28)}">${t(dummy, 'お問い合わせ', '【見出し】お問い合わせ')}</h2>` +
      `<p style="${leadStyle(dummy)}">${t(dummy, 'お気軽にご相談ください。', '【リード文】どんな相談ができるかを 1 文で')}</p>` +
      `<a href="#contact" style="display:inline-block;margin-top:24px;padding:14px 40px;background:#222;color:#fff;text-decoration:none">お問合せフォームへ</a>` +
      `</section>`,
  },
  {
    item: {
      id: 'mol-button',
      name: 'ボタン',
      family: 'ボタン',
      level: 'MOL',
      description: '主導線のボタン 1 つ。',
      source: 'ledger',
    },
    build: () =>
      `<section class="wf-ds" data-ds="mol-button" data-ds-v="1" style="padding:24px 64px"><a href="#contact" style="display:inline-block;padding:14px 40px;background:#222;color:#fff;text-decoration:none">ボタンの文言</a></section>`,
  },
  {
    item: {
      id: 'mol-breadcrumb',
      name: 'パンくず',
      family: 'ナビゲーション',
      level: 'MOL',
      description: '現在地を示す 1 行。',
      source: 'ledger',
    },
    build: () =>
      `<section class="wf-ds" data-ds="mol-breadcrumb" data-ds-v="1" style="padding:16px 64px;font-size:14px;color:#666">ホーム ＞ 私たちについて ＞ 沿革</section>`,
  },
  {
    item: {
      id: 'local-annotation',
      name: '注釈ブロック',
      family: '注釈',
      level: 'SEC',
      description: 'この案件だけで使っている注釈。',
      source: 'local',
    },
    build: () =>
      `<section class="wf-ds" data-ds="local-annotation" data-ds-v="1" style="padding:24px 64px;background:#fdf3f3;color:${DUMMY_COLOR};font-size:16px;line-height:1.8">※この欄の内容は打合せ後に確定します</section>`,
  },
  {
    item: {
      id: 'tpl-lower',
      name: '下層ページ(1 カラム)',
      family: 'ページ',
      level: 'TPL',
      description: '見出し・本文・問い合わせ帯の 3 段。新しいページとして作られる。',
      source: 'ledger',
    },
    build: () => '',
  },
  {
    item: {
      id: 'pag-contact',
      name: 'お問い合わせページ',
      family: 'ページ',
      level: 'PAG',
      description: 'フォームまで入ったページ 1 枚。',
      source: 'ledger',
    },
    build: () => '',
  },
];

const byId = new Map(entries.map((e) => [e.item.id, e]));

/** 見本のページ(blob: の URL)。1 件につき 1 つ作って使い回す */
const previewUrls = new Map<string, string>();
const previewUrl = (id: string): string | undefined => {
  const cached = previewUrls.get(id);
  if (cached) return cached;
  const entry = byId.get(id);
  if (!entry) return undefined;
  const body = entry.build(false) || '<p style="padding:48px;font-size:20px">ページの雛形です</p>';
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;font-family:system-ui,sans-serif;color:#242424;background:#fff">${body}</body>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  previewUrls.set(id, url);
  return url;
};

const withPreview = (item: EditorInsertItem): EditorInsertItem => ({ ...item, previewUrl: previewUrl(item.id) });

const pick = (predicate: (item: EditorInsertItem) => boolean) =>
  entries.filter((e) => predicate(e.item)).map((e) => withPreview(e.item));

export const insertsCatalog = (): EditorInsertCatalog => ({
  groups: [
    { id: 'sections', label: 'セクション', items: pick((i) => i.level === 'SEC' && i.source !== 'local') },
    { id: 'parts', label: 'パーツ', items: pick((i) => i.level === 'MOL') },
    { id: 'pages', label: 'ページ', items: pick((i) => i.level === 'TPL' || i.level === 'PAG') },
    { id: 'local', label: 'この案件の部品', items: pick((i) => i.source === 'local') },
  ],
});

export const fetchInsertHtml = (id: string, dummy: boolean): { html: string; name?: string } => {
  const entry = byId.get(id);
  if (!entry) throw new Error(`台帳に ${id} がありません`);
  return { html: entry.build(dummy), name: entry.item.name };
};

/** 作ったページの中身(createContent の戻りを開いたときに見えるもの) */
export const newPageHtml = (title: string, templateId?: string) =>
  `<main data-wf-body style="width:100%;font-family:system-ui,sans-serif;color:#242424;background:#fff">` +
  `<section style="${sec()}"><p style="font-size:14px;color:#888;margin:0 0 8px">${templateId ?? 'ページ'}</p><h1 style="font-size:40px;margin:0">${title}</h1></section>` +
  `<section style="${sec()}"><p style="font-size:18px;line-height:1.8;margin:0">この下に台帳からセクションを足していきます。</p></section>` +
  `</main>`;

/** 「台帳から挿入」を試すページ */
export const insertsPage = `<main data-wf-body style="width:100%;font-family:system-ui,sans-serif;color:#242424;background:white">
<header style="padding:24px 64px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between"><strong style="font-size:22px">サンプル工業</strong><nav style="font-size:15px">事業紹介　　会社情報　　採用情報　　お問合せ</nav></header>
<section style="${sec()}"><h1 style="font-size:40px;margin:0 0 16px">台帳から挿入の動作確認</h1><p style="font-size:18px;line-height:1.8;margin:0">ツールバーの「＋ 追加」→「台帳から挿入」。選択中の要素の直後に入ります。</p></section>
<section style="${sec()}"><h2 style="font-size:28px;margin:0 0 16px">2 つめのセクション</h2><p style="font-size:18px;line-height:1.8;margin:0">ここを選んでから挿すと、このすぐ下に入ります。</p></section>
<footer style="padding:40px 64px;font-size:14px;border-top:1px solid #ddd">サンプル工業株式会社</footer>
</main>`;
