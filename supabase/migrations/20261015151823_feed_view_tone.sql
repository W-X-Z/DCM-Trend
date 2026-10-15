-- 피드 카드 색(위기 신호·미달은 경고색)과 해산 공시의 펀드·리츠 제외
create or replace view mart.v_feed as
with s as (select * from core.feed_sets order by asof desc limit 1)
select
  s.asof, s.model, s.created_at, (x.ord)::int as rank,
  x.it ->> 'tag'        as tag,
  x.it ->> 'kind'       as kind,
  x.it ->> 'kind_label' as kind_label,
  x.it ->> 'corp_code'  as corp_code,
  x.it ->> 'corp_name'  as corp_name,
  x.it ->> 'headline'   as headline,
  x.it ->> 'body'       as body,
  x.it ->> 'point'      as point,
  (x.it ->> 'event_dt')::date as event_dt,
  x.it ->> 'rcept_no'   as rcept_no,
  x.it ->> 'ref_key'    as ref_key,
  x.it ->> 'label'      as label,
  x.it -> 'flags'       as flags,
  x.it ->> 'tone'       as tone,
  x.it ->> 'by'         as written_by
from s cross join lateral jsonb_array_elements(s.items) with ordinality as x (it, ord);

grant select on mart.v_feed to anon, authenticated;

update ref.feed_rules set exclude_pattern = '스팩|기업인수목적|부동산투자|리츠|투자회사|사모투자|펀드'
where rule_key = 'd_dissolve';
