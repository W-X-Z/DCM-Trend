-- 현업 피드백: 화면 오른쪽 아래 '의견 보내기'로 받는다.
-- 화면(anon)은 mart.submit_feedback 함수로만 쓸 수 있고, 저장된 피드백은 읽을 수 없다(ops 는 비노출).
-- 보는 곳: Supabase 대시보드 Table Editor > 스키마 ops > v_feedback (또는 feedback 에서 status·memo 수정)

create table ops.feedback (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  kind        text not null check (kind in ('good', 'improve', 'bug', 'data', 'etc')),
  body        text not null check (char_length(body) between 2 and 2000),
  author      text check (char_length(author) <= 60),
  page        text check (char_length(page) <= 300),
  client_id   text check (char_length(client_id) <= 40),
  viewport    text check (char_length(viewport) <= 20),
  status      text not null default 'new' check (status in ('new', 'doing', 'done', 'hold')),
  memo        text
);
create index feedback_created_idx on ops.feedback (created_at desc);
comment on table ops.feedback is '현업 피드백. client_id 는 브라우저별 임의 값(사람 식별 아님), status·memo 는 운영자가 정리용으로 쓴다.';

-- 운영자가 보기 편한 순서와 한국 시간
create view ops.v_feedback as
select
  id,
  to_char(created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as received_kst,
  case kind when 'good' then '좋은 점' when 'improve' then '개선 의견' when 'bug' then '오류'
            when 'data' then '필요한 데이터·기능' else '기타' end as kind_label,
  body,
  author,
  page,
  status,
  memo,
  client_id
from ops.feedback
order by created_at desc;

create or replace function mart.submit_feedback(
  p_kind text, p_body text, p_author text default null, p_page text default null,
  p_client_id text default null, p_viewport text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_body text := btrim(coalesce(p_body, ''));
  v_client text := nullif(left(btrim(coalesce(p_client_id, '')), 40), '');
begin
  if p_kind is null or p_kind not in ('good', 'improve', 'bug', 'data', 'etc') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if char_length(v_body) < 2 or char_length(v_body) > 2000 then
    raise exception 'invalid body' using errcode = '22023';
  end if;
  -- 과도한 전송 막기: 같은 브라우저 1분 3건, 전체 10분 60건
  if v_client is not null and (select count(*) from ops.feedback
       where client_id = v_client and created_at > now() - interval '1 minute') >= 3 then
    raise exception 'too many' using errcode = '54000';
  end if;
  if (select count(*) from ops.feedback where created_at > now() - interval '10 minutes') >= 60 then
    raise exception 'too many' using errcode = '54000';
  end if;

  insert into ops.feedback (kind, body, author, page, client_id, viewport)
  values (p_kind, v_body,
          nullif(left(btrim(coalesce(p_author, '')), 60), ''),
          nullif(left(btrim(coalesce(p_page, '')), 300), ''),
          v_client,
          nullif(left(btrim(coalesce(p_viewport, '')), 20), ''))
  returning id into v_id;
  return v_id;
end
$$;

revoke all on function mart.submit_feedback(text, text, text, text, text, text) from public;
grant execute on function mart.submit_feedback(text, text, text, text, text, text) to anon, authenticated, service_role;
grant select, update on ops.feedback to service_role;
grant select on ops.v_feedback to service_role;
