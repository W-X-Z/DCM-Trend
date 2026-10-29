'use client';

// 데이터 탭: 이 초안에 쓰려고 모은 데이터. 유형별로 몇 건만 보이고 '펼치기'로 전부.
// 외부(공개) 데이터는 출처·기준일·쓰인 장표, 회사 내부 데이터는 목록만(미연계).
import { useState, type ReactNode } from 'react';
import type { DataReport, Src } from '@/lib/deck/sources';

export type DataRow = { label: string; source: string; asof: string | null; slides: string[]; status: Src['status']; note?: string };

export function rowsOf(report: DataReport, kind: Src['kind']): DataRow[] {
  const map = new Map<string, DataRow>();
  for (const it of report.items) {
    for (const s of it.srcs) {
      if (s.kind !== kind) continue;
      if (kind === 'ext' && s.status === 'missing') continue;
      if (kind === 'int' && /템플릿 고정 장표/.test(s.label)) continue;
      const k = `${s.label}|${s.source}`;
      const r = map.get(k) ?? { label: s.label, source: s.source, asof: s.asof ?? null, slides: [], status: s.status, note: s.note };
      if (!r.slides.includes(it.label)) r.slides.push(it.label);
      if (s.asof && (!r.asof || s.asof > r.asof)) r.asof = s.asof;
      if (s.status === 'used') r.status = 'used';
      map.set(k, r);
    }
  }
  if (kind === 'int') {
    for (const m of report.intMissing) {
      const k = `${m.label}|${m.source}`;
      if (!map.has(k)) map.set(k, { label: m.label, source: m.source, asof: null, slides: m.items, status: 'missing', note: m.note });
    }
  }
  return [...map.values()];
}

// 외부 데이터 유형: 공시 / 금리·정책 / 시장 자료
export const EXT_GROUPS: { key: string; label: string; test: (src: string) => boolean }[] = [
  { key: 'dart', label: '공시 (DART)', test: (s) => /DART|금융감독원 전자공시|증권신고서|정정신고서|발행실적|수요예측 결과/.test(s) },
  { key: 'rate', label: '금리·정책 (한국은행·ECOS·미 연준)', test: (s) => /ECOS|한국은행|연준|Federal|공휴일|금융감독원|FRED/.test(s) },
  { key: 'market', label: '시장 자료 (DM 판·증권사 리포트·언론)', test: () => true },
];
export function groupExt(rows: DataRow[]) {
  const out = EXT_GROUPS.map((g) => ({ ...g, rows: [] as DataRow[] }));
  for (const r of rows) out.find((g) => g.test(r.source))!.rows.push(r);
  return out.filter((g) => g.rows.length);
}

const short = (label: string) => label.replace(/^(Ⅰ|Ⅱ)-\d+(-[①-⑧])?\.?\s*/, '').replace(/^App\d+\.\s*/, '');
export function SlideNames({ list }: { list: string[] }) {
  const names = [...new Set(list.map(short))];
  return (
    <span className="dk2-slides">
      {names.slice(0, 3).join(', ')}
      {names.length > 3 && <span className="muted"> 외 {names.length - 3}</span>}
    </span>
  );
}

const SHOW = 3;

function Group({ title, extra, rows, kind }: { title: string; extra?: ReactNode; rows: DataRow[]; kind: Src['kind'] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SHOW);
  return (
    <section className="dk2-dgroup">
      <h4 className="dk2-dgroup-h">
        {title} <span className="muted small tnum">{rows.length}건</span>
        {extra}
      </h4>
      <table className="data dk2-table">
        <thead>
          <tr>
            <th>데이터</th>
            <th>출처</th>
            {kind === 'ext' && <th>기준일</th>}
            <th>{kind === 'ext' ? '쓰인 장표' : '쓰일 장표'}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={`${r.label}|${r.source}`}>
              <td>
                {r.label}
                {r.status === 'alt' && <span className="dk2-tag">대체</span>}
              </td>
              <td className="muted">{r.source}</td>
              {kind === 'ext' && <td className="tnum">{r.asof ?? '–'}</td>}
              <td><SlideNames list={r.slides} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > SHOW && (
        <button type="button" className="dk2-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? '접기' : `펼치기 (${rows.length - SHOW}건 더)`}
        </button>
      )}
    </section>
  );
}

export function DataView({ report, asof }: { report: DataReport; asof: string }) {
  const ext = rowsOf(report, 'ext');
  const int = rowsOf(report, 'int');
  const linked = int.some((r) => r.status === 'used');
  return (
    <div className="dk2-data">
      <section aria-labelledby="dk2-ext-h">
        <h3 id="dk2-ext-h" className="dk2-data-h">
          외부 데이터 <span className="muted small tnum">{ext.length}건 · {asof} 기준</span>
        </h3>
        {groupExt(ext).map((g) => (
          <Group key={g.key} title={g.label} rows={g.rows} kind="ext" />
        ))}
      </section>
      <section aria-labelledby="dk2-int-h">
        <h3 id="dk2-int-h" className="dk2-data-h">
          회사 내부 데이터 <span className="muted small tnum">{int.length}건</span>
          <span className="dk2-unlinked">{linked ? '일부 미연계' : '미연계'}</span>
        </h3>
        <Group title="사내 시스템·구독 데이터" rows={int} kind="int" />
      </section>
    </div>
  );
}
