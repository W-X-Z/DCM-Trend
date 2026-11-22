"""사무실 화면이 읽는 설정. AX 플랫폼의 'RM 미팅 준비' 화면이 이 JSON 으로 방과 사람을 그린다.

python3 -m desk config > config.json
"""
from .agents import AGENTS, DEPTS, PRICES, WEB_SEARCH_USD
from .tools import TOOLS

ROLE = {"collect.newsdesk": "뉴스 검색", "monitor.screener": "공시·기사 선별", "scout.lead": "대상 선정", "research.analyst": "기업 분석",
        "brief.writer": "1pager 작성", "verify.checker": "사실 검증"}


# 산출물 칸의 화면 이름
LABEL = {"articles": "기사 목록", "signals": "선별한 건", "leads": "미팅 대상 회사", "skipped": "선정하지 않은 후보와 사유",
         "call": "미팅 판단", "call_reason": "판단 근거", "funding": "자금 수요", "capacity": "상환·집행 여력", "progress": "조달 진행 현황", "caution": "유의 사항",
         "recent": "최근 동향", "comps_pick": "참고 사례", "open_items": "확인 필요 사항", "sources": "출처", "headline": "판단 한 줄", "agenda": "미팅 아젠다",
         "reference": "참고 사례", "state": "검증 결과", "fixes": "고친 곳", "patches": "고쳐 쓴 내용", "unconfirmed": "확인하지 못한 항목", "note": "검증 의견"}


def _fields(tool):
    props = ((tool or {}).get("input_schema") or {}).get("properties") or {}
    rows = []
    for k, v in props.items():
        rows.append([LABEL.get(k, k), {"array": "목록", "string": "글", "object": "묶음", "integer": "숫자", "boolean": "예·아니오"}.get(v.get("type"), ""), (v.get("description") or "")[:120]])
    return rows


def config():
    agents = {"collect.workflow": {
        "id": "collect.workflow", "dept": "collect", "name": "수집 담당", "role": "공시·뉴스 수집", "kind": "workflow",
        "model": None, "models": [], "desc": "공시와 발행·금리 데이터, 뉴스를 정해진 시각에 수집합니다.",
        "count": 1, "search": 0, "max_tokens": 0, "tools": [], "system": None, "out": None}}
    for a in AGENTS.values():
        t = a["tool"]
        agents[a["id"]] = {
            "id": a["id"], "dept": a["dept"], "name": a["name"], "role": ROLE.get(a["id"], ""), "kind": "agent",
            "model": a["model"], "models": [a["model"]], "desc": a["desc"], "count": a["count"], "search": a["search"],
            "max_tokens": a["max_tokens"], "tools": a["tools"], "system": a["system"],
            "out": {"name": t["name"], "fields": _fields(t)} if t else None}
    return {"floors": [{"id": "desk", "no": 1, "name": "RM 미팅 준비"}], "depts": DEPTS, "agents": agents,
            "prices": {m: list(p) for m, p in PRICES.items()}, "searchUsd": WEB_SEARCH_USD,
            "tools": {n: t[0]["description"] for n, t in TOOLS.items()}}
