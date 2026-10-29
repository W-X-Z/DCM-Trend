import Link from 'next/link';
import type { ReactNode } from 'react';
import { FabContext } from './Fab';
import { FilterMenu } from './FilterMenu';
import { SectionHead } from './Ui';
import { kstToday } from '@/lib/filings';
import { won } from '@/lib/format';
import { getBondHistory, getMaturities } from '@/lib/queries';
import {
  DEFAULT_PERIOD, GRADES, MARKETS, PERIODS, RECO, buildReco, historySince, marketOf, periodRange, windowEnd,
  type Grade, type MarketKey, type Period, type RecoItem,
} from '@/lib/reco';
const SHOW = 18;

const md = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
const ym = (d: string) => `${d.slice(2, 4)}.${d.slice(5, 7)}`;
// 증권사 이름 줄임: NH투자증권 → NH, 한국투자증권 → 한국, 미래에셋증권 → 미래에셋
export const firm = (s: string) => s.replace(/(금융투자|투자증권|증권)$/, '') || s;

function Firms({ list, max = 4 }: { list: string[]; max?: number }) {
  // NH 가 뒤쪽에 있어도 보이도록 NH 를 먼저 넣고 자른다
  const nh = list.filter((f) => /NH/.test(f));
  const shown = [...list.filter((f, i) => i < max && !/NH/.test(f)).slice(0, Math.max(0, max - nh.length)), ...nh];
  const ordered = list.filter((f) => shown.includes(f));
  return (
    <>
      {ordered.map((f, i) => (
        <span key={f}>
          {i > 0 && '·'}
          {/NH/.test(f) ? <strong>{firm(f)}</strong> : firm(f)}
        </span>
      ))}
      {list.length > ordered.length && <span className="muted"> 외 {list.length - ordered.length}</span>}
    </>
  );
}

function Card({ it }: { it: RecoItem }) {
  const t = it.tranches;
  const series = t[0].series ? `제${t[0].series}회` : '회차 미상';
  return (
    <li className="rc">
      <div className="rc-top">
        <span className="rc-d tnum">D-{it.days_left}</span>
        <span className="rc-dt">{md(it.first_dt)} 만기</span>
      </div>
      <div className="rc-co">
        <Link href={`/company/${it.corp_code}`} className="rc-corp">{it.corp_name}</Link>
        <span className="rc-meta">{[it.rating, it.market && it.market !== '기타' ? it.market : '비상장'].filter(Boolean).join(' · ')}</span>
      </div>
      <p className="rc-mat">
        <strong className="tnum">{won(it.amount_krw)}</strong>
        <span>
          {series}
          {t[0].tenor_months ? ` ${Math.round(t[0].tenor_months / 12)}년물` : ''}
          {t.length > 1 ? ` 외 ${t.length - 1}건` : ''}
        </span>
        {it.nh_mat && <span className="rc-nh">NH 주관</span>}
      </p>
      <dl className="rc-hist">
        <div>
          <dt>주관 이력</dt>
          <dd className="tnum">
            {it.issues ? (
              <>
                공모채 {it.issues}회 · NH 대표 {it.nh_lead_n}회{it.nh_co_n ? ` · 인수 ${it.nh_co_n}회` : ''}
              </>
            ) : (
              <span className="muted">최근 {RECO.historyYears}년 공모채 없음</span>
            )}
          </dd>
        </div>
        {it.last_dt && (
          <div>
            <dt>직전 회차</dt>
            <dd className="tnum">
              {ym(it.last_dt)} <Firms list={it.last_leads} />
            </dd>
          </div>
        )}
      </dl>
      <div className="rc-foot">
        <Link href={`/company/${it.corp_code}`} className="cta-sm is-sub" aria-label={`${it.corp_name} 자세히 보기`}>
          자세히 보기
        </Link>
        <Link href={`/proposal/deck?corp=${it.corp_code}`} target="_blank" rel="noopener" className="cta-sm" aria-label={`${it.corp_name} 제안서 초안 (새 탭)`}>
          제안서 초안
        </Link>
      </div>
    </li>
  );
}

// nh: NH주관만 (만기가 돌아오는 회차를 NH투자증권이 대표주관한 회사)
type Filter = { period: Period; grade: Grade | null; market: MarketKey | null; nh: boolean };
type Rest = Omit<Filter, 'period'>;

// 기본값(3~6개월, 등급·시장·주관여부 고르지 않음)은 주소에서 뺀다
function hrefOf(f: Filter) {
  const q = new URLSearchParams();
  if (f.period !== DEFAULT_PERIOD) q.set('p', f.period);
  if (f.grade) q.set('g', f.grade);
  if (f.market) q.set('mk', f.market);
  if (f.nh) q.set('nh', '1');
  const s = q.toString();
  return s ? `/?${s}` : '/';
}

export async function RecoFeed({ period, grade, market, nh }: Filter) {
  const today = kstToday();
  // 만기일정 구간별로 회사를 묶는다 (한 회사가 두 구간에 만기가 있으면 양쪽에 각각)
  let byPeriod: Record<Period, RecoItem[]> | null = null;
  try {
    const mats = await getMaturities({ from: today, to: windowEnd(today), product: 'bond', eventType: '만기' });
    const corps = [...new Set(mats.filter((m) => m.sub_type !== '금융채').map((m) => m.corp_code))];
    const hist = await getBondHistory(corps, historySince(today));
    byPeriod = Object.fromEntries(
      PERIODS.map((p) => {
        const [a, b] = periodRange(today, p.key);
        return [p.key, buildReco(mats.filter((m) => m.event_dt >= a && m.event_dt < b), hist, today)];
      }),
    ) as Record<Period, RecoItem[]>;
  } catch {
    byPeriod = null;
  }

  const head = (right?: ReactNode) => (
    <SectionHead
      id="reco-h"
      title="영업 추천"
      info={`공모 회사채(금융채 제외) 만기가 돌아오는 회사를 만기가 가까운 순으로 보여 줍니다(같은 날은 만기 금액이 큰 순). 만기일정 기본은 제안 적기인 3~6개월 뒤. 등급은 최근 공모채 기준, 상장시장은 만기 회차 기준, 주관 이력은 최근 ${RECO.historyYears}년 공모채입니다. NH주관은 만기가 돌아오는 회차를 NH투자증권이 대표주관한 회사입니다. 이미 차환 신고서를 낸 회사는 맨 아래에 따로 둡니다.`}
      right={right}
    />
  );

  if (byPeriod === null) {
    return (
      <section className="section reco-sec" aria-labelledby="reco-h">
        {head()}
        <p className="empty">추천 목록을 불러오지 못했습니다. 잠시 뒤 새로고침하세요.</p>
      </section>
    );
  }

  const fit = (it: RecoItem, x: Rest) =>
    (!x.grade || it.grade === x.grade) && (!x.market || marketOf(it.market) === x.market) && (!x.nh || it.nh_mat);
  const rest: Rest = { grade, market, nh };
  const openIn = (p: Period) => byPeriod![p].filter((i) => !i.refi);
  const cur = openIn(period);
  // 드롭다운 항목별 건수: 나머지 필터는 그대로 두고 그 항목만 바꿨을 때
  const count = (x: Partial<Rest>) => cur.filter((i) => fit(i, { ...rest, ...x })).length;
  const shown = cur.filter((i) => fit(i, rest));
  const done = byPeriod[period].filter((i) => i.refi && fit(i, rest));
  const f: Filter = { period, grade, market, nh };
  const pLabel = PERIODS.find((p) => p.key === period)!.label;
  const gLabel = GRADES.find((g) => g.key === grade)?.label;
  const mLabel = MARKETS.find((m) => m.key === market)?.label;

  const filters = (
    <div className="reco-filters">
      <FilterMenu
        name="만기일정"
        value={pLabel}
        active={period !== DEFAULT_PERIOD}
        options={PERIODS.map((p) => ({
          key: p.key, label: p.label, on: p.key === period, href: hrefOf({ ...f, period: p.key }),
          count: openIn(p.key).filter((i) => fit(i, rest)).length,
        }))}
      />
      <FilterMenu
        name="신용등급"
        value={gLabel ?? '신용등급'}
        active={!!grade}
        options={[
          { key: 'all', label: '전체', on: !grade, href: hrefOf({ ...f, grade: null }), count: count({ grade: null }) },
          ...GRADES.map((g) => ({
            key: g.key, label: g.label, on: g.key === grade, href: hrefOf({ ...f, grade: g.key }), count: count({ grade: g.key }),
          })),
        ]}
      />
      <FilterMenu
        name="상장시장"
        value={mLabel ?? '상장시장'}
        active={!!market}
        options={[
          { key: 'all', label: '전체', on: !market, href: hrefOf({ ...f, market: null }), count: count({ market: null }) },
          ...MARKETS.map((m) => ({
            key: m.key, label: m.label, on: m.key === market, href: hrefOf({ ...f, market: m.key }), count: count({ market: m.key }),
          })).filter((o) => o.count > 0 || o.on),
        ]}
      />
      <FilterMenu
        name="주관여부"
        value={nh ? 'NH주관' : '주관여부'}
        active={nh}
        options={[
          { key: 'all', label: '전체', on: !nh, href: hrefOf({ ...f, nh: false }), count: count({ nh: false }) },
          { key: 'nh', label: 'NH주관', on: nh, href: hrefOf({ ...f, nh: true }), count: count({ nh: true }) },
        ]}
      />
    </div>
  );

  return (
    <section className="section reco-sec" aria-labelledby="reco-h">
      <FabContext
        label="영업 추천 회사"
        companies={shown.slice(0, 10).map((i) => ({ c: i.corp_code, n: i.corp_name, sub: `D-${i.days_left} · ${won(i.amount_krw)} 만기` }))}
      />
      {head(filters)}
      {shown.length === 0 ? (
        <p className="empty">조건에 맞는 회사가 없습니다.</p>
      ) : (
        <>
          <ol className="reco">
            {shown.slice(0, SHOW).map((it) => (
              <Card key={it.corp_code} it={it} />
            ))}
          </ol>
          {shown.length > SHOW && (
            <details className="disc-more reco-more">
              <summary>{shown.length - SHOW}곳 더 보기</summary>
              <ol className="reco">
                {shown.slice(SHOW).map((it) => (
                  <Card key={it.corp_code} it={it} />
                ))}
              </ol>
            </details>
          )}
        </>
      )}
      {done.length > 0 && (
        <details className="disc-more reco-done">
          <summary>차환 신고서를 이미 낸 회사 {done.length}곳</summary>
          <ul className="reco-done-list">
            {done.map((it) => (
              <li key={it.corp_code}>
                <Link href={`/company/${it.corp_code}`}>{it.corp_name}</Link>
                <span className="muted tnum">
                  {md(it.first_dt)} 만기 {won(it.amount_krw)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
