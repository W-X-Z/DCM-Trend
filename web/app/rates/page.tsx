import Link from 'next/link';
import { Header } from '@/components/Chrome';
import { InsightPanel } from '@/components/Insights';
import { LineChart, type LineSeries } from '@/components/LineChart';
import { bp, date } from '@/lib/format';
import { getPolicyEvents, getRateLatest, getRates, getSpreads } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: '금리 추이' };

const RANGES = { '1y': 1, '3y': 3, '5y': 5 } as const;
type Range = keyof typeof RANGES;

// 계열 색: 같은 계열은 화면 어디서나 같은 색 (기준금리는 정책 기준선이라 무채색 점선)
const COLOR: Record<string, string> = {
  base_rate: 'var(--ink-2)',
  ktb3y: '#2a78d6',
  ktb10y: '#1baf7a',
  corp3y_aa: '#eb6834',
  corp3y_bbb: '#6250d6',
  cd91: '#eda100',
};

export default async function RatesPage({ searchParams }: { searchParams: { p?: string } }) {
  const range: Range = (searchParams.p as Range) in RANGES ? (searchParams.p as Range) : '1y';
  const since = new Date(Date.now() - RANGES[range] * 365.25 * 86400_000).toISOString().slice(0, 10);
  const [latest, rates, spreads, events] = await Promise.all([
    getRateLatest().catch(() => []),
    getRates(since, ['base_rate', 'ktb3y', 'ktb10y', 'corp3y_aa', 'corp3y_bbb']).catch(() => []),
    getSpreads(since).catch(() => []),
    getPolicyEvents().catch(() => []),
  ]);
  const label = Object.fromEntries(latest.map((l) => [l.series_key, l.label_ko]));
  const pts = (k: string) => rates.filter((r) => r.series_key === k).map((r) => ({ t: r.dt, v: Number(r.value) }));
  const level: LineSeries[] = [
    { key: 'base_rate', label: label.base_rate ?? '기준금리', color: COLOR.base_rate, dashed: true, step: true, points: pts('base_rate') },
    { key: 'ktb3y', label: label.ktb3y ?? '국고채 3년', color: COLOR.ktb3y, points: pts('ktb3y') },
    { key: 'ktb10y', label: label.ktb10y ?? '국고채 10년', color: COLOR.ktb10y, points: pts('ktb10y') },
    { key: 'corp3y_aa', label: label.corp3y_aa ?? '회사채 3년 AA-', color: COLOR.corp3y_aa, points: pts('corp3y_aa') },
  ].filter((s) => s.points.length);
  const spread: LineSeries[] = [
    { key: 'aa', label: 'AA- 스프레드 (회사채 AA- − 국고 3년)', color: COLOR.corp3y_aa, points: spreads.filter((s) => s.aa_spread_bp != null).map((s) => ({ t: s.dt, v: Number(s.aa_spread_bp) })) },
    { key: 'term', label: '장단기 금리차 (국고 10년 − 3년)', color: COLOR.ktb10y, points: spreads.filter((s) => s.term_spread_bp != null).map((s) => ({ t: s.dt, v: Number(s.term_spread_bp) })) },
  ].filter((s) => s.points.length);
  const gap: LineSeries[] = [
    { key: 'bbb', label: '등급 간 차이 (BBB- − AA-)', color: COLOR.corp3y_bbb, points: spreads.filter((s) => s.bbb_aa_gap_bp != null).map((s) => ({ t: s.dt, v: Number(s.bbb_aa_gap_bp) })) },
  ].filter((s) => s.points.length);

  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const upcoming = events.filter((e) => e.event_dt >= today);
  const past = events.filter((e) => e.event_dt < today).slice(-3).reverse();

  return (
    <>
      <Header active="rates" />
      <main id="main" className="wrap">
        <div className="page-head">
          <h1 className="page-title">금리 추이</h1>
          <p className="page-sub">
            한국은행 ECOS 일별 시장금리입니다. 제안서의 시장상황 장표에 쓰는 지표와 금통위 일정만 보여 주고, 금리 예측은 하지 않습니다.
          </p>
          <div className="controls">
            <span className="seg" aria-label="기간">
              {(Object.keys(RANGES) as Range[]).map((r) => (
                <Link key={r} href={r === '1y' ? '/rates' : `/rates?p=${r}`} aria-current={range === r}>
                  최근 {RANGES[r]}년
                </Link>
              ))}
            </span>
          </div>
        </div>

        {latest.length === 0 ? (
          <p className="empty">
            금리 데이터가 아직 없습니다. GitHub 저장소에 ECOS_API_KEY 를 등록하면 다음 수집(매일 07:10)부터 채워집니다.
          </p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>지표</th>
                    <th>기준일</th>
                    <th className="num">금리</th>
                    <th className="num">1주</th>
                    <th className="num">1개월</th>
                    <th className="num">3개월</th>
                    <th className="num">1년</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.map((l) => (
                    <tr key={l.series_key}>
                      <td>
                        <span className="swatch-label" style={{ ['--pc' as string]: COLOR[l.series_key] ?? 'var(--muted)' }}>{l.label_ko}</span>
                      </td>
                      <td className="nowrap">{date(l.dt)}</td>
                      <td className="num">{Number(l.value).toFixed(3)}%</td>
                      <td className="num">{bp(l.chg_1w_bp)}</td>
                      <td className="num">{bp(l.chg_1m_bp)}</td>
                      <td className="num">{bp(l.chg_3m_bp)}</td>
                      <td className="num">{bp(l.chg_1y_bp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <InsightPanel scope="rates" title="최근 1개월 변화" />

            <section className="section" aria-labelledby="level-h">
              <div className="section-head">
                <h2 id="level-h">금리 수준</h2>
                <p>기준금리는 점선</p>
              </div>
              <div className="chart-card">
                <LineChart title="기준금리, 국고채, 회사채 AA- 금리" unit="%" series={level} />
              </div>
            </section>

            <section className="section" aria-labelledby="spread-h">
              <div className="section-head">
                <h2 id="spread-h">스프레드</h2>
                <p>단위 bp. 등급 간 차이는 크기가 달라 따로 그립니다</p>
              </div>
              <div className="chart-pair">
                <div className="chart-card">
                  <LineChart title="AA- 스프레드와 장단기 금리차" unit="bp" series={spread} height={220} />
                </div>
                <div className="chart-card">
                  <LineChart title="BBB- 와 AA- 금리 차이" unit="bp" series={gap} height={220} />
                </div>
              </div>
            </section>
          </>
        )}

        <section className="section" aria-labelledby="events-h">
          <div className="section-head">
            <h2 id="events-h">금통위 일정</h2>
            <p>통화정책방향 결정회의</p>
          </div>
          {events.length === 0 ? (
            <p className="empty">등록된 일정이 없습니다.</p>
          ) : (
            <div className="events">
              <div>
                <h3 className="sub-h">다가오는 회의</h3>
                {upcoming.length ? (
                  <ul className="event-list">
                    {upcoming.map((e) => (
                      <li key={e.event_dt}>
                        <strong className="tnum">{date(e.event_dt)}</strong> {e.label_ko}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="note">올해 남은 회의가 없습니다. 내년 일정은 한국은행 발표 후 추가합니다.</p>
                )}
              </div>
              <div>
                <h3 className="sub-h">최근 회의</h3>
                <ul className="event-list">
                  {past.map((e) => (
                    <li key={e.event_dt}>
                      <strong className="tnum">{date(e.event_dt)}</strong> {e.label_ko}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <p className="note">일정 출처: {events[0]?.source ?? '한국은행'}</p>
        </section>
      </main>
    </>
  );
}
