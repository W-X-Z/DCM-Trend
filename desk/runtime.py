"""에이전트 호출 한 곳. 요청 조립(agents.py 정의), 웹 검색·도구, 비용, 호출별 기록(desk.calls).

Tenbagger-Finder runtime.py 를 옮긴 것이다(요청 형식, 잘린 출력 처리, 형식 보정, 비용 상한은 그쪽 첫 실행들에서 고친 그대로).
실행 하나(desk.runs)에 호출 여러 개(desk.calls)가 붙는다. 기록에 실패해도 본 작업은 계속한다.
"""
import json, os, threading, time, urllib.error, urllib.request

from . import core as c
from .agents import AGENTS, CACHE_READ, HAIKU, PRICES, SONNET, WEB_SEARCH_USD
from .tools import TOOLS

RUN = {"id": None, "cost": 0.0, "cap": float(os.environ.get("DESK_USD_CAP", "5")), "calls": 0}
_lock = threading.Lock()


class BudgetExceeded(RuntimeError):
    pass


def _api():
    return os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/") + "/v1/messages"


def _safe(fn):
    try:
        return fn()
    except Exception as e:   # 기록은 덤이다
        print("기록 실패:", str(e)[:160])
        return None


def start_run(kind="daily"):
    rid = time.strftime("%Y%m%d-%H%M%S", time.gmtime()) + ("" if kind == "daily" else "-" + kind)
    RUN.update(id=rid, cost=0.0, calls=0, cap=float(os.environ.get("DESK_USD_CAP", "5")))
    _safe(lambda: c.rpc("desk_run_start", {"p_run_id": rid, "p_kind": kind}))
    return rid


def finish_run(status="done", summary=None):
    if RUN["id"]:
        _safe(lambda: c.rpc("desk_run_finish", {"p_run_id": RUN["id"], "p_status": status, "p_cost": round(RUN["cost"], 4), "p_summary": summary}))


def left():
    return RUN["cap"] - RUN["cost"]


def cost_of(model, u):
    p = PRICES.get(model, (0, 0))
    inp = (u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0) * 1.25 + u.get("cache_read_input_tokens", 0) * CACHE_READ.get(model, 0.1))
    return inp / 1e6 * p[0] + u.get("output_tokens", 0) / 1e6 * p[1] + u.get("web_search_requests", 0) * WEB_SEARCH_USD


def _post(body):
    data = json.dumps(body).encode()
    err, net = None, 0
    for attempt in range(8):
        try:
            req = urllib.request.Request(_api(), data=data, headers={"x-api-key": c.env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01",
                                                                    "content-type": "application/json"})
            with urllib.request.urlopen(req, timeout=600) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            msg = e.read()[:300].decode("utf-8", "replace")
            drop = next((k for k in ("thinking", "cache_control") if e.code == 400 and k in body and k in msg.lower()), None)
            if drop:   # 이 모델이 그 설정을 거부하면 빼고 다시
                body.pop(drop)
                data = json.dumps(body).encode()
                continue
            err = f"HTTP {e.code} {msg}"
            if e.code in (429, 500, 502, 503, 529):   # 한도·과부하: 서버가 알려 준 만큼(최대 90초) 기다린다
                ra = (e.headers.get("retry-after") or "").strip()
                time.sleep(min(90.0, float(ra)) if ra.replace(".", "", 1).isdigit() else 5 * (attempt + 1))
                continue
            break
        except Exception as e:   # 시간 초과·연결 끊김: 같은 요청을 다시 보내면 입력 비용이 또 든다. 한 번만 더
            err = str(e)[:160]
            net += 1
            if net >= 2:
                break
            time.sleep(3)
    raise RuntimeError(err)


def summarize(agent_id, out):
    """기록(과 나중의 화면 말풍선)에 남길 짧은 요약."""
    if not isinstance(out, dict):
        return ""
    if agent_id == "monitor.screener":
        s = [x for x in out.get("signals") or [] if isinstance(x, dict)]
        return f"신호 {len(s)}" + (f" · {s[0].get('corp_name', '')} {s[0].get('what', '')[:60]}" if s else "")
    if agent_id == "scout.lead":
        ls = [x for x in out.get("leads") or [] if isinstance(x, dict)]
        return ("대상 " + ", ".join(x.get("corp_name", "") for x in ls)) if ls else "대상 없음"
    if agent_id == "research.analyst":
        ck = out.get("checks") or {}
        st = lambda k: str((ck.get(k) or {}).get("state", "–")) if isinstance(ck.get(k), dict) else "–"
        return f"수요 {st('need')} · 여력 {st('capacity')} · 시기 {st('timing')} · 열림 {st('access')}" + (" · 제외 조건 해당" if (out.get("kill") or {}).get("hit") is True else "")
    if agent_id == "brief.writer":
        return str(out.get("headline", ""))[:120]
    if agent_id == "verify.checker":
        return f"{out.get('state', '')} · 고친 항목 {len(out.get('fixes') or [])}"
    return ""


def _fit(v, sch):
    """모델이 낸 값을 도구 형식에 맞춘다. 객체·배열을 문자열(JSON)로 내거나 숫자를 글자로 내는 일이 있다. 못 맞추면 그대로 둔다."""
    t = (sch or {}).get("type")
    if t in ("object", "array") and isinstance(v, str):
        try:
            v = json.loads(v)
        except Exception:
            if t == "array":
                return [v] if v.strip() else []
            return {"_text": v}   # 객체 자리에 글이 오면 감싼다 (쓰는 쪽의 .get 이 죽지 않게. 11/22 첫 실행에서 검수 결과를 잃었다)
    if t == "object" and not isinstance(v, dict):
        return {"_text": v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)} if v not in (None, "") else {}
    if t == "object" and isinstance(v, dict):
        props = sch.get("properties") or {}
        return {k: _fit(x, props.get(k)) for k, x in v.items()}
    if t == "array":
        if v is None:
            return []
        return [_fit(x, sch.get("items")) for x in (v if isinstance(v, list) else [v])]
    if t in ("integer", "number") and isinstance(v, str):
        try:
            f = float(v.replace(",", "").strip())
            return int(f) if t == "integer" else f
        except Exception:
            return None
    if t == "integer" and isinstance(v, float):
        return int(v)
    if t == "string" and v is not None and not isinstance(v, str):
        return json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else str(v)
    return v


def call(agent_id, user, item="", slot=1, model=None, reserve=0.0):
    """에이전트 한 번 호출. (출력 dict 또는 None, usage dict) 를 돌려준다.
    reserve: 뒤 단계 몫으로 남겨 둘 금액. 남은 한도가 이보다 적으면 호출하지 않는다."""
    a = AGENTS[agent_id]
    model = model or a["model"]
    with _lock:
        if RUN["cost"] >= RUN["cap"] - reserve:
            raise BudgetExceeded(f"실행 비용 상한 ${RUN['cap']} 도달 (쓴 금액 ${RUN['cost']:.2f})")
        RUN["calls"] += 1
    cid = _safe(lambda: c.rpc("desk_call_start", {"p": {"run_id": RUN["id"], "agent": agent_id, "dept": a["dept"], "slot": slot, "model": model, "item": str(item)[:300]}}))
    out_tool = a["tool"]
    client = [TOOLS[t] for t in a["tools"]]
    tools = [out_tool] + [t[0] for t in client]
    if a["search"]:
        tools.append({"type": "web_search_20250305", "name": "web_search", "max_uses": a["search"]})
    forced = not client and not a["search"] and model == HAIKU   # Haiku 만 도구 강제 (나머지는 thinking 과 함께 auto)
    system = a["system"] + ("" if forced else f"\n\n{'조사가 끝나면 ' if (client or a['search']) else ''}{out_tool['name']} 도구를 정확히 한 번 호출해 답한다. 다른 형식으로 답하지 않는다.")
    body = {"model": model, "max_tokens": a["max_tokens"], "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            "tools": tools, "messages": [{"role": "user", "content": user}],
            "tool_choice": {"type": "tool", "name": out_tool["name"]} if forced else {"type": "auto"}}
    # thinking: Haiku 는 끈다. Sonnet 은 도구 호출 사이에만. Opus·Fable 은 적지 않는다(항상 켜져 있고 다른 값은 400).
    if model == HAIKU:
        body["thinking"] = {"type": "disabled"}
    elif model == SONNET:
        body["thinking"] = {"type": "between_tools"}
    if client or a["search"]:   # 여러 번 오가는 호출: 앞부분(검색 결과, 도구 결과)을 캐시에서 읽는다
        body["cache_control"] = {"type": "ephemeral"}
    u = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0, "web_search_requests": 0}
    out, err, nudged = None, None, False
    try:
        for _turn in range(40):
            r = _post(body)
            ru = r.get("usage") or {}
            for k in u:
                u[k] += (ru.get("server_tool_use") or {}).get(k, 0) if k == "web_search_requests" else (ru.get(k) or 0)
            content = r.get("content") or []
            uses = [b for b in content if b.get("type") == "tool_use"]
            hit = next((b for b in uses if b.get("name") == out_tool["name"]), None)
            if hit:
                need = out_tool["input_schema"].get("required") or []
                got = hit.get("input") if isinstance(hit.get("input"), dict) else {}
                if r.get("stop_reason") == "max_tokens" and any(k not in got for k in need):
                    err = "출력이 max_tokens 에서 잘림"   # 잘린 도구 호출은 빈 입력으로 온다. 결과로 받지 않는다
                    break
                out = _fit(hit.get("input"), out_tool["input_schema"])
                if not isinstance(out, dict):
                    out, err = None, "출력이 객체가 아님"
                break
            if r.get("stop_reason") == "max_tokens":
                err = "출력 도구를 부르기 전에 max_tokens 에 닿음"
                break
            body["messages"] = body["messages"] + [{"role": "assistant", "content": content}]
            if r.get("stop_reason") == "pause_turn":
                continue
            if uses:   # client 도구 실행 결과를 돌려준다
                res = []
                for b in uses:
                    fn = next((t[1] for t in client if t[0]["name"] == b.get("name")), None)
                    try:
                        val = fn(b.get("input") or {}) if fn else {"error": "없는 도구"}
                    except Exception as e:
                        val = {"error": str(e)[:200]}
                    text = val if isinstance(val, str) else json.dumps(val, ensure_ascii=False, default=str)
                    res.append({"type": "tool_result", "tool_use_id": b["id"], "content": text[:60000]})
                body["messages"] = body["messages"] + [{"role": "user", "content": res}]
                continue
            if nudged:
                err = "출력 도구를 부르지 않음"
                break
            nudged = True
            body["messages"] = body["messages"] + [{"role": "user", "content": f"이제 {out_tool['name']} 도구로 답하라."}]
        else:
            err = "턴 한도"
    except Exception as e:
        err = str(e)[:300]
    cost = cost_of(model, u)
    with _lock:
        RUN["cost"] += cost
    if cid is not None:
        summ = None
        try:   # 기록용 요약이 실패해도 결과는 돌려준다
            summ = summarize(agent_id, out)[:300] if out is not None else None
        except Exception as e:
            print(f"[{agent_id}#{slot}] 기록용 요약 실패:", str(e)[:160])
        _safe(lambda: c.rpc("desk_call_finish", {"p_id": cid, "p": {
            "status": "ok" if out is not None else "error", "error": err,
            "input_tokens": u["input_tokens"] + u["cache_read_input_tokens"] + u["cache_creation_input_tokens"], "output_tokens": u["output_tokens"],
            "searches": u["web_search_requests"], "cost_usd": round(cost, 5), "summary": summ,
            "output": out if out is not None and len(json.dumps(out, ensure_ascii=False)) < 60000 else None}}))
    if out is None:
        print(f"[{agent_id}#{slot}] 실패: {err}")
        return None, {**u, "error": err, "cost": cost}
    return out, {**u, "cost": cost}
