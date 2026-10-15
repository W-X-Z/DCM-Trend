-- =====================================================================
-- 14. "첫 발행" 판정을 상품별 수집 시작일 기준으로
--
-- 회사채 과거 백필(2019~)로 전체 최초일이 앞당겨져, 유증·IPO 처럼 2024-10 부터 수집한 상품에서
-- "첫 발행"이 잘못 붙는 문제를 막는다.
-- =====================================================================

create or replace view mart.v_notable_deals as
with prm as (
  select
    (select value from ref.params where key = 'large_deal_krw')
      || jsonb_build_object('ipo', (select value from ref.params where key = 'large_deal_krw_ipo'))  as large_krw,
    (select (value #>> '{}')::int from ref.params where key = 'first_issue_min_history_months')    as hist_months
),
firsts as (
  select v.product_type, min(v.deal_dt) as first_dt from mart.v_deals v group by v.product_type
)
select v.deal_key, v.deal_dt, v.product_type, v.product_label, v.corp_code, v.corp_name, r.reason, r.detail
from mart.v_deals v
cross join prm
join firsts f on f.product_type = v.product_type
cross join lateral (
  select '미달'::text, format('수요예측 경쟁률 %s:1', v.competition_ratio)
   where v.is_undersubscribed
  union all
  select '증액', format('%s억 → %s억', round(v.initial_amount_krw / 1e8), round(v.amount_krw / 1e8))
   where v.is_increased
  union all
  select '대형', format('%s억', round(v.amount_krw / 1e8))
   where v.amount_krw >= (prm.large_krw ->> v.product_type)::numeric
  union all
  select '첫 발행', '수집 기간 내 같은 상품 첫 발행'
   where v.product_type <> 'ipo'
     and v.deal_dt >= f.first_dt + make_interval(months => prm.hist_months)
     and not exists (
       select 1 from mart.v_deals p
       where p.corp_code = v.corp_code and p.product_type = v.product_type and p.deal_dt < v.deal_dt
     )
  union all
  select '밴드 ' || v.ipo_price_vs_band, format('공모가 %s원', v.offer_price)
   where v.ipo_price_vs_band in ('상단 초과', '하단 미만')
) as r (reason, detail)
where v.status <> 'withdrawn';
