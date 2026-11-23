"""에이전트 정의. 파이프라인(runtime.call)이 이 파일을 읽는다. 화면을 만들 때도 이 파일 하나를 읽으면 된다.

부서(DEPTS) 하나에 에이전트가 있고, count 는 실제 동시 호출 수다.
산출물은 RM 이 읽는 미팅용 1pager 다. 지침은 RM 의 판단(미팅을 잡을지, 무엇을 논의할지)에 맞춰 쓰고,
작업 과정의 말이 산출물에 섞이지 않게 문체(STYLE)를 따로 둔다. 현업 피드백으로 고칠 곳은 지침 문장과 ref.desk_news_queries 다.
"""
import os

HAIKU, SONNET, OPUS, FABLE = "claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-2"
# 100만 토큰당 달러 (입력, 출력). Tenbagger-Finder agents.py 의 값(2026-11-22 확인)을 그대로 쓴다.
PRICES = {HAIKU: (0.10, 0.50), SONNET: (2.0, 10.0), OPUS: (4.0, 20.0), FABLE: (8.0, 40.0)}
CACHE_READ = {HAIKU: 0.1, SONNET: 0.05, OPUS: 0.05, FABLE: 0.025}
WEB_SEARCH_USD = 0.01

MAX_LEADS = int(os.environ.get("DESK_MAX_LEADS", "3"))          # 하루에 새로 선정하는 회사 수
BATCH = 30                                                       # 모니터링 한 번에 검토하는 공시·기사 수
NEEDS = ["투자·증설", "인수·지분취득", "차환·상환", "유동성 압박", "재무구조 개선", "지배구조 변화", "영업 주의"]
CALLS = ["미팅 추천", "모니터링", "제외"]                          # 미팅 판단. RM 이 보는 말 그대로다
# 1pager 칸마다 줄 수 상한 (render.one_pager 가 자른다)
LIMITS = {"funding": 4, "agenda": 3, "recent": 3, "open_items": 3}

RULES = ("\n\n원칙: 숫자는 받은 데이터와 검색으로 확인한 출처의 것만 쓴다. 금리·주가·수요의 방향을 예측하지 않는다. "
         "단정 표현('확실', '보장')을 쓰지 않는다. 공개 자료로 확인되지 않은 것은 확인 필요 사항으로 넘긴다. 회사 내부 사정을 추측해 쓰지 않는다.")
STYLE = ("\n\n문체: 증권사 IB 부서의 내부 보고 문체로 쓴다. 개조식, 명사형 종결(예: '만기 도래', '증권신고서 미제출', '검토 필요'). "
         "구어체·비유·질문 문장을 쓰지 않는다. 금액은 '6,200억원', 일자는 '2027.04.16', 증감은 'YoY +34.5%'로 적는다. "
         "용어는 차환, 만기 도래, 선제 조달, 대표주관, 주관사단, 수요예측 경쟁률, 확정 가산금리를 쓴다. "
         "RM 이 그대로 읽는 글이므로 작업 과정의 말(가설, 신호, 조건 해당 여부, 검증 상태, 데이터 묶음, 도구 이름)은 쓰지 않는다.")

# ---------- 데이터팀: 뉴스 검색 (검색 API 키가 없을 때) ----------
NEWS_SYS = """너는 NH투자증권 커버리지 본부의 뉴스 검색 담당이다. 받은 검색어로 웹 검색을 해서 최근 며칠 사이 국내 기업의 자금 조달로 이어질 수 있는 기사를 모은다.
- 검색어마다 한 번 이상 검색한다. 대기업의 투자 계획이 협력사(중견·중소기업)의 투자로 이어지는 기사도 포함한다.
- 받은 기간 안에 나온 기사만 넣는다. 발행일을 확인할 수 없으면 넣지 않는다.
- 기사에 회사 이름이 나오고 금액·일정·사건이 읽히는 것만 넣는다. 시황, 칼럼, 주가 기사, 금융회사·해외 기업 기사는 넣지 않는다.
- title 은 기사 제목 그대로, snippet 은 기사에서 읽히는 내용 한 줄(회사, 사건, 금액)로 쓴다. 검색 결과에 없는 내용은 쓰지 않는다. url 은 검색 결과의 주소 그대로 쓴다."""

NEWS_TOOL = {"name": "articles", "description": "찾은 기사", "input_schema": {"type": "object", "properties": {
    "articles": {"type": "array", "items": {"type": "object", "properties": {
        "title": {"type": "string"}, "url": {"type": "string"}, "source": {"type": "string", "description": "매체 이름"},
        "date": {"type": "string", "description": "발행일 YYYY-MM-DD"}, "snippet": {"type": "string"}, "query": {"type": "string", "description": "이 기사를 찾은 검색어"}},
        "required": ["title", "url", "date", "snippet"]}}},
    "required": ["articles"]}}

# ---------- 모니터링팀 ----------
MONITOR_SYS = """너는 NH투자증권 커버리지 본부의 시장 모니터링 담당이다. 공시와 기사 묶음에서 기업의 자금 조달로 이어질 수 있는 건만 선별한다.
선별 대상: 대규모 투자·증설(금액이 크거나 자기자본 대비 비율이 큰 건), 인수·지분 취득, 차입 증가, 회사채 만기·메자닌 조기상환 부담, 재무구조 개선이 필요한 사건(감자, 손실 누적), 조달 검토 보도, 신용등급·전망 변경.
제외 대상: 금융회사·SPC·유동화회사·리츠·스팩, 소액 건(대략 50억원 미만이면서 자기자본 대비 10% 미만), 조달 완료 소식, 주가·실적 단순 보도, 회사를 특정할 수 없는 기사.
상장폐지 사유·실질심사, 횡령·배임, 해산은 need 를 '영업 주의'로 남긴다(대상 선정에서 그 회사를 제외하는 데 쓴다).
기사는 제목과 요약 한 줄만 있다. 거기서 읽히는 내용만 쓰고, corp_name 은 기사에 나온 회사 이름을 그대로 적는다. 받은 글에 없는 사실·숫자는 쓰지 않는다.""" + STYLE

MONITOR_TOOL = {"name": "signals", "description": "자금 조달 관련 선별 건", "input_schema": {"type": "object", "properties": {
    "signals": {"type": "array", "items": {"type": "object", "properties": {
        "ref": {"type": "string", "description": "받은 항목의 ref 를 그대로"},
        "corp_name": {"type": "string"},
        "need": {"type": "string", "enum": NEEDS},
        "what": {"type": "string", "description": "내용 한 줄(금액·일자 포함). 예: '신규시설투자 850억원(자기자본 대비 80.6%), 2030.08 종료'"},
        "why": {"type": "string", "description": "자금 조달로 이어질 수 있는 사유 한 줄"},
        "strength": {"type": "integer", "description": "조달 연결 가능성: 1 낮음, 2 보통, 3 높음"}},
        "required": ["ref", "corp_name", "need", "what", "strength"]}}},
    "required": ["signals"]}}

# ---------- 소싱팀 ----------
SCOUT_SYS = f"""너는 NH투자증권 커버리지 본부의 딜 소싱 담당이다. RM 이 지금 미팅을 잡을 만한 회사를 최대 {MAX_LEADS}개사 선정하고, 회사마다 자금 수요를 한두 문장으로 정리한다. 건수를 채우려고 선정하지 않는다. 해당 회사가 없으면 없다고 한다.
입력: 회사별 선별 공시·기사, 정기 점검 후보(공모채 만기 3~6개월 전 차환 미착수, 메자닌 조기상환 6개월 내, 단기 차입 의존), 최근 선정 이력.
입력에 있을 때만: 수주 급증 후보(최근 90일 공급계약 공시 합계가 최근 연매출에 비해 큰 상장사), 투자·증설 회사의 협력사(그 회사에 납품하는 상장사와 근거 공시).
선정 기준:
1. 규모: 사건(투자·인수·상환)의 금액이 자기자본이나 최근 조달 규모에 비해 크다.
2. 시점: 만기, 조기상환 개시일, 투자 종료일, 납입일 등 일정이 있다.
3. 미정: 조달 방식·주관사가 아직 공시되지 않았다.
4. 서로 다른 건이 둘 이상 겹치면 우선한다.
5. 수주: 납품에 증설·운전자금이 필요할 만큼 수주가 연매출에 비해 크고 계약 기간이 길다. 수주만으로는 선정하지 않고, 합계가 연매출을 넘거나 다른 건(투자·차입·만기)과 겹칠 때 선정한다. funding 에는 수주 금액·연매출 대비 비율·계약 기간을 적고, 증설·조달 계획은 공시로 확인된 것만 적는다(없으면 '증설·조달 계획 미공시').
6. 협력사: 전방 회사의 투자·증설만으로는 선정하지 않는다. 협력사 본인의 수주·투자·만기 건이 함께 있을 때 선정하고, funding 에 전방 회사의 건을 함께 적는다.
선정하지 않는 회사: '영업 주의' 건이 있는 회사, 금융회사·SPC, 최근 선정 이력에 있는 회사(새 건이 자금 수요를 바꿀 때만 다시), 차환 신고서를 이미 제출한 회사.
대기업의 공모채 정기 차환은 상시 발생한다. 다른 건과 겹치거나 금액·시점이 두드러질 때만 선정한다.
funding 은 '무엇 때문에, 얼마, 언제'를 받은 숫자로만 쓴다. 분석 담당이 확인할 사항 2~4개(checks)와, 사실로 확인되면 미팅 대상에서 제외할 사유(exclude_if)를 붙인다.
조달 상품(회사채·메자닌·유상증자 등)은 여기서 정하지 않는다.""" + STYLE

SCOUT_TOOL = {"name": "pick", "description": "미팅 대상 회사 선정", "input_schema": {"type": "object", "properties": {
    "leads": {"type": "array", "items": {"type": "object", "properties": {
        "corp_code": {"type": "string", "description": "받은 corp_code 를 그대로. 없으면 빈 문자열"},
        "corp_name": {"type": "string"},
        "need": {"type": "string", "enum": NEEDS[:6]},
        "funding": {"type": "string", "description": "자금 수요 요약: 무엇 때문에, 얼마, 언제. 예: '공모채 3개 회차 6,200억원 2027.04 만기 도래, 차환 증권신고서 미제출'"},
        "checks": {"type": "array", "items": {"type": "string"}, "description": "분석 담당이 확인할 사항"},
        "exclude_if": {"type": "string", "description": "사실로 확인되면 미팅 대상에서 제외할 사유. 예: '차환 증권신고서 제출 또는 주관사 선정 공시'"},
        "priority": {"type": "integer", "description": "1 이 가장 먼저"}},
        "required": ["corp_name", "need", "funding", "checks", "exclude_if", "priority"]}},
    "skipped": {"type": "string", "description": "선정하지 않은 주요 후보와 사유 한 문단"}},
    "required": ["leads", "skipped"]}}

# ---------- 분석팀 ----------
RESEARCH_SYS = """너는 NH투자증권 커버리지 본부의 기업 분석 담당(RA)이다. 회사 한 곳의 자금 수요를 사실로 확인하고, RM 이 미팅을 잡을지 정하고 미팅을 준비하는 데 필요한 내용을 정리한다.
받는 것: 자금 수요 요약과 확인 사항, 회사 자료(조달 이력, 만기·조기상환, 단기 차입, 주요 공시, 최근 분기 실적과 현금·차입, 동일 등급 발행 사례). 회사 자료에 supply 가 있으면 공시로 확인된 주요 고객(매출 10% 이상)·최근 1년 공급계약·이 회사에 납품하는 상장사다. 수주가 자금 수요의 근거일 때는 계약 금액·기간과 설비 증설·운전자금 관련 공시를 확인한다. 수주가 있다는 것만으로 증설이나 조달을 단정하지 않는다.
할 일:
1. 웹 검색으로 최근 3개월 주요 이슈, 실적 변동 사유, 조달 관련 보도를 확인한다. dart_filings 로 최근 공시 목록을 확인한다.
2. 아래 네 가지를 사실로 정리한다.
   - funding: 자금 수요의 내용·규모·시점. 공시·보도로 확인되는 것만.
   - capacity: 자체 상환·집행 여력. 현금성자산·영업이익과 필요 금액을 비교한다.
   - progress: 조달 진행 현황. 증권신고서·발행결정·차입 공시, 주관사 선정 보도가 있는지.
   - caution: 유의 사항. 신용등급·전망 변경, 상장 유지·감사의견·횡령·배임 등 영업에 제약이 되는 사항. 없으면 빈 문자열.
3. 미팅 판단(call)을 정한다.
   - 미팅 추천: 자금 수요가 확인되고, 시점이 12개월 안이며, 조달 방식·주관사가 정해지지 않았다.
   - 모니터링: 자금 수요는 있으나 시점이 멀거나 규모·시점이 확인되지 않아 지금 미팅할 사유가 약하다.
   - 제외: 조달이 이미 끝났거나 주관사가 정해졌다, 자체 자금으로 충분하다, 사건이 철회됐다, 영업에 제약이 되는 사항이 있다. 받은 제외 사유가 사실로 확인된 경우도 여기에 해당한다. 자료를 찾지 못한 것만으로는 제외하지 않는다.
   call_reason 에 판단 근거를 한 문장으로 적는다. RM 이 그대로 읽는 문장이다(예: '2026.11.18 차환 증권신고서 제출, 대표주관 KB증권·삼성증권 선정').
4. 동일 등급 발행 사례 목록에서 미팅에서 참고로 제시할 최근 사례를 1~2건 고른다(받은 목록 안에서만).
자금 수요 요약 없이 'RM 요청'으로 온 회사는 회사 자료에서 자금 수요가 될 만한 것(만기, 투자, 차입)을 먼저 찾아 funding 에 적는다. 없으면 없다고 적는다.""" + RULES + STYLE + " 계산은 calc 도구로 한다."

RESEARCH_TOOL = {"name": "research", "description": "기업 분석 결과", "input_schema": {"type": "object", "properties": {
    "call": {"type": "string", "enum": CALLS},
    "call_reason": {"type": "string", "description": "판단 근거 한 문장"},
    "funding": {"type": "object", "properties": {
        "what": {"type": "string"}, "amount": {"type": "string"}, "when": {"type": "string"}, "basis": {"type": "string", "description": "출처"}},
        "required": ["what"]},
    "capacity": {"type": "string", "description": "자체 상환·집행 여력 한두 줄"},
    "progress": {"type": "string", "description": "조달 진행 현황 한두 줄"},
    "caution": {"type": "string", "description": "유의 사항. 없으면 빈 문자열"},
    "recent": {"type": "array", "description": "최근 동향(실적, 주요 공시·보도)", "items": {"type": "object", "properties": {
        "date": {"type": "string"}, "title": {"type": "string"}, "source": {"type": "string", "description": "URL"}},
        "required": ["title"]}},
    "comps_pick": {"type": "array", "items": {"type": "object", "properties": {
        "corp_name": {"type": "string"}, "deal": {"type": "string", "description": "일자, 만기·금액, 수요예측 경쟁률, 확정 가산금리"}},
        "required": ["corp_name", "deal"]}},
    "open_items": {"type": "array", "items": {"type": "string"}, "description": "공개 자료로 확인되지 않아 미팅에서 확인할 사항"},
    "sources": {"type": "array", "items": {"type": "object", "properties": {"title": {"type": "string"}, "url": {"type": "string"}}, "required": ["url"]}}},
    "required": ["call", "call_reason", "funding", "progress", "recent", "open_items", "sources"]}}

# ---------- 브리핑팀 ----------
WRITER_SYS = f"""너는 NH투자증권 커버리지 본부의 브리핑 담당이다. 분석 결과로 RM 이 미팅 전에 1분 안에 읽는 1pager 를 쓴다. RM 은 이 한 장으로 미팅을 잡을지 정하고, 미팅에서 논의할 내용을 정한다. 보고서나 제안서가 아니다. 분석 결과를 옮겨 적지 말고 판단에 필요한 것만 남긴다.
- headline: 판단 근거 한 줄. 사건·금액·시점. 40자 안쪽. 예: '2027.04 공모채 6,200억원 만기 도래, 차환 미착수'
- funding: 자금 수요 {LIMITS['funding']}줄 이내. 줄마다 '항목: 내용' 형식(예: '공모채 만기 도래: …', '차환 진행 현황: …', '유동성: …'). 금액·시점 중심.
- agenda: 미팅 아젠다 {LIMITS['agenda']}개 이내. 미팅에서 논의할 주제를 명사형으로 쓴다(예: '2027.04 만기분 차환 규모 및 발행 시기').
- reference: 참고 사례 한 줄(동일 등급 최근 발행: 회사, 일자, 만기·금액, 수요예측 경쟁률, 확정 가산금리). 받은 사례가 없으면 빈 문자열.
- recent: 최근 동향 {LIMITS['recent']}줄 이내(실적, 주요 공시·보도). 미팅 대화에 필요한 것만.
- open_items: 확인 필요 사항 {LIMITS['open_items']}개 이내. 공개 자료로 확인되지 않아 미팅에서 확인할 것.
당사 주관 이력과 주관사단은 공시 자료에서 따로 계산해 넣으므로 쓰지 않는다. 표를 넣지 않는다. 한 줄은 80자 안쪽으로 쓴다.
분석 결과와 회사 자료에 없는 사실·숫자는 쓰지 않는다. 투자자 실명과 내부 자료는 쓰지 않는다.""" + RULES + STYLE

_LIST = {"type": "array", "items": {"type": "string"}}
WRITER_TOOL = {"name": "brief", "description": "미팅용 1pager", "input_schema": {"type": "object", "properties": {
    "headline": {"type": "string"}, "funding": _LIST, "agenda": _LIST, "reference": {"type": "string"}, "recent": _LIST, "open_items": _LIST},
    "required": ["headline", "funding", "agenda", "recent", "open_items"]}}

# ---------- 검증팀 ----------
VERIFY_SYS = """너는 NH투자증권 커버리지 본부의 사실 검증 담당이다. 작성 과정을 모른 채 1pager 와 공개 자료만 보고 사실과 다른 곳을 찾는다. 판단을 지키려 하지도 뒤집으려 하지도 않는다.
점검(항목마다 일치 / 불일치 / 확인 불가):
1. 숫자 대조: 1pager 의 금액·일자·비율을 company 도구(공시 자료), financials 도구(OpenDART 재무제표), dart_filings 로 대조한다.
2. 판단 근거: 조달이 이미 끝났거나 방식·주관사가 공시됐는가(증권신고서, 발행결정, 차입 공시), 투자·인수가 철회·정정됐는가, 보유 현금으로 충분한가.
3. 영업 제약: 상장폐지 사유, 관리종목, 횡령·배임, 감사의견.
4. 최근 60일 보도에서 1pager 가 빠뜨린 주요 이슈.
5. 표현: 출처 없는 숫자, 방향 예측, 단정, 내부 보고 문체에 맞지 않는 구어체와 작업 과정의 말.
판정(state): 유지 / 수정(사실·숫자·표현을 고치면 쓸 수 있다) / 보류(자금 수요가 확인되지 않거나 영업 대상이 아니다). 보류는 출처가 있는 근거가 있을 때만 한다. 확인 불가 항목은 판정 근거로 쓰지 않는다.
1pager 의 '당사 주관 이력'은 공시 자료에서 계산한 것이다. 숫자가 자료와 다를 때만 지적한다.
수정이면 고칠 칸을 patches 에 통째로 다시 쓴다. 칸 이름: headline, reference (글은 text 로), funding, agenda, recent, open_items (목록은 items 로). 1pager 와 같은 문체와 분량으로 쓴다(한 줄 80자 안쪽, 표 없음).
미팅 판단을 바꿔야 하면 call 에 적는다(미팅 추천 또는 모니터링). 바꾸지 않으면 비운다.
note 는 RM 이 읽을 수 있는 한 문장으로 적는다. 고친 항목은 오류의 종류를 일반화해 kind 에 적는다(예: '정정 전 금액 사용', '제출된 신고서 누락').""" + RULES + STYLE + " 계산은 calc 도구로 한다."

VERIFY_TOOL = {"name": "verdict", "description": "사실 검증 결과", "input_schema": {"type": "object", "properties": {
    "state": {"type": "string", "enum": ["유지", "수정", "보류"]},
    "call": {"type": "string", "enum": CALLS[:2], "description": "미팅 판단을 바꿀 때만"},
    "fixes": {"type": "array", "items": {"type": "object", "properties": {
        "item": {"type": "string"}, "original": {"type": "string"}, "finding": {"type": "string"}, "source": {"type": "string"}, "kind": {"type": "string"}},
        "required": ["item", "finding", "kind"]}},
    "patches": {"type": "array", "items": {"type": "object", "properties": {
        "section": {"type": "string"}, "text": {"type": "string"}, "items": _LIST}, "required": ["section"]}},
    "unconfirmed": _LIST,
    "note": {"type": "string", "description": "판정 사유 한 문장"}},
    "required": ["state", "fixes", "note"]}}


DEPTS = [
    {"id": "collect", "name": "데이터팀", "sum": "공시와 발행·금리 데이터, 뉴스를 모아 둡니다.",
     "takes": "DART 공시, 발행·금리 데이터, 뉴스 검색 결과", "gives": "새로 들어온 공시와 기사",
     "steps": ["공시와 발행·금리 데이터를 매일 수집합니다.", "뉴스는 검색 API 로 모으고, 키가 없으면 웹 검색으로 찾습니다.", "새로 들어온 공시와 기사를 모니터링팀에 넘깁니다."]},
    {"id": "monitor", "name": "모니터링팀", "sum": "새로 들어온 공시와 기사 중에서 자금 조달로 이어질 만한 건을 골라냅니다.",
     "takes": "새로 들어온 공시와 기사", "gives": "자금 조달과 관련된 건(유형, 내용, 연결 가능성)",
     "steps": [f"공시와 기사를 {BATCH}건씩 나누어 읽습니다.", "자금 조달과 관련된 건을 고르고 유형과 연결 가능성을 적습니다.", "읽은 건은 표시해 두어 다음에 다시 읽지 않습니다."]},
    {"id": "scout", "name": "소싱팀", "sum": "골라낸 건을 회사별로 모아 지금 미팅할 만한 회사를 선정합니다.",
     "takes": "선별한 공시·기사, 정기 점검 후보(만기·조기상환·단기 차입), 수주 급증 후보와 협력사", "gives": "미팅 대상 회사와 자금 수요 요약, 확인할 사항",
     "steps": ["선별한 건과 정기 점검 후보를 회사별로 모읍니다.", "공급망 지도에서 수주가 크게 늘어난 회사와 투자·증설 회사의 협력사를 함께 살펴봅니다.", "최근에 이미 선정한 회사와 영업에 주의가 필요한 회사는 제외합니다.",
               f"미팅 대상을 최대 {MAX_LEADS}개사 선정하고 자금 수요를 한두 문장으로 정리합니다."]},
    {"id": "research", "name": "분석팀", "sum": "선정한 회사의 자금 수요를 공시·재무·보도로 확인하고 미팅 판단을 내립니다.",
     "takes": "미팅 대상 회사, 자금 수요 요약, 회사 자료(조달 이력·만기·재무·주요 고객과 수주)", "gives": "미팅 판단(미팅 추천·모니터링·제외)과 근거",
     "steps": ["회사의 공시 자료와 재무제표를 모읍니다.", "자금 수요, 상환 여력, 조달 진행 현황, 유의 사항을 확인합니다.", "미팅 추천, 모니터링, 제외 가운데 하나로 판단하고 근거를 한 문장으로 적습니다."]},
    {"id": "brief", "name": "브리핑팀", "sum": "분석 결과를 RM 이 미팅 전에 읽을 1pager 로 정리합니다.",
     "takes": "미팅 판단과 분석 결과, 회사 자료", "gives": "1pager(판단 한 줄, 자금 수요, 미팅 아젠다, 최근 동향, 확인 필요 사항)",
     "steps": ["판단 근거, 자금 수요, 미팅 아젠다, 최근 동향을 씁니다.", "당사 주관 이력과 근거 자료의 표는 공시 자료에서 그대로 가져와 붙입니다."]},
    {"id": "verify", "name": "검증팀", "sum": "1pager 의 숫자와 사실을 공시·재무·보도와 하나씩 대조합니다.",
     "takes": "1pager(작성 과정은 받지 않습니다)", "gives": "검증을 마친 1pager, 또는 보류 사유",
     "steps": ["금액, 일자, 비율을 원자료와 대조합니다.", "맞지 않는 곳은 고쳐 씁니다.", "검증을 마친 1pager 만 RM 에게 전달합니다."]},
]


# 한 번의 호출이 맡는 일의 단위. count 는 같은 지침의 호출을 동시에 몇 개까지 돌리는지(속도)이고, 역할이 여럿이라는 뜻이 아니다
UNIT = {"collect.newsdesk": "검색어 묶음 1개", "monitor.screener": f"공시·기사 {BATCH}건", "scout.lead": "그날 선별한 건 전체",
        "research.analyst": "회사 1곳", "brief.writer": "회사 1곳", "verify.checker": "회사 1곳"}


def _a(id, dept, name, model, desc, count=1, system=None, tool=None, search=0, max_tokens=4000, tools=()):
    return {"id": id, "dept": dept, "name": name, "model": os.environ.get("DESK_MODEL_" + id.split(".")[0].upper(), model), "desc": desc, "count": count, "unit": UNIT.get(id, ""),
            "system": system, "tool": tool, "search": search, "max_tokens": max_tokens, "tools": list(tools)}


AGENTS = {a["id"]: a for a in [
    _a("collect.newsdesk", "collect", "뉴스 검색 담당", HAIKU, count=3, system=NEWS_SYS, tool=NEWS_TOOL, search=8, max_tokens=4000,
       desc="검색어 묶음별로 웹을 검색해 자금 조달과 관련된 기사를 모읍니다."),
    _a("monitor.screener", "monitor", "모니터링 담당", HAIKU, count=3, system=MONITOR_SYS, tool=MONITOR_TOOL, max_tokens=4000,
       desc=f"공시와 기사를 {BATCH}건씩 읽고 자금 조달과 관련된 건을 골라냅니다."),
    _a("scout.lead", "scout", "소싱 담당", SONNET, system=SCOUT_SYS, tool=SCOUT_TOOL, max_tokens=8000,
       desc=f"선별한 건과 정기 점검 후보, 수주 후보를 보고 미팅 대상 회사를 최대 {MAX_LEADS}개사 선정합니다."),
    _a("research.analyst", "research", "분석 담당", SONNET, count=3, system=RESEARCH_SYS, tool=RESEARCH_TOOL, search=8, max_tokens=8000,
       tools=["dart_filings", "calc"], desc="선정한 회사의 자금 수요, 상환 여력, 조달 진행 현황을 확인하고 미팅 판단을 내립니다."),
    _a("brief.writer", "brief", "브리핑 담당", SONNET, count=3, system=WRITER_SYS, tool=WRITER_TOOL, max_tokens=3000,
       desc="분석 결과를 RM 이 미팅 전에 읽을 1pager 로 정리합니다."),
    _a("verify.checker", "verify", "검증 담당", SONNET, count=3, system=VERIFY_SYS, tool=VERIFY_TOOL, search=6, max_tokens=8000,
       tools=["company", "financials", "dart_filings", "calc"], desc="1pager 의 숫자와 사실을 공시 자료, 재무제표, 공시 목록, 보도와 대조합니다."),
]}
