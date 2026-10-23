// AI 문안 검증: 사실 묶음에 없는 숫자, 근거 없는 전망·단정 표현이 있는 줄은 버리고 규칙 문안으로 채운다.
import type { DeckText } from './types';

const NUM = /\d+(?:[.,]\d+)*/g;
const norm = (s: string) => {
  const v = Number(s.replace(/,/g, ''));
  return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : s;
};

export function allowedNumbers(...sources: unknown[]) {
  const set = new Set<string>();
  for (const src of sources) {
    const s = typeof src === 'string' ? src : JSON.stringify(src);
    for (const m of s.match(NUM) ?? []) {
      set.add(norm(m));
      // 26.12.10 같은 날짜 조각도 허용
      for (const part of m.split('.')) set.add(norm(part));
    }
  }
  return set;
}

// 시장 예측: 금리·스프레드·수요 등의 방향을 예상하는 문장. 하우스(출처)를 밝힌 인용만 허용한다.
// NH 의 제안 판단('~이 적합하다고 판단', '~제안', '~필요')은 시장 방향을 예측하지 않는 한 허용한다(숫자는 사실 묶음 안에서만).
const FORECAST = /(것으로\s*(보인다|보임|보여|예상|전망)|예상됨|예상된다|예상되며|전망됨|전망된다|전망되며|할\s*것|될\s*것|기대됨|기대된다|가능성)/;
const MARKET = /(금리|스프레드|국고채|회사채\s*시장|기준금리|수요|경쟁률|발행\s*여건|크레딧)[^.,]{0,24}(상승|하락|인상|인하|확대|축소|강세|약세|반등|증가|감소|개선|악화|안정|충분|부족|흥행|미달|양호|견조|회복|둔화)/;
const ABSOLUTE = /(확실|보장|틀림없|반드시\s*(성공|흥행))/;
const HOUSE = /(증권|리서치|하우스|연구원|한국은행|연준|Fed|FOMC|위원)/;

export function lineOk(line: string, allowed: Set<string>, allowForecast: boolean) {
  const bad = (line.match(NUM) ?? []).filter((m) => !allowed.has(norm(m)) && !m.split('.').every((p) => allowed.has(norm(p))));
  if (bad.length) return { ok: false, why: `숫자 ${bad.join(', ')}` };
  if (ABSOLUTE.test(line)) return { ok: false, why: '단정 표현' };
  if (FORECAST.test(line) && MARKET.test(line) && !(allowForecast && HOUSE.test(line))) return { ok: false, why: '출처 없는 시장 전망' };
  if (line.length > 180) return { ok: false, why: '너무 김' };
  return { ok: true, why: '' };
}

// 필드별로 검증하고, 통과한 줄이 없으면 규칙 문안을 쓴다
export function mergeValidated(ai: Partial<DeckText>, rule: DeckText, allowed: Set<string>) {
  const dropped: { field: string; line: string; why: string }[] = [];
  const list = (k: keyof DeckText, forecast = false): string[] => {
    const xs = (ai[k] as string[] | undefined) ?? [];
    const ok = xs.filter((l) => {
      const v = lineOk(l, allowed, forecast);
      if (!v.ok) dropped.push({ field: k, line: l, why: v.why });
      return v.ok;
    });
    return ok.length ? ok : (rule[k] as string[]);
  };
  const leadOk = ai.lead && lineOk(ai.lead, allowed, false).ok;
  if (ai.lead && !leadOk) dropped.push({ field: 'lead', line: ai.lead, why: lineOk(ai.lead, allowed, false).why });
  const rows = (ai.structureRows ?? []).filter((r) => r && lineOk(`${r.label} ${r.desc}`, allowed, false).ok);
  const strengths = rule.strengths.map((rs, i) => {
    const a = ai.strengths?.[i];
    return a && lineOk(`${a.title} ${a.text}`, allowed, false).ok && a.title.length <= 16 ? a : rs;
  });
  const text: DeckText = {
    lead: leadOk ? ai.lead! : rule.lead,
    peers: list('peers'),
    compare: list('compare'),
    schedule: list('schedule'),
    structure: list('structure'),
    structureRows: rows.length === rule.structureRows.length && rows.length ? rows : rule.structureRows,
    strengths,
    rates: list('rates', true),
    corp: list('corp', true),
    views: list('views', true),
    sizing: list('sizing'),
    pipeline: list('pipeline'),
    bok: list('bok', true),
    fomc: list('fomc', true),
    usviews: list('usviews', true),
    forecast: list('forecast', true),
    league: list('league'),
    maturity: list('maturity'),
    sales: list('sales'),
    termNotes: (() => {
      const out = { ...rule.termNotes };
      for (const k of Object.keys(out) as (keyof typeof out)[]) {
        const a = ai.termNotes?.[k];
        if (typeof a === 'string' && a.trim()) {
          const v = lineOk(a.replace(/\n/g, ' '), allowed, false);
          if (v.ok && a.length <= 90) out[k] = a;
          else dropped.push({ field: `termNotes.${k}`, line: a, why: v.ok ? '너무 김' : v.why });
        }
      }
      return out;
    })(),
  };
  return { text, dropped };
}
