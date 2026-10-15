-- =====================================================================
-- 화면 하단 "데이터 기준" 표시용. ops 는 노출하지 않으므로 필요한 값만 mart 로 연다.
-- =====================================================================

create or replace view mart.v_data_status as
select
  (select max(r.finished_at) from ops.ingest_runs r
    where r.job = 'refresh' and r.status = 'success')                  as last_refresh_at,
  (select max(f.rcept_dt) from raw.filings f)                           as latest_filing_dt,
  (select min(v.deal_dt) from mart.v_deals v)                           as first_deal_dt,
  (select max(v.deal_dt) from mart.v_deals v)                           as latest_deal_dt,
  (select count(*) from core.deals d where d.product_type = 'bond')     as bond_deals,
  (select count(*) from core.deals d where d.product_type = 'mezz')     as mezz_deals,
  (select count(*) from core.deals d where d.product_type = 'equity')   as equity_deals;

comment on view mart.v_data_status is '수집·변환 최신 시각과 상품별 딜 수 (화면 하단 표시)';

grant select on mart.v_data_status to anon, authenticated;
