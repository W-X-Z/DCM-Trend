"""에이전트 정의. 파이프라인(runtime.call)이 이 파일을 읽는다. 화면을 만들 때도 이 파일 하나를 읽으면 된다.

부서(DEPTS) 하나에 에이전트가 있고, count 는 실제 동시 호출 수다.
지침은 RM·RA 인터뷰(2026-09~11)에서 나온 기준을 옮긴 것이다. 현업 피드백으로 고칠 곳은 지침 문장과 ref.desk_news_queries 다.
"""
import os

HAIKU, SONNET, OPUS, FABLE = "claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-2"
# 100만 토큰당 달러 (입력, 출력). Tenbagger-Finder agents.py 의 값(2026-11-22 확인)을 그대로 쓴다.
PRICES = {HAIKU: (0.10, 0.50), SONNET: (2.0, 10.0), OPUS: (4.0, 20.0), FABLE: (8.0, 40.0)}
CACHE_READ = {HAIKU: 0.1, SONNET: 0.05, OPUS: 0.05, FABLE: 0.025}
WEB_SEARCH_USD = 0.01

MAX_LEADS = int(os.environ.get("DESK_MAX_LEADS", "3"))          # 하루에 새로 고르는 회사 수
BATCH = 30                                                       # 모니터링 한 번에 읽는 공시·기사 수
NEEDS = ["투자·증설", "인수·지분취득", "차환·상환", "유동성 압박", "재무구조 개선", "지배구조 변화", "영업 주의"]
STATES = ["확인", "일부", "확인 못 함", "반대 증거"]

RULES = ("\n\n규칙: 숫자는 받은 데이터와 검색으로 확인한 출처의 것만 쓴다. 금리·주가·수요의 방향을 예측하지 않는다. "
         "'확실', '보장' 같은 단정 표현을 쓰지 않는다. 확인하지 못한 것은 그렇게 적는다. 공개 자료만 쓴다(회사 내부 사정을 추측해 쓰지 않는다).")

# ---------- 모니터링팀 ----------
MONITOR_SYS = """너는 딜 발굴 데스크 모니터링팀이다. 공시와 기사 묶음을 받아, 기업의 자금 조달 수요로 이어질 수 있는 것만 신호로 남기고 나머지는 버린다.
남기는 것: 대규모 투자·증설(금액이 크거나 자기자본 대비 비율이 큰 것), 인수·지분 취득, 차입 증가, 만기·풋 상환 부담, 재무구조 개선이 필요한 사건(감자, 손실 누적), 조달을 검토한다는 보도, 신용등급·전망 변화.
버리는 것: 금융회사·SPC·유동화회사·리츠·스팩, 금액이 작아 조달로 이어지지 않는 건(대략 50억 원 미만이면서 자기자본 대비 10% 미만), 이미 조달을 끝냈다는 소식, 주가·실적 단순 보도, 회사를 특정할 수 없는 기사.
상장폐지 사유·실질심사, 횡령·배임, 해산은 need 를 '영업 주의'로 남긴다(발굴팀이 그 회사를 빼는 데 쓴다).
기사는 제목과 요약 한 줄만 있다. 거기서 읽히는 것만 쓰고, corp_name 은 기사에 나온 회사 이름을 그대로 적는다. 받은 글에 없는 사실·숫자는 쓰지 않는다."""

MONITOR_TOOL = {"name": "signals", "description": "자금 수요 신호", "input_schema": {"type": "object", "properties": {
    "signals": {"type": "array", "items": {"type": "object", "properties": {
        "ref": {"type": "string", "description": "받은 항목의 ref 를 그대로"},
        "corp_name": {"type": "string"},
        "need": {"type": "string", "enum": NEEDS},
        "what": {"type": "string", "description": "무슨 일인가 한 줄 (금액·날짜 포함)"},
        "why": {"type": "string", "description": "왜 자금 수요로 이어질 수 있는가 한 줄"},
        "strength": {"type": "integer", "description": "1 약함, 2 보통, 3 강함"}},
        "required": ["ref", "corp_name", "need", "what", "strength"]}}},
    "required": ["signals"]}}

# ---------- 발굴팀 ----------
SCOUT_SYS = f"""너는 딜 발굴 데스크 발굴팀장이다. RM 이 지금 연락할 만한, 돈이 필요해 보이는 회사를 최대 {MAX_LEADS}곳 고르고 회사마다 자금 수요 가설을 쓴다. 채우려고 고르지 않는다. 없으면 없다고 한다.
입력: 회사별 신호(공시·기사), 규칙이 뽑은 후보(공모채 만기 3~6개월 전인데 차환 신고서 없음, 메자닌 풋 6개월 내, 단기 차입 의존), 최근 보드.
고르는 기준:
1. 사건(투자·인수·상환)의 금액이 자기자본이나 최근 조달 규모에 견줘 크다.
2. 시기가 있다: 만기, 풋 시작일, 투자 종료일, 납입일.
3. 조달 방법이 아직 공시되지 않았다.
4. 서로 다른 신호가 둘 이상이면 먼저 고른다.
고르지 않는 것: '영업 주의' 신호가 있는 회사, 금융회사·SPC, 최근 보드에 이미 있는 회사(새 신호가 그 가설을 바꿀 때만 다시), 차환 신고서를 이미 낸 회사.
대기업의 공모채 차환(refi_due)은 늘 있는 일이다. 다른 신호와 겹치거나 금액·시기가 두드러질 때만 고른다.
가설은 '무엇 때문에, 얼마쯤, 언제'를 받은 숫자로만 쓴다. 조사팀이 확인할 질문 2~4개와, 이러면 대상이 아니라는 조건(kill)을 붙인다.
상품(회사채·메자닌·유상증자 등)은 여기서 정하지 않는다."""

SCOUT_TOOL = {"name": "pick", "description": "오늘의 대상과 가설", "input_schema": {"type": "object", "properties": {
    "leads": {"type": "array", "items": {"type": "object", "properties": {
        "corp_code": {"type": "string", "description": "받은 corp_code 를 그대로. 없으면 빈 문자열"},
        "corp_name": {"type": "string"},
        "need": {"type": "string", "enum": NEEDS[:6]},
        "hypothesis": {"type": "string", "description": "무엇 때문에, 얼마쯤, 언제 돈이 필요할 것 같은가"},
        "signal_refs": {"type": "array", "items": {"type": "string"}, "description": "근거로 쓴 신호의 src_ref 또는 규칙 후보의 signal_key"},
        "questions": {"type": "array", "items": {"type": "string"}},
        "kill": {"type": "string", "description": "이것이 확인되면 대상이 아니다"},
        "priority": {"type": "integer", "description": "1 이 가장 먼저"}},
        "required": ["corp_name", "need", "hypothesis", "questions", "kill", "priority"]}},
    "skipped": {"type": "string", "description": "고르지 않은 주요 후보와 이유 한 문단"}},
    "required": ["leads", "skipped"]}}

# ---------- 조사팀 ----------
RESEARCH_SYS = """너는 딜 발굴 데스크 조사 담당이다. 회사 한 곳의 자금 수요 가설을 받아 사실로 확인하고, RM 이 미팅에서 쓸 재료를 모은다.
받는 것: 가설과 질문, 데이터 묶음(조달 이력, 만기·풋, 단기 차입, 주요 공시, 최근 분기 실적과 현금·차입, 유사 사례).
할 일:
1. 웹 검색으로 회사의 사업(무엇을 누구에게 파는가, 공급망에서의 자리), 최근 3개월 이슈, 실적이 변한 이유를 확인한다. dart_filings 로 최근 공시 목록을 본다.
2. 확인 넷의 상태를 정한다.
   - need: 자금 수요가 실재하는가. 사건이 공시·보도로 확인되고 금액·시기가 있는가.
   - capacity: 자체 자금으로 감당이 어려운가. 현금·영업이익과 필요 금액을 견준다. '확인'은 외부 조달이 필요해 보인다는 뜻이다.
   - timing: 조달이 필요한 때가 앞으로 12개월 안에 있는가.
   - access: 아직 열려 있는가. '확인'은 조달 방법·주관사가 공시·보도되지 않았다는 뜻이다.
   상태의 뜻: 확인 = 출처가 있는 사실로 섰다 / 일부 = 방향은 맞으나 금액·시기 가운데 빠진 것이 있다 / 확인 못 함 = 찾았으나 자료가 없다 / 반대 증거 = 가설과 반대되는 사실을 찾았다(이미 조달 완료, 현금으로 충분, 투자 철회 등). 자료가 없는 것을 반대 증거로 적지 않는다.
3. 유사 사례 목록에서 RM 이 미팅에서 말할 만한 최근 발행을 고른다(받은 목록 안에서만).
4. 가설의 kill 조건이 사실로 확인되면 kill_hit 에 그 사실과 출처를 적는다. 아니면 비운다.
가설 없이 'RM 요청'으로 온 회사는 데이터 묶음에서 자금 수요가 될 만한 것(만기, 투자, 차입)을 먼저 찾아 need_detail 에 적는다. 없으면 없다고 적는다.""" + RULES + " 계산은 calc 도구로 한다."

_CHECK = {"type": "object", "properties": {"state": {"type": "string", "enum": STATES}, "note": {"type": "string", "description": "근거 한두 줄과 출처"}},
          "required": ["state", "note"]}

RESEARCH_TOOL = {"name": "research", "description": "조사 결과", "input_schema": {"type": "object", "properties": {
    "checks": {"type": "object", "properties": {"need": _CHECK, "capacity": _CHECK, "timing": _CHECK, "access": _CHECK},
               "required": ["need", "capacity", "timing", "access"]},
    "need_detail": {"type": "object", "properties": {
        "what": {"type": "string"}, "amount": {"type": "string"}, "when": {"type": "string"}, "basis": {"type": "string", "description": "출처"}},
        "required": ["what"]},
    "business": {"type": "string", "description": "사업 설명 3~4문장: 무엇을 누구에게 파는가"},
    "position": {"type": "string", "description": "공급망에서의 자리, 주요 고객·경쟁사"},
    "earnings_note": {"type": "string", "description": "최근 실적이 변한 이유"},
    "issues": {"type": "array", "items": {"type": "object", "properties": {
        "date": {"type": "string"}, "title": {"type": "string"}, "why": {"type": "string", "description": "미팅에서 왜 중요한가"}, "source": {"type": "string", "description": "URL"}},
        "required": ["title"]}},
    "funding_done": {"type": "string", "description": "이미 끝냈거나 공시한 조달. 없으면 빈 문자열"},
    "comps_pick": {"type": "array", "items": {"type": "object", "properties": {
        "corp_name": {"type": "string"}, "deal": {"type": "string", "description": "일자, 상품, 금액, 조건"}, "point": {"type": "string", "description": "이 회사와 닮은 점"}},
        "required": ["corp_name", "deal"]}},
    "unknowns": {"type": "array", "items": {"type": "string"}},
    "kill_hit": {"type": "string"},
    "sources": {"type": "array", "items": {"type": "object", "properties": {"title": {"type": "string"}, "url": {"type": "string"}}, "required": ["url"]}}},
    "required": ["checks", "need_detail", "business", "issues", "unknowns", "kill_hit", "sources"]}}

# ---------- 브리핑팀 ----------
WRITER_SYS = """너는 딜 발굴 데스크 브리핑 담당이다. 조사 결과로 RM 이 미팅 직전 3분 안에 읽는 1pager 의 글 칸을 쓴다. 표(실적, 차입·만기, 조달 이력, 유사 사례)는 코드가 데이터로 그리므로 표 내용을 글로 되풀이하지 않는다.
- headline: 왜 지금 이 회사인가 한 문장(사건과 금액·시기).
- need: 자금 수요 2~3줄(무엇, 얼마, 언제).
- company: 사업 설명 2~3문장. 이 산업을 처음 보는 RM 도 알 수 있게 쓴다(무엇을 누구에게 파는가, 공급망에서의 자리).
- earnings: 최근 실적 변화와 이유 1~2줄.
- debt: 차입·만기에서 눈에 띄는 것 1~2줄.
- issues: 최근 이슈 3~5개(날짜, 한 줄).
- talking_points: 미팅에서 꺼낼 말 3~5개. 질문 위주로, 자금 계획을 자연스럽게 묻는 순서로 쓴다. 유사 사례를 하나 넣는다.
- angles: 검토할 수 있는 조달 방향 0~2개와 근거(받은 사례, 회사의 조달 이력). '검토 가능' 수준으로만 쓴다.
- unknowns: 확인하지 못해 미팅에서 물어볼 것.
조사 결과와 데이터 묶음에 없는 사실·숫자를 쓰지 않는다. 명사형으로 짧게 쓴다. 기관 실명, 내부 자료는 쓰지 않는다.""" + RULES

_LIST = {"type": "array", "items": {"type": "string"}}
WRITER_TOOL = {"name": "brief", "description": "1pager 글 칸", "input_schema": {"type": "object", "properties": {
    "headline": {"type": "string"}, "need": {"type": "string"}, "company": {"type": "string"}, "earnings": {"type": "string"}, "debt": {"type": "string"},
    "issues": _LIST, "talking_points": _LIST, "angles": _LIST, "unknowns": _LIST},
    "required": ["headline", "need", "company", "issues", "talking_points", "unknowns"]}}

# ---------- 검수팀 ----------
VERIFY_SYS = """너는 딜 발굴 데스크 검수 담당이다. 작성 과정을 모른 채 1pager 와 공개 자료만 보고 틀린 곳과 빠진 곳을 찾는다. 결론을 지키려 하지도 뒤집으려 하지도 않는다.
점검(항목마다 맞음 / 틀림 / 확인 못 함):
1. 숫자 대조: 1pager 의 금액·날짜·비율을 company 도구(공시 DB)와 dart_filings 로 대조한다.
2. 자금 수요 반증: 이미 조달을 끝냈거나 방법을 공시했는가(증권신고서, 발행결정, 차입 공시), 투자·인수가 철회·정정됐는가, 보유 현금으로 충분한가.
3. 영업 가능성: 상장폐지 사유, 관리종목, 횡령·배임, 감사의견 문제.
4. 최근 60일 보도에서 1pager 가 빠뜨린 큰 이슈.
5. 표현: 출처 없는 숫자, 방향 예측, 단정.
판정: 유지 / 수정(사실·숫자를 고치면 쓸 수 있다) / 보류(자금 수요 자체가 서지 않거나 영업 대상이 아니다). 보류는 출처가 있는 근거가 있을 때만 한다. 확인 못 한 항목은 판정 근거로 쓰지 않는다.
수정이면 고칠 칸을 patches 에 통째로 다시 쓴다. 칸 이름: headline, need, company, earnings, debt (글), issues, talking_points, angles, unknowns (목록은 items 로).
고친 항목은 실수의 종류를 일반화해 kind 에 적는다(예: '정정 전 금액 사용', '이미 낸 신고서를 놓침').""" + RULES + " 계산은 calc 도구로 한다."

VERIFY_TOOL = {"name": "verdict", "description": "검수 판정", "input_schema": {"type": "object", "properties": {
    "state": {"type": "string", "enum": ["유지", "수정", "보류"]},
    "fixes": {"type": "array", "items": {"type": "object", "properties": {
        "item": {"type": "string"}, "original": {"type": "string"}, "finding": {"type": "string"}, "source": {"type": "string"}, "kind": {"type": "string"}},
        "required": ["item", "finding", "kind"]}},
    "patches": {"type": "array", "items": {"type": "object", "properties": {
        "section": {"type": "string"}, "text": {"type": "string"}, "items": _LIST}, "required": ["section"]}},
    "unconfirmed": _LIST,
    "note": {"type": "string", "description": "판정 이유 한두 줄"}},
    "required": ["state", "fixes", "note"]}}


DEPTS = [
    {"id": "collect", "name": "수집실", "sum": "공시·금리는 기존 수집기(ingest)가, 뉴스는 검색 피드 수집기(desk/news.py)가 쌓는다."},
    {"id": "monitor", "name": "모니터링팀", "sum": "아직 안 읽은 공시와 기사 제목에서 자금 수요 신호만 남긴다."},
    {"id": "scout", "name": "발굴팀", "sum": "신호와 규칙 후보를 회사별로 모아 오늘의 대상과 자금 수요 가설을 정한다."},
    {"id": "research", "name": "조사팀", "sum": "가설을 사실로 확인하고 사업·이슈·유사 사례를 모은다."},
    {"id": "brief", "name": "브리핑팀", "sum": "미팅용 1pager 를 쓴다. 표는 코드가 데이터로 그린다."},
    {"id": "verify", "name": "검수팀", "sum": "작성 과정을 모른 채 1pager 를 공개 자료와 대조한다. 검수를 거친 것만 게시된다."},
]


def _a(id, dept, name, model, desc, count=1, system=None, tool=None, search=0, max_tokens=4000, tools=()):
    return {"id": id, "dept": dept, "name": name, "model": os.environ.get("DESK_MODEL_" + id.split(".")[0].upper(), model), "desc": desc, "count": count,
            "system": system, "tool": tool, "search": search, "max_tokens": max_tokens, "tools": list(tools)}


AGENTS = {a["id"]: a for a in [
    _a("monitor.screener", "monitor", "모니터링 담당", HAIKU, count=3, system=MONITOR_SYS, tool=MONITOR_TOOL, max_tokens=4000,
       desc=f"공시·기사 {BATCH}건씩 읽고 자금 수요 신호만 남긴다."),
    _a("scout.lead", "scout", "발굴팀장", SONNET, system=SCOUT_SYS, tool=SCOUT_TOOL, max_tokens=8000,
       desc=f"회사별 신호와 규칙 후보에서 대상을 최대 {MAX_LEADS}곳 고르고 가설·질문·제외 조건을 쓴다."),
    _a("research.analyst", "research", "조사 담당", SONNET, count=3, system=RESEARCH_SYS, tool=RESEARCH_TOOL, search=8, max_tokens=10000,
       tools=["dart_filings", "calc"], desc="가설 하나를 받아 확인 넷(수요, 여력, 시기, 열려 있는가)과 사업·이슈·유사 사례를 정리한다."),
    _a("brief.writer", "brief", "브리핑 담당", SONNET, count=3, system=WRITER_SYS, tool=WRITER_TOOL, max_tokens=6000,
       desc="조사 결과로 1pager 의 글 칸을 쓴다."),
    _a("verify.checker", "verify", "검수 담당", SONNET, count=3, system=VERIFY_SYS, tool=VERIFY_TOOL, search=6, max_tokens=8000,
       tools=["company", "dart_filings", "calc"], desc="1pager 를 공시 DB·공시 목록·보도와 대조해 유지·수정·보류를 정한다."),
]}
