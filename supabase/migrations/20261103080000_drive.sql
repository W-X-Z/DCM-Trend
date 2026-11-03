-- 드라이브(MVP, 11/3): AX 플랫폼 4안 드라이브와 DCM 제안서 Agent 가 같이 쓰는 파일 저장소.
-- 현업이 올린 DM · 레퍼런스 · 자료를 버전으로 남기고, 올릴 때 뽑은 글 · 슬라이드 구조 · 카드(레퍼런스) · 판(DM)을 같이 둔다.
-- 원본은 bytea(파일 5MB 이하). 화면 · Agent 는 mart 함수로만 읽고 쓴다(서버 전용 키, 접근 키는 API 에서 확인).

create table ops.drive_files (
  id          bigint generated always as identity primary key,
  area        text not null check (area in ('dept', 'mine')),          -- 부서 공용 / 내 폴더
  owner       text not null check (char_length(owner) between 1 and 60), -- 부서 id 또는 사용자 id
  folder      text not null check (char_length(folder) between 1 and 60),
  name        text not null check (char_length(name) between 1 and 200),
  kind        text not null check (kind in ('pptx', 'pdf', 'md', 'csv', 'txt', 'xlsx', 'docx', 'json')),
  size        integer not null check (size between 0 and 5000000),
  ver         integer not null check (ver >= 1),
  body        bytea not null,
  content     text,                       -- 뽑은 글(참고 · 검색용)
  slides      jsonb,                      -- PPTX 슬라이드 구조(제목 · 글 · 표 · 차트 · 그림)
  meta        jsonb not null default '{}'::jsonb, -- card(레퍼런스) · edition(DM 판) 등
  status      text not null default 'ready' check (status in ('processing', 'ready', 'error')),
  error       text check (char_length(error) <= 500),
  created_at  timestamptz not null default now(),
  created_by  text check (char_length(created_by) <= 60),
  client_id   text check (char_length(client_id) <= 40),
  deleted_at  timestamptz,
  unique (area, owner, folder, name, ver)
);
create index drive_files_folder_idx on ops.drive_files (area, owner, folder) where deleted_at is null;
create index drive_files_created_idx on ops.drive_files (created_at desc);

-- 과도한 쓰기 막기: 같은 브라우저 1분 20건, 전체 10분 200건
create or replace function ops.drive_guard(p_client text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_client is not null and (select count(*) from ops.drive_files
       where client_id = p_client and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'too many' using errcode = '54000';
  end if;
  if (select count(*) from ops.drive_files where created_at > now() - interval '10 minutes') >= 200 then
    raise exception 'too many' using errcode = '54000';
  end if;
end
$$;

-- 올리기: 같은 자리(구역 · 소유 · 폴더 · 이름)에 있으면 새 버전
create or replace function mart.drive_put(
  p_area text, p_owner text, p_folder text, p_name text, p_kind text, p_body_b64 text,
  p_content text default null, p_slides jsonb default null, p_meta jsonb default '{}'::jsonb,
  p_status text default 'ready', p_author text default null, p_client_id text default null
)
returns table (id bigint, ver integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_body bytea := decode(coalesce(p_body_b64, ''), 'base64');
  v_ver integer;
  v_id bigint;
  v_client text := nullif(left(btrim(coalesce(p_client_id, '')), 40), '');
begin
  perform ops.drive_guard(v_client);
  select coalesce(max(f.ver), 0) + 1 into v_ver from ops.drive_files f
   where f.area = p_area and f.owner = p_owner and f.folder = p_folder and f.name = p_name;
  insert into ops.drive_files (area, owner, folder, name, kind, size, ver, body, content, slides, meta, status, created_by, client_id)
  values (p_area, p_owner, btrim(p_folder), btrim(p_name), p_kind, octet_length(v_body), v_ver, v_body,
          left(p_content, 400000), p_slides, coalesce(p_meta, '{}'::jsonb), coalesce(p_status, 'ready'),
          nullif(left(btrim(coalesce(p_author, '')), 60), ''), v_client)
  returning ops.drive_files.id into v_id;
  return query select v_id, v_ver;
end
$$;

-- 처리 결과 넣기(카드 · 판 · 상태)
create or replace function mart.drive_set(p_id bigint, p_meta jsonb, p_status text, p_error text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  update ops.drive_files
     set meta = coalesce(meta, '{}'::jsonb) || coalesce(p_meta, '{}'::jsonb),
         status = p_status, error = left(p_error, 500)
   where id = p_id and deleted_at is null;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  return p_id;
end
$$;

-- 폴더 목록: 이름마다 최신 버전(원본 · 글은 빼고)
create or replace function mart.drive_list(p_area text, p_owner text, p_folder text default null)
returns table (id bigint, folder text, name text, kind text, size integer, ver integer, versions bigint,
               status text, error text, meta jsonb, created_at timestamptz, created_by text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.folder, f.name, f.kind, f.size, f.ver,
         (select count(*) from ops.drive_files g where g.area = f.area and g.owner = f.owner and g.folder = f.folder and g.name = f.name and g.deleted_at is null),
         f.status, f.error, f.meta - 'edition', f.created_at, f.created_by
    from ops.drive_files f
   where f.area = p_area and f.owner = p_owner and (p_folder is null or f.folder = p_folder) and f.deleted_at is null
     and f.ver = (select max(g.ver) from ops.drive_files g
                   where g.area = f.area and g.owner = f.owner and g.folder = f.folder and g.name = f.name and g.deleted_at is null)
   order by f.folder, f.created_at desc
$$;

-- 버전 목록
create or replace function mart.drive_versions(p_id bigint)
returns table (id bigint, ver integer, size integer, status text, created_at timestamptz, created_by text)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.ver, g.size, g.status, g.created_at, g.created_by
    from ops.drive_files f join ops.drive_files g
      on g.area = f.area and g.owner = f.owner and g.folder = f.folder and g.name = f.name and g.deleted_at is null
   where f.id = p_id
   order by g.ver desc
$$;

-- 원본(base64)
create or replace function mart.drive_body(p_id bigint)
returns table (name text, kind text, body_b64 text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.name, f.kind, encode(f.body, 'base64') from ops.drive_files f where f.id = p_id and f.deleted_at is null
$$;

-- 글 · 슬라이드 구조 · 메타(미리보기 · Agent 참고)
create or replace function mart.drive_read(p_id bigint)
returns table (id bigint, area text, owner text, folder text, name text, kind text, ver integer, content text, slides jsonb, meta jsonb, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.area, f.owner, f.folder, f.name, f.kind, f.ver, f.content, f.slides, f.meta, f.status
    from ops.drive_files f where f.id = p_id and f.deleted_at is null
$$;

-- 지우기(그 이름의 모든 버전)
create or replace function mart.drive_delete(p_id bigint, p_client_id text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  f ops.drive_files%rowtype;
begin
  perform ops.drive_guard(nullif(left(btrim(coalesce(p_client_id, '')), 40), ''));
  select * into f from ops.drive_files where drive_files.id = p_id and deleted_at is null;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  update ops.drive_files set deleted_at = now()
   where area = f.area and owner = f.owner and folder = f.folder and name = f.name and deleted_at is null;
  return p_id;
end
$$;

-- Agent: 기준일 이전 가장 최근 DM 판(올린 것 중 처리가 끝난 것)
create or replace function mart.drive_dm_latest(p_asof date)
returns table (id bigint, name text, edition jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.name, f.meta -> 'edition'
    from ops.drive_files f
   where f.area = 'dept' and f.folder = 'DM' and f.status = 'ready' and f.deleted_at is null
     and f.meta ? 'edition' and (f.meta -> 'edition' ->> 'edition') <= to_char(p_asof, 'YYYY-MM-DD')
   order by f.meta -> 'edition' ->> 'edition' desc, f.ver desc
   limit 1
$$;

-- Agent: 레퍼런스 카드(부서 공용 '레퍼런스' 폴더의 최신 버전)
create or replace function mart.drive_refs(p_owner text)
returns table (id bigint, name text, kind text, card jsonb, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.name, l.kind, l.meta -> 'card', l.created_at
    from mart.drive_list('dept', p_owner, '레퍼런스') l
   where l.status = 'ready' and l.meta ? 'card'
$$;

revoke all on function ops.drive_guard(text) from public;
revoke all on function mart.drive_put(text, text, text, text, text, text, text, jsonb, jsonb, text, text, text) from public;
revoke all on function mart.drive_set(bigint, jsonb, text, text) from public;
revoke all on function mart.drive_list(text, text, text) from public;
revoke all on function mart.drive_versions(bigint) from public;
revoke all on function mart.drive_body(bigint) from public;
revoke all on function mart.drive_read(bigint) from public;
revoke all on function mart.drive_delete(bigint, text) from public;
revoke all on function mart.drive_dm_latest(date) from public;
revoke all on function mart.drive_refs(text) from public;
grant execute on function mart.drive_put(text, text, text, text, text, text, text, jsonb, jsonb, text, text, text) to anon, authenticated, service_role;
grant execute on function mart.drive_set(bigint, jsonb, text, text) to anon, authenticated, service_role;
grant execute on function mart.drive_list(text, text, text) to anon, authenticated, service_role;
grant execute on function mart.drive_versions(bigint) to anon, authenticated, service_role;
grant execute on function mart.drive_body(bigint) to anon, authenticated, service_role;
grant execute on function mart.drive_read(bigint) to anon, authenticated, service_role;
grant execute on function mart.drive_delete(bigint, text) to anon, authenticated, service_role;
grant execute on function mart.drive_dm_latest(date) to anon, authenticated, service_role;
grant execute on function mart.drive_refs(text) to anon, authenticated, service_role;
grant select, insert, update on ops.drive_files to service_role;
