"""에이전트가 쓰는 도구와 조사 데이터 묶음: 재무(OpenDART 전체 재무제표), 공시 목록, 공시 DB, 계산."""
import ast, datetime as dt, operator, re

from . import core as c

# ---------- 계산 ----------
_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv, ast.Pow: operator.pow,
        ast.USub: operator.neg, ast.UAdd: operator.pos, ast.Mod: operator.mod, ast.FloorDiv: operator.floordiv}


def calc(expr):
    def ev(n):
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            return n.value
        if isinstance(n, ast.BinOp) and type(n.op) in _OPS:
            if isinstance(n.op, ast.Pow) and abs(ev(n.right)) > 100:
                raise ValueError("지수가 너무 크다")
            return _OPS[type(n.op)](ev(n.left), ev(n.right))
        if isinstance(n, ast.UnaryOp) and type(n.op) in _OPS:
            return _OPS[type(n.op)](ev(n.operand))
        raise ValueError("숫자와 + - * / ** % // 괄호만 쓸 수 있다")
    return ev(ast.parse(str(expr).replace(",", ""), mode="eval"))


# ---------- 재무 ----------
# 보고서 코드: 1분기 11013, 반기 11012, 3분기 11014, 사업 11011. 12월 결산 기준으로 최신부터 거슬러 올라가며 받는다.
_REPORTS = (("11011", 12, "4Q"), ("11014", 9, "3Q"), ("11012", 6, "2Q"), ("11013", 3, "1Q"))
_IS = {
    "revenue": (("ifrs-full_Revenue",), ("매출액", "수익(매출액)", "영업수익", "매출", "매출액(영업수익)")),
    "op": (("dart_OperatingIncomeLoss",), ("영업이익", "영업이익(손실)", "영업손익", "영업손실")),
    "ni": (("ifrs-full_ProfitLoss",), ("당기순이익", "당기순이익(손실)", "분기순이익", "분기순이익(손실)", "반기순이익", "반기순이익(손실)", "당기순손익", "당기순손실")),
}
_BS = {
    "cash": (("ifrs-full_CashAndCashEquivalents",), ("현금및현금성자산",)),
    "assets": (("ifrs-full_Assets",), ("자산총계",)),
    "liabilities": (("ifrs-full_Liabilities",), ("부채총계",)),
    "equity": (("ifrs-full_Equity",), ("자본총계",)),
}
_DEBT = re.compile(r"차입금|사채|유동성장기부채")
_NOT_DEBT = re.compile(r"충당|할인|이자|상환할증|자산|파생|전환권|조정|대여|미수")


def _amt(s):
    s = (s or "").replace(",", "").strip()
    return int(s) if re.fullmatch(r"-?\d+", s) else None


def _nm(s):
    return re.sub(r"^[\sⅠ-Ⅻ\d\.\-·]+", "", (s or "")).replace(" ", "")


def _find(rows, spec, divs):
    ids, names = spec
    for div in divs:   # 손익계산서(IS)를 먼저, 없으면 포괄손익계산서(CIS)
        for r in rows:
            if r.get("sj_div") == div and (r.get("account_id") in ids or _nm(r.get("account_nm")) in names):
                return r
    return None


def _candidates(today):
    out = []
    for y in (today.year, today.year - 1, today.year - 2):
        for code, month, q in _REPORTS:
            if dt.date(y, month, 28) < today:   # 기간이 끝난 보고서만 시도 (아직 안 냈으면 013 → 다음으로)
                out.append((y, code, q))
    return out


def _parse(rows, year, code, q):
    is_ = {}
    for k, spec in _IS.items():
        r = _find(rows, spec, ("IS", "CIS"))
        if r:
            cur, add = _amt(r.get("thstrm_amount")), _amt(r.get("thstrm_add_amount"))
            # 사업보고서: thstrm = 연간. 1분기: thstrm = 3개월 = 누적. 반기·3분기: thstrm = 3개월, thstrm_add = 누적
            is_[k] = {"q": None if code == "11011" else cur, "cum": cur if code in ("11011", "11013") else add}
    bs = {k: _amt(r.get("thstrm_amount")) for k, spec in _BS.items() if (r := _find(rows, spec, ("BS",)))}
    debt = {}
    for r in rows:
        nm = _nm(r.get("account_nm"))
        if r.get("sj_div") == "BS" and _DEBT.search(nm) and not _NOT_DEBT.search(nm) and (v := _amt(r.get("thstrm_amount"))):
            debt[nm] = v
    return {"year": year, "code": code, "period": f"{year}.{q}", "is": is_, "bs": bs, "debt": debt}


def financials(corp_code, today=None, want=5):
    """최근 분기 실적(매출·영업이익·순이익)과 가장 최근 분기 말의 현금·차입·부채비율. 단위 원.
    4분기 값은 사업보고서 연간에서 3분기 누적을 빼서 구한다(derived)."""
    today = today or dt.date.today()
    reps, fs, tried = [], None, 0
    try:
        for y, code, q in _candidates(today):
            if len(reps) >= want or tried >= want + 3:
                break
            tried += 1
            r = None
            for div in ([fs] if fs else ["CFS", "OFS"]):   # 연결이 없으면 별도
                r = c.dart("fnlttSinglAcntAll.json", corp_code=corp_code, bsns_year=y, reprt_code=code, fs_div=div)
                if r:
                    fs = div
                    break
            if r:
                reps.append(_parse(r.get("list") or [], y, code, q))
            elif reps:
                break   # 중간에 빠진 보고서가 있으면 거기서 멈춘다 (분기 순서가 어긋난다)
    except Exception as e:
        if not reps:
            return {"error": f"재무 자료를 못 구함: {str(e)[:120]}"}
    if not reps:
        return {"error": "OpenDART 재무제표 없음(비상장·미제출)"}
    quarters = []
    for i, rp in enumerate(reps):
        row, derived = {"period": rp["period"]}, False
        for k in _IS:
            v = (rp["is"].get(k) or {}).get("q")
            if rp["code"] == "11011":   # 4분기 = 연간 - 같은 해 3분기 누적
                prev = next((x for x in reps[i + 1:] if x["year"] == rp["year"] and x["code"] == "11014"), None)
                ann, cum = (rp["is"].get(k) or {}).get("cum"), ((prev or {}).get("is", {}).get(k) or {}).get("cum")
                v, derived = (ann - cum if ann is not None and cum is not None else None), True
            row[k] = v
        if derived:
            row["derived"] = True
        if any(row.get(k) is not None for k in _IS):
            quarters.append(row)
    last = reps[0]
    bs, debt = last["bs"], last["debt"]
    debt_sum = sum(debt.values()) if debt else None
    bal = {"as_of": last["period"], **bs, "borrowings": debt, "borrowings_sum": debt_sum}
    if bs.get("liabilities") is not None and bs.get("equity"):
        bal["debt_ratio_pct"] = round(bs["liabilities"] / bs["equity"] * 100, 1)
    if debt_sum is not None and bs.get("cash") is not None:
        bal["net_debt"] = debt_sum - bs["cash"]
    return {"basis": "연결" if fs == "CFS" else "별도", "unit": "원", "quarters": quarters, "balance": bal,
            "notes": ["차입 합계는 재무상태표에서 계정 이름이 차입금·사채·유동성장기부채인 줄을 더한 값이다(합계 계정이 따로 있으면 겹칠 수 있다)",
                      "4분기는 연간에서 3분기 누적을 뺀 값이다"]}


# ---------- 공시 목록 ----------
def dart_filings(corp_code, days=180):
    end = dt.date.today()
    try:
        r = c.dart("list.json", corp_code=corp_code, bgn_de=(end - dt.timedelta(days=int(days or 180))).strftime("%Y%m%d"),
                   end_de=end.strftime("%Y%m%d"), page_count=100)
    except Exception as e:
        return {"error": str(e)[:160]}
    return [{"dt": x.get("rcept_dt"), "report": (x.get("report_nm") or "").strip(), "by": x.get("flr_nm"),
             "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={x.get('rcept_no')}"} for x in ((r or {}).get("list") or [])[:60]]


# ---------- 조사 데이터 묶음 ----------
def dossier(corp_code):
    d = c.rpc("desk_company", {"p_corp_code": corp_code}) or {}
    d["comps"] = c.rpc("desk_comps", {"p_corp_code": corp_code}) or {}
    d["financials"] = financials(corp_code)
    from . import supply
    pos = supply.position(corp_code)   # 주요 고객 · 최근 수주 · 납품 상장사. 공급망 DB 를 쓰지 않으면 넣지 않는다
    if pos:
        d["supply"] = pos
    return d


def _str(v):
    return str(v or "").strip()


TOOLS = {
    "calc": ({"name": "calc", "description": "산술식 계산. 예: 85000000000/105500000000*100",
              "input_schema": {"type": "object", "properties": {"expr": {"type": "string"}}, "required": ["expr"]}},
             lambda x: calc(x.get("expr"))),
    "dart_filings": ({"name": "dart_filings", "description": "회사의 최근 공시 목록(DART). corp_code 8자리, days 기본 180",
                      "input_schema": {"type": "object", "properties": {"corp_code": {"type": "string"}, "days": {"type": "integer"}}, "required": ["corp_code"]}},
                     lambda x: dart_filings(_str(x.get("corp_code")), x.get("days") or 180)),
    "financials": ({"name": "financials", "description": "OpenDART 재무제표: 최근 분기 매출·영업이익·순이익과 가장 최근 분기 말의 현금·차입·부채비율(원). corp_code 8자리",
                    "input_schema": {"type": "object", "properties": {"corp_code": {"type": "string"}}, "required": ["corp_code"]}},
                   lambda x: financials(_str(x.get("corp_code")))),
    "company": ({"name": "company", "description": "공시 DB 의 회사 데이터: 개요, 단기 차입, 만기·풋, 조달 이력, 주요 공시, 사업 확장, 관련 기사. corp_code 8자리",
                 "input_schema": {"type": "object", "properties": {"corp_code": {"type": "string"}}, "required": ["corp_code"]}},
                lambda x: c.rpc("desk_company", {"p_corp_code": _str(x.get("corp_code"))})),
}
