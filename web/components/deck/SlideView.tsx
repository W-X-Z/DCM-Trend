'use client';

// 슬라이드 미리보기 (HTML). 780x540pt 판을 화면 폭에 맞춰 줄인다.
import type { CSSProperties, ReactNode } from 'react';
import { BULLET_INDENT, cellBoxes, type BarChart, type Chart, type Para, type Prim, type Slide, type Table, type TextBox } from '@/lib/deck/model';
import { colsGeom, lineGeom, type Geom } from '@/lib/deck/chart';
import { C, LINE, PAGE } from '@/lib/deck/theme';

const hex = (c?: string) => (c ? `#${c}` : undefined);
const FONT = "'NanumGothicDeck', 'NanumGothic', 'Nanum Gothic', 'Malgun Gothic', sans-serif";

function Paras({ paras, size, color, bold, line, align }: { paras: Para[]; size: number; color: string; bold?: boolean; line: number; align?: string }) {
  const ind = BULLET_INDENT(size);
  return (
    <>
      {paras.map((p, i) => (
        <div
          key={i}
          style={{
            marginTop: i ? p.gap ?? 0 : 0,
            paddingLeft: p.bullet ? ind : 0,
            position: 'relative',
            textAlign: (align === 'c' ? 'center' : align === 'r' ? 'right' : 'left') as CSSProperties['textAlign'],
            lineHeight: `${size * line}px`,
            minHeight: size * line,
          }}
        >
          {p.bullet && (
            <span
              aria-hidden
              style={{ position: 'absolute', left: size * 0.25, top: size * line * 0.5 - size * 0.17, width: size * 0.34, height: size * 0.34, background: hex(color) }}
            />
          )}
          {p.runs.map((r, j) => (
            <span
              key={j}
              style={{
                fontWeight: r.b || bold ? 700 : 400,
                textDecoration: r.u ? 'underline' : undefined,
                textUnderlineOffset: r.u ? 2 : undefined,
                color: hex(r.color ?? color),
                fontSize: r.size ?? size,
              }}
            >
              {r.t}
            </span>
          ))}
        </div>
      ))}
    </>
  );
}

function TextEl({ t }: { t: TextBox }) {
  const pad = t.pad ?? 4;
  return (
    <div
      style={{
        position: 'absolute', left: t.x, top: t.y, width: t.w, height: t.h, padding: pad, boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', justifyContent: t.valign === 'm' ? 'center' : t.valign === 'b' ? 'flex-end' : 'flex-start',
        fontSize: t.size, color: hex(t.color), fontWeight: t.xb ? 800 : t.bold ? 700 : 400, overflow: 'visible',
        wordBreak: 'keep-all', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap',
      }}
    >
      <Paras paras={t.paras} size={t.size} color={t.color} bold={t.bold || t.xb} line={t.line ?? LINE} align={t.align} />
    </div>
  );
}

function TableEl({ t }: { t: Table }) {
  const { boxes } = cellBoxes(t);
  const out: ReactNode[] = [];
  for (const b of boxes) {
    const size = b.cell.size ?? t.size;
    out.push(
      <div
        key={`${b.r}-${b.c}`}
        style={{
          position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, boxSizing: 'border-box',
          background: hex(b.cell.fill), padding: '1px 4px',
          borderTop: `0.5px solid ${hex(t.grid)}`, borderBottom: `0.5px solid ${hex(t.grid)}`,
          borderLeft: t.gridV ? `0.5px solid ${hex(t.grid)}` : undefined, borderRight: t.gridV ? `0.5px solid ${hex(t.grid)}` : undefined,
          display: 'flex', flexDirection: 'column', justifyContent: b.cell.valign === 't' ? 'flex-start' : b.cell.valign === 'b' ? 'flex-end' : 'center',
          fontSize: size, wordBreak: 'keep-all', overflowWrap: 'anywhere', overflow: 'hidden',
        }}
      >
        <Paras paras={b.cell.paras} size={size} color={b.cell.color ?? t.color} bold={b.cell.bold} line={1.22} align={b.cell.align ?? 'c'} />
      </div>,
    );
  }
  return <>{out}</>;
}

function BarEl({ c, x, y, w, h }: { c: BarChart; x: number; y: number; w: number; h: number }) {
  const max = Math.max(...c.values, 1);
  const n = c.values.length;
  const slot = w / n;
  const bw = Math.min(34, slot * 0.55);
  const base = h - 18;
  return (
    <svg style={{ position: 'absolute', left: x, top: y, overflow: 'visible' }} width={w} height={h}>
      <line x1={0} x2={w} y1={base} y2={base} stroke={hex(C.grid)} strokeWidth={0.75} />
      {c.values.map((v, i) => {
        const bh = (v / max) * (base - 16);
        const cx = slot * i + slot / 2;
        const hi = c.highlight.includes(i);
        return (
          <g key={i}>
            <rect x={cx - bw / 2} y={base - bh} width={bw} height={bh} fill={hex(hi ? c.hiColor : c.color)} />
            <text x={cx} y={base - bh - 4} textAnchor="middle" fontSize={8.5} fontWeight={hi ? 700 : 400} fill={hex(C.ink)}>{c.labels[i]}</text>
            <text x={cx} y={base + 12} textAnchor="middle" fontSize={8.5} fontWeight={hi ? 700 : 400} fill={hex(C.sub)}>{c.cats[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

function GeomEl({ g, x, y, w, h }: { g: Geom; x: number; y: number; w: number; h: number }) {
  return (
    <svg style={{ position: 'absolute', left: x, top: y, overflow: 'visible' }} width={w} height={h}>
      {g.grid.map((l, i) => <line key={`g${i}`} x1={l.x1} x2={l.x2} y1={l.y} y2={l.y} stroke={hex(C.grid)} strokeWidth={0.5} />)}
      {g.base && <line x1={g.base.x1} x2={g.base.x2} y1={g.base.y} y2={g.base.y} stroke={hex(C.sub)} strokeWidth={0.6} />}
      {g.rects.map((r, i) => <rect key={`r${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill={hex(r.color)} />)}
      {g.paths.map((p, i) => (
        <path key={`p${i}`} d={p.pts.map((q, k) => `${k ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('')} fill="none" stroke={hex(p.color)} strokeWidth={1.4} strokeLinejoin="round" />
      ))}
      {g.texts.map((t, i) => (
        <text key={`t${i}`} x={t.x} y={t.y} textAnchor={t.anchor} fontSize={t.size} fontWeight={t.bold ? 700 : 400} fill={hex(t.color)}>{t.t}</text>
      ))}
      {g.legend.map((l, i) => (
        <g key={`l${i}`} transform={`translate(${l.x}, ${l.y})`}>
          {l.kind === 'line' ? <line x1={0} x2={12} y1={-2.5} y2={-2.5} stroke={hex(l.color)} strokeWidth={2} /> : <rect x={2} y={-6.5} width={8} height={7} fill={hex(l.color)} />}
          <text x={16} y={0} fontSize={7.5} fill={hex(C.ink)}>{l.name}</text>
        </g>
      ))}
    </svg>
  );
}

function ChartEl({ ch }: { ch: Chart }) {
  const c = ch.chart;
  if (c.kind === 'bar') return <BarEl c={c} x={ch.x} y={ch.y} w={ch.w} h={ch.h} />;
  const g = c.kind === 'line' ? lineGeom(c, ch.w, ch.h) : colsGeom(c, ch.w, ch.h);
  return <GeomEl g={g} x={ch.x} y={ch.y} w={ch.w} h={ch.h} />;
}

function PrimEl({ p }: { p: Prim }) {
  switch (p.k) {
    case 'rect':
      return (
        <div
          style={{
            position: 'absolute', left: p.x, top: p.y, width: p.w, height: p.h, background: hex(p.fill), boxSizing: 'border-box',
            border: p.stroke ? `${p.sw ?? 0.75}px ${p.dash ? 'dashed' : 'solid'} ${hex(p.stroke)}` : undefined,
          }}
        />
      );
    case 'line': {
      const horiz = p.y1 === p.y2;
      return (
        <div
          style={{
            position: 'absolute', left: Math.min(p.x1, p.x2), top: Math.min(p.y1, p.y2) - (horiz ? p.w / 2 : 0),
            width: horiz ? Math.abs(p.x2 - p.x1) : p.w, height: horiz ? p.w : Math.abs(p.y2 - p.y1), background: hex(p.color),
          }}
        />
      );
    }
    case 'img':
      // eslint-disable-next-line @next/next/no-img-element
      return <img alt="" src={p.src === 'logo-white' ? '/deck/nh-logo-white.png' : p.src === 'logo-color' ? '/deck/nh-logo-color.png' : p.src} style={{ position: 'absolute', left: p.x, top: p.y, width: p.w, height: p.h }} />;
    case 'text':
      return <TextEl t={p} />;
    case 'table':
      return <TableEl t={p} />;
    case 'chart':
      return <ChartEl ch={p} />;
  }
}

// 검토 표시(화면 미리보기 전용): 장표 위에 겹쳐 그린다. focus 면 표시 밖을 흐리게.
export type ViewMark = { key: string; kind: string; x: number; y: number; w: number; h: number; text: string; n: number };

export function SlideView({ slide, width, marks, focus, active, onPick }: { slide: Slide; width: number; marks?: ViewMark[]; focus?: boolean; active?: string | null; onPick?: (key: string) => void }) {
  const k = width / PAGE.w;
  const ms = marks ?? [];
  return (
    <div className="dk-slide" style={{ width, height: PAGE.h * k }}>
      <div
        style={{
          position: 'relative', width: PAGE.w, height: PAGE.h, transform: `scale(${k})`, transformOrigin: '0 0',
          background: hex(slide.bg ?? C.white), fontFamily: FONT, color: hex(C.ink), overflow: 'hidden',
        }}
      >
        {slide.chrome.map((p, i) => <PrimEl key={`c${i}`} p={p} />)}
        {slide.prims.map((p, i) => <PrimEl key={i} p={p} />)}
        {focus && ms.length > 0 && (
          <svg aria-hidden width={PAGE.w} height={PAGE.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <defs>
              <mask id={`dk-mask-${slide.id}`}>
                <rect x={0} y={0} width={PAGE.w} height={PAGE.h} fill="white" />
                {ms.map((m) => <rect key={m.key} x={m.x} y={m.y} width={m.w} height={m.h} fill="black" />)}
              </mask>
            </defs>
            <rect x={0} y={0} width={PAGE.w} height={PAGE.h} fill="rgb(248 249 251 / 0.78)" mask={`url(#dk-mask-${slide.id})`} />
          </svg>
        )}
        {ms.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`dk-mark mk-${m.kind}${active === m.key ? ' is-active' : ''}`}
            style={{ left: m.x, top: m.y, width: m.w, height: m.h }}
            aria-label={`검토 ${m.n}: ${m.text}`}
            title={m.text}
            onClick={() => onPick?.(m.key)}
          >
            <span className="dk-mark-pin" aria-hidden>{m.n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
