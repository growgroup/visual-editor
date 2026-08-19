"use client";

/**
 * 右ペイン「図形/図の書式設定」。実機の書式ウィンドウと同じ構成で
 * 影・反射・光彩・ぼかし(ソフトエッジ)をスライダーで調整する。
 *
 * 値は要素の data-gg-fx にJSONで持たせ、そこからCSSを組み立てて
 * inline style に反映する(box-shadow/-webkit-box-reflect/mask-image)。
 * CSSが正で、data-gg-fx は「スライダーの位置を思い出すためのメモ」。
 * 保存時に data-gg-* は原本TSXへは書かれないので、TSXには効果のCSSだけが残る。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useEditorContext } from '../../EditorContext';
import { PPT_PALETTES, type PptTheme } from './PptChrome';
import { applyShadowAndGlow, getFxHost, unwrapFxHostIfEmpty } from '../../utils/element-effects';

const FX_ATTR = 'data-gg-fx';

type Shadow = { on: boolean; color: string; opacity: number; size: number; blur: number; angle: number; distance: number };
type Reflection = { on: boolean; opacity: number; size: number; blur: number; distance: number };
type Glow = { on: boolean; color: string; size: number; opacity: number };
type SoftEdge = { on: boolean; size: number };
type Fx = { shadow: Shadow; reflection: Reflection; glow: Glow; softEdge: SoftEdge };

const DEFAULT_FX: Fx = {
  shadow: { on: false, color: '#000000', opacity: 60, size: 0, blur: 12, angle: 90, distance: 8 },
  reflection: { on: false, opacity: 50, size: 35, blur: 2, distance: 4 },
  glow: { on: false, color: '#0d99ff', size: 12, opacity: 60 },
  softEdge: { on: false, size: 10 },
};

const SHADOW_PRESETS: { label: string; value: Partial<Shadow> | null }[] = [
  { label: 'なし', value: null },
  { label: '右下(小)', value: { on: true, angle: 45, distance: 6, blur: 8, size: 0, opacity: 45 } },
  { label: '右下(中)', value: { on: true, angle: 45, distance: 12, blur: 18, size: 0, opacity: 50 } },
  { label: '真下(大)', value: { on: true, angle: 90, distance: 18, blur: 30, size: 0, opacity: 55 } },
];

function hexToRgba(hex: string, alphaPct: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const a = Math.max(0, Math.min(1, alphaPct / 100));
  if (!m) return `rgba(0,0,0,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * 効果を要素へ反映する。
 * 影と光彩は element-effects に任せる(切り抜き図形や画像は drop-shadow になる)。
 */
function applyFx(el: HTMLElement, fx: Fx): void {
  const rad = (fx.shadow.angle * Math.PI) / 180;
  // 影・光彩は要素(切り抜き図形なら枠)に載る。返ってきた要素へ反射とぼかしも載せる
  const host = applyShadowAndGlow(
    el,
    fx.shadow.on
      ? {
          dx: Math.round(Math.cos(rad) * fx.shadow.distance * 10) / 10,
          dy: Math.round(Math.sin(rad) * fx.shadow.distance * 10) / 10,
          blur: fx.shadow.blur,
          size: fx.shadow.size,
          color: hexToRgba(fx.shadow.color, fx.shadow.opacity),
        }
      : null,
    fx.glow.on ? { size: fx.glow.size, color: hexToRgba(fx.glow.color, fx.glow.opacity) } : null,
  );

  // 反射・ぼかしも枠に載せる(図形本体に載せると切り抜きで消えるため)
  const target = fx.reflection.on || fx.softEdge.on ? getFxHost(el, true) : host;
  target.style.setProperty(
    '-webkit-box-reflect',
    fx.reflection.on
      ? `below ${fx.reflection.distance}px linear-gradient(transparent ${100 - fx.reflection.size}%, rgba(255,255,255,${fx.reflection.opacity / 100}))`
      : '',
  );

  const mask = fx.softEdge.on
    ? `radial-gradient(closest-side, #000 ${Math.max(0, 100 - fx.softEdge.size * 2)}%, transparent 100%)`
    : '';
  target.style.setProperty('-webkit-mask-image', mask);
  target.style.maskImage = mask;
  unwrapFxHostIfEmpty(target);
}

function readFx(el: HTMLElement | null): Fx {
  if (!el) return DEFAULT_FX;
  const raw = el.getAttribute(FX_ATTR);
  if (!raw) {
    // 既に box-shadow だけ付いている要素は「影あり」として拾う
    const has =
      (!!el.style.boxShadow && el.style.boxShadow !== 'none') ||
      /drop-shadow\(/.test(el.style.filter || '');
    return has ? { ...DEFAULT_FX, shadow: { ...DEFAULT_FX.shadow, on: true } } : DEFAULT_FX;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Fx>;
    return {
      shadow: { ...DEFAULT_FX.shadow, ...parsed.shadow },
      reflection: { ...DEFAULT_FX.reflection, ...parsed.reflection },
      glow: { ...DEFAULT_FX.glow, ...parsed.glow },
      softEdge: { ...DEFAULT_FX.softEdge, ...parsed.softEdge },
    };
  } catch {
    return DEFAULT_FX;
  }
}

/** 実機のスライダー行(ラベル / スライダー / 数値) */
function Row({
  label, value, min, max, step, unit, onChange, pal, disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  pal: (typeof PPT_PALETTES)['dark'];
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 px-3 py-[3px] ${disabled ? 'opacity-40' : ''}`}>
      <span className="w-[52px] shrink-0 text-[11px]" style={{ color: pal.sub }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 accent-[#0F6CBD]"
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-6 w-[54px] rounded border px-1 text-right text-[11px] outline-none"
        style={{ backgroundColor: pal.control, borderColor: pal.border, color: pal.text }}
      />
      <span className="w-[16px] shrink-0 text-[10px]" style={{ color: pal.sub }}>{unit ?? ''}</span>
    </div>
  );
}

function Section({
  title, open, onToggle, pal, children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  pal: (typeof PPT_PALETTES)['dark'];
  children: React.ReactNode;
}) {
  return (
    <div className="border-b" style={{ borderColor: pal.border }}>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1 px-2 py-1.5 text-[12px] font-medium"
        style={{ color: pal.text }}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {title}
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

export function PptFormatPane({
  theme, onClose,
}: {
  theme: PptTheme;
  onClose: () => void;
}) {
  const pal = PPT_PALETTES[theme];
  const { getIframeDoc, selectedElement, selectedElementIds, notifyIframeChange } = useEditorContext();

  const el = useMemo((): HTMLElement | null => {
    const doc = getIframeDoc();
    const id = selectedElementIds[0] ?? selectedElement?.id;
    if (!doc || !id) return null;
    const found = doc.querySelector<HTMLElement>(`[data-element-id="${id}"]`);
    return found;
  }, [getIframeDoc, selectedElement, selectedElementIds]);

  const [fx, setFx] = useState<Fx>(DEFAULT_FX);
  const [open, setOpen] = useState({ shadow: true, reflection: false, glow: false, softEdge: false });

  // 選択が変わったら、その要素の効果を読み直す
  useEffect(() => { setFx(readFx(el)); }, [el]);

  const commit = useCallback(
    (next: Fx) => {
      setFx(next);
      if (!el) return;
      applyFx(el, next);
      el.setAttribute(FX_ATTR, JSON.stringify(next));
      notifyIframeChange();
    },
    [el, notifyIframeChange],
  );

  const set = <K extends keyof Fx>(key: K, patch: Partial<Fx[K]>) =>
    commit({ ...fx, [key]: { ...fx[key], ...patch } } as Fx);

  return (
    <div
      className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l"
      style={{ backgroundColor: pal.chrome, borderColor: pal.border, color: pal.text }}
    >
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: pal.border }}>
        <span className="text-[13px] font-semibold">図の書式設定</span>
        <button onClick={onClose} title="閉じる" className="rounded p-0.5" style={{ color: pal.sub }}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!el && (
        <div className="px-3 py-4 text-[11.5px]" style={{ color: pal.sub }}>
          図形・画像を選択すると、影や反射などの効果を調整できます。
        </div>
      )}

      {el && (
        <>
          <Section title="影" open={open.shadow} onToggle={() => setOpen((o) => ({ ...o, shadow: !o.shadow }))} pal={pal}>
            <div className="flex items-center gap-1 px-3 py-1">
              <span className="w-[52px] shrink-0 text-[11px]" style={{ color: pal.sub }}>標準スタイル</span>
              {SHADOW_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => commit({ ...fx, shadow: p.value ? { ...fx.shadow, ...p.value } : { ...fx.shadow, on: false } })}
                  className="rounded border px-1.5 py-0.5 text-[10.5px]"
                  style={{ borderColor: pal.border, color: pal.text }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 px-3 py-[3px]">
              <span className="w-[52px] shrink-0 text-[11px]" style={{ color: pal.sub }}>色</span>
              <input type="color" value={fx.shadow.color}
                onChange={(e) => set('shadow', { color: e.target.value, on: true })}
                className="h-6 w-8 cursor-pointer rounded border" style={{ borderColor: pal.border }} />
            </div>
            <Row label="透明度" value={fx.shadow.opacity} min={0} max={100} unit="%" disabled={!fx.shadow.on}
              onChange={(v) => set('shadow', { opacity: v })} pal={pal} />
            <Row label="サイズ" value={fx.shadow.size} min={-20} max={40} unit="px" disabled={!fx.shadow.on}
              onChange={(v) => set('shadow', { size: v })} pal={pal} />
            <Row label="ぼかし" value={fx.shadow.blur} min={0} max={80} unit="px" disabled={!fx.shadow.on}
              onChange={(v) => set('shadow', { blur: v })} pal={pal} />
            <Row label="角度" value={fx.shadow.angle} min={0} max={360} unit="°" disabled={!fx.shadow.on}
              onChange={(v) => set('shadow', { angle: v })} pal={pal} />
            <Row label="距離" value={fx.shadow.distance} min={0} max={80} unit="px" disabled={!fx.shadow.on}
              onChange={(v) => set('shadow', { distance: v, on: true })} pal={pal} />
          </Section>

          <Section title="反射" open={open.reflection} onToggle={() => setOpen((o) => ({ ...o, reflection: !o.reflection }))} pal={pal}>
            <div className="flex items-center gap-1 px-3 py-1">
              <span className="w-[52px] shrink-0 text-[11px]" style={{ color: pal.sub }}>標準スタイル</span>
              <button onClick={() => set('reflection', { on: false })} className="rounded border px-1.5 py-0.5 text-[10.5px]" style={{ borderColor: pal.border, color: pal.text }}>なし</button>
              <button onClick={() => set('reflection', { on: true, opacity: 50, size: 35, distance: 4 })} className="rounded border px-1.5 py-0.5 text-[10.5px]" style={{ borderColor: pal.border, color: pal.text }}>接触</button>
              <button onClick={() => set('reflection', { on: true, opacity: 40, size: 50, distance: 16 })} className="rounded border px-1.5 py-0.5 text-[10.5px]" style={{ borderColor: pal.border, color: pal.text }}>離す</button>
            </div>
            <Row label="透明度" value={fx.reflection.opacity} min={0} max={100} unit="%" disabled={!fx.reflection.on}
              onChange={(v) => set('reflection', { opacity: v })} pal={pal} />
            <Row label="サイズ" value={fx.reflection.size} min={0} max={100} unit="%" disabled={!fx.reflection.on}
              onChange={(v) => set('reflection', { size: v })} pal={pal} />
            <Row label="距離" value={fx.reflection.distance} min={0} max={60} unit="px" disabled={!fx.reflection.on}
              onChange={(v) => set('reflection', { distance: v })} pal={pal} />
          </Section>

          <Section title="光彩" open={open.glow} onToggle={() => setOpen((o) => ({ ...o, glow: !o.glow }))} pal={pal}>
            <div className="flex items-center gap-2 px-3 py-[3px]">
              <span className="w-[52px] shrink-0 text-[11px]" style={{ color: pal.sub }}>色</span>
              <input type="color" value={fx.glow.color}
                onChange={(e) => set('glow', { color: e.target.value, on: true })}
                className="h-6 w-8 cursor-pointer rounded border" style={{ borderColor: pal.border }} />
              <button onClick={() => set('glow', { on: !fx.glow.on })}
                className="ml-auto rounded border px-1.5 py-0.5 text-[10.5px]" style={{ borderColor: pal.border, color: pal.text }}>
                {fx.glow.on ? '光彩を消す' : '光彩を付ける'}
              </button>
            </div>
            <Row label="サイズ" value={fx.glow.size} min={0} max={60} unit="px" disabled={!fx.glow.on}
              onChange={(v) => set('glow', { size: v })} pal={pal} />
            <Row label="透明度" value={fx.glow.opacity} min={0} max={100} unit="%" disabled={!fx.glow.on}
              onChange={(v) => set('glow', { opacity: v })} pal={pal} />
          </Section>

          <Section title="ぼかし(ソフトエッジ)" open={open.softEdge} onToggle={() => setOpen((o) => ({ ...o, softEdge: !o.softEdge }))} pal={pal}>
            <div className="px-3 py-1">
              <button onClick={() => set('softEdge', { on: !fx.softEdge.on })}
                className="rounded border px-1.5 py-0.5 text-[10.5px]" style={{ borderColor: pal.border, color: pal.text }}>
                {fx.softEdge.on ? 'ソフトエッジを消す' : 'ソフトエッジを付ける'}
              </button>
            </div>
            <Row label="サイズ" value={fx.softEdge.size} min={0} max={45} unit="%" disabled={!fx.softEdge.on}
              onChange={(v) => set('softEdge', { size: v })} pal={pal} />
          </Section>

          <button
            onClick={() => commit(DEFAULT_FX)}
            className="m-3 rounded border px-2 py-1 text-[11.5px]"
            style={{ borderColor: pal.border, color: pal.text }}
          >
            効果をすべて解除
          </button>
        </>
      )}
    </div>
  );
}
