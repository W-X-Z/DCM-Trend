"""딜 발굴 데스크 시험: 가짜 서버로 전 구간을 돌린다. 실행: python3 -m unittest desk.tests.test_desk -v"""
import datetime as dt, json, os, tempfile, unittest
from pathlib import Path

from desk import agents, core, news, office, pipeline, render, runtime as rt, supply, tools
from desk.tests import fakes

E8 = 100_000_000


def research_ok(body):
    return {"call": "미팅 추천", "call_reason": "CB 700억원 2026.11.29 만기 도래, 상환 재원 300억원 미확인",
            "funding": {"what": "전환사채 만기 상환", "amount": "700억원", "when": "2026.11.29", "basis": "발행 이력"},
            "capacity": "현금성자산 대비 상환 부담", "progress": "단기차입 400억원 결정(2026.11.20), 잔여 300억원 조달 방식 미공시", "caution": "",
            "recent": [{"date": "2026.11.20", "title": "단기차입 400억원 결정", "source": "https://dart.fss.or.kr"}],
            "comps_pick": [], "open_items": ["잔여 300억원 상환 재원"], "sources": [{"title": "DART", "url": "https://dart.fss.or.kr"}]}


def script(**over):
    def signals(body):
        batch = json.loads(fakes.first_text(body).split("\n", 1)[1])
        pick = {"20261120800930": ("롯데관광개발", "차환·상환", 3), "20261120800697": ("남성", "투자·증설", 3), "20261120900873": ("빅텐츠", "영업 주의", 2),
                "n0001": ("남성", "투자·증설", 2), "없는ref": ("유령", "투자·증설", 3)}
        refs = [b["ref"] for b in batch] + ["없는ref"]
        return {"signals": [{"ref": r, "corp_name": pick[r][0], "need": pick[r][1], "what": "시험", "why": "시험", "strength": pick[r][2]} for r in refs if r in pick]}

    def lead(code, name, pr):
        return {"corp_code": code, "corp_name": name, "need": "차환·상환", "funding": f"{name} 자금 수요", "checks": ["상환 재원"], "exclude_if": "조달 완료", "priority": pr}

    today = str(pipeline._today())
    s = {"signals": signals,
         # 뉴스 검색 담당(검색 API 키가 없을 때): 기간 안 기사 하나, 오래된 기사 · 주소가 없는 기사 · 발행일이 없는 기사
         "articles": lambda b: {"articles": [{"title": "남성, 면목동 개발에 850억 투입", "url": "https://news.example.com/n1", "source": "시험일보", "date": today, "snippet": "남성 850억원 투자", "query": "신규 시설투자 결정"},
                                             {"title": "오래된 기사", "url": "https://news.example.com/old", "date": "2020-01-01", "snippet": "x"},
                                             {"title": "주소 없음", "url": "javascript:alert(1)", "date": today, "snippet": "x"}, {"title": "날짜 없음", "url": "https://news.example.com/nd", "date": "", "snippet": "x"}]},
         "pick": lambda b: {"leads": [lead("00231372", "롯데관광개발", 1), lead("00172185", "남성", 2), lead("00550082", "빅텐츠", 3), lead("99999999", "유령", 4)], "skipped": "롯데쇼핑: 정기 차환"},
         "research": lambda b: {**research_ok(b), "call": "제외", "call_reason": "2026.11.18 PF 대출 약정 공시로 조달 완료"} if "남성" in fakes.first_text(b) else research_ok(b),
         "brief": lambda b: {"headline": "CB 700억원 만기 도래", "funding": ["전환사채 만기 도래: 700억원"], "agenda": ["상환 재원 조달 계획"], "reference": "",
                             "recent": ["2026.11.20 단기차입 400억원 결정"], "open_items": []},
         "verdict": lambda b: {"state": "수정", "fixes": [{"item": "headline", "finding": "만기일 누락", "kind": "일자 누락"}],
                               "patches": [{"section": "headline", "text": "CB 700억원 2026.11.29 만기 도래"}, {"section": "agenda", "items": ["상환 재원 조달 계획", "잔여 300억원 조달 방안"]}], "note": "만기일 보완"}}
    s.update(over)
    return s


class Base(unittest.TestCase):
    def boot(self, scr=None, cap="5", usage=None, dart_missing=()):
        self.sb, self.ai, self.dart = fakes.Supabase(), fakes.Anthropic(scr or script(), usage), fakes.Dart(dart_missing)
        self.tmp = tempfile.TemporaryDirectory()
        core.OUT = Path(self.tmp.name)
        os.environ.update(SUPABASE_URL=self.sb.url, SUPABASE_SERVICE_ROLE_KEY="sb_test", ANTHROPIC_BASE_URL=self.ai.url, ANTHROPIC_API_KEY="k",
                          OPENDART_BASE=self.dart.url, OPENDART_API_KEY="k", DESK_USD_CAP=cap)
        for k in ("NAVER_CLIENT_ID", "NAVER_HUB_CLIENT_ID", "DESK_NEWS_BASE", "SUPPLY_MAP_DB_URL"):
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
        # 대상 선정: 영업 주의(빅텐츠)와 모르는 회사는 빠진다. 선정한 회사는 분석 전에 목록에 있다
        self.assertEqual([l["corp_name"] for l in self.sb.leads], ["롯데관광개발", "남성"])
        self.assertEqual(self.lead("남성")["hypothesis"], "남성 자금 수요")
        # 분석: 미팅 판단이 '제외'면 1pager 를 쓰지 않고, 판단 근거가 제외 사유로 남는다
        self.assertEqual(self.lead("남성")["status"], "기각")
        self.assertIn("PF 대출", self.lead("남성")["note"])
        self.assertEqual(self.ai.count("brief"), 1)
        # 검증의 정정이 반영되어 전달된다
        l = self.lead("롯데관광개발")
        self.assertEqual(l["status"], "게시")
        self.assertEqual((l["brief"]["call"], l["brief"]["headline"]), ("미팅 추천", "CB 700억원 2026.11.29 만기 도래"))
        md = l["brief_md"]
        for part in ("# 롯데관광개발\n", "**미팅 추천** | CB 700억원 2026.11.29 만기 도래", "## 자금 수요\n- 전환사채 만기 도래: 700억원", "## 당사 주관 이력", "## 미팅 아젠다\n1. 상환 재원 조달 계획\n2. 잔여 300억원 조달 방안",
                     "## 최근 동향", "기준일"):
            self.assertIn(part, md)
        # 한 장: 표가 없고, 작업 과정의 말이 없고, 짧다
        self.assertNotIn("|---", md)
        self.assertEqual(render.jargon(md), [])
        self.assertLess(len(md), 900)
        # 표와 출처는 근거 자료에 있다
        for part in ("## 분기 실적", "| 2026.3Q | 100억 | 10억 | -5억 |", "2025.4Q*", "## 차입 및 만기", "차입금 1,400억", "부채비율 200.0%", "| 2026.11.29 | 메자닌 CB 만기 | 700억", "## 조달 이력", "## 출처"):
            self.assertIn(part, l["brief"]["detail_md"])
        self.assertEqual(render.jargon(l["brief"]["detail_md"]), [])
        # 검증 담당은 1pager 만 받는다 (선정 사유·분석 결과는 주지 않는다)
        vreq = next(x for x in self.ai.requests if x["tools"][0]["name"] == "verdict")
        self.assertNotIn("자금 수요 요약", fakes.first_text(vreq))
        self.assertNotIn("[표현 점검]", fakes.first_text(vreq))
        self.assertIn("[1pager]", fakes.first_text(vreq))
        # 호출 기록의 요약도 RM 이 읽을 수 있는 말이다
        sums = {c["agent"]: c.get("summary") for c in self.sb.calls}
        self.assertTrue(sums["monitor.screener"].startswith("선별 "))
        self.assertTrue(sums["verify.checker"].startswith("검증 완료 · 정정 1건"))
        self.assertTrue(any(c["agent"] == "sme.analyst" and c["summary"].startswith("제외 · ") for c in self.sb.calls))
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
        one = script(pick=lambda b: {"leads": [{"corp_code": "00231372", "corp_name": "롯데관광개발", "need": "차환·상환", "funding": "CB 만기", "checks": [], "exclude_if": "", "priority": 1}], "skipped": ""})
        self.boot(one, cap="0.6", usage={"research": {"input_tokens": 150000}})
        r = pipeline.daily()
        self.assertEqual(r["status"], "partial")
        l = self.lead("롯데관광개발")
        self.assertEqual(l["status"], "대기")
        self.assertIsNotNone(l.get("research"))                # 끝난 단계는 저장돼 있다
        self.assertIsNone(l.get("brief"))
        os.environ["DESK_USD_CAP"] = "5"
        n = self.ai.count("signals") + self.ai.count("pick")
        r = pipeline.resume()                                  # 새 대상을 고르지 않고 이어서만 한다
        self.assertEqual(self.ai.count("signals") + self.ai.count("pick"), n)
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
        self.assertNotIn("**롯데관광개발**", (sorted(core.OUT.iterdir())[-1] / "summary.md").read_text(encoding="utf-8").split("## 검증 보류")[0])

    def test_odd_outputs(self):
        """형식이 어긋난 출력(2026-11-22 첫 실제 실행에서 겪은 것): 글로 온 정정, 글 칸에 넣은 표, 정해진 값이 아닌 판단. 결과를 잃지 않고 전달한다."""
        odd = {"state": "수정", "note": "정정", "fixes": ["만기일 누락", {"item": "합계", "finding": "9,050억원"}], "unconfirmed": ["부채비율"],
               "patches": ["headline 을 고칠 것", {"section": "funding", "text": "유동성: 현금 대비 43.7%\n| 일자 | 금액 |\n|---|---|\n| 2027.04.16 | 3,300억 |"}, {"section": "recent", "items": ["2026.11.13 토지 매입 공시"]}]}
        self.boot(script(research=lambda b: {**research_ok(b), "call": "제외 아님"}, verdict=lambda b: odd))
        pipeline.daily()
        for name in ("롯데관광개발", "남성"):
            l = self.lead(name)
            self.assertEqual((l["status"], l["brief"]["call"]), ("게시", "모니터링"), name)   # 정해진 값이 아닌 판단은 제외로 읽지 않는다
        md = self.lead("롯데관광개발")["brief_md"]
        self.assertIn("- 유동성: 현금 대비 43.7%", md)
        self.assertNotIn("| 2027.04.16 | 3,300억 |", md)         # 1pager 에는 표를 넣지 않는다
        self.assertIn("- 2026.11.13 토지 매입 공시", md)
        self.assertEqual(self.lead("롯데관광개발")["verify"]["fixes"][0], {"_text": "만기일 누락"})   # 글로 온 정정도 기록에 남는다
        self.assertTrue(all(c.get("output") for c in self.sb.calls))   # 호출의 출력을 기록에 남긴다

    def test_wording_check(self):
        """1pager 에 작업 과정의 말이 섞이면 검증 담당에게 알려 고치게 하고, 미팅 판단을 바꾸면 반영한다."""
        self.boot(script(brief=lambda b: {"headline": "가설: CB 700억원 만기", "funding": ["신호 3건 확인"], "agenda": ["상환 재원"], "recent": [], "open_items": []},
                         verdict=lambda b: {"state": "수정", "call": "모니터링", "fixes": [], "note": "표현 정정",
                                            "patches": [{"section": "headline", "text": "CB 700억원 만기 도래"}, {"section": "funding", "items": ["전환사채 만기 도래: 700억원"]}]}))
        pipeline.daily()
        vreq = next(x for x in self.ai.requests if x["tools"][0]["name"] == "verdict")
        self.assertIn("[표현 점검]", fakes.first_text(vreq))
        self.assertIn("가설, 신호", fakes.first_text(vreq))
        l = self.lead("롯데관광개발")
        self.assertEqual(render.jargon(l["brief_md"]), [])
        self.assertIn("**모니터링** | CB 700억원 만기 도래", l["brief_md"])

    def test_old_format_is_redone(self):
        """예전 형식(미팅 판단이 없는 분석 · 자금 수요 칸이 없는 1pager)으로 멈춰 있던 대상은 이어 할 때 지금 형식으로 다시 만든다."""
        self.boot()
        self.sb.leads.append({"lead_id": 1, "corp_code": "00231372", "corp_name": "롯데관광개발", "status": "대기", "origin": "daily", "priority": 1, "hypothesis": "CB 만기",
                              "signals": [], "questions": [], "kill": "", "research": {"checks": {"need": {"state": "확인"}}, "kill": {"hit": False}},
                              "brief": {"headline": "옛 1pager", "talking_points": ["상환 계획은?"]}, "brief_md": "## 왜 지금"})
        r = pipeline.resume()
        self.assertEqual((self.ai.count("research"), self.ai.count("brief"), self.ai.count("verdict")), (1, 1, 1))
        l = self.lead("롯데관광개발")
        self.assertEqual((r["status"], l["status"], l["brief"]["call"]), ("done", "게시", "미팅 추천"))
        self.assertNotIn("왜 지금", l["brief_md"])

    def test_redo(self):
        """판단 기준이나 형식을 바꾼 뒤: 최근 선정한 회사를 분석부터 다시 한다. 새 대상은 선정하지 않는다."""
        self.boot()
        pipeline.daily()
        self.assertEqual((self.lead("롯데관광개발")["status"], self.lead("남성")["status"]), ("게시", "기각"))
        n = self.ai.count("signals") + self.ai.count("pick")
        self.ai.script["research"] = research_ok        # 남성도 이번에는 미팅 추천
        r = pipeline.redo()
        self.assertEqual(self.ai.count("signals") + self.ai.count("pick"), n)
        self.assertEqual(self.ai.count("research"), 4)
        self.assertEqual((self.lead("롯데관광개발")["status"], self.lead("남성")["status"]), ("게시", "게시"))
        self.assertIsNone(self.lead("남성")["note"])
        self.assertEqual((r["status"], len(r["leads"])), ("done", 2))
        self.assertEqual(self.sb.runs[r["run_id"]]["kind"], "redo")

    def test_brief_request(self):
        self.boot(script(research=lambda b: {**research_ok(b), "call": "제외", "call_reason": "조달 계획 미확인"}, verdict=lambda b: {"state": "보류", "fixes": [], "note": "자금 수요 미확인"}))
        r = pipeline.brief_for("롯데관광개발")
        self.assertEqual(self.ai.count("signals") + self.ai.count("pick"), 0)   # 모니터링·대상 선정은 건너뛴다
        self.assertEqual(self.lead("롯데관광개발")["status"], "게시")           # RM 이 요청한 회사는 제외·보류하지 않고 판단 근거를 적어 전달한다
        self.assertIn("**모니터링** | CB 700억원 만기 도래", r["leads"][0]["brief_md"])
        self.assertEqual(r["leads"][0]["brief"]["call_reason"], "조달 계획 미확인")


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

    def test_teams(self):
        """대상 선정 뒤에 회사 자료로 대기업팀 · SME팀을 나누고, 팀마다 정해진 수까지만 선정한다."""
        self.assertEqual(agents.track_of({"overview": {"latest_bond_rating": "AA-"}}), "corp")
        self.assertEqual(agents.track_of({"overview": {"bond_deal_count": 3}}), "corp")
        self.assertEqual(agents.track_of({"overview": {}, "financials": {"balance": {"assets": 3e12}}}), "corp")
        self.assertEqual(agents.track_of({"overview": {"mezz_deal_count": 7}, "financials": {"balance": {"assets": 5e11}}}), "sme")
        self.assertEqual(agents.track_of(None), "sme")
        lead = lambda code, name, pr, tr: {"corp_code": code, "corp_name": name, "track": tr, "need": "차환·상환", "funding": f"{name} 자금 수요", "checks": [], "exclude_if": "조달 완료", "priority": pr}
        pick = lambda b: {"leads": [lead("00231372", "롯데관광개발", 1, "sme"), lead("00172185", "남성", 2, "sme")], "skipped": ""}
        self.boot(script(pick=pick, research=research_ok))
        rated = fakes.FX["companies"]["00172185"]["overview"]
        keep = dict(rated)
        self.addCleanup(lambda: (rated.clear(), rated.update(keep)))
        rated.update(latest_bond_rating="A+", bond_deal_count=4)      # 남성: 회사채 등급이 있으면 소싱 담당이 SME 라고 해도 대기업팀
        out = pipeline.daily(force=True)
        by = {(c["item"], c["agent"].split(".")[0]) for c in self.sb.calls if c["agent"].endswith((".analyst", ".writer"))}
        self.assertEqual(by, {("롯데관광개발", "sme"), ("남성", "corp")})
        sysm = {r["system"][0]["text"] for r in self.ai.requests if r["tools"][0]["name"] in ("research", "brief")}
        self.assertTrue(any("[대기업팀]" in x for x in sysm) and any("[SME팀]" in x for x in sysm))
        self.assertEqual({x["corp"]: x["team"] for x in self.sb.runs[out["run_id"]]["summary"]["handoff"]["leads"]}, {"롯데관광개발": "SME팀", "남성": "대기업팀"})
        # 팀마다 자리 수가 따로다: 한 자리씩이면 SME 둘 중 둘째는 선정하지 않고, 대기업 하나는 선정한다
        keep_n = pipeline.TRACK_LEADS
        self.addCleanup(lambda: setattr(pipeline, "TRACK_LEADS", keep_n))
        pipeline.TRACK_LEADS = 1
        rated.clear(); rated.update(keep)
        self.boot(script(pick=pick, research=research_ok))
        pipeline.daily(force=True)
        self.assertEqual([l["corp_name"] for l in self.sb.leads], ["롯데관광개발"])
        rated.update(latest_bond_rating="A+")
        self.boot(script(pick=pick, research=research_ok))
        pipeline.daily(force=True)
        self.assertEqual([l["corp_name"] for l in self.sb.leads], ["롯데관광개발", "남성"])

    def test_supply(self):
        """공급망 DB 를 붙이면 수주 급증 후보와 협력사가 대상 선정에 들어가고, 선정된 회사의 관련 공시와 근거 자료에 남는다."""
        today = pipeline._today()
        k = lambda pct, amt, cp=None: {"dt": str(today), "title": "2차전지 조립설비 | 공급", "counterparty": cp, "counterparty_corp": None, "amount": amt, "pct": pct,
                                       "start": "2026-11-01", "end": "2028-03-31", "rcept_no": "20261101000001"}
        feed = {"latest": str(today - dt.timedelta(days=20)), "items": [
            {"corp_code": "00231372", "corp_name": "롯데관광개발", "market": "Y", "induty_code": "55101", "revenue_year": 2025, "revenue": 300 * E8, "n": 2, "amount": 900 * E8, "pct": 300.0,
             "last_dt": str(today), "contracts": [k(200.0, 600 * E8, "글로벌 배터리 제조사"), k(100.0, 300 * E8)]},
            {"corp_code": "00000041", "corp_name": "시험건설", "market": "K", "induty_code": "41221", "revenue": 100 * E8, "n": 1, "amount": 500 * E8, "pct": 500.0, "contracts": [k(500.0, 500 * E8)]}]}
        sup = [{"corp_code": "00550082", "corp_name": "빅텐츠", "market": "K", "induty_code": "59114", "top_pct": 12.0, "last_dt": str(today),
                "evidence": [{"basis": "공급계약", "dt": str(today), "item": "설비 납품", "amount": 50 * E8, "pct": 12.0, "rcept_no": "20261101000009"}]}]
        pos = {"customers": [{"fiscal_year": 2025, "name": "고객 A", "party_corp": None, "share_pct": 41.2, "segment": None, "rcept_no": "x"}],
               "orders": [{**k(200.0, 600 * E8, "글로벌 배터리 제조사")}], "suppliers": []}
        calls = []

        def fake(sql, args=()):
            calls.append(sql)
            return feed if "orders" in sql else sup if "suppliers" in sql else pos if args[0] == "00231372" else None

        real = supply._call
        supply._call = fake
        self.addCleanup(lambda: setattr(supply, "_call", real))
        self.boot()
        self.assertEqual((supply.orders(today), supply.position("00231372")), (([], None), None))   # 주소가 없으면 조회하지 않는다
        self.assertEqual(calls, [])
        os.environ["SUPPLY_MAP_DB_URL"] = "postgresql://test"
        out = pipeline.daily(force=True)
        user = next(r for r in self.ai.requests if r["tools"][0]["name"] == "pick")["messages"][0]["content"]
        self.assertIn("[수주 급증 후보 (최근 90일 공급계약 공시)]", user)
        self.assertIn("900억원", user)
        self.assertNotIn("시험건설", user)                     # 건설은 뺀다
        self.assertIn("[투자·증설 회사의 협력사]", user)       # 남성(투자·증설)의 협력사
        self.assertNotIn("_url", user)
        lead = self.lead("롯데관광개발")
        self.assertTrue(any("최근 90일 공급계약 2건 · 900억원 · 최근 연매출 대비 300.0%" == s.get("what") and s["url"].endswith("20261101000001") for s in lead["signals"]))
        self.assertEqual(lead["dossier"]["supply"]["customers"][0]["name"], "고객 A")
        self.assertIn("## 주요 고객 및 수주", lead["brief"]["detail_md"])
        self.assertIn("고객 A: 매출의 41.2%", lead["brief"]["detail_md"])
        self.assertIn("2차전지 조립설비 / 공급", lead["brief"]["detail_md"])
        self.assertNotIn("supply", self.lead("남성")["dossier"])   # 공급망 자료가 없는 회사
        self.assertEqual(out["stat"]["supply"], {"orders": 1, "suppliers": 1, "latest": feed["latest"]})
        ho = self.sb.runs[out["run_id"]]["summary"]["handoff"]   # 팀 사이에 오간 자료가 실행 요약에 남는다
        self.assertEqual(len(ho["read"]), out["stat"]["read"])
        self.assertTrue(any(x["picked"] and x["need"] and x["url"] for x in ho["read"]) and any(not x["picked"] for x in ho["read"]))
        self.assertEqual({x["kind"] for x in ho["read"]}, {"공시", "기사"})
        self.assertEqual((ho["orders"][0]["corp"], ho["orders"][0]["amount"], ho["chain"][0]["corp"], ho["chain"][0]["front"]), ("롯데관광개발", "900억원", "빅텐츠", "남성"))
        row = next(x for x in ho["leads"] if x["corp"] == "롯데관광개발")
        self.assertEqual((row["result"], row["research"]["call"], row["verify"]["state"]), ("게시", "미팅 추천", "수정"))
        self.assertTrue(row["scout"]["funding"] and row["scout"]["checks"] and row["brief"]["md"].startswith("# 롯데관광개발") and row["verify"]["fixes"])
        ex = next(x for x in ho["leads"] if x["corp"] == "남성")
        self.assertEqual((ex["result"], ex["brief"], ex["research"]["call"]), ("기각", None, "제외"))
        self.assertLess(len(json.dumps(ho, ensure_ascii=False)), 60000)
        self.assertEqual(out["stat"]["supply_stale"], feed["latest"])
        self.assertIn("공급계약 공시가", (core.OUT / out["run_id"] / "summary.md").read_text(encoding="utf-8"))
        supply._call = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down"))   # 조회가 안 돼도 멈추지 않는다
        self.assertEqual(supply.orders(today), ([], None))
        self.assertEqual(supply.chain([{"corp_code": "00172185", "corp_name": "남성", "signals": [{"need": "투자·증설"}]}], today), [])

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
        rt.start_run("daily")
        self.assertEqual(news.collect(), 1)   # 키가 없으면 뉴스 검색 담당이 웹 검색으로 찾는다. 기간 안이고 주소·발행일이 있는 기사만 넣는다
        row = self.sb.news.pop()
        self.assertEqual((row["url"], row["grp"], row["source"], row["published_at"][:10]), ("https://news.example.com/n1", "투자·증설", "시험일보", str(pipeline._today())))
        req = next(x for x in self.ai.requests if x["tools"][0]["name"] == "articles")
        self.assertTrue(any(t.get("type", "").startswith("web_search") for t in req["tools"]))
        self.assertIn("신규 시설투자 결정", fakes.first_text(req))
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

    def test_render(self):
        md = render.one_pager({"corp_name": "시험", "brief": {"headline": "h", "funding": ["a"] * 9, "agenda": ["b"] * 9, "reference": "사례", "recent": "한 줄", "open_items": []}, "dossier": {}}, "2026-11-22")
        self.assertIn("**모니터링** | h", md)                                   # 판단이 없으면 모니터링
        self.assertEqual((md.count("- a\n"), md.count(". b\n")), (4, 3))         # 칸마다 줄 수 상한
        self.assertIn("3. b\n\n참고 사례: 사례\n", md)
        self.assertIn("## 당사 주관 이력\n- 공모 조달 이력 없음", md)
        self.assertNotIn("## 확인 필요 사항", md)                               # 빈 칸은 제목도 없다
        self.assertIn("## 출처", render.detail({"dossier": {"financials": {"error": "없음"}}}))
        self.assertEqual(render.won(620000000000), "6,200억")
        self.assertEqual(render.won(12300000000000), "12.3조")
        self.assertEqual(tools.calc("85000000000/105500000000*100") > 80, True)

    def test_nh_history(self):
        """당사 주관 이력은 조달 이력 · 만기 목록에서 계산한다(같은 날 여러 회차는 한 번의 발행)."""
        d = lambda day, m, **k: {"deal_dt": day, "lead_managers": m, **k}
        ds = {"deals": [d("2026-06-10", "KB증권, NH투자증권, 삼성증권"), d("2026-06-10", "대신증권, 하나증권"), d("2026-01-30", "KB증권, 한국투자증권"), d("2026-01-30", "삼성증권", nh_lead=True),
                        d("2025-10-31", "부국증권"), d("2025-09-19", "KB증권, NH투자증권")],
              "maturities": [{"event_dt": "2027-04-16", "amount_krw": 3300 * E8, "lead_managers": "KB증권, NH투자증권"}, {"event_dt": "2027-04-30", "amount_krw": 900 * E8, "lead_managers": "삼성증권"},
                             {"event_dt": "2028-06-30", "amount_krw": 500 * E8, "lead_managers": "NH투자증권"}]}
        self.assertEqual(render.nh_lines(ds, "2026-11-22"), ["최근 4회 발행 중 3회 대표주관 참여(2026.06, 2026.01, 2025.09)", "12개월 내 만기 도래분 중 당사 주관 회차 3,300억원(1건)",
                                                              "주요 주관사(최근 4회 발행): KB증권 3회 · 삼성증권 2회 · 대신증권 1회 · 부국증권 1회"])
        self.assertEqual(render.nh_lines({"deals": [d("2026-06-10", "KB증권")]}, "2026-11-22"), ["최근 1회 발행 중 당사 대표주관 이력 없음", "주요 주관사(최근 1회 발행): KB증권 1회"])

    def test_office_config(self):
        """사무실 화면 설정: 부서마다 절차가 있고, 호출 기록에 남는 에이전트가 모두 들어 있다."""
        c = office.config()
        self.assertEqual([d["id"] for d in c["depts"]], ["collect", "monitor", "scout", "corp", "sme", "verify"])
        self.assertTrue(all(d["steps"] for d in c["depts"]))
        self.assertEqual(set(c["agents"]) - {"collect.workflow"}, set(agents.AGENTS))
        for a in c["agents"].values():
            self.assertIn(a["dept"], [d["id"] for d in c["depts"]])
            self.assertTrue(a["role"] and a["name"])
            self.assertTrue(set(a["tools"]) <= set(c["tools"]))
        self.assertEqual(c["agents"]["verify.checker"]["out"]["name"], "verdict")
        # 화면에 그대로 나오는 이름 · 설명에 작업 과정의 말이 없다
        shown = json.dumps([[d["name"], d["sum"], d["steps"]] for d in c["depts"]] + [[a["name"], a["role"], a["desc"]] for a in c["agents"].values()], ensure_ascii=False)
        self.assertEqual(render.jargon(shown), [])
        json.dumps(c)


if __name__ == "__main__":
    unittest.main()
