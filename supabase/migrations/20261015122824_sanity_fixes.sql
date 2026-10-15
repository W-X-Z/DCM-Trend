-- 원천 공시의 명백한 입력 오류 보정 (변환 마지막 단계, 매 갱신마다 다시 적용)
-- 회사채: 신고서 '납입일' 칸에 만기일을 적은 경우(납입일 ≥ 만기일). 예) 흥국화재 18회(2019.03), 우리카드 10회(2023.11)
--         → 청약일로 바꾸고 만기 개월 수를 다시 계산한다.

create or replace function core.apply_sanity_fixes()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  n_pay int;
begin
  with x as (
    select d.deal_key, core.parse_date_kr(g.item ->> 'sbd') as sbd
    from core.deals d
    join core.bond_terms b on b.deal_key = d.deal_key
    join lateral (
      select a.item
      from raw.api_items a
      where a.endpoint = 'bdRs' and a.group_title = '일반사항'
        and a.corp_code = d.corp_code and a.item ->> 'tm' = d.series
      order by a.rcept_no desc
      limit 1
    ) g on true
    where d.product_type = 'bond' and d.payment_dt >= b.maturity_dt
  )
  update core.deals d set
    payment_dt = x.sbd,
    status     = case when d.status = 'announced' and x.sbd <= current_date then 'completed' else d.status end
  from x
  where x.deal_key = d.deal_key and x.sbd is not null and x.sbd < d.payment_dt;
  get diagnostics n_pay = row_count;

  update core.bond_terms b set tenor_months = round((b.maturity_dt - d.payment_dt) / 30.4375)::int
  from core.deals d
  where d.deal_key = b.deal_key and d.product_type = 'bond'
    and b.maturity_dt > d.payment_dt and coalesce(b.tenor_months, 0) = 0;

  return jsonb_build_object('bond_payment_dt', n_pay);
end
$$;

create or replace function public.ingest_refresh()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
begin
  r := jsonb_build_object('companies', core.refresh_companies());
  r := r || jsonb_build_object('bond',   core.refresh_bond_deals());
  r := r || jsonb_build_object('mezz',   core.refresh_mezz_deals());
  r := r || jsonb_build_object('equity', core.refresh_equity_deals());
  r := r || jsonb_build_object('ipo',    core.refresh_ipo_deals());
  r := r || jsonb_build_object('docs',   core.apply_doc_fields());
  r := r || jsonb_build_object('fixes',  core.apply_sanity_fixes());
  return r;
end
$$;
