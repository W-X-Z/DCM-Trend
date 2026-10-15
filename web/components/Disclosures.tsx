import { date } from '@/lib/format';
import { fetchDisclosures, hasDartKey } from '@/lib/opendart';
import { getDisclosureRules } from '@/lib/queries';
import type { Disclosure } from '@/lib/types';

function Row({ d }: { d: Disclosure }) {
  return (
    <li className={`disc imp-${d.importance}`}>
      <span className="disc-date tnum">{date(d.rcept_dt)}</span>
      <span className="disc-cat">{d.category}</span>
      <a className="disc-name" href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${d.rcept_no}`} target="_blank" rel="noreferrer">
        {d.report_nm}
      </a>
      {d.flr_nm && <span className="disc-flr">{d.flr_nm}</span>}
    </li>
  );
}

export async function Disclosures({ corp }: { corp: string }) {
  if (!hasDartKey()) {
    return <p className="empty">최근 공시를 보려면 Vercel 환경변수에 OPENDART_API_KEY 를 등록해야 합니다.</p>;
  }
  let list: Disclosure[];
  try {
    const rules = await getDisclosureRules();
    list = await fetchDisclosures(corp, rules);
  } catch {
    return <p className="empty">DART 에서 공시 목록을 받지 못했습니다. 잠시 뒤 다시 열어 보세요.</p>;
  }
  if (!list.length) return <p className="empty">최근 6개월 공시가 없습니다.</p>;
  const key = list.filter((d) => d.importance <= 2);
  const rest = list.filter((d) => d.importance > 2);
  return (
    <div>
      {key.length > 0 ? (
        <ul className="discs">
          {key.map((d) => (
            <Row key={d.rcept_no} d={d} />
          ))}
        </ul>
      ) : (
        <p className="note">정기보고서·지분 변동 외 공시 없음</p>
      )}
      {rest.length > 0 && (
        <details className="disc-more">
          <summary>정기보고서·지분 변동 등 {rest.length}건 더 보기</summary>
          <ul className="discs">
            {rest.map((d) => (
              <Row key={d.rcept_no} d={d} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
