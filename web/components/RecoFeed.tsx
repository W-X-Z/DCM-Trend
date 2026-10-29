import Link from 'next/link';
import type { ReactNode } from 'react';
import { FabContext } from './Fab';
import { SectionHead } from './Ui';
import { kstToday } from '@/lib/filings';
import { won } from '@/lib/format';
import { getBondHistory, getMaturities } from '@/lib/queries';
import { GRADES, RECO, buildReco, historySince, windowEnd, type Grade, type RecoItem } from '@/lib/reco';
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
        <Link href={`/proposal/deck?corp=${it.corp_code}`} target="_blank" rel="noopener" className="cta-sm" aria-label={`${it.corp_name} 제안서 초안 (새 탭)`}>
          제안서 초안
        </Link>
      </div>
    </li>
  );
}

export async function RecoFeed({ grade }: { grade: Grade | null }) {
  const today = kstToday();
  let items: RecoItem[] | null = null;
  try {
    const mats = await getMaturities({ from: today, to: windowEnd(today), product: 'bond', eventType: '만기' });
    const corps = [...new Set(mats.filter((m) => m.sub_type !== '금융채').map((m) => m.corp_code))];
    const hist = await getBondHistory(corps, historySince(today));
    items = buildReco(mats, hist, today);
  } catch {
    items = null;
  }

  const head = (right?: ReactNode) => (
    <SectionHead
      id="reco-h"
      title="영업 추천"
      info={`앞으로 ${Math.round(RECO.windowDays / 30)}개월 안에 공모 회사채(금융채 제외) 만기가 돌아오는 회사를 만기 시기(만기 ${RECO.pitchFrom}~${RECO.pitchTo}일 전이 제안 적기), 만기 금액, 최근 ${RECO.historyYears}년 공모채 발행 횟수로 점수를 매겼습니다. 등급은 최근 공모채 기준입니다. 이미 차환 신고서를 낸 회사는 맨 아래에 따로 둡니다.`}
      right={right}
    />
  );

  if (items === null) {
    return (
      <section className="section reco-sec" aria-labelledby="reco-h">
        {head()}
        <p className="empty">추천 목록을 불러오지 못했습니다. 잠시 뒤 새로고침하세요.</p>
      </section>
    );
  }

  const open = items.filter((i) => !i.refi);
  const done = items.filter((i) => i.refi);
  const shown = grade ? open.filter((i) => i.grade === grade) : open;

  return (
    <section className="section reco-sec" aria-labelledby="reco-h">
      <FabContext
        label="영업 추천 회사"
        companies={shown.slice(0, 10).map((i) => ({ c: i.corp_code, n: i.corp_name, sub: `D-${i.days_left} · ${won(i.amount_krw)} 만기` }))}
      />
      {head(
        <nav className="chips" aria-label="신용등급">
          <Link href="/" scroll={false} aria-current={!grade ? 'true' : undefined}>
            전체<span className="tnum">{open.length}</span>
          </Link>
          {GRADES.map((g) => (
            <Link key={g.key} href={`/?g=${g.key}`} scroll={false} aria-current={grade === g.key ? 'true' : undefined}>
              {g.label}
              <span className="tnum">{open.filter((i) => i.grade === g.key).length}</span>
            </Link>
          ))}
        </nav>,
      )}
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
