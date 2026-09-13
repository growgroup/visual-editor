import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster, toast } from 'sonner';
import { VisualEditor, setEditorIO, type EditorDeck, type EditorIO } from '../src/index';
import { applyDeck } from '../src/components/viewer/useDeck';
import { webpage, slides, webpagePages } from './samples';
import { partsLibrary, partsPage, createPartsStore } from './parts-samples';
import { getCleanHtml } from '../src/editor/utils/html-utils';
import { socketFor } from '../src/editor/collab/connection';
import '../dist/editor.css';
import './playground.css';

const params = new URLSearchParams(location.search);
// ?mode=parts … webpage モード + 部品(loadParts/savePart)と CSS 変数(loadVariables/saveVariables)のメモリ実装
const parts = params.get('mode') === 'parts';
const mode = params.get('mode') === 'slide' ? 'slide' : 'webpage';
const minimal = params.has('minimal');
// ?canvas … Figma 風のマルチフレームキャンバス(全ページを 1 枚のキャンバスに並べる)
const canvasMode = params.has('canvas');
/**
 * ?canvas&thumbs … contentList[].thumbnail(ページ全体を写した画像)付きの 26 ページ。
 * 大きく縮小したときに、見るだけの紙面が iframe から画像に落ちることの確認用。
 * 1 枚(8 ページ目)だけ画像の URL を壊してあり、読めないページが iframe のまま残ることを見る
 */
const thumbsMode = canvasMode && params.has('thumbs');
const THUMB_COUNT = 26;
/** ページと同じ縦横比(幅 1820 × 高さ 1200)で、番号だけ入った画像。幅は 480px 以上 */
const thumbUrl = (n: number) =>
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="546" height="360" viewBox="0 0 1820 1200"><rect width="1820" height="1200" fill="#eef2f7"/><rect x="120" y="120" width="900" height="90" fill="#c9d4e3"/><rect x="120" y="260" width="1580" height="40" fill="#dce3ec"/><rect x="120" y="330" width="1400" height="40" fill="#dce3ec"/><text x="120" y="900" font-family="sans-serif" font-size="220" fill="#8fa3bb">page ${n}</text></svg>`,
  );
const thumbPages = Array.from({ length: THUMB_COUNT }, (_, i) => webpagePages[i % webpagePages.length]);
const sampleHtml = parts
  ? [partsPage]
  : mode === 'webpage'
    ? (thumbsMode ? thumbPages.map((p) => p.html) : canvasMode ? webpagePages.map((p) => p.html) : [webpage])
    : canvasMode ? [...slides, ...slides, ...slides] : slides;
const partsStore = createPartsStore();
const partsIo: EditorIO = {
  loadParts: async () => ({
    categories: partsLibrary.categories,
    parts: Array.from(partsStore.parts.values()).map((p) => structuredClone(p)),
  }),
  savePart: async (part) => {
    partsStore.parts.set(part.id, structuredClone(part));
    partsStore.log.push({ op: 'savePart', id: part.id, at: new Date().toISOString() });
    return part;
  },
  deletePart: async (id) => {
    partsStore.parts.delete(id);
    partsStore.log.push({ op: 'deletePart', id, at: new Date().toISOString() });
  },
  loadVariables: async () => structuredClone(partsStore.variables),
  saveVariables: async (variables) => {
    partsStore.variables = structuredClone(variables);
    partsStore.log.push({ op: 'saveVariables', at: new Date().toISOString() });
  },
};
const pageTitle = (i: number) =>
  mode === 'webpage'
    ? (thumbsMode ? `${thumbPages[i].title}（${i + 1}）` : canvasMode ? webpagePages[i].title : 'トップページ')
    : ['伝わる体験を、いっしょにつくる。', '私たちの進め方'][i % 2] + (canvasMode && i >= 2 ? `（${i + 1}）` : '');
let deck: EditorDeck = { version: 1, title: 'リデザインの動作確認', slides: sampleHtml.map((_, i) => ({ id: String(i + 1), title: pageTitle(i), template: 'sample', edited: false, comments: [] })) };
const documents = new Map(deck.slides.map((entry, i) => [entry.id, sampleHtml[i]]));
const saveLog: { html: string; auto: boolean; id: string }[] = [];
const failure = { save: false, comment: false };
const clone = () => structuredClone(deck);
const commit = () => { deck.version++; return clone(); };
const entry = (page: number) => { const value = deck.slides[page - 1]; if (!value) throw new Error('ページが見つかりません'); return value; };
const uid = () => crypto.randomUUID();
const adapter: EditorIO = {
  loadDeck: async () => clone(),
  // キャンバスでは隣のページの本文をここから読む(保存したものが返る)
  ...(canvasMode ? { loadContent: async (id: string) => { await new Promise((r) => setTimeout(r, 120)); return documents.get(id) ?? ''; } } : {}),
  commentAction: async (page, action) => {
    if (failure.comment) throw new Error('送信失敗の確認用です。失敗設定を解除して再送信してください。');
    const target = entry(page);
    const comments = target.comments ??= [];
    if (action.action === 'add') comments.push({ ...action, id: uid(), createdAt: new Date().toISOString() });
    else {
      const c = comments.find((c) => c.id === action.commentId);
      if (!c) throw new Error('コメントが見つかりません');
      if (action.action === 'reply') (c.replies ??= []).push({ id: uid(), author: action.author, text: action.text, createdAt: new Date().toISOString() });
      if (action.action === 'resolve') c.resolved = action.resolved;
      if (action.action === 'delete') target.comments = comments.filter((c) => c.id !== action.commentId);
    }
    return commit();
  },
  ...(mode === 'slide' ? {
    renderContent: (page: number) => <div dangerouslySetInnerHTML={{ __html: documents.get(entry(page).id) ?? '' }} />,
    deckOps: {
      move: async (from: number, to: number) => { const item = entry(from); deck.slides.splice(from - 1, 1); deck.slides.splice(to - 1, 0, item); return commit(); },
      duplicate: async (page: number) => { const source = entry(page); const item = { ...structuredClone(source), id: uid(), title: `${source.title}（コピー）` }; documents.set(item.id, documents.get(source.id)!); deck.slides.splice(page, 0, item); return commit(); },
      remove: async (page: number) => { if (deck.slides.length <= 1) throw new Error('最後のページは削除できません'); documents.delete(entry(page).id); deck.slides.splice(page - 1, 1); return commit(); },
      updateMeta: async (page: number, patch: { hidden?: boolean; transition?: 'fade' | 'push' | 'zoom' | null }) => { const item = entry(page); if ('hidden' in patch) item.hidden = patch.hidden; if ('transition' in patch) item.transition = patch.transition ?? undefined; return commit(); },
      insert: async (_template: string, at: number) => { const item = { id: uid(), title: '新しいスライド', template: 'sample', edited: false }; documents.set(item.id, slides[1]); deck.slides.splice(Math.max(0, at), 0, item); return commit(); },
    },
  } : {}),
  ...(parts ? partsIo : {}),
};
/**
 * ?collab=ws://127.0.0.1:5418&name=A&room=pg … リアルタイム共同編集(io.collab)。
 * room が同じタブどうしが同じ部屋に入る。route はページ 1 が "/"、以降 "/page-<id>"。
 * &uid= で参加者の id(省略時は name)、&requireBridge で書き戻し役が居ない警告を出し続ける
 */
const collabUrl = params.get('collab');
const collabRoom = params.get('room') || 'pg-local';
const routeOf = (id: string) => (id === '1' ? '/' : `/page-${id}`);
const collabIo: EditorIO['collab'] = collabUrl
  ? {
      url: collabUrl,
      projectRoom: `wf/${collabRoom}__@project`,
      roomFor: (id) => `wf/${collabRoom}__${encodeURIComponent(routeOf(id))}`,
      routeFor: routeOf,
      user: { id: params.get('uid') || params.get('name') || 'A', name: params.get('name') || 'A' },
      requireBridge: params.has('requireBridge'),
    }
  : undefined;
setEditorIO(minimal ? {} : { ...adapter, ...(collabIo ? { collab: collabIo } : {}) });
applyDeck(minimal ? { version: 0, title: '', slides: [] } : clone());

/** 編集中の紙面の保存 HTML(getCleanHtml)。検証で「共同編集の層が保存に混ざらない」ことを見る */
const editorCleanHtml = () => {
  const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>('.gg-editor-ui iframe')).filter((f) => !f.closest('[data-page-preview]'));
  const doc = frames.map((f) => f.contentDocument).find((d) => d?.getElementById('artboard'));
  return doc ? getCleanHtml(doc) : null;
};

// ローカル検証用。公開APIや配布物には含まれない。
Object.assign(window, {
  editorPlayground: {
    saveLog, failure, documents, deck: () => clone(), parts: partsStore, cleanHtml: editorCleanHtml,
    // 共同編集の WebSocket(検証で切断 → 再接続を起こす)
    collabSocket: () => (collabUrl ? socketFor(collabUrl) : null),
  },
});

function Playground() {
  const [page, setPage] = useState(1);
  const [opened, setOpened] = useState(() => ({ id: entry(1).id, html: documents.get(entry(1).id)! }));
  const [revision, setRevision] = useState(0);
  const [saves, setSaves] = useState(0);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    const showPage = () => {
      const n = Math.max(1, Math.min(deck.slides.length, Number(location.hash.match(/edit\/(\d+)/)?.[1]) || 1));
      const item = entry(n); setPage(n);
      // キャンバスではエディタを作り直さない(ページ切替はエディタの中で起きる)
      if (canvasMode) return;
      setOpened({ id: item.id, html: documents.get(item.id)! }); setRevision((v) => v + 1);
    };
    window.addEventListener('hashchange', showPage);
    window.addEventListener('gg:deck-mutated', showPage);
    return () => { window.removeEventListener('hashchange', showPage); window.removeEventListener('gg:deck-mutated', showPage); };
  }, []);
  return <div className="pg-layout">
    <aside className="pg-rail">
      <strong>Visual Editor</strong><span className="pg-caption">リデザインの動作確認</span>
      <nav><a href="?mode=webpage" aria-current={mode === 'webpage' && !parts && !canvasMode ? 'page' : undefined}>構成ラフ</a><a href="?mode=slide" aria-current={mode === 'slide' && !canvasMode ? 'page' : undefined}>スライド</a><a href="?mode=parts" aria-current={parts ? 'page' : undefined}>部品</a><a href="?mode=webpage&canvas" aria-current={mode === 'webpage' && canvasMode ? 'page' : undefined}>キャンバス(構成ラフ)</a><a href="?mode=slide&canvas" aria-current={mode === 'slide' && canvasMode ? 'page' : undefined}>キャンバス(スライド)</a><a href="?mode=webpage&canvas&thumbs" aria-current={thumbsMode ? 'page' : undefined}>キャンバス(サムネイル26枚)</a></nav>
      {canvasMode && <div className="pg-card"><strong>マルチフレームのキャンバス</strong><p>全ページが並びます。クリックしたページが編集対象。ホイールで移動、⌘+ホイールで拡大縮小、Space+ドラッグで移動。⇧1 全体 / ⇧2 このページ / ⇧R 定規。</p></div>}
      {parts && <div className="pg-card"><strong>部品モード</strong><p>左パネルの部品をドロップ → 実体化(data-part)。CTA 帯はスロット(見出し・説明)だけ編集できます。右クリックで「部品として保存」「切り離す」。</p><p>保存先はメモリ(window.editorPlayground.parts)。</p></div>}
      <div className="pg-card"><strong>確認すること</strong><p>文字をダブルクリックして編集。要素を選んでコメントを追加できます。</p><p>上部の「…」からライト／ダークを切り替えられます。</p></div>
      <div className="pg-card"><strong>メモリ上に保存</strong><p>保存 {saves} 回</p><p>再読み込みすると編集とコメントは初期状態に戻ります。</p></div>
      <label><input type="checkbox" onChange={(e) => { failure.save = e.target.checked; }} />保存を失敗させる</label>
      <label><input type="checkbox" onChange={(e) => { failure.comment = e.target.checked; }} />コメント送信を失敗させる</label>
      <a href={`?mode=${mode}${minimal ? '' : '&minimal'}`}>{minimal ? '機能付きIOで開く' : 'IO未提供で確認'}</a>
      <p className="pg-caption">このレールは利用側のUIを模したplayground専用です。</p>
    </aside>
    <div className="pg-editor">
      {closed ? <button className="pg-reopen" onClick={() => setClosed(false)}>エディタを開く</button> : <VisualEditor
        key={canvasMode ? 'canvas' : `${opened.id}:${revision}`} html={opened.html} editorMode={mode} artboardWidth={mode === 'webpage' ? 1820 : undefined}
        contentId={String(page)} contentList={deck.slides.map((item, i) => ({
          id: String(i + 1), title: item.title, order: i + 1,
          // サムネイル検証用: 階層(親の下に子 5 枚ずつ)と画像。8 ページ目だけ画像の URL が壊れている
          ...(thumbsMode ? {
            parentId: i === 0 ? null : String(Math.floor((i - 1) / 5) + 1),
            thumbnail: i === 7 ? '/__missing-thumbnail.png' : thumbUrl(i + 1),
          } : {}),
        }))}
        enableMultiPageCanvas={canvasMode}
        canvasStorageKey={canvasMode ? `playground-${mode}` : undefined}
        onContentChange={(id) => { window.location.hash = `#/edit/${id}`; }}
        onSave={async (html, options) => {
          if (failure.save) throw new Error('保存失敗の確認用です。');
          const targetId = options?.contentId ?? opened.id;
          documents.set(targetId, html); saveLog.push({ html, auto: options?.auto === true, id: targetId }); setSaves(saveLog.length);
          const item = deck.slides.find((s) => s.id === targetId); if (item) item.edited = true;
          if (!options?.auto) toast.success('メモリ上に保存しました');
        }}
        onClose={() => setClosed(true)}
      />}
    </div><Toaster position="bottom-center" />
  </div>;
}
createRoot(document.getElementById('root')!).render(<Playground />);
