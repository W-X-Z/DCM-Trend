-- 인수대가(udtprc)가 '인수금액의 0.30%'처럼 비율로 적힌 공시를 금액으로 바꾼다.
-- 이전에는 숫자만 뽑아 0.30(원)으로 저장해 수수료율이 0bp 근처로 낮게 잡혔다(회사채 인수인 행 1만여 건).
--   '60,000,000(정액)'                         → 60,000,000
--   '인수금액의 0.30%' / '인수수수료 0.10%'      → 인수금액 × 0.30%
--   '인수수수료 0.10%\n성과인수수수료 0.03%'    → 기본 수수료(첫 비율)만
--   '인수금액의 0.\n25%'                         → 줄바꿈을 지우고 0.25%
--   '모집총액의 0.30% 中 10%' (지분 배분형)      → 인수인별 금액을 알 수 없어 비움
create or replace function core.parse_uw_fee(p text, p_amt numeric, p_cap numeric default 0.1)
returns numeric
language sql immutable
set search_path = ''
as $$
  with s as (
    select regexp_replace(coalesce(p, ''), '\s', '', 'g') as t,
           (regexp_match(regexp_replace(coalesce(p, ''), '\s', '', 'g'), '([0-9]+(\.[0-9]+)?)%'))[1]::numeric as pct
  )
  select case
    when p is null or p_amt is null then null
    when s.t ~ '%' then
      case when s.t ~ '中' then null
           when s.pct > 0 and s.pct <= 5 then round(p_amt * s.pct / 100)
      end
    when core.parse_numeric(p) <= p_amt * p_cap then core.parse_numeric(p)
  end
  from s
$$;

-- 변환 함수 세 곳(회사채·메자닌/유상증자·IPO)의 인수대가 계산을 새 함수로 바꾼다.
do $$
declare
  fn text;
  def text;
  cap text;
  old_expr text;
  new_expr text;
begin
  foreach fn in array array['core.refresh_bond_deals()', 'core.refresh_equity_deals()', 'core.refresh_ipo_deals()'] loop
    def := pg_get_functiondef(fn::regprocedure);
    cap := case when fn = 'core.refresh_equity_deals()' then '0.2' else '0.1' end;
    old_expr := 'case when core.parse_numeric(u.item ->> ''udtprc'') <= core.parse_krw(u.item ->> ''udtamt'') * ' || cap || E'\n'
             || '         then core.parse_numeric(u.item ->> ''udtprc'') end';
    new_expr := 'core.parse_uw_fee(u.item ->> ''udtprc'', core.parse_krw(u.item ->> ''udtamt''), ' || cap || ')';
    if position(old_expr in def) = 0 then
      raise exception '인수대가 식을 찾지 못함: %', fn;
    end if;
    execute replace(def, old_expr, new_expr);
  end loop;
end
$$;
