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

const FORECAST = /(것으로\s*(보인다|보임|보여|예상|전망)|예상됨|예상된다|예상되며|전망됨|전망된다|전망되며|할\s*것|될\s*것|기대됨|기대된다|확실|보장|틀림없)/;
const HOUSE = /(증권|리서치|하우스|연구원|한국은행|연준|Fed|FOMC)/;

export function lineOk(line: string, allowed: Set<string>, allowForecast: boolean) {
  const bad = (line.match(NUM) ?? []).filter((m) => !allowed.has(norm(m)) && !m.split('.').every((p) => allowed.has(norm(p))));
  if (bad.length) return { ok: false, why: `숫자 ${bad.join(', ')}` };
  if (FORECAST.test(line) && !(allowForecast && HOUSE.test(line))) return { ok: false, why: '전망·단정 표현' };
  if (line.length > 160) return { ok: false, why: '너무 김' };
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
  };
  return { text, dropped };
}
