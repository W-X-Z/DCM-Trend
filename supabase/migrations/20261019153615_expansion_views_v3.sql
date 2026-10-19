-- 사업 확장 기업 v3
--  - v2 에서 뺐던 '정정본만 있는 신규시설투자'(1년 넘은 결정의 정정)를 진행 중인 투자로 다시 넣고 is_amendment 로 표시
--    (원 결정이 1년 넘었어도 최근 1년에 금액·기간을 정정했다면 투자가 진행 중이다)
--  - 상세 API 공시도 결의일이 1년 넘었지만 최근 1년에 정정했으면 같은 방식으로 표시
--  - 신규시설투자 투자 종료일(end_dt), 회사별 새 결정 여부·마지막 투자 종료일 열 추가

create or replace view core.v_expansion_events as
with
-- 1) 상세 API 이벤트
api as (
  select x.rcept_no, x.corp_code, x.endpoint, x.item,
         coalesce(core.parse_date_kr(x.item ->> 'bddd'), f.rcept_dt) as decided_dt,
         left(regexp_replace(case x.endpoint
           when 'tgastInhDecsn' then coalesce(x.item ->> 'ast_nm', '')
           when 'otcprStkInvscrInhDecsn' then coalesce(x.item ->> 'iscmp_cmpnm', '')
           else coalesce(x.item ->> 'inh_bsn', '') end, '\s', '', 'g'), 30) as k
  from raw.api_items x
  join raw.filings f on f.rcept_no = x.rcept_no
  where x.endpoint in ('tgastInhDecsn', 'otcprStkInvscrInhDecsn', 'bsnInhDecsn')
),
api_latest as (
  select distinct on (a.corp_code, a.endpoint, a.decided_dt, a.k) a.*
  from api a
  order by a.corp_code, a.endpoint, a.decided_dt, a.k, a.rcept_no desc
),
api_ev as (
  select
    a.rcept_no, a.corp_code, a.decided_dt,
    case a.endpoint when 'tgastInhDecsn' then 'asset' when 'otcprStkInvscrInhDecsn' then 'stake' else 'biz' end as src,
    case a.endpoint
      when 'bsnInhDecsn' then core.to_num(a.item ->> 'inh_prc')
      else core.to_num(a.item ->> 'inhdtl_inhprc') end as amount_krw,
    case a.endpoint
      when 'tgastInhDecsn' then core.to_num(a.item ->> 'inhdtl_tast_vs')
      when 'otcprStkInvscrInhDecsn' then coalesce(core.to_num(a.item ->> 'inhdtl_ecpt_vs'), core.to_num(a.item ->> 'inhdtl_tast_vs'))
      else round(core.to_num(a.item ->> 'inh_prc') / nullif(core.to_num(a.item ->> 'ast_cmp_all'), 0) * 100, 2) end as ratio_pct,
    case a.endpoint
      when 'otcprStkInvscrInhDecsn' then case when core.to_num(a.item ->> 'inhdtl_ecpt_vs') is not null then '자기자본' else '자산총액' end
      else '자산총액' end as ratio_basis,
    case a.endpoint
      when 'tgastInhDecsn' then nullif(btrim(a.item ->> 'ast_nm'), '-')
      when 'otcprStkInvscrInhDecsn' then nullif(btrim(a.item ->> 'iscmp_cmpnm'), '-')
      else nullif(btrim(a.item ->> 'inh_bsn'), '-') end as target,
    nullif(btrim(a.item ->> 'inh_pp'), '-') as purpose,
    case a.endpoint
      when 'tgastInhDecsn' then nullif(btrim(a.item ->> 'ast_sen'), '-')
      when 'otcprStkInvscrInhDecsn' then nullif(btrim(a.item ->> 'iscmp_mbsn'), '-')
      else nullif(btrim(a.item ->> 'inh_bsn_mc'), '-') end as detail,
    core.to_num(a.item ->> 'atinh_eqrt') as stake_after_pct,
    coalesce(a.item ->> 'iscmp_rl_cmpn', '') as relation,
    (regexp_match(coalesce(a.item ->> 'dl_pym', a.item ->> 'inh_pym', ''),
       '자금\s*조달\s*(?:방법|방안|계획|재원)?\s*[:：]?\s*([^\n]{2,60})'))[1] as funding_note,
    a.decided_dt < current_date - 365 as is_amendment,
    null::date as end_dt
  from api_latest a
),
-- 2) 신규시설투자 (원문 파싱)
capex_raw as (
  select f.rcept_no, f.corp_code, f.rcept_dt, f.report_nm,
         (select jsonb_object_agg(split_part(d.field, ':', 1), d.value) from raw.doc_fields d
           where d.rcept_no = f.rcept_no and d.purpose = 'disclosure'
             and coalesce(d.run_id, 0) = (select max(coalesce(g.run_id, 0)) from raw.doc_fields g where g.rcept_no = f.rcept_no)) as v
  from raw.filings f
  where f.report_nm ~ '신규\s*시설\s*투자' and f.rcept_dt >= current_date - 400
),
capex_k as (
  select c.*, coalesce(nullif(left(regexp_replace(coalesce(c.v ->> '투자 대상', c.v ->> '투자 목적', ''), '\s', '', 'g'), 30), ''), c.rcept_no) as k
  from capex_raw c
),
capex_latest as (
  select distinct on (c.corp_code, c.k) c.*,
         min(c.rcept_dt) over (partition by c.corp_code, c.k) as first_dt,
         bool_and(c.report_nm ~ '^\[') over (partition by c.corp_code, c.k) as amended_only
  from capex_k c
  order by c.corp_code, c.k, c.rcept_no desc
),
capex_ev as (
  select c.rcept_no, c.corp_code, c.first_dt as decided_dt, 'capex'::text as src,
         core.to_num(c.v ->> '투자금액') as amount_krw,
         core.to_num(c.v ->> '자기자본 대비') as ratio_pct,
         '자기자본'::text as ratio_basis,
         nullif(c.v ->> '투자 대상', '') as target,
         nullif(c.v ->> '투자 목적', '') as purpose,
         null::text as detail, null::numeric as stake_after_pct, ''::text as relation, null::text as funding_note,
         c.amended_only as is_amendment,
         case when c.v ->> '투자 종료일' ~ '^\d{4}-\d{2}-\d{2}$' then (c.v ->> '투자 종료일')::date end as end_dt
  from capex_latest c
  -- 원문을 못 읽은 정정본(목적·금액 없음)은 같은 회사의 다른 신규시설투자가 있으면 그쪽으로 본다
  where c.v is not null
     or not exists (select 1 from capex_latest o where o.corp_code = c.corp_code and o.rcept_no <> c.rcept_no and o.v is not null)
),
ev as (
  select * from api_ev
  union all
  select * from capex_ev
),
-- 3) 분류
t as (
  select e.*, f.report_nm, f.rcept_dt,
         f.report_nm ~ '철회' as withdrawn,
         f.report_nm ~ '자회사의\s*주요경영사항' as via_sub,
         coalesce(e.purpose, '') || ' ' || coalesce(e.target, '') || ' ' || coalesce(e.detail, '') as txt
  from ev e
  join raw.filings f on f.rcept_no = e.rcept_no
)
select
  t.rcept_no, t.corp_code, t.decided_dt, t.rcept_dt, t.report_nm, t.src,
  case t.src when 'capex' then '신규시설투자' when 'asset' then '유형자산 양수' when 'stake' then '타법인 지분 인수' else '영업양수' end as src_label,
  case
    when t.withdrawn then '철회'
    when t.src = 'capex' then
      case when t.txt ~ '임대\s*(수익|사업)|투자\s*수익|시세\s*차익' and t.txt !~ '생산|공장|제조|설비|증설' then '임대·투자'
           when t.txt ~ '사옥|본사|업무\s*(시설|공간)|연구소|R&D|연구\s*개발\s*센터|연구센터' and t.txt !~ '생산|공장|제조|증설|Capa|CAPA|캐파|양산' then '연구·업무시설'
           when t.txt ~ '부지\s*개발|개발\s*사업|호텔|리조트|복합\s*(시설|단지)|매장|점포' and t.txt !~ '생산|공장|제조|증설|Capa|CAPA|캐파|양산|설비' then '부지·사업장 확보'
           else '생산·설비 증설' end
    when t.src = 'asset' then
      case when t.txt ~ '생산|공장|제조|증설|Capa|CAPA|캐파|양산|생산\s*라인|GMP|설비|물류|플랜트|발전\s*(소|설비|사업)|선박|선대|데이터\s*센터|사업장|산단|산업\s*단지|공단'
             or coalesce(t.detail, '') ~ '기계|선박|구축물|설비|차량운반' then '생산·설비 증설'
           when t.txt ~ '재무\s*구조|차입금\s*상환' then '기타 자산'
           when t.txt ~ '임대|투자\s*(수익|이익|자산)|시세\s*차익|현금\s*흐름|자산\s*(운용|포트폴리오|가치)|여유\s*자금|현금\s*자산|수익\s*창출' then '임대·투자'
           when t.txt ~ '사옥|본사|업무\s*(시설|공간|환경)|연구|R&D|사무|물리적\s*공간' then '연구·업무시설'
           when t.txt ~ '부지|용지|사업\s*(확장|확대|규모|다각화|영역|활용|추진)|신사업|개발|신규\s*사업|신설|매장|점포|호텔|병원|센터|성장\s*기반' then '부지·사업장 확보'
           else '기타 자산' end
    when t.src = 'stake' then
      case when t.txt ~ '단순\s*투자'
             or (t.txt ~ '투자\s*(수익|이익)|재무적\s*투자|자산\s*운용|여유\s*자금'
                 and t.txt !~ '성장\s*동력|신사업|진출|다각화|확장|시너지') then '단순 투자'
           when t.relation ~ '자회사|종속|계열' and t.txt ~ '공장|생산|제조|설립|신설|증설|설비' then '생산·설비 증설'
           when t.relation ~ '자회사|종속|계열' and t.txt !~ '신규|진출|신사업|다각화' then '계열 지분 정리'
           when t.txt ~ '운영\s*자금|재무\s*구조|채무\s*상환|지배\s*구조|지배력|경영\s*효율|경영권\s*(안정|강화)|책임\s*경영|콜\s*옵션|주식\s*매수\s*청구'
                and t.txt !~ '확장|다각화|진출|신사업|신규|시너지|수직|성장\s*동력|외형|생산\s*능력' then '계열 지분 정리'
           when coalesce(t.stake_after_pct, 0) >= 30 or t.txt ~ '경영권|인수' then '인수·신사업'
           else '소수 지분 투자' end
    else '인수·신사업'
  end as cat,
  t.amount_krw, t.ratio_pct, t.ratio_basis, t.target, t.purpose, t.detail, t.stake_after_pct, t.relation, t.funding_note, t.via_sub,
  t.is_amendment, t.end_dt
from t
-- 최근 1년 결정, 또는 1년 전 결정이라도 최근 1년에 정정 공시가 있으면(진행 중인 투자) is_amendment 로 표시해 넣는다
where t.decided_dt >= current_date - 365 or (t.is_amendment and t.rcept_dt >= current_date - 365);

-- 화면용 이벤트: 정정 여부·투자 종료일 열 추가
create or replace view mart.v_expansion_events as
select e.rcept_no, e.corp_code, c.corp_name, c.market, e.decided_dt, e.rcept_dt, e.src, e.src_label, e.cat,
       e.amount_krw, e.ratio_pct, e.ratio_basis, e.target, e.purpose, e.detail, e.stake_after_pct, e.funding_note, e.via_sub,
       'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' || e.rcept_no as dart_url,
       e.is_amendment, e.end_dt
from core.v_expansion_events e
join core.companies c on c.corp_code = e.corp_code
where e.cat in ('생산·설비 증설', '부지·사업장 확보', '인수·신사업', '연구·업무시설')
  and coalesce(c.induty_code, '') !~ '^6[456]'
  and c.corp_name !~ '리츠|스팩|기업인수목적|부동산투자회사|금융지주|증권$|은행$|보험$|캐피탈$|카드$|자산운용$'
  and not (e.via_sub and exists (
    select 1 from core.v_expansion_events o
    where o.corp_code <> e.corp_code and o.src = e.src and o.amount_krw = e.amount_krw
      and abs(o.rcept_dt - e.rcept_dt) <= 3));

-- 회사별 묶음: 확장 유형·금액·가장 큰 결정, 최근 1년 공모·사모 조달, NH 대표주관 이력
create or replace view mart.v_expansion_companies as
with e as (select * from mart.v_expansion_events),
agg as (
  select e.corp_code, min(e.corp_name) as corp_name, min(e.market) as market,
         count(*) as event_count,
         sum(e.amount_krw) as amount_krw,
         max(e.ratio_pct) as max_ratio_pct,
         min(e.decided_dt) as first_dt, max(e.decided_dt) as last_dt,
         array_agg(distinct e.cat order by e.cat) as cats,
         bool_or(not e.is_amendment) as has_new_decision,
         max(e.end_dt) as last_end_dt
  from e group by e.corp_code
),
maxr as (
  select distinct on (e.corp_code) e.corp_code, e.ratio_basis as max_ratio_basis
  from e where e.ratio_pct is not null order by e.corp_code, e.ratio_pct desc
),
top1 as (
  select distinct on (e.corp_code) e.corp_code, e.src_label as top_src, e.amount_krw as top_amount_krw, e.ratio_pct as top_ratio_pct,
         e.ratio_basis as top_ratio_basis, coalesce(e.purpose, e.target) as top_what, e.target as top_target
  from e order by e.corp_code, e.amount_krw desc nulls last, e.decided_dt desc
),
fund as (
  select d.corp_code,
         jsonb_agg(jsonb_build_object(
           'type', case d.product_type when 'bond' then '공모 회사채' when 'ipo' then 'IPO'
                     when 'equity' then '유상증자' else coalesce(case when d.is_public then '공모 ' else '사모 ' end || d.sub_type, '메자닌') end,
           'amount_krw', d.amount_krw, 'dt', coalesce(d.payment_dt, d.deal_dt), 'nh_lead', d.nh_lead)
           order by coalesce(d.payment_dt, d.deal_dt) desc) as funding,
         max(coalesce(d.payment_dt, d.deal_dt)) as last_funding_dt
  from mart.v_deals d
  where d.corp_code in (select corp_code from agg)
    and coalesce(d.payment_dt, d.deal_dt) >= current_date - 365
    and coalesce(d.status, '') not in ('withdrawn', 'cancelled')
  group by d.corp_code
),
nh as (
  select d.corp_code, bool_or(d.nh_lead) as nh_lead_ever
  from mart.v_deals d where d.corp_code in (select corp_code from agg) group by d.corp_code
)
select a.corp_code, a.corp_name, a.market, o.latest_bond_rating, a.cats, a.event_count, a.amount_krw, a.max_ratio_pct,
       a.first_dt, a.last_dt, t.top_src, t.top_amount_krw, t.top_ratio_pct, t.top_ratio_basis, t.top_what, t.top_target,
       coalesce(f.funding, '[]'::jsonb) as funding,
       (f.last_funding_dt is null or f.last_funding_dt < a.first_dt) as no_funding_after,
       coalesce(n.nh_lead_ever, false) as nh_lead_ever,
       o.outstanding_bond_krw, o.outstanding_bond_1y_krw, m.max_ratio_basis, a.has_new_decision, a.last_end_dt
from agg a
join top1 t on t.corp_code = a.corp_code
left join fund f on f.corp_code = a.corp_code
left join nh n on n.corp_code = a.corp_code
left join maxr m on m.corp_code = a.corp_code
left join mart.v_company_overview o on o.corp_code = a.corp_code;
