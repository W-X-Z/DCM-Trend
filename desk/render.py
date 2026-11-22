"""1pager 본문(마크다운) 조립. 표는 데이터 묶음에서 코드가 그리고, 글 칸만 브리핑 담당이 쓴 것을 넣는다."""
import datetime as dt


def won(v):
    if v is None or v == "":
        return "–"
    eok = float(v) / 1e8
    if abs(eok) >= 10000:
        return f"{eok / 10000:.1f}조"
    return f"{eok:,.0f}억"


def _d(v):
    return str(v or "")[:10].replace("-", ".") or "–"


def _table(head, rows):
    if not rows:
        return ""
    return "\n".join(["| " + " | ".join(head) + " |", "|" + "---|" * len(head)] + ["| " + " | ".join(str(x) for x in r) + " |" for r in rows]) + "\n"


def _s(x):
    if isinstance(x, dict):   # 목록 자리에 객체가 오면 값만 이어 붙인다
        return " ".join(str(v).strip() for v in x.values() if v not in (None, "", [], {}))
    return str(x).strip()


def _lines(xs):
    if isinstance(xs, str):
        return xs.strip() + "\n" if xs.strip() else ""
    return "".join(f"- {_s(x)}\n" for x in (xs or []) if _s(x))


def _terms(d):
    t = []
    if d.get("rating"):
        t.append(d["rating"])
    if d.get("tenor_months"):
        t.append(f"{d['tenor_months'] / 12:g}년")
    if d.get("yield_pct") is not None:
        t.append(f"발행금리 {d['yield_pct']}%")
    elif d.get("coupon_pct") is not None:
        t.append(f"표면 {d['coupon_pct']}%")
    if d.get("ytm_pct") is not None:
        t.append(f"만기보장 {d['ytm_pct']}%")
    if d.get("competition_ratio") is not None:
        t.append(f"경쟁률 {d['competition_ratio']}배")
    if d.get("final_spread_bp") is not None:
        t.append(f"가산 {d['final_spread_bp']:+g}bp")
    if d.get("refix_floor_ratio_pct") is not None:
        t.append(f"리픽싱 하한 {d['refix_floor_ratio_pct']}%")
    if d.get("put_start_dt"):
        t.append(f"풋 {_d(d['put_start_dt'])}~")
    if d.get("shares_ratio_pct") is not None:
        t.append(f"신주 비율 {d['shares_ratio_pct']}%")
    return ", ".join(t) or "–"


def one_pager(lead, asof=None):
    """lead: desk.leads 한 줄(dict). brief(글 칸), dossier(데이터), research, verify 를 읽는다."""
    b, ds, rs, vf = lead.get("brief") or {}, lead.get("dossier") or {}, lead.get("research") or {}, lead.get("verify") or {}
    ov, fin = ds.get("overview") or {}, ds.get("financials") or {}
    asof = asof or dt.date.today().isoformat()
    meta = [f"기준일 {_d(asof)}", ov.get("market") or "", f"회사채 등급 {ov['latest_bond_rating']}" if ov.get("latest_bond_rating") else "",
            f"검수 {vf['state']}" if vf.get("state") else "검수 전"]
    md = [f"# {lead.get('corp_name')} 미팅 1pager\n", f"**{b.get('headline', '').strip()}**\n", " · ".join(x for x in meta if x) + "\n"]

    md.append("\n## 왜 지금\n" + _lines(b.get("need")))
    sig = [f"{_d(s.get('dt'))} {s.get('what') or s.get('label') or ''}" + (f" ([원문]({s['url']}))" if s.get("url") else "") for s in (lead.get("signals") or []) if isinstance(s, dict)]
    if sig:
        md.append("\n근거 신호\n" + _lines(sig))

    md.append("\n## 회사\n" + _lines(b.get("company")))

    md.append("\n## 최근 실적\n")
    qs = fin.get("quarters") or []
    if qs:
        md.append(f"{fin.get('basis', '')} 기준\n\n" + _table(["분기", "매출", "영업이익", "순이익"],
                  [[q["period"] + ("*" if q.get("derived") else ""), won(q.get("revenue")), won(q.get("op")), won(q.get("ni"))] for q in qs[:5]]))
        if any(q.get("derived") for q in qs[:5]):
            md.append("\\* 연간에서 3분기 누적을 뺀 값\n")
    else:
        md.append(f"재무 자료 없음 ({fin.get('error', '미수집')})\n")
    md.append("\n" + _lines(b.get("earnings")))

    md.append("\n## 차입과 만기\n")
    bal, sd = fin.get("balance") or {}, ds.get("short_debt") or {}
    facts = []
    if bal:
        facts.append(f"{bal.get('as_of')} 말: 현금성자산 {won(bal.get('cash'))}, 차입 계정 합계 {won(bal.get('borrowings_sum'))}"
                     + (f", 부채비율 {bal['debt_ratio_pct']}%" if bal.get("debt_ratio_pct") is not None else ""))
    if sd.get("total_1y_krw"):
        parts = [f"{k} {won(sd[c])}" for k, c in (("사채", "bond_1y_krw"), ("CP", "cp_1y_krw"), ("전단채", "stb_krw")) if sd.get(c)]
        if sd.get("bond_private_1y_krw") and parts and parts[0].startswith("사채"):
            parts[0] += f"(사모 {won(sd['bond_private_1y_krw'])} 포함)"
        facts.append(f"1년 내 만기 채무증권 {won(sd['total_1y_krw'])} ({', '.join(parts)}; {_d(sd.get('stlm_dt'))} 정기보고서)")
    md.append(_lines(facts))
    md.append("\n" + _table(["일자", "구분", "금액", "비고"], [[_d(m.get("event_dt")), f"{m.get('product', '')} {m.get('sub_type') or ''} {m.get('event', '')}".strip(), won(m.get("amount_krw")),
              ", ".join(x for x in [m.get("rating"), f"주관 {m['lead_managers']}" if m.get("lead_managers") else "", "차환 신고서 있음" if m.get("refi_signal") else ""] if x) or "–"]
              for m in (ds.get("maturities") or [])[:8]]))
    md.append("\n" + _lines(b.get("debt")))

    deals = ds.get("deals") or []
    if deals:
        md.append("\n## 조달 이력" + (" (최근 8건)" if len(deals) > 8 else "") + "\n" + _table(["일자", "상품", "금액", "조건", "대표주관"],
                  [[_d(d.get("deal_dt")), f"{d.get('product', '')} {d.get('sub_type') or ''}".strip(), won(d.get("amount_krw")), _terms(d),
                    (d.get("lead_managers") or "–") + (" (NH)" if d.get("nh_lead") and "NH" not in (d.get("lead_managers") or "") else "")] for d in deals[:8]]))

    md.append("\n## 최근 이슈\n" + _lines(b.get("issues")))

    cp = ds.get("comps") or {}
    rows = [[_d(d.get("deal_dt")), d.get("corp_name"), won(d.get("amount_krw")), _terms(d)] for d in (cp.get("bonds") or [])[:8]] \
        or [[_d(d.get("deal_dt")), f"{d.get('corp_name')} ({d.get('sub_type') or '유상증자'})", won(d.get("amount_krw")), _terms(d)]
            for d in ((cp.get("mezz") or [])[:6] + (cp.get("equity") or [])[:3])]
    if rows:
        md.append(f"\n## 유사 사례\n{cp.get('basis', '')}\n\n" + _table(["일자", "회사", "금액", "조건"], rows))

    md.append("\n## 미팅 토킹포인트\n" + "".join(f"{i}. {_s(x)}\n" for i, x in enumerate(b.get("talking_points") or [], 1)))
    if b.get("angles"):
        md.append("\n## 검토할 수 있는 방향\n" + _lines(b.get("angles")))
    if b.get("unknowns"):
        md.append("\n## 확인하지 못한 것\n" + _lines(b.get("unknowns")))

    if vf:
        md.append(f"\n## 검수\n{vf.get('state', '')}: {vf.get('note', '')}\n")
        md.append(_lines([((f"{f['item']}: " if f.get("item") else "") + str(f.get("finding") or f.get("_text") or "") + (f" ({f['source']})" if f.get("source") else "")) if isinstance(f, dict) else _s(f)
                          for f in vf.get("fixes") or []]))
        if vf.get("unconfirmed"):
            md.append("확인 못 한 항목: " + "; ".join(_s(x) for x in vf["unconfirmed"]) + "\n")

    src = [f"[{s.get('title') or s['url']}]({s['url']})" for s in (rs.get("sources") or []) if isinstance(s, dict) and s.get("url")]
    md.append("\n## 출처\n" + _lines(["공시 DB(OpenDART 수집분), OpenDART 재무제표"] + src[:12]))
    md.append("\n공개 자료만으로 만든 초안이다. 미팅 전에 숫자와 일정을 확인한다.\n")
    return "".join(md)
