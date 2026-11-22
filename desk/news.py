"""뉴스 수집: 네이버 뉴스 검색 API 로 ref.desk_news_queries 의 검색어를 조회해 raw.news 에 쌓는다.

- 공식 검색 API 를 쓴다(크롤링하지 않는다). 키는 둘 중 하나:
  NAVER_HUB_CLIENT_ID / NAVER_HUB_CLIENT_SECRET (네이버 클라우드 NAVER API HUB) 또는 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET (네이버 개발자센터).
  둘 다 없으면 뉴스 검색 담당(에이전트 웹 검색, search)이 대신 찾는다. 같은 검색어에도 결과가 매번 달라질 수 있어 빠짐없이 훑는 데는 검색 API 가 낫다.
- 저장하는 것은 API 가 주는 제목, 요약 한 줄, 원문 주소, 발행 시각이다. 본문은 받지 않는다.
- 검색어는 DB 행이다. 현업 인터뷰 뒤 행을 고친다.
"""
import datetime as dt, email.utils, hashlib, html, json, os, re, time, urllib.parse
from concurrent.futures import ThreadPoolExecutor

from . import core as c

_TAG = re.compile(r"<[^>]+>")


def _clean(s):
    return html.unescape(_TAG.sub("", s or "")).strip()


def parse(payload, query, grp, since_ts=None):
    """네이버 뉴스 검색 응답(JSON dict) → raw.news 행."""
    out = []
    for it in (payload or {}).get("items") or []:
        url = (it.get("originallink") or it.get("link") or "").strip()
        title = _clean(it.get("title"))
        if not url or not title:
            continue
        try:
            ts = email.utils.parsedate_to_datetime(it.get("pubDate") or "")
        except Exception:
            ts = None
        if since_ts and ts and ts.timestamp() < since_ts:
            continue
        host = urllib.parse.urlparse(url).netloc.replace("www.", "")
        out.append({"url_hash": hashlib.sha1(url.encode()).hexdigest()[:20], "url": url, "title": title, "snippet": _clean(it.get("description"))[:300],
                    "source": host, "published_at": ts.isoformat() if ts else None, "query": query, "grp": grp})
    return out


def _api():
    """(주소, 헤더, 추가 인자). 응답 형식(items: title, originallink, link, description, pubDate)은 두 경로가 같다."""
    g = lambda k: os.environ.get(k, "").strip()
    if g("NAVER_HUB_CLIENT_ID") and g("NAVER_HUB_CLIENT_SECRET"):
        return (g("DESK_NEWS_BASE") or "https://naverapihub.apigw.ntruss.com/search/v1/news",
                {"X-NCP-APIGW-API-KEY-ID": g("NAVER_HUB_CLIENT_ID"), "X-NCP-APIGW-API-KEY": g("NAVER_HUB_CLIENT_SECRET")}, {"format": "json"})
    if g("NAVER_CLIENT_ID") and g("NAVER_CLIENT_SECRET"):
        return (g("DESK_NEWS_BASE") or "https://openapi.naver.com/v1/search/news.json",
                {"X-Naver-Client-Id": g("NAVER_CLIENT_ID"), "X-Naver-Client-Secret": g("NAVER_CLIENT_SECRET")}, {})
    return None


def rows_from(articles, grp, today, days):
    """뉴스 검색 담당의 출력 → raw.news 행. 주소가 http(s) 이고 발행일이 기간 안인 것만."""
    lo, out = str(today - dt.timedelta(days=days)), []
    for a in articles or []:
        if not isinstance(a, dict):
            continue
        url, title, day = str(a.get("url") or "").strip(), _clean(str(a.get("title") or "")), str(a.get("date") or "")[:10]
        if not re.match(r"https?://", url) or not title or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) or not lo <= day <= str(today):
            continue
        out.append({"url_hash": hashlib.sha1(url.encode()).hexdigest()[:20], "url": url, "title": title, "snippet": _clean(str(a.get("snippet") or ""))[:300],
                    "source": str(a.get("source") or "") or urllib.parse.urlparse(url).netloc.replace("www.", ""),
                    "published_at": day + "T00:00:00+09:00", "query": str(a.get("query") or "")[:80], "grp": grp})
    return out


def search(days=3):
    """검색 API 키가 없을 때: 검색어 묶음(grp)마다 뉴스 검색 담당이 웹 검색으로 기사를 찾는다. 넣은 건수를 돌려준다."""
    from . import runtime as rt
    groups = {}
    for q in c.rpc("desk_news_queries") or []:
        groups.setdefault(q["grp"], []).append(q["query"])
    if not groups:
        return None
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date()

    def one(i, grp):
        user = f"오늘은 {today} 이다. 최근 {days}일({today - dt.timedelta(days=days)} 이후) 기사만 찾는다.\n검색어: {json.dumps(groups[grp], ensure_ascii=False)}"
        try:
            out, _ = rt.call("collect.newsdesk", user, item=f"{grp} · 검색어 {len(groups[grp])}개", slot=i % 3 + 1, reserve=1.0)
        except rt.BudgetExceeded:
            return []
        return rows_from((out or {}).get("articles"), grp, today, days)

    with ThreadPoolExecutor(3) as ex:
        found = [r for rows in ex.map(lambda x: one(*x), enumerate(sorted(groups))) for r in rows]
    rows = list({r["url_hash"]: r for r in found}.values())
    n = c.rpc("desk_news_put", {"p_items": rows}) if rows else 0
    print(f"뉴스(웹 검색): 찾은 기사 {len(rows)}건, 새로 넣은 것 {n}건")
    return n


def collect(days=3, per_query=50):
    """검색어마다 최신순으로 받아 최근 days 일 기사만 넣는다. 넣은 건수를 돌려준다. 검색 API 키가 없으면 웹 검색(search)으로 찾는다."""
    api = _api()
    if not api:
        return search(days)
    base, headers, extra = api
    since = time.time() - days * 86400
    rows, seen = [], set()
    for q in c.rpc("desk_news_queries") or []:
        try:
            url = base + "?" + urllib.parse.urlencode({"query": q["query"], "display": per_query, "start": 1, "sort": "date", **extra})
            payload = json.loads(c.http_get(url, headers=headers))
        except Exception as e:
            print(f"뉴스: '{q['query']}' 실패 {str(e)[:100]}")
            continue
        for r in parse(payload, q["query"], q["grp"], since):
            if r["url_hash"] not in seen:
                seen.add(r["url_hash"])
                rows.append(r)
        time.sleep(0.12)   # 초당 10건 제한
    n = c.rpc("desk_news_put", {"p_items": rows}) if rows else 0
    print(f"뉴스: 받은 기사 {len(rows)}건, 새로 넣은 것 {n}건")
    return n
