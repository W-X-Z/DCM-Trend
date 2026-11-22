"""공급망: 공시 기반 공급망 지도(supply-map, 별도 DB)를 읽기 전용 계정으로 조회한다.

- 수주 급증 후보: 최근 90일 공급계약 공시 합계가 최근 연매출에 비해 큰 상장사.
- 전방 투자의 협력사: 투자·증설 건이 있는 회사에 납품하는 상장사(공급계약 상대방, 매출 10% 이상 주요 고객).
- 공급망 위치: 한 회사의 주요 고객 · 최근 수주 · 납품 상장사(기업 분석과 근거 자료에 쓴다).

SUPPLY_MAP_DB_URL 이 없거나 조회가 실패하면 빈 값을 돌려준다(공시 · 기사만으로 돈다). 데이터는 복사해 두지 않고 그때그때 읽는다.
"""
import datetime as dt

from . import core as c
from .render import won

ORDER_DAYS = 90        # 수주를 모아 보는 기간
MIN_PCT = 30           # 기간 안 수주 합계 ÷ 최근 연매출(%) 하한
MAX_ORDERS = 25        # 대상 선정에 넘기는 수주 후보 수
MAX_ANCHORS = 5        # 협력사를 찾아볼 전방 회사 수
MAX_SUPPLIERS = 8      # 전방 한 곳당 협력사 수
STALE_DAYS = 14        # 공급계약 수집이 이보다 오래 멈춰 있으면 실행 요약에 적는다
SKIP_KSIC = ("41", "42")   # 종합 · 전문 건설: 공사 수주가 본업이라 매출 대비 비율이 늘 크다
DART = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo="


def enabled():
    return bool(c.env("SUPPLY_MAP_DB_URL", ""))


def _call(sql, args=()):
    """viewer.* 함수 하나를 부르고 jsonb 결과를 돌려준다. 시험에서는 이 함수를 바꿔 끼운다."""
    import psycopg   # 공급망을 쓸 때만 필요하다
    with psycopg.connect(c.env("SUPPLY_MAP_DB_URL"), connect_timeout=15, prepare_threshold=None) as conn:
        row = conn.execute(sql, args).fetchone()
    return row[0] if row else None


def _safe(sql, args, default):
    if not enabled():
        return default
    try:
        out = _call(sql, args)
        return default if out is None else out
    except Exception as e:
        print("공급망 조회 실패:", str(e)[:160])
        return default


def _term(a, b):
    return f"{str(a)[:10].replace('-', '.')}~{str(b)[:10].replace('-', '.')}" if a and b else None


def _clean(d):
    return {k: v for k, v in d.items() if v not in (None, "", [], {})}


def orders(today):
    """수주 급증 후보와 수집 기준일. → (rows, latest)"""
    out = _safe("select viewer.orders(%s::date, %s, %s)", (str(today - dt.timedelta(days=ORDER_DAYS)), MIN_PCT, MAX_ORDERS * 3), {})
    rows = []
    for x in out.get("items") or []:
        if str(x.get("induty_code") or "")[:2] in SKIP_KSIC:
            continue
        ks = x.get("contracts") or []
        rows.append(_clean({
            "corp_code": x["corp_code"], "corp_name": x["corp_name"], "시장": {"Y": "유가", "K": "코스닥", "N": "코넥스"}.get(x.get("market")),
            "최근 연매출": f"{won(x['revenue'])}원({x.get('revenue_year')})" if x.get("revenue") else None,
            "수주 합계": f"{won(x['amount'])}원" if x.get("amount") else None, "연매출 대비(%)": x.get("pct"), "건수": x.get("n"), "최근 공시일": x.get("last_dt"),
            "계약": [_clean({"공시일": k.get("dt"), "계약": k.get("title"), "상대방": k.get("counterparty"), "금액": f"{won(k['amount'])}원" if k.get("amount") else None,
                           "연매출 대비(%)": k.get("pct"), "기간": _term(k.get("start"), k.get("end"))}) for k in ks[:3]],
            "_url": DART + ks[0]["rcept_no"] if ks and ks[0].get("rcept_no") else None}))
        if len(rows) >= MAX_ORDERS:
            break
    return rows, out.get("latest")


def chain(comps, today):
    """선별 공시·기사에 투자·증설 건이 있는 회사(전방)에 납품하는 상장사."""
    anchors = [g for g in comps if g.get("corp_code") and any(s.get("need") == "투자·증설" for s in g["signals"])][:MAX_ANCHORS]
    rows = []
    for g in anchors:
        sup = _safe("select viewer.suppliers(%s, %s::date, %s)", (g["corp_code"], str(today - dt.timedelta(days=730)), MAX_SUPPLIERS * 2), [])
        sup = [x for x in sup if str(x.get("induty_code") or "")[:2] not in SKIP_KSIC][:MAX_SUPPLIERS]
        if not sup:
            continue
        what = next((s.get("what") for s in g["signals"] if s.get("need") == "투자·증설"), None)
        rows.append({"전방": g["corp_name"], "전방 건": what, "협력사": [_clean({
            "corp_code": x["corp_code"], "corp_name": x["corp_name"],
            "근거": [_clean({"구분": e.get("basis"), "공시일": e.get("dt"), "내용": e.get("item"), "금액": f"{won(e['amount'])}원" if e.get("amount") else None,
                           "연매출 대비(%)": e.get("pct")}) for e in (x.get("evidence") or [])[:2]],
            "_url": next((DART + e["rcept_no"] for e in x.get("evidence") or [] if e.get("rcept_no")), None)}) for x in sup]})
    return rows


def position(corp_code):
    """한 회사의 공급망 위치. 없으면 None."""
    p = _safe("select viewer.position(%s)", (corp_code,), None)
    if not isinstance(p, dict) or not any(p.get(k) for k in ("customers", "orders", "suppliers")):
        return None
    return p


def order_line(o):
    """대상 선정 뒤 1pager 의 관련 공시에 남기는 한 줄."""
    parts = [f"최근 {ORDER_DAYS}일 공급계약 {o.get('건수', 0)}건"]
    if o.get("수주 합계"):
        parts.append(o["수주 합계"])
    if o.get("연매출 대비(%)") is not None:
        parts.append(f"최근 연매출 대비 {o['연매출 대비(%)']}%")
    return {"dt": o.get("최근 공시일"), "what": " · ".join(parts), "need": "투자·증설", "url": o.get("_url")}


def chain_line(front, s):
    e = (s.get("근거") or [{}])[0]
    desc = " ".join(str(x) for x in (e.get("구분"), e.get("내용"), e.get("금액")) if x)
    return {"dt": e.get("공시일"), "what": f"{front} 납품" + (f" ({desc})" if desc else ""), "need": "투자·증설", "url": s.get("_url")}


def public(rows):
    """모델에 넘길 때 안쪽 값(_url)을 뺀다."""
    if isinstance(rows, list):
        return [public(x) for x in rows]
    if isinstance(rows, dict):
        return {k: public(v) for k, v in rows.items() if not k.startswith("_")}
    return rows
