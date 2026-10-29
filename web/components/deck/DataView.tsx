// 데이터 탭: 이 초안에 쓰려고 모은 데이터 목록. 외부(공개) 데이터는 출처·기준일·쓰인 장표, 내부 데이터는 칸만 비워 둔다.
import type { DataReport, Src } from '@/lib/deck/sources';

type Row = { label: string; source: string; asof: string | null; slides: string[]; status: Src['status']; note?: string };

function rowsOf(report: DataReport, kind: Src['kind']) {
  const map = new Map<string, Row>();
  for (const it of report.items) {
    for (const s of it.srcs) {
      if (s.kind !== kind) continue;
      if (kind === 'ext' && s.status === 'missing') continue;
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

const short = (label: string) => label.replace(/^(Ⅰ|Ⅱ)-\d+(-[①-⑧])?\.?\s*/, '').replace(/^App\d+\.\s*/, '');

function Slides({ list }: { list: string[] }) {
  const names = [...new Set(list.map(short))];
  return (
    <span className="dk2-slides">
      {names.slice(0, 3).join(', ')}
      {names.length > 3 && <span className="muted"> 외 {names.length - 3}</span>}
    </span>
  );
}

export function DataView({ report, asof }: { report: DataReport; asof: string }) {
  const ext = rowsOf(report, 'ext');
  const int = rowsOf(report, 'int').filter((r) => !/템플릿 고정 장표/.test(r.label));
  return (
    <div className="dk2-data">
      <section aria-labelledby="dk2-ext-h">
        <h3 id="dk2-ext-h" className="dk2-data-h">
          수집한 데이터 <span className="muted small tnum">{ext.length}건 · {asof} 기준</span>
        </h3>
        <div className="table-wrap">
          <table className="data dk2-table">
            <thead>
              <tr>
                <th>데이터</th>
                <th>출처</th>
                <th>기준일</th>
                <th>쓰인 장표</th>
              </tr>
            </thead>
            <tbody>
              {ext.map((r) => (
                <tr key={`${r.label}|${r.source}`}>
                  <td>
                    {r.label}
                    {r.status === 'alt' && <span className="dk2-tag">대체</span>}
                  </td>
                  <td className="muted">{r.source}</td>
                  <td className="tnum nowrap">{r.asof ?? '–'}</td>
                  <td><Slides list={r.slides} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="dk2-int-h">
        <h3 id="dk2-int-h" className="dk2-data-h">
          회사 내부 데이터 <span className="muted small tnum">{int.length}건 · 사내 연계 시 채움</span>
        </h3>
        <div className="table-wrap">
          <table className="data dk2-table">
            <thead>
              <tr>
                <th>데이터</th>
                <th>출처</th>
                <th>값</th>
                <th>쓰일 장표</th>
              </tr>
            </thead>
            <tbody>
              {int.map((r) => (
                <tr key={`${r.label}|${r.source}`}>
                  <td>{r.label}</td>
                  <td className="muted">{r.source}</td>
                  <td>{r.status === 'used' ? <span className="dk2-tag is-on">연결됨</span> : <span className="dk2-empty" aria-label="비어 있음" />}</td>
                  <td><Slides list={r.slides} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
