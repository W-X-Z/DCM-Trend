-- 피드 후보 보정 (10-16 실데이터 점검)
-- 1) 등급 하락·상승과 '직전 회차 등급'은 같은 구분(일반회사채·신종자본증권·금융채 …)끼리 비교한다
--    (제주은행 신종자본증권 A+ 를 직전 선순위 AA+ 와 비교해 '하락'으로 잡던 문제)
-- 2) 금융회사(증권·캐피탈·카드·저축은행·금융지주)의 단기차입금 증가는 일상 자금 운용이라 피드에서 뺀다
-- 3) 공시 값·규모는 주요 공시 화면과 같은 함수(core.disc_facts / core.disc_size)를 쓴다

update ref.feed_rules set exclude_pattern = '증권$|캐피탈|카드$|저축은행|금융지주|자산운용|리츠|위탁관리부동산|기업인수목적'
where rule_key = 'd_stdebt';

create or replace function public.ingest_feed_candidates(p_asof date default current_date, p_days int default 14)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with fr as (select * from ref.feed_rules where is_active),
  w as (select fr.weight, fr.rule_key, fr.label_ko from fr where fr.tag = '발행'),
  -- 회사채: 발행 단위(트랜치 묶음)
  bond as (
    select
      'bond'::text as kind, i.issue_key as ref_key, i.corp_code, i.corp_name,
      coalesce(i.pricing_dt, i.deal_dt) as event_dt, i.latest_rcept_no as rcept_no,
      array_remove(array[
        case when i.is_undersubscribed then 'i_undersub' end,
        case when i.increase_pct >= 100 then 'i_big_increase' end,
        case when i.competition_ratio >= 10 then 'i_hot_demand' end,
        case when i.amount_krw >= 5e11 then 'i_jumbo' end,
        case when i.tenor_max >= 120 then 'i_long' end,
        case when i.rating_group in ('BBB', 'BB', 'B') then 'i_low_grade' end,
        case when i.tranche_count >= 3 then 'i_multi' end,
        case when i.spread_max_bp >= 30 then 'i_wide_spread' end,
        case when not exists (
          select 1 from mart.v_deals p
          where p.corp_code = i.corp_code and p.product_type = 'bond' and p.deal_dt < i.deal_dt) then 'i_first' end,
        case when i.sub_type = '신종자본증권' then 'i_hybrid' end,
        case when i.nh_lead is not true and i.lead_managers is not null and exists (
          select 1 from mart.v_deals p
          where p.corp_code = i.corp_code and p.nh_lead and coalesce(p.deal_dt, p.announce_dt) < i.deal_dt) then 'i_lost_client' end,
        case when i.rating_notch > (select p.rating_notch from mart.v_bond_issues p
                                    where p.corp_code = i.corp_code and p.deal_dt < i.deal_dt and p.rating_notch is not null and p.sub_type is not distinct from i.sub_type
                                    order by p.deal_dt desc limit 1) then 'i_downgrade'
             when i.rating_notch < (select p.rating_notch from mart.v_bond_issues p
                                    where p.corp_code = i.corp_code and p.deal_dt < i.deal_dt and p.rating_notch is not null and p.sub_type is not distinct from i.sub_type
                                    order by p.deal_dt desc limit 1) then 'i_upgrade' end
      ], null) as flags,
      jsonb_build_object(
        '상품', '공모 회사채', '구분', i.sub_type, '등급', i.rating,
        '확정 발행액', core.fmt_krw(i.amount_krw),
        '최초 모집액', core.fmt_krw(i.initial_amount_krw),
        '증액률', case when i.increase_pct is not null and i.increase_pct <> 0 then trim_scale(i.increase_pct)::text || '%' end,
        '전체 수요예측 경쟁률', case when i.competition_ratio is not null then trim_scale(i.competition_ratio)::text || '배' end,
        '만기 구성', i.tenor_combo,
        '트랜치', (
          select string_agg(
            concat_ws(' ', x ->> 'tenor_label', core.fmt_krw((x ->> 'amount_krw')::numeric),
              '(' || concat_ws(', ',
                case when x ? 'competition_ratio' then '경쟁률 ' || trim_scale((x ->> 'competition_ratio')::numeric)::text || '배' end,
                case when x ? 'final_spread_bp' then '가산금리 ' || case when (x ->> 'final_spread_bp')::numeric > 0 then '+' else '' end
                     || trim_scale((x ->> 'final_spread_bp')::numeric)::text || 'bp' end,
                case when x ? 'coupon_pct' then '금리 ' || trim_scale((x ->> 'coupon_pct')::numeric)::text || '%' end) || ')'),
            ' / ')
          from jsonb_array_elements(i.tranches) x),
        '대표주관', i.lead_managers,
        '직전 회차 등급', (select p.rating from mart.v_bond_issues p
                         where p.corp_code = i.corp_code and p.deal_dt < i.deal_dt and p.rating is not null and p.sub_type is not distinct from i.sub_type
                         order by p.deal_dt desc limit 1),
        '이전 NH 대표주관 딜(건)', (select nullif(count(*), 0) from mart.v_deals p
                                where p.corp_code = i.corp_code and p.nh_lead and coalesce(p.deal_dt, p.announce_dt) < i.deal_dt),
        '수요예측일', to_char(i.pricing_dt, 'YYYY.MM.DD'),
        '납입일', to_char(i.deal_dt, 'YYYY.MM.DD')) as facts,
      i.amount_krw
    from mart.v_bond_issues i
    where coalesce(i.pricing_dt, i.deal_dt) > p_asof - p_days and coalesce(i.pricing_dt, i.deal_dt) <= p_asof
  ),
  -- 메자닌·유상증자·IPO: 딜 단위 (같은 회사·같은 날 여러 건이면 한 건으로 묶는다)
  deal_raw as (
    select
      v.product_type as kind, v.deal_key as ref_key, v.corp_code, v.corp_name,
      case v.product_type when 'ipo' then coalesce(v.pricing_dt, v.announce_dt, v.deal_dt) else coalesce(v.announce_dt, v.deal_dt) end as event_dt,
      v.latest_rcept_no as rcept_no,
      array_remove(array[
        case when v.product_type = 'mezz' and v.amount_krw >= 1e11 then 'i_jumbo'
             when v.product_type = 'equity' and v.amount_krw >= 1e11 then 'i_jumbo'
             when v.product_type = 'ipo' and v.amount_krw >= 1e11 then 'i_jumbo' end,
        case when v.product_type = 'mezz' and v.is_public then 'i_public_mezz' end,
        case when v.product_type = 'mezz' and v.coupon_pct = 0 and v.ytm_pct = 0 then 'i_zero' end,
        case when v.product_type = 'mezz' and v.refix_floor_ratio_pct < 70 then 'i_low_refix' end,
        case when v.product_type = 'mezz' and not exists (
          select 1 from mart.v_deals p
          where p.corp_code = v.corp_code and p.product_type = 'mezz'
            and coalesce(p.announce_dt, p.deal_dt) < coalesce(v.announce_dt, v.deal_dt)) then 'i_first_mezz' end,
        case when v.product_type = 'equity' and v.dilution_pct >= 30 then 'i_dilution' end,
        case when v.product_type = 'equity' and v.sub_type in ('주주배정', '주주배정후 일반공모', '일반공모', '주주우선공모증자') then 'i_public_eq' end,
        case when v.product_type = 'ipo' and v.pricing_dt is not null then 'i_ipo' end,
        case when v.product_type = 'ipo' and v.ipo_price_vs_band in ('상단 초과', '하단 미만') then 'i_band_out' end,
        case when v.product_type = 'ipo' and v.ipo_demand_ratio >= 1000 then 'i_hot_demand' end,
        case when v.nh_lead is not true and v.lead_managers is not null and exists (
          select 1 from mart.v_deals p
          where p.corp_code = v.corp_code and p.nh_lead and p.deal_key <> v.deal_key
            and coalesce(p.announce_dt, p.deal_dt) < coalesce(v.announce_dt, v.deal_dt)) then 'i_lost_client' end
      ], null) as flags,
      case v.product_type
        when 'mezz' then jsonb_build_object(
          '상품', v.product_label, '종류', v.sub_type, '발행액', core.fmt_krw(v.amount_krw),
          '공모 여부', case when v.is_public then '공모' when v.is_public is false then '사모' end,
          '표면이자율', case when v.coupon_pct is not null then trim_scale(v.coupon_pct)::text || '%' end,
          '만기이자율', case when v.ytm_pct is not null then trim_scale(v.ytm_pct)::text || '%' end,
          '전환·교환가', case when v.conv_price is not null then to_char(v.conv_price, 'FM999,999,999,990') || '원' end,
          '리픽싱 하한', case when v.refix_floor_ratio_pct is not null then trim_scale(v.refix_floor_ratio_pct)::text || '%' end,
          '조기상환청구 시작일', to_char(v.put_start_dt, 'YYYY.MM.DD'),
          '대표주관·인수인', coalesce(v.lead_managers, v.underwriters),
          '결정일', to_char(v.announce_dt, 'YYYY.MM.DD'),
          '납입일', to_char(v.payment_dt, 'YYYY.MM.DD'))
        when 'equity' then jsonb_build_object(
          '상품', '유상증자', '방식', v.sub_type, '조달액', core.fmt_krw(v.amount_krw),
          '신주 비율', case when v.dilution_pct is not null then trim_scale(round(v.dilution_pct, 1))::text || '%' end,
          '발행가', case when v.offer_price is not null then to_char(v.offer_price, 'FM999,999,999,990') || '원' end,
          '인수방식', v.underwriting_method, '대표주관', v.lead_managers,
          '결정일', to_char(v.announce_dt, 'YYYY.MM.DD'),
          '납입일', to_char(v.payment_dt, 'YYYY.MM.DD'))
        else jsonb_build_object(
          '상품', 'IPO', '구분', v.sub_type, '공모금액', core.fmt_krw(v.amount_krw),
          '확정공모가', case when v.offer_price is not null then to_char(v.offer_price, 'FM999,999,999,990') || '원' end,
          '희망밴드', case when v.ipo_band_low is not null then to_char(v.ipo_band_low, 'FM999,999,999,990') || '~' || to_char(v.ipo_band_high, 'FM999,999,999,990') || '원' end,
          '밴드 대비', v.ipo_price_vs_band,
          '수요예측 경쟁률', case when v.ipo_demand_ratio is not null then trim_scale(round(v.ipo_demand_ratio, 2))::text || '대 1' end,
          '구주매출 비중', case when v.ipo_secondary_pct is not null then trim_scale(round(v.ipo_secondary_pct, 1))::text || '%' end,
          '대표주관', v.lead_managers,
          '청약일', to_char(v.ipo_subscription_dt, 'YYYY.MM.DD'))
      end as facts,
      v.amount_krw
    from mart.v_deals v
    where v.product_type in ('mezz', 'equity', 'ipo') and v.status <> 'withdrawn'
      and coalesce(v.sub_type, '') <> '스팩'
      and case v.product_type when 'ipo' then coalesce(v.pricing_dt, v.announce_dt, v.deal_dt) else coalesce(v.announce_dt, v.deal_dt) end
          between p_asof - p_days + 1 and p_asof
  ),
  deal as (
    select distinct on (x.kind, x.corp_code, x.event_dt)
      x.kind, x.ref_key, x.corp_code, x.corp_name, x.event_dt, x.rcept_no, x.flags,
      x.facts || case when x.n > 1 then jsonb_build_object('같은 날 결정 건수', x.n::text || '건', '같은 날 결정 합계', core.fmt_krw(x.total))
                      else '{}'::jsonb end as facts,
      coalesce(x.total, x.amount_krw) as amount_krw
    from (
      select d.*, count(*) over g as n, sum(d.amount_krw) over g as total
      from deal_raw d
      window g as (partition by d.kind, d.corp_code, d.event_dt)
    ) x
    order by x.kind, x.corp_code, x.event_dt, x.amount_krw desc nulls last
  ),
  issued as (
    select * from bond union all select * from deal
  ),
  issued_scored as (
    select s.*,
      (select coalesce(sum(w.weight), 0) from w where w.rule_key = any (s.flags || array['i_base'])) as score,
      (select string_agg(w.label_ko, ', ' order by w.weight desc) from w where w.rule_key = any (s.flags)) as label
    from issued s
    where s.corp_name !~ coalesce((select exclude_pattern from fr where rule_key = 'i_base'), '$^')
  ),
  -- 주요사항보고서
  disc as (
    select distinct on (r.rule_key, f.corp_code)
      r.rule_key, r.label_ko, r.weight, r.endpoint, r.routine_pattern, f.corp_code, f.corp_name, f.rcept_dt as event_dt, f.rcept_no,
      regexp_replace(regexp_replace(f.report_nm, '^주요사항보고서\((.*)\)$', '\1'), '\s{2,}', ' ', 'g') as report
    from fr r
    join raw.filings f
      on r.tag = '공시' and f.report_nm ~ r.report_pattern and f.report_nm !~ '^\['
     and f.rcept_dt > p_asof - p_days and f.rcept_dt <= p_asof
     and f.corp_name !~ coalesce(r.exclude_pattern, '$^')
    order by r.rule_key, f.corp_code, f.rcept_no desc
  ),
  disc_facts as (
    select d.*,
      jsonb_build_object('공시', d.report, '공시일', to_char(d.event_dt, 'YYYY.MM.DD')) || core.disc_facts(d.rcept_no, d.endpoint) as facts,
      core.disc_size(d.rcept_no, d.endpoint) as size_krw
    from disc d
  ),
  allc as (
    select '발행'::text as tag, kind, ref_key, corp_code, corp_name, event_dt, rcept_no, flags,
      coalesce(label, '최근 발행') as label,
      score + case when amount_krw >= 1e12 then 1 when amount_krw >= 3e11 then 0.5 else 0 end as score,
      jsonb_strip_nulls(facts) as facts
    from issued_scored
    union all
    select '공시', rule_key, rcept_no, corp_code, corp_name, event_dt, rcept_no, array[rule_key], label_ko,
      weight + case when size_krw >= 1e12 then 1.5 when size_krw >= 1e11 then 1 when size_krw >= 1e10 then 0.5 else 0 end
             - case when routine_pattern is not null and facts::text ~ routine_pattern then 1 else 0 end,
      jsonb_strip_nulls(facts)
    from disc_facts
  ),
  ranked as (
    select a.*,
      o.market, o.bond_deal_count, o.mezz_deal_count, o.equity_deal_count, o.latest_bond_rating,
      exists (select 1 from mart.v_deals v where v.corp_code = a.corp_code and v.nh_lead) as nh_lead_ever,
      row_number() over (partition by a.tag order by a.score desc, a.event_dt desc) as rn
    from allc a
    left join mart.v_company_overview o on o.corp_code = a.corp_code
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'tag', tag, 'kind', kind, 'ref_key', ref_key, 'corp_code', corp_code, 'corp_name', corp_name,
      'event_dt', event_dt, 'rcept_no', rcept_no, 'flags', to_jsonb(flags), 'label', label, 'score', score,
      'facts', facts,
      'context', jsonb_strip_nulls(jsonb_build_object(
        '시장', market, '공모채 발행 이력(건)', bond_deal_count, '메자닌 이력(건)', mezz_deal_count,
        '유상증자 이력(건)', equity_deal_count, '최근 회사채 등급', latest_bond_rating,
        'NH 대표주관 이력', case when nh_lead_ever then '있음' end)))
    order by score desc, event_dt desc), '[]'::jsonb)
  from ranked
  where rn <= case tag when '발행' then 30 else 25 end
$$;
