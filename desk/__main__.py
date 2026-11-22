"""딜 발굴 데스크 실행.

python3 -m desk daily [--days 3] [--force]     하루 실행 (모니터링 → 발굴 → 조사 → 1pager → 검수)
python3 -m desk resume                         새 대상 없이, 끝내지 못한 대상만 이어서
python3 -m desk brief <회사명 또는 corp_code>  회사를 지정해 1pager 만
python3 -m desk news [--days 3]                뉴스 수집만
python3 -m desk fin <corp_code>                재무 도구 결과 확인
python3 -m desk config                         사무실 화면 설정(JSON)
"""
import argparse, json, sys

from . import news, office, pipeline, tools


def main(argv=None):
    ap = argparse.ArgumentParser(prog="desk", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["daily", "resume", "brief", "news", "fin", "config"])
    ap.add_argument("target", nargs="*")
    ap.add_argument("--days", type=int, default=3)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "daily":
        pipeline.daily(a.days, force=a.force)
    elif a.cmd == "resume":
        pipeline.resume()
    elif a.cmd == "news":
        news.collect(a.days)
    elif a.cmd == "config":
        print(json.dumps(office.config(), ensure_ascii=False, indent=1))
    elif not a.target:
        ap.error(f"{a.cmd} 에는 회사가 필요하다")
    elif a.cmd == "brief":
        pipeline.brief_for(" ".join(a.target))
    else:
        print(json.dumps(tools.financials(a.target[0]), ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
