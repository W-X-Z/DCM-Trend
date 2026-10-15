-- 유상증자 결정일 보정
-- OpenDART 주요사항보고서 API(piicDecsn)는 정정된 공시의 경우 '최종 정정본'에만 값을 준다.
-- 원 결정 공시에 값이 없으면 딜이 정정 공시 날짜로 잡혀 최근 달의 건수·금액이 부풀었다
-- (26.07~09: 231건 중 154건이 정정본만으로 만들어진 딜. 예: SK하이닉스 6/24 결정 → 7/10 로 잡힘).
-- → 정정본만 있는 딜은 같은 회사의 원 결정 공시(목록의 비고 '정', 1년 안, 아직 다른 딜에 안 쓰인 것)에 연결하고
--   결정일을 그 날짜로 바꾼다. 매 갱신마다 다시 적용한다.

create or replace function core.apply_sanity_fixes()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  n_pay int;
  n_eq int := 0;
  r record;
  o_no text;
  o_dt date;
begin
  -- 회사채: 신고서 '납입일' 칸에 만기일을 적은 경우(납입일 ≥ 만기일) → 청약일
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

  -- 유상증자: 정정본만 있는 딜 → 원 결정 공시 날짜
  for r in
    select d.deal_key, d.corp_code, min(df.rcept_no) as first_rcept, min(df.rcept_dt) as first_dt
    from core.deals d
    join core.deal_filings df on df.deal_key = d.deal_key
    where d.product_type = 'equity'
      and not exists (select 1 from core.deal_filings x where x.deal_key = d.deal_key and x.role = 'decision')
    group by d.deal_key, d.corp_code
    order by min(df.rcept_no)
  loop
    select f.rcept_no, f.rcept_dt into o_no, o_dt
    from raw.filings f
    where f.corp_code = r.corp_code
      and f.report_nm ~ '^주요사항보고서\((유상증자결정|유무상증자결정)\)'
      and coalesce(f.rm, '') ~ '정'
      and f.rcept_no < r.first_rcept
      and f.rcept_dt >= r.first_dt - 365
      and not exists (select 1 from core.deal_filings x where x.rcept_no = f.rcept_no)
    order by f.rcept_no desc
    limit 1;
    if found then
      insert into core.deal_filings (deal_key, rcept_no, role, rcept_dt)
      values (r.deal_key, o_no, 'decision', o_dt)
      on conflict do nothing;
      update core.deals set announce_dt = o_dt, first_rcept_no = o_no where deal_key = r.deal_key;
      update core.equity_terms set board_dt = o_dt where deal_key = r.deal_key;
      n_eq := n_eq + 1;
    end if;
  end loop;

  return jsonb_build_object('bond_payment_dt', n_pay, 'equity_original_dt', n_eq);
end
$$;
