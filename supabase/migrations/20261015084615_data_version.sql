-- =====================================================================
-- 화면 캐시 키용 데이터 버전. 변환(ingest_refresh)이 돌 때마다 바뀐다.
-- 화면은 이 값을 조회 헤더에 넣어, 데이터가 바뀌면 캐시를 새로 채운다.
-- 컬럼은 뒤에만 추가한다 (화면 계약).
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
  (select count(*) from core.deals d where d.product_type = 'equity')   as equity_deals,
  (select max(d.updated_at) from core.deals d)                          as data_version;

-- 버전만 가볍게 읽는 뷰 (화면이 요청마다 조회)
create or replace view mart.v_data_version as
select (select max(d.updated_at) from core.deals d) as data_version;

grant select on mart.v_data_status, mart.v_data_version to anon, authenticated;
