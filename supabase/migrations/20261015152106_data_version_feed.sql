-- 화면 캐시 버전: 홈 피드가 새로 써지면 바뀌도록
create or replace view mart.v_data_version as
select greatest(
  (select max(d.updated_at) from core.deals d),
  (select max(i.created_at) from core.insight_issue_sets i),
  (select max(f.created_at) from core.feed_sets f),
  (select max(r.fetched_at) from raw.rates r)) as data_version;
