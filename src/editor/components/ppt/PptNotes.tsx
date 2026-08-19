"use client";

/**
 * PowerPointのノート欄相当。スライドごとのトークスクリプト(発表原稿)を編集する。
 *
 * 保存先は public/presenter-script.json の segments[{page, text, note}]。
 * これは発表者コンソール(presenter.html)がそのまま読む原稿ファイルなので、
 * ここで書いた内容が本番のカンペになる。案件データ扱いで同期に消されない。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Sparkles, StickyNote } from 'lucide-react';
import { PPT_PALETTES, type PptTheme } from './PptChrome';
import { readApiJson } from '../../utils/api-json';

type Segment = { page: number; text?: string; note?: string };

export function PptNotes({ page, theme }: { page: number; theme: PptTheme }) {
  const pal = PPT_PALETTES[theme];
  const [open, setOpen] = useState(false);
  const [segments, setSegments] = useState<Map<number, Segment>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef<{ page: number; text: string; note: string } | null>(null);

  // 原稿ファイルを読み込む(1回)
  useEffect(() => {
    let alive = true;
    fetch('/__presenter-script')
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        const map = new Map<number, Segment>();
        for (const seg of data.segments ?? []) map.set(seg.page, seg);
        setSegments(map);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  const flush = useCallback(async () => {
    const d = dirtyRef.current;
    if (!d) return;
    dirtyRef.current = null;
    try {
      await fetch('/__presenter-script/segment', {
        method: 'POST',
        body: JSON.stringify(d),
      });
    } catch {
      // devサーバー再起動中など。次の編集で再保存される
    }
  }, []);

  // ページ切替: 編集中の内容を保存してから、切替先の原稿を出す
  useEffect(() => {
    void flush();
    const seg = segments.get(page);
    setText(seg?.text ?? '');
    setNote(seg?.note ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, loaded]);

  // アンマウント時も取りこぼさない
  useEffect(() => () => { void flush(); }, [flush]);

  const queueSave = (nextText: string, nextNote: string) => {
    setSegments((m) => {
      const copy = new Map(m);
      copy.set(page, { page, text: nextText, note: nextNote });
      return copy;
    });
    dirtyRef.current = { page, text: nextText, note: nextNote };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), 800);
  };

  const hasContent = Boolean(text.trim() || note.trim());

  // ================= AIで原稿を生成 =================
  const [genState, setGenState] = useState<{ running: boolean; message: string }>({
    running: false,
    message: '',
  });
  const [askMinutes, setAskMinutes] = useState(false);
  const [minutes, setMinutes] = useState('30');

  /** 生成完了後にファイルを読み直し、表示中ページの原稿を差し替える */
  const reloadSegments = useCallback(async () => {
    try {
      const data = await (await fetch('/__presenter-script')).json();
      const map = new Map<number, Segment>();
      for (const seg of data.segments ?? []) map.set(seg.page, seg);
      setSegments(map);
      const seg = map.get(page);
      // 入力途中の手元の内容を潰さないよう、フォーカスが無いときだけ反映
      if (!dirtyRef.current) {
        setText(seg?.text ?? '');
        setNote(seg?.note ?? '');
      }
    } catch {
      // devサーバー再起動中など。次の操作で読み直される
    }
  }, [page]);

  const startGen = useCallback(
    async (payload: { pages?: number[]; all?: boolean; minutes?: number }) => {
      setGenState({ running: true, message: '開始中…' });
      setOpen(true);
      try {
        const res = await fetch('/__script-gen', { method: 'POST', body: JSON.stringify(payload) });
        const { jobId, error } = await readApiJson<{ jobId?: string; error?: string }>(res);
        if (!jobId) throw new Error(error || '開始できませんでした');
        // 完了までポーリング(生成は1バッチ30秒〜)
        for (;;) {
          await new Promise((r) => setTimeout(r, 1500));
          const st = await readApiJson<{ state: string; message?: string; error?: string }>(
            await fetch(`/__script-gen/status/${jobId}`),
          );
          setGenState({ running: st.state === 'running', message: st.message ?? '' });
          if (st.state === 'done') {
            await reloadSegments();
            return;
          }
          if (st.state === 'error') throw new Error(st.error || '生成に失敗しました');
        }
      } catch (e) {
        setGenState({ running: false, message: `失敗: ${String(e).slice(0, 120)}` });
      }
    },
    [reloadSegments],
  );

  return (
    <div className="shrink-0 border-t" style={{ borderColor: pal.border, backgroundColor: pal.rail }}>
      {/* 折りたたみバー(実機の「ノートを入力」) */}
      <div className="flex h-6 w-full items-center gap-1.5 px-3 text-[11px]">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          style={{ color: hasContent ? pal.text : pal.sub }}
          title="トークスクリプト(発表者コンソールの原稿)を編集"
        >
          <StickyNote className="h-3 w-3 shrink-0" style={{ color: hasContent ? '#498205' : pal.sub }} />
          <span className="truncate">
            {genState.message
              ? genState.message
              : hasContent
                ? 'ノートあり — トークスクリプトを編集'
                : 'ノートを入力(トークスクリプト)'}
          </span>
        </button>
        {/* AI生成: このスライドだけ / 発表時間を決めて全スライド */}
        {genState.running ? (
          <span className="flex shrink-0 items-center gap-1" style={{ color: pal.sub }}>
            <Loader2 className="h-3 w-3 animate-spin" />
            生成中…
          </span>
        ) : askMinutes ? (
          <span className="flex shrink-0 items-center gap-1" style={{ color: pal.sub }}>
            発表時間
            <input
              type="number"
              min={1}
              max={600}
              value={minutes}
              autoFocus
              onChange={(e) => setMinutes(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setAskMinutes(false);
                  void startGen({ all: true, minutes: Math.max(1, Number(minutes) || 30) });
                }
                if (e.key === 'Escape') setAskMinutes(false);
              }}
              className="h-5 w-[52px] rounded border px-1 text-right text-[11px] outline-none"
              style={{ backgroundColor: pal.control, borderColor: pal.border, color: pal.text }}
            />
            分
            <button
              onClick={() => {
                setAskMinutes(false);
                void startGen({ all: true, minutes: Math.max(1, Number(minutes) || 30) });
              }}
              className="rounded border px-1.5 py-0.5"
              style={{ borderColor: pal.border, color: pal.text }}
            >
              生成
            </button>
            <button onClick={() => setAskMinutes(false)} className="px-1" style={{ color: pal.sub }}>
              ✕
            </button>
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => void startGen({ pages: [page] })}
              title="このスライドの原稿をAIで生成(既存の原稿は置き換わる。段取りメモは残る)"
              className="flex items-center gap-1 rounded border px-1.5 py-0.5"
              style={{ borderColor: pal.border, color: pal.text }}
            >
              <Sparkles className="h-3 w-3" />
              このスライドを生成
            </button>
            <button
              onClick={() => setAskMinutes(true)}
              title="発表時間を決めて、全スライドの原稿をAIで一括生成(時間から文字数を配分)"
              className="flex items-center gap-1 rounded border px-1.5 py-0.5"
              style={{ borderColor: pal.border, color: pal.text }}
            >
              <Sparkles className="h-3 w-3" />
              全スライドを生成…
            </button>
          </span>
        )}
        <button onClick={() => setOpen((v) => !v)} className="shrink-0" style={{ color: pal.sub }}>
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </button>
      </div>

      {open && (
        <div className="flex gap-2 px-3 pb-2">
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); queueSave(e.target.value, note); }}
            placeholder={`スライド ${page} で話すこと…(発表者コンソールにそのまま出ます)`}
            className="h-[104px] flex-1 resize-none rounded border p-2 text-[12.5px] leading-relaxed outline-none"
            style={{ backgroundColor: pal.control, borderColor: pal.border, color: pal.text }}
          />
          <textarea
            value={note}
            onChange={(e) => { setNote(e.target.value); queueSave(text, e.target.value); }}
            placeholder="段取りメモ(任意)…"
            className="h-[104px] w-[220px] resize-none rounded border p-2 text-[11.5px] leading-relaxed outline-none"
            style={{ backgroundColor: pal.control, borderColor: pal.border, color: pal.sub }}
          />
        </div>
      )}
    </div>
  );
}
