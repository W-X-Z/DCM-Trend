"""딜 발굴 데스크 시험: 가짜 서버로 전 구간을 돌린다. 실행: python3 -m unittest desk.tests.test_desk -v"""
import datetime as dt, json, os, tempfile, unittest
from pathlib import Path

from desk import core, news, pipeline, render, runtime as rt, tools
from desk.tests import fakes

E8 = 100_000_000
GOOD = {s: {"state": "확인", "note": "공시로 확인"} for s in ("need", "capacity", "timing", "access")}


def research_ok(body):
    return {"checks": GOOD, "need_detail": {"what": "전환사채 만기 상환", "amount": "700억원", "when": "2026-11-29", "basis": "발행 이력"},
            "business": "제주 복합리조트를 운영한다.", "position": "", "earnings_note": "", "issues": [{"date": "2026-11-20", "title": "단기차입 400억 결정", "why": "상환 재원", "source": "https://dart.fss.or.kr"}],
            "funding_done": "", "comps_pick": [], "unknowns": ["나머지 300억 재원"], "kill_hit": "", "sources": [{"title": "DART", "url": "https://dart.fss.or.kr"}]}


def script(**over):
    def signals(body):
        batch = json.loads(fakes.first_text(body).split("\n", 1)[1])
        pick = {"20261120800930": ("롯데관광개발", "차환·상환", 3), "20261120800697": ("남성", "투자·증설", 3), "20261120900873": ("빅텐츠", "영업 주의", 2),
                "n0001": ("남성", "투자·증설", 2), "없는ref": ("유령", "투자·증설", 3)}
        refs = [b["ref"] for b in batch] + ["없는ref"]
        return {"signals": [{"ref": r, "corp_name": pick[r][0], "need": pick[r][1], "what": "시험", "why": "시험", "strength": pick[r][2]} for r in refs if r in pick]}

    def lead(code, name, pr):
        return {"corp_code": code, "corp_name": name, "need": "차환·상환", "hypothesis": f"{name} 가설", "questions": ["재원은?"], "kill": "이미 조달", "priority": pr}

    s = {"signals": signals,
         "pick": lambda b: {"leads": [lead("00231372", "롯데관광개발", 1), lead("00172185", "남성", 2), lead("00550082", "빅텐츠", 3), lead("99999999", "유령", 4)], "skipped": "롯데쇼핑: 통상 차환"},
         "research": lambda b: {**research_ok(b), "kill_hit": "이미 PF 대출 약정 공시"} if "남성" in fakes.first_text(b) else research_ok(b),
         "brief": lambda b: {"headline": "CB 700억 만기", "need": "상환 재원 필요", "company": "리조트 운영", "earnings": "", "debt": "", "issues": ["11/20 단기차입"],
                             "talking_points": ["상환 계획은?"], "angles": [], "unknowns": []},
         "verdict": lambda b: {"state": "수정", "fixes": [{"item": "headline", "finding": "만기일 누락", "kind": "날짜 누락"}],
                               "patches": [{"section": "headline", "text": "CB 700억 11/29 만기"}, {"section": "talking_points", "items": ["상환 계획은?", "남은 300억은?"]}], "note": "날짜 보완"}}
    s.update(over)
    return s


class Base(unittest.TestCase):
    def boot(self, scr=None, cap="5", usage=None, dart_missing=()):
        self.sb, self.ai, self.dart = fakes.Supabase(), fakes.Anthropic(scr or script(), usage), fakes.Dart(dart_missing)
        self.tmp = tempfile.TemporaryDirectory()
        core.OUT = Path(self.tmp.name)
        os.environ.update(SUPABASE_URL=self.sb.url, SUPABASE_SERVICE_ROLE_KEY="sb_test", ANTHROPIC_BASE_URL=self.ai.url, ANTHROPIC_API_KEY="k",
                          OPENDART_BASE=self.dart.url, OPENDART_API_KEY="k", DESK_USD_CAP=cap)
        for k in ("NAVER_CLIENT_ID", "NAVER_HUB_CLIENT_ID", "DESK_NEWS_BASE"):
            os.environ.pop(k, None)
        os.environ.pop("GITHUB_STEP_SUMMARY", None)
        self.addCleanup(lambda: [(x.srv.shutdown(), x.srv.server_close()) for x in (self.sb, self.ai, self.dart)] and None)
        self.addCleanup(self.tmp.cleanup)

    def lead(self, name):
        return next(l for l in self.sb.leads if l["corp_name"] == name)


class Flow(Base):
    def test_daily(self):
        self.boot()
        r = pipeline.daily()
        self.assertEqual(r["status"], "done")
        # 모니터링: 받은 항목에 없는 ref 는 버리고, 읽은 것은 모두 본 것으로 남긴다
        self.assertEqual(len(self.sb.signals), 4)
        self.assertEqual(len(self.sb.seen), 7)
        self.assertEqual(next(s for s in self.sb.signals if s["src_ref"] == "n0001")["corp_code"], "00172185")   # 기사 속 회사 이름 → 코드
        # 발굴: 영업 주의(빅텐츠)와 모르는 회사는 빠진다. 가설은 조사 전에 보드에 있다
        self.assertEqual([l["corp_name"] for l in self.sb.leads], ["롯데관광개발", "남성"])
        # 조사: 제외 조건에 걸린 회사는 기각, 1pager 를 쓰지 않는다
        self.assertEqual(self.lead("남성")["status"], "기각")
        self.assertIn("PF 대출", self.lead("남성")["note"])
        self.assertEqual(self.ai.count("brief"), 1)
        # 검수의 고침이 반영되어 게시된다
        l = self.lead("롯데관광개발")
        self.assertEqual(l["status"], "게시")
        self.assertEqual(l["brief"]["headline"], "CB 700억 11/29 만기")
        md = l["brief_md"]
        for part in ("CB 700억 11/29 만기", "## 최근 실적", "| 2026.3Q | 100억 | 10억 | -5억 |", "2025.4Q*", "## 차입과 만기", "차입 계정 합계 1,400억", "부채비율 200.0%",
                     "| 2026.11.29 | 메자닌 CB 만기 | 700억", "## 조달 이력", "2. 남은 300억은?", "## 검수", "수정: 날짜 보완"):
            self.assertIn(part, md)
        # 검수 담당은 1pager 만 받는다 (가설·조사 결과는 주지 않는다)
        vreq = next(x for x in self.ai.requests if x["tools"][0]["name"] == "verdict")
        self.assertNotIn("가설", fakes.first_text(vreq))
        self.assertIn("[1pager]", fakes.first_text(vreq))
        # 조사 담당의 도구 왕복(dart_filings)과 호출 기록
        self.assertTrue(any(p[0].endswith("list.json") for p in self.dart.paths))
        self.assertTrue(all(c.get("status") == "ok" for c in self.sb.calls))
        self.assertGreater(rt.RUN["cost"], 0)
        out = core.OUT / r["run_id"]
        self.assertIn("**롯데관광개발**", (out / "summary.md").read_text(encoding="utf-8"))
        self.assertTrue((out / "롯데관광개발.md").exists())
        # 하루 한 번
        self.assertIsNone(pipeline.daily())

    def test_second_day_reads_nothing_twice(self):
        self.boot()
        pipeline.daily()
        n = self.ai.count("signals")
        r = pipeline.daily(force=True)
        self.assertEqual(self.ai.count("signals"), n)          # 본 공시·기사는 다시 읽지 않는다
        self.assertEqual(len(self.sb.leads), 2)                # 보드에 있는 회사는 다시 고르지 않는다
        self.assertEqual(r["leads"], [])

    def test_budget_stop_and_resume(self):
        one = script(pick=lambda b: {"leads": [{"corp_code": "00231372", "corp_name": "롯데관광개발", "need": "차환·상환", "hypothesis": "가설", "questions": [], "kill": "", "priority": 1}], "skipped": ""})
        self.boot(one, cap="0.6", usage={"research": {"input_tokens": 150000}})
        r = pipeline.daily()
        self.assertEqual(r["status"], "partial")
        l = self.lead("롯데관광개발")
        self.assertEqual(l["status"], "대기")
        self.assertIsNotNone(l.get("research"))                # 끝난 단계는 저장돼 있다
        self.assertIsNone(l.get("brief"))
        os.environ["DESK_USD_CAP"] = "5"
        r = pipeline.daily(force=True)
        self.assertEqual(self.ai.count("research"), 1)         # 조사는 다시 하지 않는다
        self.assertEqual(self.lead("롯데관광개발")["status"], "게시")
        self.assertEqual(r["status"], "done")

    def test_hold_and_truncated(self):
        cut = {"_raw": {"content": [{"type": "tool_use", "id": "x", "name": "brief", "input": {}}], "stop_reason": "max_tokens"}}
        self.boot(script(verdict=lambda b: {"state": "보류", "fixes": [], "note": "11/18 차환 발행 공시가 이미 있음"}, brief=lambda b: cut))
        r = pipeline.daily()
        self.assertEqual(self.lead("롯데관광개발")["status"], "대기")   # 잘린 출력은 결과로 받지 않는다
        self.assertEqual(r["status"], "partial")
        self.ai.script.update(script(verdict=self.ai.script["verdict"]))
        pipeline.daily(force=True)
        l = self.lead("롯데관광개발")
        self.assertEqual((l["status"], l["note"]), ("보류", "11/18 차환 발행 공시가 이미 있음"))
        self.assertNotIn("**롯데관광개발**", (sorted(core.OUT.iterdir())[-1] / "summary.md").read_text(encoding="utf-8").split("## 보류")[0])

    def test_brief_request(self):
        self.boot(script(research=lambda b: {**research_ok(b), "kill_hit": "조달 계획 없음"}, verdict=lambda b: {"state": "보류", "fixes": [], "note": "수요 불명"}))
        r = pipeline.brief_for("롯데관광개발")
        self.assertEqual(self.ai.count("signals") + self.ai.count("pick"), 0)   # 모니터링·발굴은 건너뛴다
        self.assertEqual(self.lead("롯데관광개발")["status"], "게시")           # RM 이 요청한 회사는 기각·보류하지 않고 그대로 적어 낸다
        self.assertIn("보류: 수요 불명", r["leads"][0]["brief_md"])


class Units(Base):
    def test_financials(self):
        self.boot()
        f = tools.financials("00231372", today=dt.date(2026, 11, 22))
        self.assertEqual(f["basis"], "연결")
        self.assertEqual([q["period"] for q in f["quarters"]], ["2026.3Q", "2026.2Q", "2026.1Q", "2025.4Q", "2025.3Q"])
        q4 = f["quarters"][3]
        self.assertEqual((q4["revenue"], q4["op"], q4["ni"], q4.get("derived")), (100 * E8, 10 * E8, -5 * E8, True))   # 연간 400억 - 3분기 누적 300억
        b = f["balance"]
        self.assertEqual(sorted(b["borrowings"]), ["단기차입금", "유동성전환사채", "장기차입금"])                       # 할인발행차금은 뺀다
        self.assertEqual((b["borrowings_sum"], b["cash"], b["net_debt"], b["debt_ratio_pct"]), (1400 * E8, 50 * E8, 1350 * E8, 200.0))

    def test_financials_fallbacks(self):
        self.boot(dart_missing={"no_cfs"})
        self.assertEqual(tools.financials("x", today=dt.date(2026, 11, 22))["basis"], "별도")   # 연결이 없으면 별도
        self.boot(dart_missing={(2026, "11014")})
        f = tools.financials("x", today=dt.date(2026, 11, 22))                                 # 3분기 보고서 전이면 반기부터
        self.assertEqual(f["quarters"][0]["period"], "2026.2Q")
        self.boot(dart_missing={(y, c) for y in (2024, 2025, 2026) for c in ("11011", "11012", "11013", "11014")})
        self.assertIn("error", tools.financials("x", today=dt.date(2026, 11, 22)))

    def test_news_parse(self):
        self.boot()
        payload = {"items": [
            {"title": "<b>남성</b>, 면목동 개발에 850억 &quot;투입&quot;", "originallink": "https://www.example.com/a", "link": "https://n.news.naver.com/x",
             "description": "자금 조달 <b>방안</b>은 미정", "pubDate": "Sat, 21 Nov 2026 09:00:00 +0900"},
            {"title": "오래된 기사", "originallink": "https://example.com/old", "description": "", "pubDate": "Mon, 02 Nov 2026 09:00:00 +0900"},
            {"title": "", "originallink": "https://example.com/empty"}]}
        since = dt.datetime(2026, 11, 19, tzinfo=dt.timezone.utc).timestamp()
        rows = news.parse(payload, "신규 시설투자 결정", "투자·증설", since)
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["title"], rows[0]["snippet"], rows[0]["source"]), ('남성, 면목동 개발에 850억 "투입"', "자금 조달 방안은 미정", "example.com"))
        self.assertTrue(rows[0]["published_at"].startswith("2026-11-21T09:00:00+09:00"))
        self.assertIsNone(news.collect())   # 키가 없으면 건너뛴다
        payload["items"][0]["pubDate"] = dt.datetime.now(dt.timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
        srv = fakes.News(payload)
        self.addCleanup(lambda: (srv.srv.shutdown(), srv.srv.server_close()) and None)
        os.environ.update(DESK_NEWS_BASE=srv.url, NAVER_CLIENT_ID="id", NAVER_CLIENT_SECRET="sec")
        self.addCleanup(lambda: [os.environ.pop(k, None) for k in ("DESK_NEWS_BASE", "NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET", "NAVER_HUB_CLIENT_ID", "NAVER_HUB_CLIENT_SECRET")] and None)
        self.assertEqual(news.collect(), 1)   # 최근 기사 한 건만 DB 로
        self.assertEqual((self.sb.news[0]["grp"], srv.seen[0][0]["sort"], srv.seen[0][1]["x-naver-client-id"]), ("투자·증설", "date", "id"))
        os.environ.update(NAVER_HUB_CLIENT_ID="hid", NAVER_HUB_CLIENT_SECRET="hsec")   # HUB 키가 있으면 그쪽 헤더로
        news.collect()
        self.assertEqual((srv.seen[-1][1]["x-ncp-apigw-api-key-id"], srv.seen[-1][0]["format"]), ("hid", "json"))

    def test_render_without_data(self):
        md = render.one_pager({"corp_name": "시험", "brief": {"headline": "h", "talking_points": ["a"]}, "dossier": {"financials": {"error": "없음"}}})
        self.assertIn("재무 자료 없음 (없음)", md)
        self.assertEqual(render.won(620000000000), "6,200억")
        self.assertEqual(render.won(12300000000000), "12.3조")
        self.assertEqual(tools.calc("85000000000/105500000000*100") > 80, True)


if __name__ == "__main__":
    unittest.main()
