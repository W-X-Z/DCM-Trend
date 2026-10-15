-- 후보 규칙에 회사명 제외 패턴 추가 (인더스트리 커버리지 기준: 금융사·공기업(특수채)·스팩·리츠 제외)
-- 실데이터 첫 실행에서 한국전력공사·삼성생명(단기 차입 의존), 스팩 해산(이슈) 같은 후보가 섞여 나왔다.
-- 감자는 자사주 소각 등 일상 공시가 많아 위기 신호에서 뺐다.
alter table ref.signal_rules add column if not exists exclude_pattern text;

update ref.signal_rules set label_ko = '회생·영업정지·해산·부도', report_pattern = '(회생절차|영업정지|해산\s*사유|부도)',
       note = '감자는 자사주 소각 등 일상 공시가 많아 뺐다'
 where signal_key = 'distress';
update ref.signal_rules set exclude_pattern = '(기업인수목적|스팩|부동산투자|리츠)'
 where signal_key in ('invest', 'put_due', 'cb_buyback', 'hybrid', 'first_issue', 'weak_demand', 'restructure', 'distress', 'big_dilution');
update ref.signal_rules set exclude_pattern = '(캐피탈|카드|증권|은행|금융지주|생명|화재|보험|자산관리|리드코프|대부|기업인수목적|스팩|리츠)'
 where signal_key = 'refi_due';
update ref.signal_rules set exclude_pattern = '(캐피탈|카드|증권|은행|금융지주|생명|화재|보험|자산관리|리드코프|대부|공사$|공단$|기업인수목적|스팩|리츠)'
 where signal_key = 'cp_reliant';
