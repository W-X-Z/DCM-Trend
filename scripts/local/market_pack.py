#!/usr/bin/env python3
"""시장 자료 팩 수집 (로컬 컴퓨터에서 실행).

Discussion Material 의 데이터 부분(일별 금리·환율·KOSPI·유가·아파트값)을 공개 출처에서 받아
Supabase 에 넣을 SQL 을 만든다. 클라우드 작업 공간은 ECOS·FRED 에 직접 접속할 수 없어서 로컬에서 돌린다.

  python3 scripts/local/market_pack.py                  # 수집 + SQL 생성 (out/market_pack_YYYYMMDD.sql)
  python3 scripts/local/market_pack.py --from-csv DIR   # 이미 받은 CSV 로 SQL 만 생성
  python3 scripts/local/market_pack.py --push           # 수집 후 바로 Supabase 에 넣기 (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 필요)

ECOS 는 ECOS_API_KEY 가 없으면 공개 sample 키(요청당 10행)로 날짜 구간을 잘게 나눠 받는다.
생성한 SQL 은 supabase 마이그레이션으로 넣거나 SQL 편집기에서 실행한다(같은 날짜는 덮어씀).
"""
import argparse, csv, datetime as dt, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

ECOS_KEY = os.environ.get('ECOS_API_KEY', 'sample')
ROWS = 10 if ECOS_KEY == 'sample' else 10000

# raw.rates (금리, 기존 시계열 키)
RATES = {
    'ktb2y': ('817Y002', '010195000'),
    'ktb3y': ('817Y002', '010200000'),
    'ktb5y': ('817Y002', '010200001'),
    'corp3y_aa': ('817Y002', '010300000'),
    'corp3y_bbb': ('817Y002', '010320000'),
}
# raw.market_daily (시장 지표)
MARKET_ECOS = {
    'usdkrw': ('731Y001', '0000001', 'D'),
    'kospi': ('802Y001', '0001000', 'D'),
    'apt_seoul': ('901Y062', 'P63ACA', 'M'),   # KB 주택매매가격지수 아파트(서울)
    'apt_all': ('901Y062', 'P63A', 'M'),       # KB 주택매매가격지수 총지수
}
MARKET_FRED = {'brent': 'DCOILBRENTEU'}


def ecos(code, item, start, end, cycle='D'):
    def get(a, b):
        u = f'https://ecos.bok.or.kr/api/StatisticSearch/{ECOS_KEY}/json/kr/1/{ROWS}/{code}/{cycle}/{a}/{b}/{item}'
        for _ in range(4):
            try:
                d = json.loads(urllib.request.urlopen(u, timeout=30).read())
                return d.get('StatisticSearch', {}).get('row', [])
            except Exception:
                pass
        return []
    wins = []
    if cycle == 'M':
        for y in range(start.year, end.year + 1):
            wins += [(f'{y}01', f'{y}06'), (f'{y}07', f'{y}12')]
    else:
        step = 12 if ROWS == 10 else 3650
        d = start
        while d <= end:
            e = min(d + dt.timedelta(days=step), end)
            wins.append((d.strftime('%Y%m%d'), e.strftime('%Y%m%d')))
            d = e + dt.timedelta(days=1)
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(lambda w: get(*w), wins))
    out = {}
    for rows in res:
        for x in rows:
            t = x['TIME']
            day = f'{t[:4]}-{t[4:6]}-{t[6:8]}' if len(t) == 8 else f'{t[:4]}-{t[4:6]}-01'
            out[day] = float(x['DATA_VALUE'])
    return sorted(out.items())


def fred(sid, start):
    b = urllib.request.urlopen(f'https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={start}', timeout=30).read().decode()
    rows = list(csv.DictReader(b.splitlines()))
    key = 'observation_date' if 'observation_date' in rows[0] else 'DATE'
    return [(r[key], float(r[sid])) for r in rows if r[sid] not in ('', '.')]


def from_csv(d):
    """로컬에서 미리 받은 CSV(daily.csv, fx_kospi.csv, apt.csv, ktb5y.csv, BRENT.csv)로 같은 구조를 만든다."""
    rates = {k: [] for k in RATES}
    for r in csv.DictReader(open(os.path.join(d, 'daily.csv'))):
        day = f"{r['dt'][:4]}-{r['dt'][4:6]}-{r['dt'][6:]}"
        for k in ('ktb2y', 'ktb3y', 'corp3y_aa', 'corp3y_bbb'):
            if r.get(k):
                rates[k].append((day, float(r[k])))
    p5 = os.path.join(d, 'ktb5y.csv')
    if os.path.exists(p5):
        for r in csv.DictReader(open(p5)):
            rates['ktb5y'].append((f"{r['dt'][:4]}-{r['dt'][4:6]}-{r['dt'][6:]}", float(r['ktb5y'])))
    market = {k: [] for k in list(MARKET_ECOS) + list(MARKET_FRED)}
    for r in csv.DictReader(open(os.path.join(d, 'fx_kospi.csv'))):
        day = f"{r['dt'][:4]}-{r['dt'][4:6]}-{r['dt'][6:]}"
        if r['usdkrw']:
            market['usdkrw'].append((day, float(r['usdkrw'])))
        if r['kospi']:
            market['kospi'].append((day, float(r['kospi'])))
    for r in csv.DictReader(open(os.path.join(d, 'apt.csv'))):
        day = f"{r['ym'][:4]}-{r['ym'][4:]}-01"
        market['apt_seoul'].append((day, float(r['seoul_apt'])))
        market['apt_all'].append((day, float(r['all'])))
    for r in csv.DictReader(open(os.path.join(d, 'BRENT.csv'))):
        if r['DCOILBRENTEU'] not in ('', '.'):
            market['brent'].append((r['observation_date'], float(r['DCOILBRENTEU'])))
    return rates, market


def collect():
    today = dt.date.today()
    rates = {k: ecos(c, i, dt.date(2022, 1, 1), today) for k, (c, i) in RATES.items()}
    market = {k: ecos(c, i, dt.date(2021, 1, 1) if cy == 'M' else dt.date(2024, 1, 1), today, cy) for k, (c, i, cy) in MARKET_ECOS.items()}
    for k, sid in MARKET_FRED.items():
        market[k] = fred(sid, '2024-01-01')
    return rates, market


def to_sql(rates, market):
    out = ['-- 시장 자료 팩: scripts/local/market_pack.py 로 생성 (공개 출처: 한국은행 ECOS, FRED)']
    for k, pts in rates.items():
        if not pts:
            continue
        vals = ',\n'.join(f"('{k}', '{d}', {v}, 'ecos')" for d, v in pts)
        out.append(f"insert into raw.rates (series_key, dt, value, source) values\n{vals}\n"
                   "on conflict (series_key, dt) do update set value = excluded.value, source = excluded.source, source_url = null, fetched_at = now();")
    for k, pts in market.items():
        if not pts:
            continue
        vals = ',\n'.join(f"('{k}', '{d}', {v})" for d, v in pts)
        out.append(f"insert into raw.market_daily (series_key, dt, value) values\n{vals}\n"
                   "on conflict (series_key, dt) do update set value = excluded.value, fetched_at = now();")
    return '\n\n'.join(out) + '\n'


def push(rates, market):
    url = os.environ['SUPABASE_URL'].rstrip('/')
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    def rpc(fn, body):
        req = urllib.request.Request(f'{url}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST',
                                     headers={'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
        return json.loads(urllib.request.urlopen(req, timeout=120).read() or b'0')
    for k, pts in rates.items():
        for i in range(0, len(pts), 500):
            rpc('ingest_put_rates', {'p_series_key': k, 'p_items': [{'dt': d, 'value': v} for d, v in pts[i:i + 500]]})
    for k, pts in market.items():
        for i in range(0, len(pts), 500):
            rpc('ingest_put_market', {'p_series_key': k, 'p_items': [{'dt': d, 'value': v} for d, v in pts[i:i + 500]]})


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--from-csv')
    ap.add_argument('--out')
    ap.add_argument('--push', action='store_true')
    a = ap.parse_args()
    rates, market = from_csv(a.from_csv) if a.from_csv else collect()
    if a.push:
        push(rates, market)
        print('pushed', {k: len(v) for k, v in {**rates, **market}.items()}, file=sys.stderr)
        sys.exit(0)
    path = a.out or os.path.join(os.path.dirname(__file__), 'out', f'market_pack_{dt.date.today():%Y%m%d}.sql')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'w').write(to_sql(rates, market))
    print(path, {k: len(v) for k, v in {**rates, **market}.items()}, file=sys.stderr)
