import Link from 'next/link';
import { InlineBar } from './BarChart';
import { Info } from './Ui';
import { bp, date, num, pct, won } from '@/lib/format';
import { comboStats, ratingStats, tenorMix, type TenorRow } from '@/lib/tranche';
import type { BondIssue } from '@/lib/types';

// 만기 구간은 순서가 있는 값이라 한 색(회사채 파랑)의 밝기로 구분한다. 만기 미상은 회색.
const TENOR_COLOR: Record<string, string> = {
  '2년 미만': '#b9d3f3',
  '2년': '#8bb6ec',
  '3년': '#5a96e1',
  '5년': '#2a78d6',
  '7년': '#1f5ea9',
  '10년 이상': '#15447c',
  '만기 미상': '#c3c8d1',
};
const DARK = new Set(['5년', '7년', '10년 이상']);

function TenorBar({ rows }: { rows: TenorRow[] }) {
  return (
    <div className="tmix" role="img" aria-label={rows.map((r) => `${r.bucket} ${pct(r.share, 0)}`).join(', ')}>
      {rows.map((r) => (
        <span
          key={r.bucket}
          className="tmix-seg"
          style={{ flexGrow: Number(r.share ?? 0), background: TENOR_COLOR[r.bucket], color: DARK.has(r.bucket) ? '#fff' : 'var(--ink)' }}
          title={`${r.bucket}: ${won(r.amount)} (${pct(r.share, 1)}), 트랜치 ${r.tranches}개`}
        >
          {(r.share ?? 0) >= 8 ? (
            <>
              {r.bucket} <b className="tnum">{pct(r.share, 0)}</b>
            </>
          ) : null}
        </span>
      ))}
    </div>
  );
}

const ratio = (v: number | null) => (v != null ? `${num(v, 1)}배` : '–');

export function TrancheSection({ issues, period }: { issues: BondIssue[]; period: string }) {
  if (!issues.length) return null;
  const mix = tenorMix(issues);
  const combos = comboStats(issues);
  const ratings = ratingStats(issues);
  const maxCombo = Math.max(...combos.map((c) => c.issues), 0);
  const multi = issues.filter((i) => i.tranche_count >= 2).length;
  return (
    <section className="section" aria-labelledby="tranche-h">
      <div className="section-head">
        <h2 id="tranche-h">
          트랜치 구조
          <Info>같은 회사·같은 본 회차·같은 납입일의 트랜치(22-1, 22-2 …)를 한 발행으로 묶었습니다. 경쟁률은 최초 모집액 대비 수요, 가산금리는 확정 가산금리의 중간값입니다. 증액 비중은 최초 모집액보다 늘려 확정한 비율입니다.</Info>
        </h2>
        <span className="muted small tnum">
          {period}, 발행 {num(issues.length)}건 중 {num(multi)}건이 2개 이상 트랜치
        </span>
      </div>

      <h3 className="sub-h">만기 구간별 발행액</h3>
      <TenorBar rows={mix} />
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>만기</th>
              <th className="num">트랜치</th>
              <th className="num">금액</th>
              <th className="num">비중</th>
              <th className="num">경쟁률 중간값</th>
              <th className="num">가산금리 중간값</th>
              <th className="num">증액 비중</th>
            </tr>
          </thead>
          <tbody>
            {mix.map((r) => (
              <tr key={r.bucket}>
                <td>
                  <span className="swatch" style={{ background: TENOR_COLOR[r.bucket] }} aria-hidden />
                  {r.bucket}
                </td>
                <td className="num">{num(r.tranches)}</td>
                <td className="num">{won(r.amount)}</td>
                <td className="num">{pct(r.share, 1)}</td>
                <td className="num">{ratio(r.medComp)}</td>
                <td className="num">{r.medSpread != null ? bp(r.medSpread) : '–'}</td>
                <td className="num">{pct(r.incShare, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="breakdowns tranche-grid">
        <div>
          <h3 className="sub-h">많이 쓰는 트랜치 조합</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>조합</th>
                  <th className="num">발행</th>
                  <th className="num">비중</th>
                  <th aria-hidden style={{ width: '18%' }} />
                  <th className="num">평균 발행액</th>
                  <th className="num">경쟁률</th>
                  <th className="num">증액</th>
                </tr>
              </thead>
              <tbody>
                {combos.map((c) => (
                  <tr key={c.combo}>
                    <td className="nowrap">{c.combo}</td>
                    <td className="num">{num(c.issues)}</td>
                    <td className="num">{pct(c.share, 0)}</td>
                    <td><InlineBar value={c.issues} max={maxCombo} color="var(--bond)" /></td>
                    <td className="num">{won(c.avgAmount)}</td>
                    <td className="num">{ratio(c.medComp)}</td>
                    <td className="num">{pct(c.incShare, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h3 className="sub-h">
            등급별 대표 구조
            <Info>등급 그룹마다 가장 많이 쓴 트랜치 조합과 그 비중, 발행액·경쟁률의 중간값입니다. 제안서의 트랜치·금액 기준점으로 씁니다.</Info>
          </h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>등급</th>
                  <th className="num">발행</th>
                  <th>대표 조합</th>
                  <th className="num">평균 트랜치</th>
                  <th className="num">발행액</th>
                  <th className="num">경쟁률</th>
                  <th className="num">증액</th>
                </tr>
              </thead>
              <tbody>
                {ratings.map((r) => (
                  <tr key={r.group}>
                    <td>{r.group}</td>
                    <td className="num">{num(r.issues)}</td>
                    <td className="nowrap">
                      {r.topCombo ?? '–'}
                      {r.topShare != null && <span className="muted small"> {pct(r.topShare, 0)}</span>}
                    </td>
                    <td className="num">{num(r.avgTranches, 1)}</td>
                    <td className="num">{won(r.medAmount)}</td>
                    <td className="num">{ratio(r.medComp)}</td>
                    <td className="num">{pct(r.incShare, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

// 가산금리(민평 방식) 또는 확정 금리(고정금리 방식) 범위
function rateRange(i: BondIssue) {
  if (i.spread_min_bp != null) {
    return i.spread_min_bp === i.spread_max_bp ? bp(i.spread_min_bp) : `${bp(i.spread_min_bp)}~${bp(i.spread_max_bp)}`;
  }
  const c = (i.tranches ?? []).map((t) => t.coupon_pct).filter((x): x is number => x != null).map(Number);
  if (!c.length) return '–';
  const lo = Math.min(...c);
  const hi = Math.max(...c);
  return lo === hi ? pct(lo, 2) : `${pct(lo, 2)}~${pct(hi, 2)}`;
}

export function BondIssueTable({ issues, caption }: { issues: BondIssue[]; caption?: string }) {
  return (
    <div className="table-wrap">
      <table className="data issues-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            <th>납입일</th>
            <th>발행사</th>
            <th>등급</th>
            <th>트랜치</th>
            <th className="num">확정액</th>
            <th className="num">최초 대비</th>
            <th className="num">경쟁률</th>
            <th className="num">금리</th>
            <th className="col-lead">대표주관</th>
            <th>공시</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((i) => (
            <tr key={i.issue_key} className={i.nh_lead ? 'row-nh' : undefined}>
              <td className="nowrap tnum">{date(i.deal_dt)}</td>
              <td>
                <Link href={`/company/${i.corp_code}`}>{i.corp_name}</Link>
                {i.sub_type && i.sub_type !== '일반회사채' && <span className="muted small"> {i.sub_type}</span>}
              </td>
              <td className="nowrap">{i.rating ?? '–'}</td>
              <td>
                <span className="trs">
                  {(i.tranches ?? []).map((t) => (
                    <span key={t.deal_key} className="tr-chip">
                      {t.tenor_label ?? '만기 미상'} <b className="tnum">{won(t.amount_krw)}</b>
                    </span>
                  ))}
                </span>
              </td>
              <td className="num">{won(i.amount_krw)}</td>
              <td className="num">
                {i.is_undersubscribed ? <span className="badge badge-alert">미달</span> : i.increase_pct ? `+${num(i.increase_pct, 0)}%` : '–'}
              </td>
              <td className="num">{ratio(i.competition_ratio)}</td>
              <td className="num nowrap">{rateRange(i)}</td>
              <td className="col-lead">{i.lead_managers ?? '–'}</td>
              <td>
                {i.latest_rcept_no ? (
                  <a href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${i.latest_rcept_no}`} target="_blank" rel="noreferrer">DART</a>
                ) : '–'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
