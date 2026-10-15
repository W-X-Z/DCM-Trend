-- 홈 피드: 합병·분할·양수도·감자·회생 같은 주요사항보고서도 상세 API 로 세부 값을 받는다.
-- 과거 전체를 다시 부르지 않도록 규칙마다 시작일(min_rcept_dt)을 둔다.
alter table ref.detail_fetch_rules add column if not exists min_rcept_dt date;

insert into ref.detail_fetch_rules (priority, report_pattern, endpoint, note, min_rcept_dt)
select v.priority, v.report_pattern, v.endpoint, v.note, v.min_rcept_dt::date
from (values
  (50, '회사\s*분할\s*합병\s*결정',                      'cmpDvmgDecsn',           '홈 피드', '2026-07-01'),
  (51, '회사\s*합병\s*결정',                             'cmpMgDecsn',             '홈 피드', '2026-07-01'),
  (52, '회사\s*분할\s*결정',                             'cmpDvDecsn',             '홈 피드', '2026-07-01'),
  (53, '주식\s*교환.{0,2}이전\s*결정',                   'stkExtrDecsn',           '홈 피드', '2026-07-01'),
  (54, '영업\s*양수\s*결정',                             'bsnInhDecsn',            '홈 피드', '2026-07-01'),
  (55, '영업\s*양도\s*결정',                             'bsnTrfDecsn',            '홈 피드', '2026-07-01'),
  (56, '유형자산\s*양수\s*결정',                         'tgastInhDecsn',          '홈 피드', '2026-07-01'),
  (57, '유형자산\s*양도\s*결정',                         'tgastTrfDecsn',          '홈 피드', '2026-07-01'),
  (58, '타법인\s*주식\s*및\s*출자증권\s*양수\s*결정',    'otcprStkInvscrInhDecsn', '홈 피드', '2026-07-01'),
  (59, '타법인\s*주식\s*및\s*출자증권\s*양도\s*결정',    'otcprStkInvscrTrfDecsn', '홈 피드', '2026-07-01'),
  (60, '감자\s*결정',                                    'crDecsn',                '홈 피드', '2026-07-01'),
  (61, '회생\s*절차\s*개시\s*신청',                      'ctrcvsBgrq',             '홈 피드', '2026-07-01'),
  (62, '해산\s*사유\s*발생',                             'dsRsOcr',                '홈 피드', '2026-07-01'),
  (63, '영업\s*정지',                                    'bsnSp',                  '홈 피드', '2026-07-01'),
  (64, '부도\s*발생',                                    'dfOcr',                  '홈 피드', '2026-07-01'),
  (65, '상각형\s*조건부\s*자본증권\s*발행\s*결정',       'wdCocobdIsDecsn',        '홈 피드', '2026-07-01')
) as v (priority, report_pattern, endpoint, note, min_rcept_dt)
where not exists (select 1 from ref.detail_fetch_rules r where r.endpoint = v.endpoint);

create or replace function public.ingest_pending_details(p_limit int default 500)
returns table (endpoint text, corp_code text, bgn_de date, end_de date, rcept_nos text[])
language sql
stable
security definer
set search_path = ''
as $$
  with matched as (
    select distinct on (f.rcept_no, r.endpoint)
      r.endpoint, f.corp_code, f.rcept_no, f.rcept_dt
    from raw.filings f
    join ref.detail_fetch_rules r
      on r.is_active and f.report_nm ~ r.report_pattern
     and f.rcept_dt >= coalesce(r.min_rcept_dt, '-infinity'::date)
    where not exists (
      select 1 from raw.detail_fetches d
      where d.endpoint = r.endpoint and d.rcept_no = f.rcept_no
        and d.status_code in ('000', '013')
    )
    order by f.rcept_no, r.endpoint, r.priority
  )
  select m.endpoint, m.corp_code, min(m.rcept_dt), max(m.rcept_dt), array_agg(m.rcept_no order by m.rcept_no)
  from matched m
  group by m.endpoint, m.corp_code
  order by min(m.rcept_dt) desc
  limit p_limit
$$;
