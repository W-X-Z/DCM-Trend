-- 시장 자료 팩(2026-10-27): 사내 Discussion Material 을 대신하는 공개 자료 기반 갱신.
-- 금통위(10/22) 이후 증권사 국내 기준금리 전망 7곳, 10월 FOMC 프리뷰 기준 미국 전망 10곳, 크레딧·국고채 시장 의견 5건,
-- 금통위·FOMC 핵심 포인트 중 오래된 항목 교체(3Q GDP 속보, 9월 CPI·고용, CME FedWatch 10/26).
-- 모든 문장은 출처 기사·리포트를 사람이 확인해 요약한 것(원문 인용 아님). 사내 이관 시 NH Discussion Material 로 대체.

insert into ref.research_views (house, analysts, published_dt, source_kind, source_title, source_url, stance, next_move, terminal_rate_pct, summary, region, end_2026_pct) values
('메리츠증권','윤여삼','2026-10-22','리포트','한국 금통위 (10월) — 채권전략','https://home.imeritz.com/include/resource/research/WorkFlow/20261022131441556K_02.pdf','인상','11월·내년 2월 인상',3.50,'11월·내년 2월 인상으로 최종 3.50% 추정. 3.75%로 올릴 신호는 찾기 어렵다고 평가','KR',null),
('대신증권','공동락','2026-10-22','기사','[기준금리 동결] 증권사들 "11월 추가 인상"… 최종 3.5% 전망','https://www.g-enews.com/article/General-News/2026/10/202610221529568388e30fcb1ba8_1','인상','11월·내년 1분기 인상',3.50,'11월 3.25%로 인상한 뒤 내년 1분기까지 3.50%에 도달할 것으로 전망','KR',null),
('SK증권','원유승','2026-10-23','기사','한은, 11월 금리 다시 올릴까…최종금리 4.00% 전망도','https://www.dailian.co.kr/news/view/1705400/','인상','11월 인상',3.50,'공급충격 파급·수요측 물가 압력을 근거로 11월 인상, 최종 3.50% 예상(10/18 전망에서 상향)','KR',null),
('키움증권','안예하','2026-10-22','기사','한은, 만장일치 금리 동결에도…증권가 "11월 또 올린다"','https://edaily.co.kr/News/Read?mediaCodeNo=257&newsId=04614966645615544','인상','11월 인상',3.50,'예상보다 덜 매파적인 회의로 평가. 최종금리 3.75% 가능성은 작아졌다고 분석','KR',null),
('한국투자증권','안재균','2026-10-21','기사','10월은 금리 동결, 11월엔 인상?…증권가 "내년까지 긴축 가능성"','https://www.greened.kr/news/articleView.html?idxno=352599','인상','11월 인상 가능성',null,'10월 회의 전 프리뷰에서 11월 인상 가능성에 무게. 최종금리는 제시하지 않음','KR',null),
('IBK투자증권','정용택','2026-10-18','기사','전문가 11명 전원 "10월 금리 동결"…9명 "최종금리 3.5%"','https://supple.kr/news/cmvd2bxem005irooi655xocch','인상','내년 1분기 1회 인상',3.25,'내년 1분기 한 차례 인상으로 3.25% 전망. 외환 변동성 시 인상이 2월로 밀릴 수 있다고 봄','KR',null),
('상상인증권','신얼','2026-10-22','기사','증권가 "한은, 예상된 금리 동결…긴축 종료 아닌 속도 조절"','https://biz.sbs.co.kr/amp/article/20000341553','인상','내년 1분기·2분기 인상',3.50,'다음 인상을 내년 1분기로 보고 최종금리 전망을 3.25%에서 3.50%로 상향','KR',null),
('NH투자증권','강승원','2026-10-26','기사','[미리보는 FOMC] 숨고르기 동결 무게···통화정책 경로 힌트에 쏠린 눈 (서울파이낸스)','https://seoulfn.com/news/articleView.html?idxno=640993','동결','10월 동결·12월 인상',null,'10월 동결과 함께 12월 인상을 시사할 것으로 전망. 이후는 데이터 의존적, 양방향 여지 유지','US',null),
('키움증권','안예하','2026-10-26','기사','[미리보는 FOMC] 숨고르기 동결 무게···통화정책 경로 힌트에 쏠린 눈 (서울파이낸스)','https://seoulfn.com/news/articleView.html?idxno=640993','동결','10월 동결·완만한 긴축',null,'현 인상 기조는 공급충격의 기대인플레 전이를 막는 보험 성격. 공격적 긴축은 피할 것으로 판단','US',null),
('iM증권','박상현','2026-10-15','기사','韓증시 때린 美 물가 쇼크…증권가 "금리 추가 인상·AI 신용 비상" (파이낸셜뉴스)','https://www.fnnews.com/news/202610150955427353','동결','10월 동결·12월/내년 1월 인상 가능',null,'10월 동결 가능성이 높으나 12월·내년 1월 추가 인상 확률이 높다고 봄. 유가 불안 장기화가 관건','US',null),
('대신증권','공동락, 이정훈','2026-10-12','리포트','DAISHIN RESEARCH 주간 금리·환율 전망','https://file.alphasquare.co.kr/media/pdfs/market-report/%EC%A3%BC%EA%B0%8420261013%EB%8C%80%EC%8B%A0%EC%A6%9D%EA%B6%8C.pdf','인상','총 2~3회 인상 후 종료 가정',null,'연준 인상이 과거 점도표 수준인 2~3회에 그치는지가 관건. 미국 최종금리를 환율 변수로 지목','US',null),
('Bank of America',null,'2026-10-15','기사','Major brokerages expect next Fed rate hike in December (Reuters)','https://capital.com/en-ae/news/major-brokerages-expect-next-fed-rate-hike-in-december','인상','10월·12월 인상',null,'주요 IB 중 유일하게 10월 인상을 예상. 10·12월 연속 인상으로 연말 4.25~4.50% 제시','US',4.50),
('Goldman Sachs',null,'2026-10-15','기사','Major brokerages expect next Fed rate hike in December (Reuters)','https://capital.com/en-ae/news/major-brokerages-expect-next-fed-rate-hike-in-december','동결','10월 동결·12월 인상',null,'10월 인상 전망을 12월로 이연. 연내 추가 1회 인상으로 4.00~4.25% 예상','US',4.25),
('J.P. Morgan',null,'2026-10-15','기사','Major brokerages expect next Fed rate hike in December (Reuters)','https://capital.com/en-ae/news/major-brokerages-expect-next-fed-rate-hike-in-december','동결','10월 동결·12월 인상',null,'다음 인상 시점을 12월로 보고 연내 추가 1회 인상으로 4.00~4.25% 예상','US',4.25),
('Morgan Stanley',null,'2026-10-15','기사','Major brokerages expect next Fed rate hike in December (Reuters)','https://capital.com/en-ae/news/major-brokerages-expect-next-fed-rate-hike-in-december','동결','10월 동결·12월 인상',null,'다음 인상 시점을 12월로 보고 연내 추가 1회 인상으로 4.00~4.25% 예상','US',4.25),
('Citigroup',null,'2026-10-15','기사','Major brokerages expect next Fed rate hike in December (Reuters)','https://capital.com/en-ae/news/major-brokerages-expect-next-fed-rate-hike-in-december','동결','10월 동결·12월 인상',null,'다음 인상 시점을 12월로 보고 연내 추가 1회 인상으로 4.00~4.25% 예상','US',4.25),
('Deutsche Bank',null,'2026-10-15','기사','Major brokerages expect next Fed rate hike in December (Reuters)','https://capital.com/en-ae/news/major-brokerages-expect-next-fed-rate-hike-in-december','동결','10월 동결·12월 인상',null,'12월 1회 추가 인상으로 4.00~4.25% 예상. 중립금리 불확실성과 중간선거 전 인상 회피 가능성 고려','US',4.25);

insert into ref.research_notes (house, topic, text, published_dt, source_title, source_url) values
('iM증권','크레딧 시장','10/8~16 국고 3년 -12.9bp·10년 -21.3bp에도 AA- 3년 스프레드는 +1.2bp 확대. 인상기에는 여전채·A급 스프레드가 상대적으로 취약하다고 평가','2026-10-19','"국채금리 급락에도..." 회사채 신용위험 확대 [fn마켓워치]','https://www.fnnews.com/news/202610190849282835'),
('이데일리','우량 회사채','AA- 3년 4.541%, 국고 대비 68.7bp로 7월 이후 65.9~72.3bp 박스권. 연기금 자금 집행으로 북클로징기에도 스프레드 안정','2026-10-16','스프레드 벌어질 때인데…회사채 앞에 줄 선 연기금 뭉칫돈','https://marketin.edaily.co.kr/News/Read?newsId=05195526645613576'),
('하나증권','우량 회사채','10/13~14 수요예측에서 AA급 경쟁률 10~14배·가산 -2~-15bp, A0급 4~8배·-5~+5bp로 우량 구간 수요가 상대적으로 강함','2026-10-21','CrediVille: 하이일드(HY) 아니고 하이센서티브(High-sensitive)','https://file.alphasquare.co.kr/media/pdfs/market-report/%ED%95%98%EC%9D%B4%EC%9D%BC%EB%93%9C%28HY%2920261021%ED%95%98%EB%82%98%EC%A6%9D%EA%B6%8C.pdf'),
('하나증권','비우량 회사채','BBB0 3년 스프레드 연초 496.7bp→511.1bp(+3%), AA-는 50.8→67.7bp(+33%). 신용스프레드는 당분간 약보합~확대 흐름으로 봄','2026-10-21','CrediVille: 하이일드(HY) 아니고 하이센서티브(High-sensitive)','https://file.alphasquare.co.kr/media/pdfs/market-report/%ED%95%98%EC%9D%B4%EC%9D%BC%EB%93%9C%28HY%2920261021%ED%95%98%EB%82%98%EC%A6%9D%EA%B6%8C.pdf'),
('메리츠증권','국고채','국고 3년 적정가치 3.8%, 10년 4.2% 내외로 제시. 금리 반등 시 매수 권고, 플래트닝 방향 유효하다고 봄','2026-10-22','한국 금통위 (10월) — 채권전략','https://home.imeritz.com/include/resource/research/WorkFlow/20261022131441556K_02.pdf');

update ref.policy_meetings set
 points = (select jsonb_agg(case
    when p->>'label'='경제전망' then jsonb_build_object('label','10월 회의 전망','text','CME FedWatch(10/26) 10월 동결 88~91%, 12월 인상 71~73%. 로이터 설문 100명 중 94명 10월 동결 예상')
    when p->>'label'='의사록(10/7)' then jsonb_build_object('label','최근 지표','text','9월 CPI 3.7%(예상 3.6%)·근원 2.6%로 예상 상회, 9월 고용 +2.9만명·실업률 4.2%. 9월 PCE·3Q GDP는 10/29 발표')
    else p end order by ord) from jsonb_array_elements(points) with ordinality as t(p, ord)),
 sources = sources || '[{"title":"Federal Reserve to announce its latest interest rate move this week (CBS News, CME FedWatch)","url":"https://www.cbsnews.com/news/federal-reserve-interest-rates-october-meeting/","date":"2026-10-26"},{"title":"US September CPI 3.7% vs 3.6% expected (investingLive)","url":"https://investinglive.com/news/us-september-cpi-vs-3-6-expected-0/","date":"2026-10-14"}]'::jsonb,
 collected_dt = date '2026-10-27'
where kind='FOMC' and meeting_dt='2026-09-16';

update ref.policy_meetings set
 points = (select jsonb_agg(case
    when p->>'label'='점도표' then jsonb_build_object('label','이후 지표','text','3Q GDP 속보(10/27) 전기비 +1.0%(8월 전망 0.3%)·전년비 3.4%. 10월 소비자물가는 11/2 발표, 11/26 회의에서 수정 전망·점도표 공표')
    else p end order by ord) from jsonb_array_elements(points) with ordinality as t(p, ord)),
 sources = sources || '[{"title":"3분기 실질 GDP 속보치 (이투데이)","url":"https://www.etoday.co.kr/news/view/2640332","date":"2026-10-27"}]'::jsonb,
 collected_dt = date '2026-10-27'
where kind='금통위' and meeting_dt='2026-10-22';
