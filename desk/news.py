"""뉴스 수집: 네이버 뉴스 검색 API 로 ref.desk_news_queries 의 검색어를 조회해 raw.news 에 쌓는다.

- 공식 검색 API 를 쓴다(크롤링하지 않는다). 키는 둘 중 하나:
  NAVER_HUB_CLIENT_ID / NAVER_HUB_CLIENT_SECRET (네이버 클라우드 NAVER API HUB) 또는 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET (네이버 개발자센터).
  둘 다 없으면 건너뛰고 부서는 공시만으로 돈다.
- 저장하는 것은 API 가 주는 제목, 요약 한 줄, 원문 주소, 발행 시각이다. 본문은 받지 않는다.
- 검색어는 DB 행이다. 현업 인터뷰 뒤 행을 고친다.
"""
import email.utils, hashlib, html, json, os, re, time, urllib.parse

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


def collect(days=3, per_query=50):
    """검색어마다 최신순으로 받아 최근 days 일 기사만 넣는다. 넣은 건수를 돌려준다(키가 없으면 None)."""
    api = _api()
    if not api:
        print("뉴스: 네이버 검색 API 키가 없어 건너뜀 (공시만으로 진행)")
        return None
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
