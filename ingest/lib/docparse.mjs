// 신고서 원문(document.xml)에서 필요한 값만 뽑는다.
// DART 원문 XML 은 형식이 깨진 경우가 많아(본문의 '<' 등) XML 파서 대신 태그를 지운 텍스트에 정규식을 쓴다.
// 표 칸은 '|' 로 구분한다. 결과는 raw.doc_fields 에 (필드, 회차, 값)으로 저장하고 해석은 SQL 이 한다.
//
// 실측 형식 (2026-10, GS 22회·이랜드월드 108회·디티에스 IPO·리메드 CB)
// - 회사채 요약표: "회차 : |22-1 |... 모집(매출)총액 |50,000,000,000 |... 이자율 |- |발행수익률 |- |상환기일 |2028년 10월 21일"
//   정정 전·정정 후·본문에 같은 표가 여러 번 나온다 → 회차별 첫 값 = 최초 신고, 마지막 값 = 확정
// - 신용등급: "평가일 |신용평가기관 |등 급 |2026년 10월 07일 |한국신용평가 |회사채 (AA0) |..."
// - 공모희망금리: "... 개별민평 수익률의 산술평균 ... 에 -0.30%p.~+0.30%p.를 가산한 이자율"
// - 확정 가산금리: "... 2년 만기 회사채 개별민평 수익률 ... 에 -0.11%p.를 가산한 이자율로 한다"
// - 수요예측: "[회 차 : 제22-1회] (단위: 건, 억원) ... 건수 |8 |18 |... |36 |수량 |900 |... |6,500 |경쟁률 |1.80 : 1 |... |13.00 : 1"
// - IPO 밴드: "희망공모가액 |17,000원 ~ 18,500원", 수요예측 경쟁률 행: "경쟁률 |394.85 |99.20 |... |983.98"
// - 메자닌 풋: 표 "1차 |2028-08-27 |2028-09-26 |2028-10-26 |..." 또는 "발행일로부터 24개월이 되는 날"
// - 기준금리 확정 후 두 번째 [발행조건확정] (이랜드월드 108회·롯데케미칼 64회): "[회차: 108] 이자율: 6.306% 발행수익률: 6.306%"
//   가산금리 문장은 "1년 만기 무보증 회사채 개별민평", "AAA등급 은행채 3년 만기 등급민평" 처럼 사이에 낱말이 끼기도 한다
// - 한 딜의 수요예측·가산금리와 확정 금리가 서로 다른 공시에 나뉘어 있으므로 합치는 일은 SQL(core.deal_doc_value)이 한다

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&#160;': ' ' };

export function stripXml(xml) {
  return xml
    // 거래소 공시 원문은 HTML 이라 <STYLE> 블록이 본문 앞에 온다 → 내용째 지운다
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(TD|TH|TE|TU)\b[^>]*>/gi, '|')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#160);/g, (m) => ENT[m] ?? m)
    .replace(/\s+/g, ' ');
}

const num = (s) => {
  if (s == null) return null;
  const t = String(s).replace(/[,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

const ymdKr = (s) => {
  const m = String(s ?? '').match(/(\d{4})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
};

const normSeries = (s) => String(s ?? '').replace(/^제\s*/, '').replace(/\s*회$/, '').replace(/\s+/g, '').trim();

// 회사채 ----------------------------------------------------------------------
export function parseBond(text) {
  const out = [];
  const push = (field, series, value) => {
    if (value === null || value === undefined || value === '') return;
    out.push({ field, series: series ?? null, value: String(value) });
  };

  // 1) 회차별 요약표 (첫 값·마지막 값). 표 사이 간격이 길어 다음 표까지가 아니라 최대 1,500자만 본다.
  const heads = [...text.matchAll(/회차\s*:\s*\|\s*([0-9]+(?:-[0-9]+)?)\s*\|/g)];
  const blocks = heads.map((h, i) => {
    const start = h.index + h[0].length;
    const end = Math.min(i + 1 < heads.length ? heads[i + 1].index : text.length, start + 1500);
    return [null, h[1], text.slice(start, end)];
  });
  const seen = new Map();
  for (const [, s, body] of blocks) {
    const series = normSeries(s);
    const amount = num(body.match(/모집\(매출\)총액\s*\|\s*([\d,]+)/)?.[1]);
    const coupon = num(body.match(/이자율\s*\|\s*([\d.]+)\s*%?/)?.[1]);
    const yld = num(body.match(/발행수익률\s*\|\s*([\d.]+)\s*%?/)?.[1]);
    const maturity = ymdKr(body.match(/상환기일\s*\|\s*([^|]+)/)?.[1]);
    const rec = seen.get(series) ?? { first: null, last: null };
    if (amount !== null) {
      rec.first ??= amount;
      rec.last = amount;
    }
    if (coupon !== null) rec.coupon = coupon;
    if (yld !== null) rec.yield = yld;
    if (maturity) rec.maturity = maturity;
    seen.set(series, rec);
  }
  // 기준금리 확정 후 정정 표: "[회차: 108] 이자율: 6.306% 발행수익률: 6.306%", "[회차 : 64]발행수익률(%): 4.497 연리이자율(%): 4.497"
  for (const m of text.matchAll(/\[\s*회\s*차\s*:\s*([0-9]+(?:-[0-9]+)?)\s*\]([^[|]{0,160})/g)) {
    const series = normSeries(m[1]);
    const coupon = num(m[2].match(/(?:연리)?이자율\s*(?:\(\s*%\s*\))?\s*:\s*(\d+\.\d+)/)?.[1]);
    const yld = num(m[2].match(/발행수익률\s*(?:\(\s*%\s*\))?\s*:\s*(\d+\.\d+)/)?.[1]);
    if (coupon === null && yld === null) continue;
    const rec = seen.get(series) ?? { first: null, last: null };
    if (coupon !== null) rec.coupon = coupon;
    if (yld !== null) rec.yield = yld;
    seen.set(series, rec);
  }
  for (const [series, r] of seen) {
    push('amount_initial', series, r.first);
    push('amount_final', series, r.last);
    push('coupon_pct', series, r.coupon);
    push('yield_pct', series, r.yield);
    push('maturity_dt', series, r.maturity);
  }

  // 2) 신용등급 (등급표의 등급 칸들)
  const ratings = [];
  for (const m of text.matchAll(/신용평가기관\s*\|\s*등\s*급\s*\|((?:[^|]{0,60}\|){3,24})/g)) {
    for (const r of m[1].matchAll(/(?:회사채|무보증사채|사채|신용등급)?\s*\(?\s*(AAA|AA[+0-]?|A[+0-]?|BBB[+0-]?|BB[+0-]?|B[+0-]?|CCC|CC|D)\s*\)?\s*(?:\(\s*[A-Za-z가-힣]+\s*\))?\s*\|/g)) {
      ratings.push(r[1]);
    }
  }
  if (ratings.length) push('rating_raw', null, [...new Set(ratings)].join(','));

  // 3) 공모희망금리 밴드
  const spreadBand = text.match(/(개별|등급)\s*민평[^~|]{0,160}?([+-]?\d+(?:\.\d+)?)\s*%\s*p\.?\s*~\s*([+-]?\d+(?:\.\d+)?)\s*%\s*p/);
  const ktbBand = text.match(/국고채[^~|]{0,120}?([+-]?\d+(?:\.\d+)?)\s*%\s*p\.?\s*~\s*([+-]?\d+(?:\.\d+)?)\s*%\s*p/);
  const fixedBand = text.match(/공모\s*희망\s*금리[^~|%]{0,40}\|?\s*(?:연\s*)?(\d+\.\d+)\s*%\s*~\s*(?:연\s*)?(\d+\.\d+)\s*%/);
  if (spreadBand) {
    push('band_type', null, `${spreadBand[1]}민평`);
    push('band_low_bp', null, Math.round(Number(spreadBand[2]) * 100));
    push('band_high_bp', null, Math.round(Number(spreadBand[3]) * 100));
  } else if (ktbBand) {
    push('band_type', null, '국고채');
    push('band_low_bp', null, Math.round(Number(ktbBand[1]) * 100));
    push('band_high_bp', null, Math.round(Number(ktbBand[2]) * 100));
  } else if (fixedBand) {
    push('band_type', null, '고정금리');
    push('band_low_pct', null, Number(fixedBand[1]));
    push('band_high_pct', null, Number(fixedBand[2]));
  }

  // 4) 확정 가산금리 (만기 연수별, 범위가 아닌 한 값)
  const spreads = new Map();
  // "2년 만기 회사채 개별민평", "1년 만기 무보증 회사채 개별민평", "AAA등급 은행채 3년 만기 등급민평"
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*년\s*만기\s*(?:[가-힣]+\s*){0,2}?(?:개별|등급)\s*민평\s*수익률[^~|]{0,160}?에\s*([+-]?\d+(?:\.\d+)?)\s*%\s*p\.?\s*를\s*가산/g)) {
    spreads.set(m[1], Math.round(Number(m[2]) * 100));
  }
  for (const [years, bp] of spreads) push('final_spread_bp_by_tenor', years, bp);

  // 5) 수요예측 결과 (회차별 합계 = 행의 마지막 값)
  const lastNum = (row) => {
    const vals = [...row.matchAll(/\|\s*([\d,]+(?:\.\d+)?)\s*(?::\s*1)?\s*(?=\||$)/g)].map((x) => num(x[1])).filter((v) => v !== null);
    return vals.length ? vals[vals.length - 1] : null;
  };
  const demandRe = /(?:\[\s*회\s*차\s*:\s*제?\s*([0-9]+(?:-[0-9]+)?)\s*회?\s*\])?[^[]{0,900}?\|\s*건수((?:\s*\|\s*[\d,\-]+)+)\s*\|\s*수량((?:\s*\|\s*[\d,\-]+)+)\s*\|\s*경쟁률((?:\s*\|\s*(?:[\d.,]+\s*:\s*1|-))+)/g;
  // 수량 단위는 표 바로 위 "(단위: 건, 억원)" 에서 읽는다. 표기가 없으면 억원으로 본다(원 단위면 1억 미만일 수 없다).
  const unitOf = (win) => {
    const u = [...win.matchAll(/단위\s*:\s*([^)|]{0,30})/g)].pop()?.[1] ?? '';
    return /백만\s*원/.test(u) ? 1e6 : /억\s*원/.test(u) ? 1e8 : /(?:^|[\s,])원/.test(u) ? 1 : null;
  };
  for (const m of text.matchAll(demandRe)) {
    const series = m[1] ? normSeries(m[1]) : null;
    const count = lastNum(m[2]);
    const qty = lastNum(m[3]);
    const ratio = lastNum(m[4].replace(/\s*:\s*1/g, ''));
    let unit = unitOf(m[0].slice(0, m[0].indexOf('건수'))) ?? 1e8;
    if (unit === 1 && qty !== null && qty < 1e8) unit = 1e8;
    push('demand_count', series, count);
    push('demand_krw', series, qty !== null ? qty * unit : null);
    push('competition_ratio', series, ratio);
  }
  return out;
}

// IPO -------------------------------------------------------------------------
export function parseIpo(text) {
  const out = [];
  const push = (field, value) => value !== null && value !== undefined && out.push({ field, series: null, value: String(value) });
  const band = text.match(/희망\s*공모\s*가액\s*\|?\s*(?:금\s*)?([\d,]+)\s*원\s*~\s*(?:금\s*)?([\d,]+)\s*원/);
  if (band) {
    push('band_low', num(band[1]));
    push('band_high', num(band[2]));
  }
  // 확정공모가: ① 표 칸 "1주당 확정공모가액 |18,500원" ② 문장 "공모가액을 10,000원으로 확정" ③ 공모개요 표(정정 후)의 모집가액.
  // "확정공모가액이 23,445원 이상으로 결정되는 경우", "확정공모가액 기준 취득가격(18,034원)" 같은 조건 문장은 쓰지 않는다.
  const last = (re) => [...text.matchAll(re)].map((m) => num(m[1])).filter(Boolean).pop() ?? null;
  const overview = [...text.matchAll(/기명식\s*보통주\s*\|\s*([\d,]+)\s*\|\s*([\d,]+)\s*\|\s*([\d,]+)\s*\|\s*([\d,]+)/g)]
    .map((m) => [num(m[1]), num(m[3]), num(m[4])])
    .filter(([q, p, t]) => q && p && t && Math.abs(q * p - t) <= t * 0.001)
    .map(([, p]) => p);
  let final =
    last(/확정\s*공모\s*가(?:액|격)\s*\|\s*(?:금\s*)?([\d,]{3,})\s*원/g) ??
    last(/공모\s*가(?:액|격)?(?:은|는|을|를|이|가)?\s*(?:1주당\s*)?(?:금\s*)?([\d,]{3,})\s*원\s*(?:으로|로)\s*(?:최종\s*)?(?:확정|결정)/g) ??
    overview.pop() ??
    null;
  const lo = band ? num(band[1]) : null;
  const hi = band ? num(band[2]) : null;
  if (final && lo && hi && (final < lo * 0.5 || final > hi * 1.5)) final = null;
  if (final) push('offer_price_final', final);
  // 수요예측 결과 표의 경쟁률 행: 숫자가 3개 이상 이어진 행 중 마지막 값(합계)
  const rows = [...text.matchAll(/경쟁률((?:\s*\|\s*[\d,]+(?:\.\d+)?\s*(?::\s*1)?){3,})/g)];
  if (rows.length) {
    const vals = [...rows[rows.length - 1][1].matchAll(/([\d,]+(?:\.\d+)?)/g)].map((x) => num(x[1]));
    push('demand_ratio', vals[vals.length - 1]);
  }
  // 의무보유 확약 비율은 확약기간별 참여내역 표를 합산해야 해서 아직 읽지 않는다(문장 정규식은 0% 오탐이 많았다).
  return out;
}

// 메자닌 (조기상환청구권) ------------------------------------------------------
export function parseMezz(text, issueDate = null) {
  const out = [];
  const sec = text.match(/조기상환\s*청구권\s*\(\s*Put\s*Option\s*\)(.{0,6000})/i)?.[1] ?? '';
  if (!sec) return out;
  const firstRow = sec.match(/\|\s*1\s*차\s*\|\s*(\d{4}[-.]\d{2}[-.]\d{2})\s*\|\s*(\d{4}[-.]\d{2}[-.]\d{2})\s*\|\s*(\d{4}[-.]\d{2}[-.]\d{2})/);
  if (firstRow) {
    out.push({ field: 'put_first_payment_dt', series: null, value: firstRow[3].replace(/\./g, '-') });
    out.push({ field: 'put_first_request_dt', series: null, value: firstRow[1].replace(/\./g, '-') });
    return out;
  }
  const months = sec.match(/발행일\s*(?:로|으로)?부터\s*(\d+)\s*개월/);
  if (months) out.push({ field: 'put_after_months', series: null, value: months[1] });
  const ytp = sec.match(/연\s*(?:복리|단리)?\s*(\d+(?:\.\d+)?)\s*%/);
  if (ytp) out.push({ field: 'put_yield_pct', series: null, value: ytp[1] });
  return out;
}

// 거래소 공시 (단기차입금·시설투자·최대주주변경·양수도·채무보증·담보제공·손익구조·단일판매) -----------
// 서식이 "라벨 칸 | 값 칸" 표라서 칸으로 나눈 뒤 라벨을 찾고 다음 칸을 읽는다.
// 필드 이름은 '화면 라벨:단위'(krw/pct/date/count/text) → SQL(core.fmt_field)이 표시 형식을 만든다.
// 실측 (2026-10): 에스엠국일 단기차입금, HMM 신규시설투자, 비츠로시스 채무보증, 에이프로젠 담보제공, 풍강 손익구조,
//                 제일엠앤에스 최대주주변경, 블루엠텍 주식양수도, 서울전자통신 경영권변경, HDC 단일판매
const labelKey = (c) => c.replace(/^[\s\d.\-ㆍ·]+/, '').replace(/\s+/g, '');
const TEXT_MAX = 80;

export function disclosureKind(head) {
  const h = head.replace(/\s+/g, '');
  if (/원리금(미지급|지급불능)|기한의이익/.test(h)) return 'bond_default';
  if (/단기차입금증가/.test(h)) return 'stdebt';
  if (/신규시설투자/.test(h)) return 'capex';
  if (/주식양수도/.test(h)) return 'transfer';
  if (/경영권변경/.test(h)) return 'control_contract';
  if (/주식담보제공/.test(h)) return null;
  if (/최대주주변경/.test(h)) return 'control';
  if (/채무보증결정/.test(h)) return 'guarantee';
  if (/담보제공결정/.test(h)) return 'collateral';
  if (/손익구조/.test(h)) return 'pl';
  if (/단일판매|공급계약/.test(h)) return 'contract';
  if (/횡령|배임/.test(h)) return 'embezzle';
  return null;
}

export function parseDisclosure(text) {
  const cells = text.split('|').map((c) => c.trim());
  const keys = cells.map(labelKey);
  const out = [];
  const seen = new Set();
  const push = (field, value) => {
    if (value === null || value === undefined) return;
    const v = String(value).trim();
    if (!v || v === '-' || seen.has(field)) return;
    seen.add(field);
    out.push({ field, series: null, value: v.length > TEXT_MAX ? `${v.slice(0, TEXT_MAX - 1)}…` : v });
  };
  const at = (re, from = 0) => keys.findIndex((k, i) => i >= from && re.test(k));
  // 라벨 다음 n번째 칸
  const val = (re, n = 1, from = 0) => {
    const i = at(re, from);
    return i >= 0 ? cells[i + n] ?? null : null;
  };
  const krw = (s, mult = 1) => {
    const v = num(s);
    return v === null ? null : String(v * mult);
  };
  const pct = (s) => (num(s) === null ? null : String(num(s)));
  const date = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? '').trim()) ? String(s).trim() : ymdKr(s));

  // 종류는 제목('회사/공시명/(날짜)')으로만 판단한다. 본문 앞부분(변경사유 '주식양수도계약에 따른 …')에 끌려가지 않게
  const title = text.match(/\/\s*([^/|]{2,120}?)\s*\/\s*\(\d{4}\.\d{2}\.\d{2}\)/)?.[1] ?? text.slice(0, 200);
  const kind = disclosureKind(title);
  if (!kind) return out;
  const equityRatio = () => push('자기자본 대비:pct', pct(val(/^자기자본대비\(%\)$/)));

  if (kind === 'stdebt') {
    push('차입금액:krw', krw(val(/^차입금액\(원\)$/)));
    equityRatio();
    push('차입 후 단기차입금:krw', krw(val(/^단기차입금합계\(원\)$/, 2)));
    push('차입 목적:text', val(/^차입목적$/));
    push('차입 형태:text', val(/^차입형태$/));
  } else if (kind === 'capex') {
    push('투자 대상:text', val(/^투자대상$/));
    push('투자금액:krw', krw(val(/^투자금액\(원\)$/)));
    equityRatio();
    push('투자 목적:text', val(/^투자목적$/));
    push('투자 종료일:date', date(val(/^종료일$/, 1, Math.max(0, at(/^투자기간$/)))));
  } else if (kind === 'guarantee' || kind === 'collateral') {
    push('채무자:text', val(/^채무자$/));
    push('채무자와의 관계:text', val(/^회사와의관계$/));
    push('채권자:text', val(/^채권자$/));
    push('채무금액:krw', krw(val(/^채무\(차입\)금액\(원\)$/)));
    if (kind === 'guarantee') {
      push('채무보증금액:krw', krw(val(/^채무보증금액\(원\)$/)));
      equityRatio();
      push('채무보증 총잔액:krw', krw(val(/^채무보증총잔액\(원\)$/)));
    } else {
      push('담보제공금액:krw', krw(val(/^담보(설정|제공)금액\(원\)$/)));
      equityRatio();
      push('담보 재산:text', val(/^담보제공재산$/));
      push('담보제공 총잔액:krw', krw(val(/^담보제공총잔액\(원\)$/)));
    }
  } else if (kind === 'pl') {
    const u = text.match(/변동내용\s*\(\s*단위\s*:\s*(백만원|천원|원)\s*\)/)?.[1] ?? '원';
    const mult = u === '백만원' ? 1e6 : u === '천원' ? 1e3 : 1;
    push('재무제표:text', val(/^재무제표의종류$/));
    const start = Math.max(0, at(/변동내용/));
    const row = (re) => {
      const i = at(re, start);
      return i >= 0 ? { cur: cells[i + 1], prev: cells[i + 2], rate: cells[i + 4], turn: cells[i + 5] } : null;
    };
    const turns = [];
    for (const [label, re] of [['매출액', /^매출액$/], ['영업이익', /^영업이익$/], ['당기순이익', /^당기순이익$/]]) {
      const r = row(re);
      if (!r) continue;
      push(`${label}:krw`, krw(r.cur, mult));
      push(`직전 ${label}:krw`, krw(r.prev, mult));
      push(`${label} 증감률:pct`, pct(r.rate));
      if (r.turn && /전환/.test(r.turn)) turns.push(`${label} ${r.turn}`);
    }
    push('흑자·적자 전환:text', turns.join(', '));
    push('변동 주요원인:text', val(/변동주요원인$/));
  } else if (kind === 'control') {
    const before = at(/^변경전$/);
    const after = at(/^변경후$/, before + 1);
    if (before >= 0) {
      push('변경 전 최대주주:text', val(/^최대주주등$/, 1, before));
      push('변경 전 지분율:pct', pct(val(/^소유비율\(%\)$/, 1, before)));
    }
    if (after >= 0) {
      push('변경 후 최대주주:text', val(/^최대주주등$/, 1, after));
      push('변경 후 지분율:pct', pct(val(/^소유비율\(%\)$/, 1, after)));
    }
    push('변경 사유:text', val(/^변경사유$/));
    push('인수자금 차입금:krw', krw(val(/^차입금\(원\)$/)));
    push('차입처:text', val(/^차입처$/));
  } else if (kind === 'transfer' || kind === 'control_contract') {
    push('양도인:text', val(/^양도인$/));
    push('양수인:text', val(/^양수인$/));
    if (kind === 'control_contract') push('계약 목적물:text', val(/^계약의목적물$/));
    push('양수도 주식수:count', pct(val(/^양수도주식수\(주\)$/)));
    push('양수금액:krw', krw(val(/^양수도대금\(원\)$/)));
    push('예정 지분율:pct', pct(val(/^예정소유비율\(%\)$/)));
    push('변경 예정일:date', date(val(/^변경예정일자$/)));
  } else if (kind === 'contract') {
    push('계약명:text', val(/^체결계약명$/));
    push('계약금액:krw', krw(val(/^계약금액\(원\)$/)));
    push('매출액 대비:pct', pct(val(/^매출액대비\(%\)$/)));
    push('계약 상대:text', val(/^계약상대$/));
  } else if (kind === 'embezzle') {
    push('발생 금액:krw', krw(val(/금액\(원\)$/)));
    equityRatio();
  } else if (kind === 'bond_default') {
    // "1. 미지급금액 | 원금(원) | … | 합계(원) | 3,500,000,000" , 내역 표 "사채종류 … | 전환사채 | 제8회 |"
    push('미지급 금액:krw', krw(val(/^합계\(원\)$/)) ?? krw(val(/(미지급|지급불능).*금액.*\(원\)$/)));
    equityRatio();
    const kindRow = text.match(/(전환사채|신주인수권부사채|교환사채|무보증사채|회사채|사채)\s*\|\s*(제?\s*[\d-]+\s*회)\s*\|/);
    push('사채 종류:text', kindRow ? `${kindRow[1]} ${kindRow[2].replace(/\s+/g, '')}` : null);
    push('미지급 사유:text', val(/^미지급사유(및대책)?$/)?.replace(/^1\)\s*미지급\s*사유\s*/, ''));
  }
  return out;
}

export function parseByPurpose(purpose, xml) {
  const text = stripXml(xml);
  if (purpose === 'bond') return parseBond(text);
  if (purpose === 'ipo') return parseIpo(text);
  if (purpose === 'mezz') return parseMezz(text);
  if (purpose === 'disclosure') return parseDisclosure(text);
  return [];
}
