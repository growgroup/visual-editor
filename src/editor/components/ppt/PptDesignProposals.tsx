"use client";

/**
 * デザイン提案(PowerPointの「デザイナー」相当)のパネル。
 *
 * 「いまのスライドを、別の見せ方にするとどうなるか」を画像で数案出し、
 * 気に入った1案を選ぶとスライドの実装(TSX)がその意匠で書き直される。
 *
 * サーバー側は vite-plugin-design-proposals.ts。生成も適用もAI CLIを回すので
 * 数分かかる。押しっぱなしで待たせないよう、状態と経過をここに出し続ける。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { readApiJson } from '../../utils/api-json';
import { createPortal } from 'react-dom';
import { X, Sparkles, Loader2, Check, AlertTriangle } from 'lucide-react';
import { useEditorContext } from '../../EditorContext';

type Pattern = { url: string; concept: string };

/**
 * リボンと同じ配色。PptChrome から値で受け取る。
 * import で取りに行くと PptChrome ↔ このファイルが循環参照になるため。
 */
export type PptPalette = {
  chrome: string; text: string; sub: string; border: string;
  hover: string; activeBg: string; control: string; rail: string;
  canvas: string; disabled: string;
};

const COUNTS = [1, 2, 3, 4];

export function PptDesignProposals({
  page, pal, onClose,
}: {
  page: number;
  pal: PptPalette;
  onClose: () => void;
}) {
  const { hasChanges } = useEditorContext();

  const [instruction, setInstruction] = useState('');
  const [count, setCount] = useState(3);
  /** 生成 */
  const [genState, setGenState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [genMessage, setGenMessage] = useState('');
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  /** 適用 */
  const [applyingUrl, setApplyingUrl] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState('');
  const [error, setError] = useState('');

  /**
   * アンマウント後にポーリングが状態を触らないようにする。
   * StrictModeでは mount → cleanup → mount と2度走るので、
   * 立ち上げ直しのたびに true へ戻す(戻さないとポーリングが死んだままになる)。
   */
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** ジョブが片付くまで status を叩き続ける */
  const poll = useCallback(
    async <T,>(url: string, onTick: (v: T & { state: string; message?: string }) => void) => {
      for (;;) {
        if (!aliveRef.current) return null;
        await new Promise((r) => setTimeout(r, 2500));
        const res = await fetch(url).catch(() => null);
        if (!res || !res.ok) continue;
        const v = (await readApiJson<T & { state: string; message?: string; error?: string }>(res));
        onTick(v);
        if (v.state !== 'running') return v;
      }
    },
    [],
  );

  const generate = useCallback(async () => {
    setError('');
    setPatterns([]);
    setGenState('running');
    setGenMessage('ジョブを開始しています…');
    const res = await fetch('/__design-gen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page, instruction, count }),
    }).catch(() => null);
    const started = res && res.ok ? await readApiJson<{ jobId: string }>(res) : null;
    if (!started?.jobId) {
      const msg = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : null;
      setGenState('error');
      setError(msg || '生成を開始できませんでした');
      return;
    }
    const final = await poll<{ patterns: Pattern[]; error?: string }>(
      `/__design-gen/status/${started.jobId}`,
      (v) => setGenMessage(v.message || ''),
    );
    if (!final || !aliveRef.current) return;
    if (final.state === 'error') {
      setGenState('error');
      setError(final.error || '生成に失敗しました');
      return;
    }
    setPatterns(final.patterns ?? []);
    setGenState('done');
  }, [page, instruction, count, poll]);

  const apply = useCallback(
    async (url: string) => {
      setError('');
      setApplyingUrl(url);
      setApplyMessage('ジョブを開始しています…');
      const res = await fetch('/__design-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, image: url, note: instruction }),
      }).catch(() => null);
      const started = res && res.ok ? await readApiJson<{ jobId: string }>(res) : null;
      if (!started?.jobId) {
        const msg = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : null;
        setApplyingUrl(null);
        setError(msg || '適用を開始できませんでした');
        return;
      }
      const final = await poll<{ error?: string; warning?: string }>(
        `/__design-apply/status/${started.jobId}`,
        (v) => setApplyMessage(v.message || ''),
      );
      if (!final || !aliveRef.current) return;
      if (final.state === 'error') {
        setApplyingUrl(null);
        setError(final.error || '適用に失敗しました');
        return;
      }
      // 文言が変わっているときは、読み込み直す前に必ず知らせる(黙って通さない)
      if (final.warning && !window.confirm(`${final.warning}\n\nこのまま反映しますか?`)) {
        setApplyingUrl(null);
        setApplyMessage('適用済みです。読み込み直すと反映されます');
        return;
      }
      // 書き直したTSXを反映するには読み込み直しが要る。
      // 未保存の編集がある場合だけ確認する(黙って捨てない)
      if (hasChanges && !window.confirm('保存していない編集があります。破棄して新しいデザインを読み込みますか?')) {
        setApplyingUrl(null);
        setApplyMessage('適用済みです。読み込み直すと反映されます');
        return;
      }
      location.reload();
    },
    [page, instruction, poll, hasChanges],
  );

  const busy = genState === 'running' || !!applyingUrl;

  return createPortal(
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center p-6"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        data-design-proposals="1"
        className="flex max-h-full w-[min(1100px,95vw)] flex-col overflow-hidden rounded-lg border shadow-2xl"
        style={{ backgroundColor: pal.chrome, borderColor: pal.border, color: pal.text }}
      >
        {/* 見出し */}
        <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: pal.border }}>
          <Sparkles className="h-4 w-4" />
          <span className="text-[13px] font-semibold">デザイン提案</span>
          <span className="text-[11px]" style={{ color: pal.sub }}>
            {page}枚目のスライドを、内容はそのままに別の見せ方で提案します
          </span>
          <button
            onClick={onClose}
            disabled={busy}
            title={busy ? '処理中は閉じられません' : '閉じる'}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded"
            style={{ color: busy ? pal.disabled : pal.text }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 生成の指示 */}
        <div className="flex items-end gap-2 border-b px-4 py-3" style={{ borderColor: pal.border }}>
          <label className="flex-1 text-[11px]" style={{ color: pal.sub }}>
            指示(任意)
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={2}
              placeholder="例: 左右2分割はやめて、図版を大きく使った構図で"
              className="mt-1 w-full resize-none rounded border px-2 py-1.5 text-[12px] outline-none"
              style={{ backgroundColor: pal.control, borderColor: pal.border, color: pal.text }}
            />
          </label>
          <label className="text-[11px]" style={{ color: pal.sub }}>
            案の数
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="mt-1 block h-[30px] rounded border px-2 text-[12px] outline-none"
              style={{ backgroundColor: pal.control, borderColor: pal.border, color: pal.text }}
            >
              {COUNTS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button
            onClick={() => void generate()}
            disabled={busy}
            className="flex h-[30px] items-center gap-1.5 rounded px-3 text-[12px] font-medium"
            style={{ backgroundColor: busy ? pal.disabled : '#ED6C47', color: '#fff' }}
          >
            {genState === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            生成
          </button>
        </div>

        {/* 経過・エラー */}
        {(genState === 'running' || applyingUrl || error) && (
          <div className="flex items-center gap-2 px-4 py-2 text-[12px]" style={{ color: error ? '#d64426' : pal.sub }}>
            {error ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
            <span className="whitespace-pre-wrap">{error || applyMessage || genMessage}</span>
          </div>
        )}

        {/* ギャラリー */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {patterns.length === 0 && genState !== 'running' && (
            <div className="py-10 text-center text-[12px]" style={{ color: pal.sub }}>
              「生成」を押すと、このスライドのデザイン案を作ります(数分かかります)
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {patterns.map((p) => (
              <div key={p.url} className="rounded border" style={{ borderColor: pal.border, backgroundColor: pal.control }}>
                <img src={p.url} alt={p.concept} className="block w-full" style={{ aspectRatio: '16 / 9', objectFit: 'contain' }} />
                <div className="flex items-start gap-2 px-2 py-2">
                  <span className="flex-1 text-[11px] leading-snug" style={{ color: pal.sub }}>{p.concept}</span>
                  <button
                    onClick={() => void apply(p.url)}
                    disabled={busy}
                    className="flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[11px]"
                    style={{
                      borderColor: pal.border,
                      color: busy ? pal.disabled : pal.text,
                      backgroundColor: applyingUrl === p.url ? pal.activeBg : undefined,
                    }}
                  >
                    {applyingUrl === p.url ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    この案で適用
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t px-4 py-2 text-[11px]" style={{ borderColor: pal.border, color: pal.sub }}>
          適用するとスライドの実装(TSX)が書き直されます。描画できない結果になった場合は自動で元に戻します。
        </div>
      </div>
    </div>,
    document.body,
  );
}
