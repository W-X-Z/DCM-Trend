-- 금리 밴드: 확정 신고서의 밴드 종류에 맞는 단위로 고른다.
-- 이전에는 bp 값을 먼저 골라, 최초 신고서 본문에서 읽힌 bp 숫자가 고정금리(%) 밴드를 덮어쓴 딜이 있었다(예: 대신자산신탁 '26.01, 21건).
do $$
declare
  f text := pg_get_functiondef('core.apply_doc_fields()'::regprocedure);
  old_low text := $q$core.parse_numeric(coalesce(core.deal_doc_value(b.deal_key, 'band_low_bp'),  core.deal_doc_value(b.deal_key, 'band_low_pct')))  as band_low,$q$;
  old_high text := $q$core.parse_numeric(coalesce(core.deal_doc_value(b.deal_key, 'band_high_bp'), core.deal_doc_value(b.deal_key, 'band_high_pct'))) as band_high,$q$;
  new_low text := $q$core.parse_numeric(case when core.deal_doc_value(b.deal_key, 'band_type') ~ '고정'
        then coalesce(core.deal_doc_value(b.deal_key, 'band_low_pct'), core.deal_doc_value(b.deal_key, 'band_low_bp'))
        else coalesce(core.deal_doc_value(b.deal_key, 'band_low_bp'), core.deal_doc_value(b.deal_key, 'band_low_pct')) end) as band_low,$q$;
  new_high text := $q$core.parse_numeric(case when core.deal_doc_value(b.deal_key, 'band_type') ~ '고정'
        then coalesce(core.deal_doc_value(b.deal_key, 'band_high_pct'), core.deal_doc_value(b.deal_key, 'band_high_bp'))
        else coalesce(core.deal_doc_value(b.deal_key, 'band_high_bp'), core.deal_doc_value(b.deal_key, 'band_high_pct')) end) as band_high,$q$;
begin
  if position(old_low in f) = 0 or position(old_high in f) = 0 then
    raise exception 'apply_doc_fields 의 밴드 계산 위치를 찾지 못함';
  end if;
  f := replace(replace(f, old_low, new_low), old_high, new_high);
  execute f;
end
$$;

select core.apply_doc_fields();
