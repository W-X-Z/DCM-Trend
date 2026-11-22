"""하루 실행: 뉴스 수집 → 모니터링 → 발굴 → 조사 → 브리핑 → 검수 → 게시.

- 대상 보드(desk.leads)에 단계 결과를 붙여 둔다. 비용 상한이나 오류로 멈추면 다음 실행이 끝난 단계를 건너뛰고 이어 한다.
- 가설을 보드에 먼저 적고 나서 조사한다. 검수를 거치지 않은 1pager 는 게시되지 않는다.
- 하루 한 번만 돈다(오늘 끝났거나 도는 실행이 있으면 바로 끝난다. force 로 다시 돌린다).
"""
import concurrent.futures as cf, datetime as dt, json, os

from . import core as c, news, render, runtime as rt, tools
from .agents import AGENTS, BATCH, MAX_LEADS

REPEAT_DAYS = 14                 # 보드에 오른 회사를 다시 고르지 않는 기간
TEXT = ("headline", "need", "company", "earnings", "debt")
LISTS = ("issues", "talking_points", "angles", "unknowns")


def _j(o, cap=30000):
    s = json.dumps(o, ensure_ascii=False, default=str, separators=(",", ":"))
    return s if len(s) <= cap else s[:cap] + " …(잘림)"


def _today():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date()


def _lanes(agent_id, items, fn):
    """items 를 에이전트 인원만큼 동시에 처리한다. fn(item, slot) 의 결과를 순서대로 돌려준다."""
    n = max(1, AGENTS[agent_id]["count"])
    with cf.ThreadPoolExecutor(max_workers=n) as ex:
        return list(ex.map(lambda p: fn(p[1], p[0] % n + 1), enumerate(items)))


# ---------- 모니터링 ----------
def monitor(inp, rid):
    items, by_ref = [], {}
    for f in inp.get("filings") or []:
        it = {"ref": f["ref"], "종류": "공시", "일자": f.get("dt"), "corp_name": f.get("corp_name"), "시장": f.get("market"), "공시": f.get("label"),
              "내용": f.get("facts") or {}, "금액": render.won(f["size_krw"]) if f.get("size_krw") else None, "회사채 등급": f.get("rating"),
              "미상환 공모채": render.won(f["outstanding_bond_krw"]) if f.get("outstanding_bond_krw") else None, "사업 확장": f.get("expansion")}
        items.append({k: v for k, v in it.items() if v not in (None, {}, "")})
        by_ref[f["ref"]] = ("filing", f)
    for n in inp.get("news") or []:
        items.append({k: v for k, v in {"ref": n["ref"], "종류": "기사", "일자": n.get("dt"), "제목": n.get("title"), "요약": n.get("snippet"), "출처": n.get("source")}.items() if v})
        by_ref[n["ref"]] = ("news", n)
    if not items:
        return {"signals": 0, "read": 0}
    batches = [items[i:i + BATCH] for i in range(0, len(items), BATCH)]

    def one(batch, slot):
        try:
            out, _ = rt.call("monitor.screener", "아래 항목에서 자금 수요 신호만 남겨라.\n" + _j(batch, 60000), item=f"공시·기사 {len(batch)}건", slot=slot)
        except rt.BudgetExceeded:
            out = None
        return batch, out

    seen, rows = [], []
    for batch, out in _lanes("monitor.screener", batches, one):
        if out is None:
            continue   # 못 읽은 묶음은 본 것으로 표시하지 않는다. 다음 실행에서 다시 읽는다
        seen += [{"src_type": by_ref[b["ref"]][0], "src_ref": b["ref"]} for b in batch]
        for s in out.get("signals") or []:
            if not isinstance(s, dict) or s.get("ref") not in by_ref:
                continue   # 받은 항목에 없는 ref 는 버린다
            kind, src = by_ref[s["ref"]]
            rows.append({"src_type": kind, "src_ref": s["ref"], "src_dt": src.get("dt"), "corp_code": src.get("corp_code") or "",
                         "corp_name": (src.get("corp_name") if kind == "filing" else s.get("corp_name") or "").strip(),
                         "need": s.get("need"), "what": s.get("what"), "why": s.get("why"), "strength": s.get("strength"), "url": src.get("url")})
    names = {}
    for r in rows:   # 기사에서 나온 회사 이름을 회사 코드로 (이름이 정확히 맞을 때만)
        if not r["corp_code"] and r["corp_name"]:
            if r["corp_name"] not in names:
                hit = (c.rpc("desk_find_company", {"p_q": r["corp_name"], "p_limit": 1}) or [None])[0]
                names[r["corp_name"]] = hit["corp_code"] if hit and float(hit.get("match_score") or 0) >= 0.99 else ""
            r["corp_code"] = names[r["corp_name"]]
    if rows:
        c.rpc("desk_signals_put", {"p_run_id": rid, "p_items": rows})
    if seen:
        c.rpc("desk_seen_put", {"p_run_id": rid, "p_items": seen})
    return {"signals": len(rows), "read": len(seen)}


# ---------- 발굴 ----------
def scout(inp, rid, stat):
    sigs = c.rpc("desk_recent_signals", {"p_days": 14}) or []
    groups = {}
    for s in sigs:
        g = groups.setdefault(s.get("corp_code") or s.get("corp_name"), {"corp_code": s.get("corp_code") or "", "corp_name": s.get("corp_name"), "signals": []})
        g["signals"].append({k: s.get(k) for k in ("src_ref", "src_type", "dt", "need", "what", "why", "strength") if s.get(k) is not None})
    comps = sorted(groups.values(), key=lambda g: (-max(x.get("strength") or 1 for x in g["signals"]), -len(g["signals"])))[:50]
    rules = [{k: r.get(k) for k in ("signal_key", "corp_code", "corp_name", "label", "facts", "context", "event_dt")} for r in (inp.get("rules") or [])][:40]
    if not comps and not rules:
        return []
    board = inp.get("board") or []
    user = (f"오늘은 {_today()} 이다.\n\n[회사별 신호 (최근 14일)]\n{_j(comps)}\n\n[규칙이 뽑은 후보]\n{_j(rules, 20000)}\n\n[최근 보드 (45일)]\n{_j(board, 8000)}")
    out, _ = rt.call("scout.lead", user, item=f"신호 회사 {len(comps)} · 규칙 후보 {len(rules)}")
    if out is None:
        return []
    stat["skipped"] = str(out.get("skipped") or "")[:1500]
    known = {x["corp_code"]: x["corp_name"] for x in comps + rules if x.get("corp_code")}
    by_name = {v: k for k, v in known.items()}
    caution = {g["corp_code"] or g["corp_name"] for g in comps if any(x.get("need") == "영업 주의" for x in g["signals"])}
    cutoff = str(_today() - dt.timedelta(days=REPEAT_DAYS))
    recent = {b["corp_code"] for b in board if str(b.get("created")) >= cutoff}
    leads = []
    for ld in sorted([x for x in out.get("leads") or [] if isinstance(x, dict)], key=lambda x: x.get("priority") or 9)[:MAX_LEADS]:
        code = ld.get("corp_code") if ld.get("corp_code") in known else by_name.get((ld.get("corp_name") or "").strip(), "")
        if not code or code in recent or code in caution or ld.get("corp_name") in caution:
            print(f"발굴: {ld.get('corp_name')} 제외 ({'회사 코드 없음' if not code else '최근 보드에 있음' if code in recent else '영업 주의'})")
            continue
        recent.add(code)
        sg = [{"dt": s.get("dt"), "what": s.get("what"), "need": s.get("need"), "url": s.get("url")} for s in sigs if s.get("corp_code") == code][:6]
        sg += [{"dt": r.get("event_dt"), "what": f"{r.get('label')} ({', '.join(f'{k} {render.won(v) if isinstance(v, (int, float)) and v > 1e7 else v}' for k, v in (r.get('facts') or {}).items())})"}
               for r in rules if r.get("corp_code") == code]
        row = {"corp_code": code, "corp_name": known[code], "origin": "daily", "priority": ld.get("priority"), "need": ld.get("need"),
               "hypothesis": ld.get("hypothesis"), "signals": sg, "questions": ld.get("questions") or [], "kill": ld.get("kill"), "run_id": rid}
        row["lead_id"] = c.rpc("desk_lead_put", {"p": row})   # 가설을 보드에 먼저 적는다
        leads.append(row)
    return leads


# ---------- 조사 → 브리핑 → 검수 ----------
def _put(lid, **kw):
    c.rpc("desk_lead_put", {"p": {"lead_id": lid, "run_id": rt.RUN["id"], **kw}})


def _head(lead):
    return (f"회사: {lead['corp_name']} (corp_code {lead['corp_code']})\n가설: {lead.get('hypothesis') or 'RM 요청'}\n"
            f"확인할 질문: {_j(lead.get('questions') or [])}\n제외 조건(kill): {lead.get('kill') or '없음'}\n근거 신호: {_j(lead.get('signals') or [], 4000)}")


def _patch(brief, patches):
    for p in patches or []:
        sec = (p or {}).get("section")
        if sec in TEXT and p.get("text"):
            brief[sec] = p["text"]
        elif sec in LISTS and (p.get("items") or p.get("text")):
            brief[sec] = p.get("items") or [x.strip("-• ").strip() for x in p["text"].splitlines() if x.strip()]


def work(lead, slot=1):
    """대상 한 곳을 끝까지. 돌려주는 값은 상태(게시·보류·기각·대기)."""
    lid, req = lead["lead_id"], lead.get("origin") == "request"
    try:
        if not lead.get("dossier"):
            lead["dossier"] = tools.dossier(lead["corp_code"])
            _put(lid, dossier=lead["dossier"])
        if not lead.get("research"):
            out, _ = rt.call("research.analyst", _head(lead) + f"\n오늘은 {_today()} 이다.\n\n[데이터 묶음]\n{_j(lead['dossier'], 40000)}", item=lead["corp_name"], slot=slot, reserve=0.5)
            if out is None:
                return "대기"
            lead["research"] = out
            _put(lid, research=out)
        rs = lead["research"]
        ck = rs.get("checks") or {}
        bad = rs.get("kill_hit") or next((f"{k}: {(ck.get(k) or {}).get('note')}" for k in ("need", "access") if (ck.get(k) or {}).get("state") == "반대 증거"), None)
        if bad and not req:   # RM 이 요청한 회사는 기각하지 않고 1pager 에 그대로 적는다
            _put(lid, status="기각", note=str(bad)[:300])
            lead["note"] = str(bad)[:300]
            return "기각"
        if not lead.get("brief"):
            ds = lead["dossier"]
            data = {k: ds.get(k) for k in ("overview", "short_debt", "maturities", "deals", "financials", "comps")}
            out, _ = rt.call("brief.writer", _head(lead) + f"\n\n[조사 결과]\n{_j(rs, 24000)}\n\n[데이터 묶음]\n{_j(data, 24000)}", item=lead["corp_name"], slot=slot, reserve=0.3)
            if out is None:
                return "대기"
            lead["brief"] = out
            lead["brief_md"] = render.one_pager(lead, str(_today()))
            _put(lid, brief=out, brief_md=lead["brief_md"])
        if not lead.get("verify"):
            lead.pop("verify", None)
            md = render.one_pager(lead, str(_today()))   # 검수 담당에게는 1pager 만 준다 (작성 과정은 주지 않는다)
            out, _ = rt.call("verify.checker", f"회사: {lead['corp_name']} (corp_code {lead['corp_code']})\n오늘은 {_today()} 이다.\n\n[1pager]\n{md}", item=lead["corp_name"], slot=slot)
            if out is None:
                return "대기"
            _patch(lead["brief"], out.get("patches"))
            lead["verify"] = {k: out.get(k) for k in ("state", "fixes", "unconfirmed", "note")}
            hold = out.get("state") == "보류" and not req
            lead["brief_md"] = render.one_pager(lead, str(_today()))
            lead["note"] = str(out.get("note") or "")[:300] if hold else None
            _put(lid, verify=lead["verify"], brief=lead["brief"], brief_md=lead["brief_md"], status="보류" if hold else "게시", note=lead["note"])
            return "보류" if hold else "게시"
        return lead.get("status") or "대기"
    except rt.BudgetExceeded as e:
        print(f"[{lead['corp_name']}] 멈춤: {e}")
        return "대기"
    except Exception as e:
        print(f"[{lead['corp_name']}] 오류: {str(e)[:200]}")
        return "대기"


# ---------- 결과 내보내기 ----------
def write_out(rid, leads, stat):
    d = c.OUT / rid
    d.mkdir(parents=True, exist_ok=True)
    by = lambda st: [x for x in leads if x.get("result") == st]
    L = [f"# 딜 발굴 데스크 {_today()}\n",
         f"읽은 공시·기사 {stat.get('read', 0)}건 · 신호 {stat.get('signals', 0)}건 · 새 기사 {stat.get('news_new') if stat.get('news_new') is not None else '수집 안 함'} · 비용 ${rt.RUN['cost']:.2f} (상한 ${rt.RUN['cap']:g})\n"]
    if stat.get("stale"):
        L.append(f"\n**수집 확인 필요:** 가장 최근 공시가 {stat['stale']} 이다.\n")
    L.append("\n## 오늘 연락할 회사\n" + ("".join(f"{i}. **{x['corp_name']}**: {(x.get('brief') or {}).get('headline', '')} (검수 {(x.get('verify') or {}).get('state', '')})\n" for i, x in enumerate(by("게시"), 1)) or "없음\n"))
    if by("보류") or by("기각"):
        L.append("\n## 보류·기각\n" + "".join(f"- {x['corp_name']} ({x['result']}): {x.get('note') or ''}\n" for x in by("보류") + by("기각")))
    if by("대기"):
        L.append("\n## 대기 (다음 실행에서 이어 한다)\n" + "".join(f"- {x['corp_name']}\n" for x in by("대기")))
    if stat.get("skipped"):
        L.append("\n## 발굴팀이 고르지 않은 후보\n" + stat["skipped"] + "\n")
    summary = "".join(L)
    (d / "summary.md").write_text(summary, encoding="utf-8")
    for x in by("게시"):
        (d / f"{x['corp_name'].replace('/', '_')}.md").write_text(x.get("brief_md") or "", encoding="utf-8")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(summary + "".join("\n---\n\n" + (x.get("brief_md") or "") for x in by("게시")))
    print(summary)
    return d


def _run(kind, body):
    rid = rt.start_run(kind)
    stat, leads, status = {}, [], "done"
    try:
        leads = body(rid, stat)
        for ld, res in zip(leads, _lanes("research.analyst", leads, work)):
            ld["result"] = res
        if any(x["result"] == "대기" for x in leads):
            status = "partial"
    except rt.BudgetExceeded as e:
        status, stat["error"] = "partial", str(e)
    except Exception as e:
        status, stat["error"] = "failed", str(e)[:300]
        raise
    finally:
        for x in leads:
            x.setdefault("result", "대기")
        stat["leads"] = [{"corp_name": x["corp_name"], "result": x["result"]} for x in leads]
        rt.finish_run(status, stat)
        write_out(rid, leads, stat)
    return {"run_id": rid, "status": status, "stat": stat, "leads": leads}


def daily(days=3, force=False):
    if not force and c.rpc("desk_ran_today", {"p_kind": "daily"}):
        print("오늘 이미 끝났거나 도는 실행이 있다. 다시 돌리려면 force.")
        return None

    def body(rid, stat):
        try:
            stat["news_new"] = news.collect(days)
        except Exception as e:   # 뉴스가 안 돼도 공시만으로 돈다
            print("뉴스 수집 실패:", str(e)[:160])
            stat["news_new"] = None
        inp = c.rpc("desk_inputs", {"p_days": days}) or {}
        last = str((inp.get("data") or {}).get("latest_filing_dt") or "")
        if last and last < str(_today() - dt.timedelta(days=4)):
            stat["stale"] = last
        stat.update(monitor(inp, rid))
        carry = c.rpc("desk_open_leads") or []   # 지난 실행에서 끝내지 못한 대상부터
        return carry + scout(inp, rid, stat)

    return _run("daily", body)


def brief_for(q):
    """RM 이 회사를 지정한 경우: 발굴을 건너뛰고 그 회사의 1pager 를 만든다."""
    q = q.strip()
    hit = (c.rpc("desk_find_company", {"p_q": q, "p_limit": 1}) or [None])[0]
    if not hit:
        raise SystemExit(f"회사를 찾지 못함: {q}")

    def body(rid, stat):
        row = {"corp_code": hit["corp_code"], "corp_name": hit["corp_name"], "origin": "request", "priority": 1,
               "hypothesis": "RM 요청: 미팅 준비. 자금 수요가 될 만한 것을 데이터에서 찾는다.", "signals": [], "questions": [], "kill": "", "run_id": rid}
        row["lead_id"] = c.rpc("desk_lead_put", {"p": row})
        return [row]

    return _run("brief", body)
