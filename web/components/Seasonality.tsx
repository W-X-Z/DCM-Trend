import { Info } from './Ui';
import { won } from '@/lib/format';

type Row = { month: string; amount_krw: number | null; deal_count: number };

// 칸 금액은 조원 (1천억 미만은 소수 둘째 자리)
const jo = (krw: number) => (krw >= 1e11 ? (krw / 1e12).toFixed(1) : (krw / 1e12).toFixed(2));

// 연도 × 월 발행금액 히트맵. 색은 한 색(상품 색)의 진하기, 칸에 금액을 적는다.
// 맨 아래 줄은 다 찬 연도들의 '연간 대비 월 비중' 평균 → 어느 달에 몰리는지.
export function Seasonality({ rows, color, title, note, todayMonth }: { rows: Row[]; color: string; title: string; note: string; todayMonth: string }) {
  const byYm = new Map<string, { amount: number; count: number }>();
  for (const r of rows) {
    const k = r.month.slice(0, 7);
    const e = byYm.get(k) ?? { amount: 0, count: 0 };
    e.amount += Number(r.amount_krw ?? 0);
    e.count += Number(r.deal_count ?? 0);
    byYm.set(k, e);
  }
  const years = [...new Set([...byYm.keys()].map((k) => k.slice(0, 4)))].sort().reverse();
  if (years.length < 2) return null;
  const max = Math.max(...[...byYm.values()].map((v) => v.amount), 1);
  const curYear = todayMonth.slice(0, 4);
  const fullYears = years.filter((y) => y < curYear && Array.from({ length: 12 }, (_, i) => byYm.has(`${y}-${String(i + 1).padStart(2, '0')}`)).filter(Boolean).length >= 10);
  const shareAvg = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, '0');
    const shares = fullYears.map((y) => {
      const tot = Array.from({ length: 12 }, (_, j) => byYm.get(`${y}-${String(j + 1).padStart(2, '0')}`)?.amount ?? 0).reduce((a, b) => a + b, 0);
      return tot ? ((byYm.get(`${y}-${m}`)?.amount ?? 0) / tot) * 100 : 0;
    });
    return shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : null;
  });
  const maxShare = Math.max(...shareAvg.map((s) => s ?? 0), 1);

  return (
    <div className="season">
      <h3 className="sub-h">
        {title}
        <span className="muted small"> 단위 조원</span>
        <Info>{note}</Info>
      </h3>
      <div className="table-wrap">
        <table className="season-grid">
          <thead>
            <tr>
              <th scope="col">연도</th>
              {Array.from({ length: 12 }, (_, i) => (
                <th key={i} scope="col" className="num">{i + 1}월</th>
              ))}
              <th scope="col" className="num">연간</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => {
              const total = Array.from({ length: 12 }, (_, i) => byYm.get(`${y}-${String(i + 1).padStart(2, '0')}`)?.amount ?? 0).reduce((a, b) => a + b, 0);
              return (
                <tr key={y}>
                  <th scope="row">{y}</th>
                  {Array.from({ length: 12 }, (_, i) => {
                    const k = `${y}-${String(i + 1).padStart(2, '0')}`;
                    const v = byYm.get(k);
                    const future = k > todayMonth;
                    const a = v?.amount ?? 0;
                    const t = a / max;
                    return (
                      <td
                        key={k}
                        className={`num${future ? ' is-future' : ''}${k === todayMonth ? ' is-now' : ''}`}
                        style={future || !a ? undefined : { background: `color-mix(in srgb, ${color} ${Math.round(8 + t * 80)}%, white)`, color: t > 0.55 ? '#fff' : undefined }}
                        title={future ? undefined : `${y}년 ${i + 1}월: ${won(a)}, ${v?.count ?? 0}건`}
                      >
                        {future ? '' : a ? jo(a) : '–'}
                      </td>
                    );
                  })}
                  <td className="num season-total">{jo(total)}</td>
                </tr>
              );
            })}
          </tbody>
          {fullYears.length >= 2 && (
            <tfoot>
              <tr>
                <th scope="row">월 비중</th>
                {shareAvg.map((s, i) => (
                  <td key={i} className="num season-share">
                    <span className="season-bar" style={{ height: `${Math.max(2, Math.round(((s ?? 0) / maxShare) * 40))}px`, background: color }} aria-hidden />
                    <span className="season-pct">{s != null ? `${s.toFixed(0)}%` : '–'}</span>
                  </td>
                ))}
                <td className="num muted small">{fullYears.at(-1)}~{fullYears[0]}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
