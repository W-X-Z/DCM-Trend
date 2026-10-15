'use client';

import { useMemo, useRef, useState } from 'react';

// 시계열 선 차트. 축 하나, 계열 4개 이하. 마우스·키보드로 날짜를 옮기면 모든 계열 값을 보여 준다.
// 날짜 문자열(YYYY-MM-DD)을 x 로, 값은 같은 단위(% 또는 bp)여야 한다.

export type LineSeries = { key: string; label: string; color: string; dashed?: boolean; step?: boolean; points: { t: string; v: number }[] };

const W = 800;
const H = 260;
const PAD = { l: 0, r: 0, t: 8, b: 0 };

function niceTicks(min: number, max: number, n = 4): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / n;
  const exp = Math.pow(10, Math.floor(Math.log10(step0)));
  const f = step0 / exp;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

const fmtDate = (t: string) => `${t.slice(2, 4)}.${t.slice(5, 7)}.${t.slice(8, 10)}`;

export function LineChart({
  series,
  unit,
  height = 260,
  title,
}: {
  series: LineSeries[];
  unit: '%' | 'bp';
  height?: number;
  title: string;
}) {
  const dates = useMemo(() => {
    const s = new Set<string>();
    for (const x of series) for (const p of x.points) s.add(p.t);
    return [...s].sort();
  }, [series]);
  const maps = useMemo(() => series.map((x) => new Map(x.points.map((p) => [p.t, p.v]))), [series]);
  const [idx, setIdx] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  if (!dates.length) return <p className="empty">표시할 데이터가 없습니다.</p>;

  const all = series.flatMap((x) => x.points.map((p) => p.v));
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const padv = (hi - lo || Math.abs(hi) || 1) * 0.08;
  lo -= padv;
  hi += padv;
  const ticks = niceTicks(lo, hi);
  const x = (i: number) => PAD.l + (dates.length === 1 ? 0.5 : i / (dates.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const di = new Map(dates.map((d, i) => [d, i]));

  const path = (s: LineSeries) => {
    let d = '';
    let prev: { X: number; Y: number } | null = null;
    for (const p of s.points) {
      const X = x(di.get(p.t)!);
      const Y = y(p.v);
      if (!prev) d += `M${X},${Y}`;
      else if (s.step) d += `H${X}V${Y}`;
      else d += `L${X},${Y}`;
      prev = { X, Y };
    }
    return d;
  };

  const fmt = (v: number) => (unit === '%' ? `${v.toFixed(2)}%` : `${Math.round(v)}bp`);
  const yearTicks = dates.filter((d, i) => i === 0 || d.slice(0, 7) !== dates[i - 1].slice(0, 7))
    .filter((d) => (dates.length > 400 ? d.slice(5, 7) === '01' : ['01', '04', '07', '10'].includes(d.slice(5, 7))));

  const onMove = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
    setIdx(Math.round(f * (dates.length - 1)));
  };
  const cur = idx === null ? null : dates[idx];

  return (
    <figure className="linechart" aria-label={title}>
      <ul className="lc-legend">
        {series.map((s) => (
          <li key={s.key}>
            <span className={`lc-key${s.dashed ? ' is-dashed' : ''}`} style={{ borderColor: s.color }} aria-hidden />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="lc-body">
        <div className="lc-yaxis" aria-hidden>
          {ticks.map((t) => (
            <span key={t} style={{ top: `${(y(t) / H) * 100}%` }}>{fmt(t)}</span>
          ))}
        </div>
        <div
          className="lc-plot"
          ref={ref}
          style={{ height }}
          tabIndex={0}
          role="img"
          aria-label={`${title}. 왼쪽·오른쪽 화살표로 날짜 이동`}
          onPointerMove={(e) => onMove(e.clientX)}
          onPointerLeave={() => setIdx(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setIdx((i) => Math.max((i ?? dates.length) - 1, 0));
            if (e.key === 'ArrowRight') setIdx((i) => Math.min((i ?? -1) + 1, dates.length - 1));
            if (e.key === 'Escape') setIdx(null);
          }}
          onBlur={() => setIdx(null)}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%">
            {ticks.map((t) => (
              <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} className="lc-grid" vectorEffect="non-scaling-stroke" />
            ))}
            {series.map((s) => (
              <path
                key={s.key}
                d={path(s)}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            ))}
          </svg>
          {cur && (
            <>
              <div className="lc-cross" style={{ left: `${(x(idx!) / W) * 100}%` }} />
              {series.map((s, i) => {
                const v = maps[i].get(cur);
                return v === undefined ? null : (
                  <div key={s.key} className="lc-dot" style={{ left: `${(x(idx!) / W) * 100}%`, top: `${(y(v) / H) * 100}%`, background: s.color }} />
                );
              })}
              <div className={`lc-tip${idx! > dates.length / 2 ? ' is-left' : ''}`} style={{ left: `${(x(idx!) / W) * 100}%` }}>
                <strong>{fmtDate(cur)}</strong>
                {series.map((s, i) => {
                  const v = maps[i].get(cur);
                  return (
                    <span key={s.key}>
                      <i style={{ background: s.color }} aria-hidden />
                      {s.label} {v === undefined ? '–' : fmt(v)}
                    </span>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="lc-xaxis" aria-hidden>
        {yearTicks.map((d) => (
          <span key={d} style={{ left: `${(x(di.get(d)!) / W) * 100}%` }}>{dates.length > 400 ? d.slice(0, 4) : `${d.slice(2, 4)}.${d.slice(5, 7)}`}</span>
        ))}
      </div>
    </figure>
  );
}
