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

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&#160;': ' ' };

export function stripXml(xml) {
  return xml
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

  // 1) 회차별 요약표 (첫 값·마지막 값)
  const blocks = [...text.matchAll(/회차\s*:\s*\|\s*([0-9]+(?:-[0-9]+)?)\s*\|(.{0,1500}?)(?=회차\s*:\s*\||$)/g)];
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
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*년\s*만기\s*회사채\s*(?:개별|등급)\s*민평\s*수익률[^~|]{0,160}?에\s*([+-]?\d+(?:\.\d+)?)\s*%\s*p\.?\s*를\s*가산/g)) {
    spreads.set(m[1], Math.round(Number(m[2]) * 100));
  }
  for (const [years, bp] of spreads) push('final_spread_bp_by_tenor', years, bp);

  // 5) 수요예측 결과 (회차별 합계 = 행의 마지막 값)
  const lastNum = (row) => {
    const vals = [...row.matchAll(/\|\s*([\d,]+(?:\.\d+)?)\s*(?::\s*1)?\s*(?=\||$)/g)].map((x) => num(x[1])).filter((v) => v !== null);
    return vals.length ? vals[vals.length - 1] : null;
  };
  const demandRe = /(?:\[\s*회\s*차\s*:\s*제?\s*([0-9]+(?:-[0-9]+)?)\s*회?\s*\])?[^[]{0,900}?\|\s*건수((?:\s*\|\s*[\d,\-]+)+)\s*\|\s*수량((?:\s*\|\s*[\d,\-]+)+)\s*\|\s*경쟁률((?:\s*\|\s*(?:[\d.,]+\s*:\s*1|-))+)/g;
  const unitEok = /단위\s*:\s*건\s*,\s*억원/.test(text);
  for (const m of text.matchAll(demandRe)) {
    const series = m[1] ? normSeries(m[1]) : null;
    const count = lastNum(m[2]);
    const qty = lastNum(m[3]);
    const ratio = lastNum(m[4].replace(/\s*:\s*1/g, ''));
    push('demand_count', series, count);
    push('demand_krw', series, qty !== null ? (unitEok ? qty * 1e8 : qty) : null);
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
  const finals = [...text.matchAll(/확정\s*공모\s*가(?:액|격)?[^0-9|]{0,24}\|?\s*(?:금\s*)?([\d,]{3,})\s*원/g)].map((m) => num(m[1])).filter(Boolean);
  if (finals.length) push('offer_price_final', finals[finals.length - 1]);
  // 수요예측 결과 표의 경쟁률 행: 숫자가 3개 이상 이어진 행 중 마지막 값(합계)
  const rows = [...text.matchAll(/경쟁률((?:\s*\|\s*[\d,]+(?:\.\d+)?\s*(?::\s*1)?){3,})/g)];
  if (rows.length) {
    const vals = [...rows[rows.length - 1][1].matchAll(/([\d,]+(?:\.\d+)?)/g)].map((x) => num(x[1]));
    push('demand_ratio', vals[vals.length - 1]);
  }
  const lock = text.match(/의무\s*보유\s*확약[^|]{0,40}\|?[^|]{0,20}?(\d+(?:\.\d+)?)\s*%/);
  if (lock) push('lockup_pct', num(lock[1]));
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

export function parseByPurpose(purpose, xml) {
  const text = stripXml(xml);
  if (purpose === 'bond') return parseBond(text);
  if (purpose === 'ipo') return parseIpo(text);
  if (purpose === 'mezz') return parseMezz(text);
  return [];
}
