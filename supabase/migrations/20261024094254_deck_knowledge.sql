-- 제안서 노하우(현업 암묵지): 장표별 판단 기준·관행·표현을 현업이 직접 쓰고 고친다.
-- 'AI 문안(노하우 반영)'을 만들 때 해당 장표·등급의 노하우를 지침으로 넣는다.
-- 권한 없이 누구나 쓰는 프로토타입이라 모든 변경을 ops.deck_knowledge_log 에 남기고, 삭제는 숨김(되살리기 가능)이다.
-- 화면(anon)은 mart 뷰로 읽고 mart.save/delete/restore_deck_knowledge 함수로만 쓴다.

create table ops.deck_knowledge (
  id          bigint generated always as identity primary key,
  slide       text not null check (slide in ('all', 'terms', 'sizing', 'schedule', 'sales', 'pipeline', 'rates', 'bok', 'fomc',
                                             'views', 'usviews', 'forecast', 'peers', 'compare', 'corp', 'league', 'strength', 'maturity')),
  kind        text not null check (kind in ('judge', 'practice', 'style', 'caution')),
  grade       text check (grade in ('AAA', 'AA', 'A', 'BBB')),
  body        text not null check (char_length(body) between 5 and 500),
  source      text check (char_length(source) <= 200),
  created_at  timestamptz not null default now(),
  created_by  text check (char_length(created_by) <= 60),
  updated_at  timestamptz not null default now(),
  updated_by  text check (char_length(updated_by) <= 60),
  deleted_at  timestamptz
);
comment on table ops.deck_knowledge is '제안서 노하우. slide=all 은 모든 장표, grade=null 은 모든 등급. kind: judge 판단 기준, practice 관행, style 표현, caution 주의';

create table ops.deck_knowledge_log (
  id            bigint generated always as identity primary key,
  knowledge_id  bigint not null references ops.deck_knowledge (id),
  action        text not null check (action in ('create', 'update', 'delete', 'restore')),
  before        jsonb,
  after         jsonb,
  author        text,
  client_id     text,
  at            timestamptz not null default now()
);
create index deck_knowledge_log_at_idx on ops.deck_knowledge_log (at desc);
create index deck_knowledge_log_client_idx on ops.deck_knowledge_log (client_id, at desc);

create or replace function ops.deck_knowledge_snap(p_id bigint)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('slide', slide, 'kind', kind, 'grade', grade, 'body', body, 'source', source)
  from ops.deck_knowledge where id = p_id
$$;

-- 과도한 쓰기 막기: 같은 브라우저 1분 30건, 전체 10분 300건
create or replace function ops.deck_knowledge_guard(p_client text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_client is not null and (select count(*) from ops.deck_knowledge_log
       where client_id = p_client and at > now() - interval '1 minute') >= 30 then
    raise exception 'too many' using errcode = '54000';
  end if;
  if (select count(*) from ops.deck_knowledge_log where at > now() - interval '10 minutes') >= 300 then
    raise exception 'too many' using errcode = '54000';
  end if;
end
$$;

create or replace function mart.save_deck_knowledge(
  p_id bigint, p_slide text, p_kind text, p_grade text, p_body text, p_source text,
  p_author text default null, p_client_id text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint := p_id;
  v_before jsonb;
  v_after jsonb;
  v_body text := btrim(coalesce(p_body, ''));
  v_grade text := nullif(btrim(coalesce(p_grade, '')), '');
  v_source text := nullif(left(btrim(coalesce(p_source, '')), 200), '');
  v_author text := nullif(left(btrim(coalesce(p_author, '')), 60), '');
  v_client text := nullif(left(btrim(coalesce(p_client_id, '')), 40), '');
begin
  if p_slide is null or p_slide not in ('all', 'terms', 'sizing', 'schedule', 'sales', 'pipeline', 'rates', 'bok', 'fomc',
                                        'views', 'usviews', 'forecast', 'peers', 'compare', 'corp', 'league', 'strength', 'maturity') then
    raise exception 'invalid slide' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('judge', 'practice', 'style', 'caution') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if v_grade is not null and v_grade not in ('AAA', 'AA', 'A', 'BBB') then
    raise exception 'invalid grade' using errcode = '22023';
  end if;
  if char_length(v_body) < 5 or char_length(v_body) > 500 then
    raise exception 'invalid body' using errcode = '22023';
  end if;
  perform ops.deck_knowledge_guard(v_client);

  if v_id is null then
    insert into ops.deck_knowledge (slide, kind, grade, body, source, created_by, updated_by)
    values (p_slide, p_kind, v_grade, v_body, v_source, v_author, v_author)
    returning id into v_id;
    insert into ops.deck_knowledge_log (knowledge_id, action, before, after, author, client_id)
    values (v_id, 'create', null, ops.deck_knowledge_snap(v_id), v_author, v_client);
  else
    perform 1 from ops.deck_knowledge where id = v_id and deleted_at is null for update;
    if not found then
      raise exception 'not found' using errcode = 'P0002';
    end if;
    v_before := ops.deck_knowledge_snap(v_id);
    update ops.deck_knowledge
       set slide = p_slide, kind = p_kind, grade = v_grade, body = v_body, source = v_source,
           updated_at = now(), updated_by = v_author
     where id = v_id;
    v_after := ops.deck_knowledge_snap(v_id);
    if v_after is distinct from v_before then
      insert into ops.deck_knowledge_log (knowledge_id, action, before, after, author, client_id)
      values (v_id, 'update', v_before, v_after, v_author, v_client);
    end if;
  end if;
  return v_id;
end
$$;

create or replace function mart.delete_deck_knowledge(p_id bigint, p_author text default null, p_client_id text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author text := nullif(left(btrim(coalesce(p_author, '')), 60), '');
  v_client text := nullif(left(btrim(coalesce(p_client_id, '')), 40), '');
begin
  perform ops.deck_knowledge_guard(v_client);
  update ops.deck_knowledge set deleted_at = now(), updated_at = now(), updated_by = v_author
   where id = p_id and deleted_at is null;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  insert into ops.deck_knowledge_log (knowledge_id, action, before, after, author, client_id)
  values (p_id, 'delete', ops.deck_knowledge_snap(p_id), null, v_author, v_client);
  return p_id;
end
$$;

create or replace function mart.restore_deck_knowledge(p_id bigint, p_author text default null, p_client_id text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author text := nullif(left(btrim(coalesce(p_author, '')), 60), '');
  v_client text := nullif(left(btrim(coalesce(p_client_id, '')), 40), '');
begin
  perform ops.deck_knowledge_guard(v_client);
  update ops.deck_knowledge set deleted_at = null, updated_at = now(), updated_by = v_author
   where id = p_id and deleted_at is not null;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  insert into ops.deck_knowledge_log (knowledge_id, action, before, after, author, client_id)
  values (p_id, 'restore', null, ops.deck_knowledge_snap(p_id), v_author, v_client);
  return p_id;
end
$$;

-- 화면용: 살아 있는 노하우, 최근 변경 이력(삭제 항목 되살리기·고친 내용 되돌리기용)
create view mart.v_deck_knowledge as
select id, slide, kind, grade, body, source, created_by, updated_by,
       to_char(updated_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as updated_kst,
       updated_at
from ops.deck_knowledge
where deleted_at is null;

create view mart.v_deck_knowledge_log as
select l.id, l.knowledge_id, l.action, l.before, l.after, l.author,
       to_char(l.at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as at_kst,
       l.at,
       (k.deleted_at is not null) as is_deleted
from ops.deck_knowledge_log l
join ops.deck_knowledge k on k.id = l.knowledge_id
order by l.at desc
limit 300;

revoke all on function mart.save_deck_knowledge(bigint, text, text, text, text, text, text, text) from public;
revoke all on function mart.delete_deck_knowledge(bigint, text, text) from public;
revoke all on function mart.restore_deck_knowledge(bigint, text, text) from public;
revoke all on function ops.deck_knowledge_snap(bigint) from public;
revoke all on function ops.deck_knowledge_guard(text) from public;
grant execute on function mart.save_deck_knowledge(bigint, text, text, text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function mart.delete_deck_knowledge(bigint, text, text) to anon, authenticated, service_role;
grant execute on function mart.restore_deck_knowledge(bigint, text, text) to anon, authenticated, service_role;
grant select on mart.v_deck_knowledge, mart.v_deck_knowledge_log to anon, authenticated;
grant select, insert, update on ops.deck_knowledge, ops.deck_knowledge_log to service_role;

-- 초기값: 시스템 프롬프트의 문체 예시와 실제 제안서·인터뷰에서 확인한 노하우(공개 가능한 일반 기준만)
insert into ops.deck_knowledge (slide, kind, grade, body, source, created_by, updated_by) values
  ('all', 'style', null,
   '문장은 근거 숫자 → NH 판단 순서의 개조식으로 쓴다. 끝은 "~진행", "~제안", "~수준", "~확보"처럼 명사형으로 맺는다.',
   'AI 문안 시스템 프롬프트(문체 예시)에서 옮김', '초기값', '초기값'),
  ('sizing', 'judge', 'A',
   'A급 주요 기관투자자는 5년물보다 3년물을 선호하므로 3년물에 중심을 두고, 5년물 규모는 기관 참여 가능성을 먼저 확인해 조절한다.',
   '대한항공 공모사채 제안서(2025-04) 적정 발행규모 장표', '초기값', '초기값'),
  ('sizing', 'judge', null,
   '수요가 클 것으로 보이면 증액 한도 상향을 검토하고, 주력 만기 수요가 부족하면 짧은 만기 트랜치를 추가로 열어 스프레드를 낮게 확정하는 방안을 함께 제시한다.',
   '대한항공 공모사채 제안서(2025-04) 적정 발행규모 장표', '초기값', '초기값'),
  ('sizing', 'judge', null,
   '회사 공모채 만기도래가 적은 연도에 새 트랜치 만기를 두면 만기 분산과 차환 부담 측면에서 유리하다고 설명한다.',
   '대한항공 공모사채 제안서(2025-04) 적정 발행규모 장표', '초기값', '초기값'),
  ('schedule', 'judge', null,
   '정기보고서 제출 이후, 다른 발행사 수요예측이 몰리기 전에 최대한 신속히 발행하는 일정을 우선 검토한다.',
   '이랜드월드 제108회 제안서 일정 장표 / AI 문안 시스템 프롬프트에서 옮김', '초기값', '초기값'),
  ('schedule', 'practice', null,
   '증권신고서 제출과 추가청약 가능성을 고려해 수요예측 전후로 하루 여유를 둔다.',
   '이랜드월드 제108회 제안서 일정 장표 / AI 문안 시스템 프롬프트에서 옮김', '초기값', '초기값'),
  ('schedule', 'practice', null,
   '공모 회사채 발행은 1~3월, 7~8월에 몰린다. 이 시기에는 경쟁 발행을 일정 판단 근거로 쓴다.',
   'GI 인터뷰(2026-10-13)', '초기값', '초기값'),
  ('terms', 'practice', null,
   '금리는 민평(주간)에 스프레드를 더해 정하고, 발행금액·트랜치는 발행사가 최종 결정한다. 제안은 근거와 함께 선택지로 제시한다.',
   'GI 인터뷰(2026-10-13)', '초기값', '초기값'),
  ('sales', 'judge', null,
   'Sales point는 발행사의 안정적인 신용도와 등급 전망으로 잡고, 최근 같은 등급 수요예측에 많이 참여한 기관을 IR·NDR 우선 대상으로 제안한다.',
   '대한항공 공모사채 제안서(2025-04) Sales 전략 장표', '초기값', '초기값'),
  ('sales', 'practice', null,
   '직전에 참여했다가 이번에 빠진 기관은 재마케팅 대상으로 두고, 증권사 리테일·은행 신탁·투자자문사 수요도 함께 파악한다.',
   '대한항공 공모사채 제안서(2025-04) Sales 전략 장표', '초기값', '초기값'),
  ('sales', 'practice', null,
   'Anchor 투자자를 먼저 확보하고 우호적 투자자의 선제 참여로 물량 확보 경쟁을 만들어 밴드 안 낮은 금리를 유도한다.',
   '대한항공 공모사채 제안서(2025-04) IR 및 수요예측 전략 장표', '초기값', '초기값'),
  ('compare', 'caution', null,
   '미매각 원인은 사실로 확인되는 차이(등급·만기·금리 밴드·시기)만 쓰고 추측으로 단정하지 않는다.',
   'AI 문안 시스템 프롬프트(사례 비교 지시)에서 옮김', '초기값', '초기값');
