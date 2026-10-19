-- 사업 확장: 업종코드(induty_code)가 아직 비어 있어 금융사 제외를 이름 규칙으로 보강
-- (벤처캐피탈·재보험·생명/손해보험·저축은행 등). 업종코드가 채워지면 기존 6[456] 조건도 그대로 작동한다.

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
  and c.corp_name !~ '인베스트먼트$|창업투자|(기술|벤처|IB)투자$|파트너스$|재보험|코리안리|생명$|화재$|해상$|저축은행$|신탁$'
  and not (e.via_sub and exists (
    select 1 from core.v_expansion_events o
    where o.corp_code <> e.corp_code and o.src = e.src and o.amount_krw = e.amount_krw
      and abs(o.rcept_dt - e.rcept_dt) <= 3));
