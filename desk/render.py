"""RM 이 읽는 1pager(마크다운)와 근거 자료 조립.

- one_pager: 한 장. 판단 한 줄 + 자금 수요 · 당사 주관 이력 · 미팅 아젠다 · 최근 동향 · 확인 필요 사항. 표 없음.
- detail: 근거 자료(분기 실적 · 차입 및 만기 · 조달 이력 · 동일 등급 발행 사례 · 출처). 화면에서 접어 둔다.
당사 주관 이력과 표는 공시 자료에서 코드가 만든다. 글은 브리핑 담당이 쓴 것을 줄 수 상한 안에서 넣는다."""
import datetime as dt, re

from .agents import CALLS, LIMITS


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
        t.append(f"경쟁률 {d['competition_ratio']}:1")
    if d.get("final_spread_bp") is not None:
        t.append(f"확정 가산금리 {d['final_spread_bp']:+g}bp")
    if d.get("refix_floor_ratio_pct") is not None:
        t.append(f"리픽싱 하한 {d['refix_floor_ratio_pct']}%")
    if d.get("put_start_dt"):
        t.append(f"조기상환 {_d(d['put_start_dt'])}~")
    if d.get("shares_ratio_pct") is not None:
        t.append(f"신주 비율 {d['shares_ratio_pct']}%")
    return ", ".join(t) or "–"


# RM 이 읽는 글에 들어가면 안 되는 작업 과정의 말. 들어 있으면 검증 담당에게 고치게 한다
JARGON = ("가설", "kill", "신호", "검수", "반대 증거", "제외 조건", "데이터 묶음", "공시 DB", "토킹포인트")


def jargon(text):
    low = str(text or "").lower()
    return [w for w in JARGON if w.lower() in low]


def _mgrs(v):
    return [x.strip() for x in re.split(r"[,·/]", v or "") if x.strip()] if isinstance(v, str) else [str(x).strip() for x in (v or []) if x]


def _is_nh(name):
    return "NH" in name.upper() or "엔에이치" in name


def _ym(v):
    return str(v or "")[:7].replace("-", ".")


def nh_lines(ds, today=None):
    """당사 주관 이력 · 주관사단. 조달 이력과 만기 목록(공시 자료)에서 계산한다."""
    today = str(today or dt.date.today())
    by = {}
    for d in ds.get("deals") or []:
        if d.get("deal_dt"):
            by.setdefault(str(d["deal_dt"])[:10], []).append(d)
    days = sorted(by, reverse=True)[:5]
    if not days:
        return ["공모 조달 이력 없음"]
    mg = {day: sorted({m for d in by[day] for m in _mgrs(d.get("lead_managers"))}) for day in days}
    nh = [day for day in days if any(d.get("nh_lead") for d in by[day]) or any(_is_nh(m) for m in mg[day])]
    L = [f"최근 {len(days)}회 발행 중 {len(nh)}회 대표주관 참여({', '.join(_ym(x) for x in nh)})" if nh else f"최근 {len(days)}회 발행 중 당사 대표주관 이력 없음"]
    limit = str(dt.date.fromisoformat(today) + dt.timedelta(days=365))
    due = [m for m in ds.get("maturities") or [] if today <= str(m.get("event_dt") or "")[:10] <= limit and any(_is_nh(x) for x in _mgrs(m.get("lead_managers")))]
    if due:
        L.append(f"12개월 내 만기 도래분 중 당사 주관 회차 {won(sum(float(m.get('amount_krw') or 0) for m in due))}원({len(due)}건)")
    cnt = {}
    for day in days:
        for m in mg[day]:
            if not _is_nh(m):
                cnt[m] = cnt.get(m, 0) + 1
    top = sorted(cnt, key=lambda k: (-cnt[k], k))[:4]
    if top:
        L.append(f"주요 주관사(최근 {len(days)}회 발행): " + " · ".join(f"{m} {cnt[m]}회" for m in top))
    return L


def _cut(xs, key):
    xs = [xs] if isinstance(xs, str) else (xs or [])
    return [_s(x).lstrip("-•· ").strip() for x in xs if _s(x)][:LIMITS[key]]


def one_pager(lead, asof=None):
    """RM 이 미팅 전에 읽는 한 장. lead: desk.leads 한 줄(dict) — brief(글), dossier(공시 자료)."""
    b, ds = lead.get("brief") or {}, lead.get("dossier") or {}
    ov = ds.get("overview") or {}
    asof = asof or dt.date.today().isoformat()
    call = b.get("call") if b.get("call") in CALLS else CALLS[1]
    meta = [ov.get("latest_bond_rating") or "", ov.get("market") or "", f"기준일 {_d(asof)}", "공개 자료 기준"]
    md = [f"# {lead.get('corp_name')}\n", " · ".join(x for x in meta if x) + "\n", f"\n**{call}** | {_s(b.get('headline') or b.get('call_reason') or '')}\n"]

    def block(title, lines, numbered=False):
        if lines:
            md.append(f"\n## {title}\n" + "".join((f"{i}. " if numbered else "- ") + x + "\n" for i, x in enumerate(lines, 1)))

    block("자금 수요", _cut(b.get("funding"), "funding"))
    block("당사 주관 이력", b.get("nh") or nh_lines(ds, asof))
    block("미팅 아젠다", _cut(b.get("agenda"), "agenda"), numbered=True)
    if _s(b.get("reference") or "") and (b.get("agenda") or []):
        md.append(f"- 참고 사례: {_s(b['reference'])}\n")
    block("최근 동향", _cut(b.get("recent"), "recent"))
    block("확인 필요 사항", _cut(b.get("open_items"), "open_items"))
    return "".join(md)


def detail(lead):
    """근거 자료. 1pager 에서 뺀 표와 출처를 모은다(화면에서 접어 둔다)."""
    ds, rs = lead.get("dossier") or {}, lead.get("research") or {}
    fin, md = ds.get("financials") or {}, []
    qs = fin.get("quarters") or []
    if qs:
        md.append(f"## 분기 실적\n{fin.get('basis', '')} 기준\n\n" + _table(["분기", "매출", "영업이익", "순이익"],
                  [[q["period"] + ("*" if q.get("derived") else ""), won(q.get("revenue")), won(q.get("op")), won(q.get("ni"))] for q in qs[:5]]))
        if any(q.get("derived") for q in qs[:5]):
            md.append("\\* 연간 실적에서 3분기 누적을 차감\n")
    bal, sd, facts = fin.get("balance") or {}, ds.get("short_debt") or {}, []
    if bal:
        facts.append(f"{bal.get('as_of')} 말 현금성자산 {won(bal.get('cash'))}, 차입금 {won(bal.get('borrowings_sum'))}"
                     + (f", 부채비율 {bal['debt_ratio_pct']}%" if bal.get("debt_ratio_pct") is not None else ""))
    if sd.get("total_1y_krw"):
        parts = [f"{k} {won(sd[c])}" for k, c in (("사채", "bond_1y_krw"), ("CP", "cp_1y_krw"), ("전단채", "stb_krw")) if sd.get(c)]
        if sd.get("bond_private_1y_krw") and parts and parts[0].startswith("사채"):
            parts[0] += f"(사모 {won(sd['bond_private_1y_krw'])} 포함)"
        facts.append(f"1년 내 만기 채무증권 {won(sd['total_1y_krw'])}({', '.join(parts)}; {_d(sd.get('stlm_dt'))} 정기보고서)")
    mats = [[_d(m.get("event_dt")), f"{m.get('product', '')} {m.get('sub_type') or ''} {m.get('event', '')}".strip(), won(m.get("amount_krw")),
             ", ".join(x for x in [m.get("rating"), f"주관 {m['lead_managers']}" if m.get("lead_managers") else "", "차환 신고서 제출" if m.get("refi_signal") else ""] if x) or "–"]
            for m in (ds.get("maturities") or [])[:8]]
    if facts or mats:
        md.append("\n## 차입 및 만기\n" + _lines(facts) + ("\n" + _table(["일자", "구분", "금액", "비고"], mats) if mats else ""))
    deals = ds.get("deals") or []
    if deals:
        md.append("\n## 조달 이력" + (" (최근 8건)" if len(deals) > 8 else "") + "\n" + _table(["일자", "상품", "금액", "조건", "대표주관"],
                  [[_d(d.get("deal_dt")), f"{d.get('product', '')} {d.get('sub_type') or ''}".strip(), won(d.get("amount_krw")), _terms(d),
                    (d.get("lead_managers") or "–") + (" (NH)" if d.get("nh_lead") and "NH" not in (d.get("lead_managers") or "") else "")] for d in deals[:8]]))
    cp = ds.get("comps") or {}
    rows = [[_d(d.get("deal_dt")), d.get("corp_name"), won(d.get("amount_krw")), _terms(d)] for d in (cp.get("bonds") or [])[:8]] \
        or [[_d(d.get("deal_dt")), f"{d.get('corp_name')} ({d.get('sub_type') or '유상증자'})", won(d.get("amount_krw")), _terms(d)]
            for d in ((cp.get("mezz") or [])[:6] + (cp.get("equity") or [])[:3])]
    if rows:
        md.append(f"\n## 동일 등급 발행 사례\n{cp.get('basis', '')}\n\n" + _table(["일자", "회사", "금액", "조건"], rows))
    sig = [f"{_d(s.get('dt'))} {s.get('what') or s.get('label') or ''}" + (f" ([원문]({s['url']}))" if s.get("url") else "") for s in (lead.get("signals") or []) if isinstance(s, dict)]
    if sig:
        md.append("\n## 관련 공시·기사\n" + _lines(sig))
    src = [f"[{s.get('title') or s['url']}]({s['url']})" for s in (rs.get("sources") or []) if isinstance(s, dict) and s.get("url")]
    md.append("\n## 출처\n" + _lines(["금융감독원 전자공시(DART), OpenDART 재무제표"] + src[:12]))
    return "".join(md).lstrip("\n")
