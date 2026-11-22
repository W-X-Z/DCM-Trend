"""시험용 가짜 서버 셋: Supabase RPC(public.desk_*), Anthropic Messages API, OpenDART.

실제 키 없이 부서의 흐름(저장, 이어 하기, 비용 상한, 도구 호출)을 끝까지 돌려 보기 위한 것이다. 모델의 답은 대본(script)으로 정한다.
"""
import copy, datetime as dt, json, re, threading, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

FX = json.loads((Path(__file__).parent / "fixtures" / "inputs_20261120.json").read_text(encoding="utf-8"))


def _serve(handler):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


class _H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")


# ---------- Supabase ----------
class Supabase:
    def __init__(self):
        self.runs, self.calls, self.seen, self.signals, self.leads, self.news = {}, [], set(), [], [], []
        self.lock = threading.Lock()
        me = self

        class H(_H):
            def do_POST(self):
                fn = self.path.rsplit("/", 1)[-1]
                with me.lock:
                    try:
                        self._send(getattr(me, fn)(**self._body()))
                    except Exception as e:
                        self._send({"message": str(e)}, 400)
        self.srv, self.url = _serve(H)

    def desk_run_start(self, p_run_id, p_kind="daily"):
        self.runs[p_run_id] = {"kind": p_kind, "status": "running", "day": dt.date.today()}
        return p_run_id

    def desk_run_finish(self, p_run_id, p_status, p_cost, p_summary=None):
        self.runs[p_run_id].update(status=p_status, cost=p_cost, summary=p_summary)

    def desk_ran_today(self, p_kind="daily"):
        return any(r["kind"] == p_kind and r["status"] in ("done", "running") for r in self.runs.values())

    def desk_call_start(self, p):
        self.calls.append(dict(p))
        return len(self.calls)

    def desk_call_finish(self, p_id, p):
        self.calls[p_id - 1].update(p)

    def desk_news_queries(self):
        return [{"query": "신규 시설투자 결정", "grp": "투자·증설"}]

    def desk_news_put(self, p_items):
        self.news += p_items
        return len(p_items)

    def desk_inputs(self, p_days=3, **kw):
        inp = copy.deepcopy(FX["inputs"])
        inp["filings"] = [f for f in inp["filings"] if ("filing", f["ref"]) not in self.seen]
        inp["news"] = [n for n in inp["news"] if ("news", n["ref"]) not in self.seen]
        inp["board"] = [{"lead_id": l["lead_id"], "corp_code": l["corp_code"], "corp_name": l["corp_name"], "status": l["status"],
                         "hypothesis": l.get("hypothesis"), "created": str(dt.date.today())} for l in self.leads]
        return inp

    def desk_seen_put(self, p_run_id, p_items):
        self.seen |= {(x["src_type"], x["src_ref"]) for x in p_items}

    def desk_signals_put(self, p_run_id, p_items):
        self.signals += p_items
        return len(p_items)

    def desk_recent_signals(self, p_days=14):
        return [{**s, "dt": s.get("src_dt")} for s in self.signals]

    def desk_find_company(self, p_q, p_limit=5):
        names = {v["overview"]["corp_name"]: k for k, v in FX["companies"].items()}
        return [{"corp_code": names[p_q], "corp_name": p_q, "match_score": 1}] if p_q in names else []

    def desk_company(self, p_corp_code):
        return copy.deepcopy(FX["companies"].get(p_corp_code) or {"overview": None})

    def desk_comps(self, p_corp_code, **kw):
        return copy.deepcopy(FX["comps"])

    def desk_lead_put(self, p):
        if not p.get("lead_id"):
            row = {**p, "lead_id": len(self.leads) + 1, "status": p.get("status") or "대기"}
            self.leads.append(row)
            return row["lead_id"]
        row = next(l for l in self.leads if l["lead_id"] == p["lead_id"])
        row.update({k: v for k, v in p.items() if k in ("status", "dossier", "research", "brief", "brief_md", "verify", "note", "run_id") and (v is not None or k == "note")})
        return row["lead_id"]

    def desk_open_leads(self):
        return copy.deepcopy([l for l in self.leads if l["status"] == "대기"])


# ---------- Anthropic ----------
class Anthropic:
    """출력 도구 이름별 대본으로 답한다. script[도구](요청 본문) → 도구 입력(dict) 또는 {'_raw': 응답 전체}."""

    def __init__(self, script, usage=None):
        self.script, self.requests = script, []
        self.usage = usage or {}
        me = self

        class H(_H):
            def do_POST(self):
                body = self._body()
                me.requests.append(body)
                tool = body["tools"][0]["name"]
                u = {"input_tokens": 10000, "output_tokens": 1000, **me.usage.get(tool, {})}
                msgs = body["messages"]
                # 조사 담당: 첫 턴에는 client 도구(dart_filings)를 한 번 부르게 해서 도구 왕복을 시험한다
                if tool == "research" and len(msgs) == 1:
                    code = re.search(r"corp_code (\d{8})", msgs[0]["content"]).group(1)
                    return self._send({"content": [{"type": "tool_use", "id": "t1", "name": "dart_filings", "input": {"corp_code": code}}],
                                       "stop_reason": "tool_use", "usage": u})
                out = me.script[tool](body)
                if isinstance(out, dict) and "_raw" in out:
                    return self._send({**out["_raw"], "usage": u})
                self._send({"content": [{"type": "tool_use", "id": "out", "name": tool, "input": out}], "stop_reason": "tool_use", "usage": u})
        self.srv, self.url = _serve(H)

    def count(self, tool):
        return sum(1 for r in self.requests if r["tools"][0]["name"] == tool and len(r["messages"]) == 1)


def first_text(body):
    m = body["messages"][0]["content"]
    return m if isinstance(m, str) else json.dumps(m, ensure_ascii=False)


# ---------- OpenDART ----------
def statement(year, code):
    """형식 시험용 재무제표(실제 회사 수치가 아니다). 분기 매출 100억씩, 3분기 누적·연간이 맞게 만든다."""
    q = {"11013": 1, "11012": 2, "11014": 3, "11011": 4}[code]
    e8 = 100_000_000
    rev3, cum = 100 * e8, 100 * e8 * q
    row = lambda sj, aid, nm, cur, add="": {"sj_div": sj, "account_id": aid, "account_nm": nm, "thstrm_amount": f"{cur:,}", "thstrm_add_amount": f"{add:,}" if add != "" else ""}
    is_cur, is_add = (cum, "") if code in ("11011", "11013") else (rev3, cum)
    return [
        row("IS", "ifrs-full_Revenue", "매출액", is_cur, is_add),
        row("IS", "dart_OperatingIncomeLoss", "영업이익(손실)", is_cur // 10, is_add // 10 if is_add != "" else ""),
        row("CIS", "ifrs-full_ProfitLoss", "분기순이익(손실)", -(is_cur // 20), -(is_add // 20) if is_add != "" else ""),
        row("BS", "ifrs-full_CashAndCashEquivalents", "현금및현금성자산", 50 * e8),
        row("BS", "-표준계정코드 미사용-", "단기차입금", 400 * e8),
        row("BS", "-표준계정코드 미사용-", "유동성전환사채", 700 * e8),
        row("BS", "-표준계정코드 미사용-", "장기차입금", 300 * e8),
        row("BS", "-표준계정코드 미사용-", "사채할인발행차금", -5 * e8),
        row("BS", "ifrs-full_Liabilities", "부채총계", 2000 * e8),
        row("BS", "ifrs-full_Equity", "자본총계", 1000 * e8),
    ]


class Dart:
    def __init__(self, missing=()):
        self.paths, self.missing = [], set(missing)
        me = self

        class H(_H):
            def do_GET(self):
                u = urllib.parse.urlparse(self.path)
                q = dict(urllib.parse.parse_qsl(u.query))
                me.paths.append((u.path, q))
                if u.path.endswith("list.json"):
                    return self._send({"status": "000", "list": [{"rcept_dt": "20261120", "report_nm": "단기차입금증가결정", "flr_nm": "시험", "rcept_no": "20261120800930"}]})
                if q.get("fs_div") == "CFS" and "no_cfs" in me.missing or (int(q["bsns_year"]), q["reprt_code"]) in me.missing:
                    return self._send({"status": "013", "message": "조회된 데이타가 없습니다."})
                self._send({"status": "000", "list": statement(int(q["bsns_year"]), q["reprt_code"])})
        self.srv, self.url = _serve(H)


# ---------- 뉴스 검색 API ----------
class News:
    def __init__(self, payload):
        self.seen = []
        me = self

        class H(_H):
            def do_GET(self):
                me.seen.append((dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query)), {k.lower(): v for k, v in self.headers.items()}))
                self._send(payload)
        self.srv, self.url = _serve(H)
