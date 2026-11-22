"""사무실 화면이 읽는 설정. AX 플랫폼의 'RM 미팅 준비' 화면이 이 JSON 으로 방과 사람을 그린다.

python3 -m desk config > config.json
"""
from .agents import AGENTS, DEPTS, PRICES, WEB_SEARCH_USD
from .tools import TOOLS

ROLE = {"monitor.screener": "신호 선별", "scout.lead": "대상 선정", "research.analyst": "가설 확인",
        "brief.writer": "1pager 작성", "verify.checker": "독립 검수"}


def _fields(tool):
    props = ((tool or {}).get("input_schema") or {}).get("properties") or {}
    return [[k, v.get("type", ""), (v.get("description") or "")[:120]] for k, v in props.items()]


def config():
    agents = {"collect.workflow": {
        "id": "collect.workflow", "dept": "collect", "name": "수집기", "role": "공시·뉴스 적재", "kind": "workflow",
        "model": None, "models": [], "desc": "공시·발행·금리는 ingest 가, 뉴스는 검색 피드 수집기가 DB 에 쌓는다.",
        "count": 1, "search": 0, "max_tokens": 0, "tools": [], "system": None, "out": None}}
    for a in AGENTS.values():
        t = a["tool"]
        agents[a["id"]] = {
            "id": a["id"], "dept": a["dept"], "name": a["name"], "role": ROLE.get(a["id"], ""), "kind": "agent",
            "model": a["model"], "models": [a["model"]], "desc": a["desc"], "count": a["count"], "search": a["search"],
            "max_tokens": a["max_tokens"], "tools": a["tools"], "system": a["system"],
            "out": {"name": t["name"], "fields": _fields(t)} if t else None}
    return {"floors": [{"id": "desk", "no": 1, "name": "딜 발굴 데스크"}], "depts": DEPTS, "agents": agents,
            "prices": {m: list(p) for m, p in PRICES.items()}, "searchUsd": WEB_SEARCH_USD,
            "tools": {n: t[0]["description"] for n, t in TOOLS.items()}}
