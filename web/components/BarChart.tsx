import type { CSSProperties } from 'react';

// 막대 차트 (HTML 막대 + CSS 툴팁). 한 차트에 한 계열, 축 하나.
// 마지막 막대가 진행 중인 기간이면 partialLast 로 옅게 표시한다.

export type Bar = { label: string; value: number; tip: string[] };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * exp;
}

export function BarChart({
  bars,
  color,
  height = 168,
  formatTick,
  labelEvery = 3,
  partialLast = false,
  compact = false,
  title,
}: {
  bars: Bar[];
  color: string;
  height?: number;
  formatTick?: (v: number) => string;
  labelEvery?: number;
  partialLast?: boolean;
  compact?: boolean;
  title: string;
}) {
  const max = niceMax(Math.max(...bars.map((b) => b.value), 0));
  const ticks = compact ? [] : [max, max / 2];
  return (
    <figure className={`bars${compact ? ' bars-compact' : ''}`} style={{ '--bar': color } as CSSProperties} aria-label={title}>
      <div className="bars-plot" style={{ height }}>
        {ticks.map((t) => (
          <div key={t} className="bars-grid" style={{ bottom: `${(t / max) * 100}%` }}>
            <span>{formatTick ? formatTick(t) : t}</span>
          </div>
        ))}
        <div className="bars-cols">
          {bars.map((b, i) => {
            const partial = partialLast && i === bars.length - 1;
            return (
              <div
                key={b.label + i}
                className={`bars-col${partial ? ' is-partial' : ''}`}
                tabIndex={compact ? -1 : 0}
                aria-label={`${b.label} ${b.tip.join(', ')}`}
              >
                <div className="bars-fill" style={{ height: `${(b.value / max) * 100}%` }} />
                <div className="bars-tip" role="tooltip">
                  <strong>{b.label}{partial ? ' (진행 중)' : ''}</strong>
                  {b.tip.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {!compact && (
        <div className="bars-axis" aria-hidden>
          {bars.map((b, i) => (
            <span key={b.label + i}>{i % labelEvery === (bars.length - 1) % labelEvery ? b.label : ''}</span>
          ))}
        </div>
      )}
    </figure>
  );
}

// 표 안에 넣는 가로 막대
export function InlineBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <span className="inline-bar" aria-hidden>
      <span style={{ width: `${max ? Math.max((value / max) * 100, value > 0 ? 1.5 : 0) : 0}%`, background: color }} />
    </span>
  );
}
