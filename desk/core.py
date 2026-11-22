"""공통: 설정, Supabase RPC(public.desk_* 만 부른다), OpenDART, HTTP."""
import json, os, threading, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "desk" / "out"


def env(key, default=None):
    v = os.environ.get(key, "").strip()
    if v:
        return v
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            if line.startswith(key + "=") and line.split("=", 1)[1].strip():
                return line.split("=", 1)[1].strip()
    if default is None:
        raise SystemExit(f"{key} 값이 없습니다 (.env 또는 환경변수)")
    return default


def http_get(url, timeout=40, headers=None, tries=3):
    err = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (dcm-trend desk)", **(headers or {})})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            err = f"HTTP {e.code}"
            if e.code < 500 and e.code != 429:
                break
        except Exception as e:
            err = str(e)[:160]
        time.sleep(1.5 * (i + 1))
    raise RuntimeError(err)


# ---------- Supabase ----------
def _sb_headers():
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    h = {"apikey": key, "Content-Type": "application/json"}
    if not key.startswith("sb_"):   # 새 형식 키(sb_secret_...)는 apikey 헤더만
        h["Authorization"] = f"Bearer {key}"
    return h


def rpc(fn, args=None, tries=3):
    url = env("SUPABASE_URL").rstrip("/") + f"/rest/v1/rpc/{fn}"
    data = json.dumps(args or {}, ensure_ascii=False).encode()
    err = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=_sb_headers(), method="POST")
            with urllib.request.urlopen(req, timeout=120) as r:
                b = r.read()
                return json.loads(b) if b else None
        except urllib.error.HTTPError as e:
            err = f"{fn} HTTP {e.code}: {e.read()[:300].decode('utf-8', 'replace')}"
            if e.code < 500:
                break
        except Exception as e:
            err = f"{fn}: {str(e)[:160]}"
        time.sleep(2 * (i + 1))
    raise RuntimeError(err)


# ---------- OpenDART ----------
_dart_lock = threading.Lock()
_dart_last = [0.0]


def dart(path, **params):
    """OpenDART JSON API. status 000 이면 응답 dict, 013(데이터 없음)이면 None, 그 밖은 예외."""
    base = env("OPENDART_BASE", "https://opendart.fss.or.kr/api").rstrip("/")
    q = urllib.parse.urlencode({"crtfc_key": env("OPENDART_API_KEY"), **{k: v for k, v in params.items() if v not in (None, "")}})
    with _dart_lock:   # 호출 간격 0.2초
        w = 0.2 - (time.time() - _dart_last[0])
        if w > 0:
            time.sleep(w)
        _dart_last[0] = time.time()
    r = json.loads(http_get(f"{base}/{path}?{q}", timeout=60))
    if r.get("status") == "000":
        return r
    if r.get("status") == "013":
        return None
    raise RuntimeError(f"OpenDART {path} status {r.get('status')}: {str(r.get('message'))[:80]}")
