import Link from 'next/link';
import { date } from '@/lib/format';
import { getFeed, getInsightIssues } from '@/lib/queries';
import type { FeedItem, InsightIssue } from '@/lib/types';
import { SectionHead } from './Ui';

const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'issue', label: '발행', tag: '발행' },
  { key: 'disc', label: '공시', tag: '공시' },
] as const;

export type FeedFilter = (typeof FILTERS)[number]['key'];

const short = (d: string | null) => (d ? `${d.slice(5, 7)}.${d.slice(8, 10)}` : '');

function Card({ it, lead }: { it: FeedItem; lead?: boolean }) {
  const cls = ['fc', it.tag === '발행' ? 't-issue' : 't-disc', it.tone === 'alert' ? 'is-alert' : '', lead ? 'is-lead' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <li className={cls}>
      <div className="fc-top">
        <span className="fc-tag">{it.tag}</span>
        {it.kind_label && <span className="fc-kind">{it.kind_label}</span>}
        {it.event_dt && (
          <time className="fc-date tnum" dateTime={it.event_dt}>{short(it.event_dt)}</time>
        )}
      </div>
      <Link href={`/company/${it.corp_code}`} className="fc-corp">{it.corp_name}</Link>
      <h3 className="fc-head">{it.headline}</h3>
      <p className="fc-body">{it.body}</p>
      <p className="fc-point">
        <span className="fc-point-k">확인할 점</span>
        {it.point}
      </p>
      {it.rcept_no && (
        <a className="fc-src" href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${it.rcept_no}`} target="_blank" rel="noreferrer">
          공시 원문
        </a>
      )}
    </li>
  );
}

export async function FeedSection({ filter = 'all' }: { filter?: FeedFilter }) {
  const items = await getFeed().catch(() => null);
  if (items === null) {
    return (
      <section className="section feed-sec" aria-labelledby="feed-h">
        <SectionHead id="feed-h" title="최근 2주 공시·발행" />
        <p className="empty">피드를 불러오지 못했습니다. 잠시 뒤 새로고침하세요.</p>
      </section>
    );
  }
  const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0];
  const shown = 'tag' in f ? items.filter((i) => i.tag === f.tag) : items;
  const isAi = items.some((i) => i.written_by && i.written_by !== 'rule');
  const asof = items[0]?.asof;
  return (
    <section className="section feed-sec" aria-labelledby="feed-h">
      <SectionHead
        id="feed-h"
        title="최근 2주 공시·발행"
        info={`최근 14일의 공시·발행 가운데 이례적인 발행(미달·큰 증액·첫 공모채·이전 NH 고객의 타사 주관·등급 하락 등)과 자금 수요·신용 위험으로 이어질 공시(단기차입금 증가, 시설투자, 최대주주 변경, 원리금 미지급 등)를 규칙으로 뽑고, ${isAi ? 'AI가 골라 문장으로 정리했습니다' : '점수 순으로 골랐습니다'}. 숫자는 공시 값 그대로이고, 후보에 없는 숫자가 들어간 문장은 버립니다.`}
        right={
          <>
            <nav className="chips" aria-label="피드 구분">
              {FILTERS.map((x) => (
                <Link key={x.key} href={x.key === 'all' ? '/' : `/?feed=${x.key}`} scroll={false} aria-current={x.key === f.key ? 'true' : undefined}>
                  {x.label}
                  <span className="tnum">{'tag' in x ? items.filter((i) => i.tag === x.tag).length : items.length}</span>
                </Link>
              ))}
            </nav>
            {asof && <span className="muted small tnum">{date(asof)} 기준</span>}
          </>
        }
      />
      {shown.length === 0 ? (
        <p className="empty">최근 2주에 해당하는 {f.label} 소식이 없습니다.</p>
      ) : (
        <ol className="feed">
          {shown.map((it, i) => (
            <Card key={`${it.rank}-${it.corp_code}`} it={it} lead={i === 0} />
          ))}
        </ol>
      )}
      <p className="feed-more small">
        <Link href="/filings">주요 공시 전체 보기</Link>
      </p>
    </section>
  );
}

// 다가오는 영업 접점: 만기·풋·단기 차입에서 고른 회사
function Touch({ it }: { it: InsightIssue }) {
  return (
    <li className="tp">
      <div className="tp-head">
        <Link href={`/company/${it.corp_code}`} className="tp-corp">{it.corp_name}</Link>
        <span className="tp-title">{it.title}</span>
        {it.event_dt && <span className="tp-date tnum">{date(it.event_dt)}</span>}
      </div>
      <p className="tp-why">{it.why}</p>
      <p className="tp-angle">
        <span className="fc-point-k">제안 포인트</span>
        {it.angle}
      </p>
    </li>
  );
}

export async function TouchpointSection() {
  const items = await getInsightIssues().catch(() => null);
  const touch = (items ?? []).filter((i) => i.kind === 'touchpoint');
  if (!touch.length) return null;
  return (
    <section className="section" aria-labelledby="tp-h">
      <SectionHead
        id="tp-h"
        title="다가오는 영업 접점"
        info="3~6개월 뒤 공모채 만기(차환 신고서 없음), 6개월 안 메자닌 조기상환청구 시작, 공모채 없이 1년 내 단기 차입이 큰 회사 가운데 먼저 연락할 곳입니다. 날짜는 만기·풋 시작일 또는 보고서 기준일입니다."
        right={<Link href="/maturities" className="small">만기도래 전체</Link>}
      />
      <ul className="tps">
        {touch.map((it) => (
          <Touch key={`${it.rank}-${it.corp_code}`} it={it} />
        ))}
      </ul>
    </section>
  );
}
