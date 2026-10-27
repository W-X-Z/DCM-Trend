'use client';

// 제안서 한 건의 실행 추적(trace → span). 브라우저에서 단계마다 걸린 시간과 입력·출력을 그대로 보여 준다.
// AI 호출은 버튼을 눌렀을 때만 한다(회사명·조건·숫자가 OpenAI 로 전송됨).
import { useCallback, useEffect, useState } from 'react';
import { Info } from '@/components/Ui';
import { forGrade, knowledgeForPrompt, type Knowledge } from '@/lib/deck/knowledge';
import { buildSlides } from '@/lib/deck/layout';
import { defaultInput, factsFor, ruleText, salesFacts } from '@/lib/deck/rules';
import type { DeckData, DeckText } from '@/lib/deck/types';
import { KIND_LABEL, type Kind } from './Chain';

type Span = {
  id: string;
  name: string;
  kind: Kind;
  start: number;
  ms: number;
  status: 'ok' | 'error';
  meta: [string, string][];
  input?: unknown;
  output?: unknown;
  extra?: { title: string; text: string }[];
};

const SAMPLES: [string, string][] = [
  ['00113526', '대한항공'], ['00160588', '한화'], ['00222532', 'LG헬로비전'], ['00120526', '롯데쇼핑'], ['00163512', '한진'], ['00207108', '이랜드월드'],
];

const kb = (s: string) => `${(new Blob([s]).size / 1024).toFixed(1)}KB`;
const preview = (v: unknown, max = 6000) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 1);
  return s.length > max ? `${s.slice(0, max)}\n… (${(s.length - max).toLocaleString('ko-KR')}자 더 있음)` : s;
};
const lines = (t: DeckText) => Object.values(t).reduce((n, v) => n + (Array.isArray(v) ? v.length : 1), 0);

export function DeckTrace({ initialCorp }: { initialCorp?: string }) {
  const [corp, setCorp] = useState(initialCorp && /^\d{8}$/.test(initialCorp) ? initialCorp : SAMPLES[0][0]);
  const [spans, setSpans] = useState<Span[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  const run = useCallback(async (withAi: boolean) => {
    setBusy(true);
    setErr(null);
    setSpans([]);
    setSel(null);
    const t0 = performance.now();
    const out: Span[] = [];
    const add = (s: Omit<Span, 'start' | 'ms' | 'status'> & { from: number; status?: Span['status'] }) => {
      const { from, ...rest } = s;
      out.push({ ...rest, start: from - t0, ms: performance.now() - from, status: s.status ?? 'ok' });
      setSpans([...out]);
    };
    const step = async <T,>(fn: () => Promise<T> | T) => {
      const from = performance.now();
      return { from, value: await fn() };
    };
    try {
      // 1. 회사 데이터
      const a = await step(async () => {
        const r = await fetch(`/api/deck/data?corp=${corp}`);
        const text = await r.text();
        if (!r.ok) throw new Error(JSON.parse(text).error ?? '데이터를 불러오지 못했습니다');
        return { d: JSON.parse(text) as DeckData, size: text };
      });
      const d = a.value.d;
      setTitle(`${d.company.corp_name} ${d.company.rating ?? ''}`);
      add({
        id: 'data', name: '회사 데이터 모으기', kind: 'data', from: a.from,
        meta: [['API', 'GET /api/deck/data'], ['크기', kb(a.value.size)], ['회사 공모채 회차', `${d.own.length}건`], ['같은 등급 사례', `${d.peers.length}건`], ['만기도래', `${d.maturities.length}건`], ['금리 시계열', `${d.series.length}개`], ['출처', 'Supabase mart 뷰(DART·ECOS 수집) + 사람이 넣은 리서치·일정']],
        input: { corp }, output: { company: d.company, asof: d.asof, own: d.own.slice(0, 2), peers: `${d.peers.length}건`, rates: d.rates },
      });

      // 2. 기본 입력값
      const b = await step(() => defaultInput(d));
      const inp = b.value;
      add({
        id: 'input', name: '기본 조건 정하기', kind: 'rule', from: b.from,
        meta: [['코드', 'rules.ts defaultInput'], ['트랜치', inp.tranches.map((t) => `${t.tenor} ${t.eok ?? '–'}억`).join(', ')], ['납입 희망일', inp.pay], ['비교 사례', `${inp.peerKeys.length}건(비교 장표 ${inp.compareKeys.length}건)`]],
        output: inp,
      });

      // 3. 사실 묶음
      const c = await step(() => factsFor(d, inp));
      const facts = c.value;
      const factsText = JSON.stringify(facts);
      add({
        id: 'facts', name: '사실 묶음 만들기', kind: 'rule', from: c.from,
        meta: [['코드', 'rules.ts factsFor'], ['항목', `${Object.keys(facts).length}개`], ['크기', kb(factsText)], ['쓰임', 'AI 지침의 근거, 문안 숫자 검증의 허용 목록']],
        output: facts,
      });

      // 4. 규칙 문안
      const e = await step(() => ruleText(d, inp));
      const rule = e.value;
      add({
        id: 'rule', name: '규칙 문안 쓰기', kind: 'rule', from: e.from,
        meta: [['코드', 'rules.ts ruleText'], ['문장 수', `${lines(rule)}줄`], ['쓰임', '장표 기본 문안 = AI 초안']],
        output: rule,
      });

      // 5. 노하우 고르기
      const g = await step(async () => {
        const r = await fetch('/api/deck/knowledge', { cache: 'no-store' });
        const j = await r.json();
        return (j.items ?? []) as Knowledge[];
      });
      const mine = forGrade(g.value, d.company.rating_group);
      const tips = knowledgeForPrompt(g.value, d.company.rating_group, ['sales']);
      add({
        id: 'tips', name: '노하우 고르기', kind: 'human', from: g.from,
        meta: [['API', 'GET /api/deck/knowledge'], ['전체', `${g.value.length}개`], [`${d.company.rating_group ?? '–'}등급에 맞는 것`, `${mine.length}개`], ['AI에 넣는 것(Sales 전략)', `${Object.values(tips).reduce((n, x) => n + x.length, 0)}개`]],
        output: tips,
      });

      // 6. 프롬프트 조립
      const h = await step(async () => {
        const r = await fetch('/api/deck/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facts: salesFacts(d, inp), rule, grade: d.company.rating_group }) });
        if (!r.ok) throw new Error('프롬프트를 만들지 못했습니다');
        return r.json() as Promise<{ model: string; version: number; system: string; schema: { properties: Record<string, unknown> }; user: string; applied: number }>;
      });
      const p = h.value;
      add({
        id: 'prompt', name: '프롬프트 조립', kind: 'rule', from: h.from,
        meta: [['API', 'POST /api/deck/prompt (AI 호출 없음)'], ['모델', p.model], ['프롬프트', `v${p.version}`], ['시스템 지침', `${p.system.length.toLocaleString('ko-KR')}자`], ['사용자 메시지', `${p.user.length.toLocaleString('ko-KR')}자`], ['출력 형식', `JSON schema strict, 필드 ${Object.keys(p.schema.properties).length}개`]],
        extra: [{ title: 'system', text: p.system }, { title: 'user', text: p.user }],
      });

      let text: DeckText = rule;
      if (withAi) {
        // 7. AI 호출 + 8. 검증·병합
        const k = await step(async () => {
          const r = await fetch('/api/deck/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facts: salesFacts(d, inp), rule, grade: d.company.rating_group }) });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? 'AI 문안을 만들지 못했습니다');
          return j as { sales: string[]; usedRule: boolean; dropped: number; droppedLines: { line: string; why: string }[]; applied: number; model: string };
        });
        const ai = k.value;
        add({
          id: 'llm', name: 'AI 호출 (Sales 전략)', kind: 'ai', from: k.from,
          meta: [['API', 'POST /api/deck/draft'], ['모델', ai.model], ['노하우 반영', `${ai.applied}개`]],
          output: ai.sales,
        });
        add({
          id: 'check', name: '줄 검증', kind: 'check', from: performance.now(),
          meta: [['버린 줄', `${ai.dropped}줄`], ['결과', ai.usedRule ? '통과한 줄이 없어 규칙 문안 사용' : `AI 문안 ${ai.sales.length}줄`], ['규칙', '숫자는 사실 안에서만 · 출처 없는 시장 전망 금지 · 단정 표현 금지 · 길이']],
          output: { 버린줄: ai.droppedLines },
        });
        text = { ...rule, sales: ai.sales };
      }

      // 9. 장표
      const m = await step(() => buildSlides(d, inp, text));
      add({
        id: 'slides', name: '장표 배치', kind: 'out', from: m.from,
        meta: [['코드', 'layout.ts buildSlides'], ['장표', `${m.value.length}장`], ['템플릿 고정 장표', `${m.value.filter((x) => x.static).length}장`], ['다음', '미리보기(HTML) · PPTX(NH 템플릿) · PDF']],
        output: m.value.map((x, i) => `${i + 1}. ${x.title}`),
      });
      setSel(withAi ? 'llm' : 'prompt');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [corp]);

  useEffect(() => {
    run(false);
  }, [run]);

  const total = spans.length ? Math.max(...spans.map((s) => s.start + s.ms)) : 0;
  const cur = spans.find((s) => s.id === sel) ?? null;

  return (
    <div className="hw-trace">
      <div className="hw-trace-bar">
        <div className="hw-switch" role="group" aria-label="회사">
          {SAMPLES.map(([c, n]) => (
            <button key={c} type="button" aria-pressed={corp === c} onClick={() => setCorp(c)} disabled={busy}>{n}</button>
          ))}
          {!SAMPLES.some(([c]) => c === corp) && <button type="button" aria-pressed>{title || corp}</button>}
        </div>
        <span className="hw-ai">
          <button type="button" className="btn" onClick={() => run(true)} disabled={busy}>{busy ? '실행 중…' : 'AI 호출까지 실행'}</button>
          <Info>노하우 반영(AI)과 같은 요청을 보냅니다. 회사명·조건·숫자가 OpenAI로 전송되고, 결과는 저장하지 않습니다.</Info>
        </span>
      </div>
      {err && <p className="empty">{err}</p>}

      <div className="hw-trace-body">
        <ol className="hw-spans" aria-label="단계">
          <li className="hw-span-h small muted">
            <span>{title || '…'}</span>
            <span className="tnum">{total ? `${Math.round(total).toLocaleString('ko-KR')}ms` : ''}</span>
          </li>
          {spans.map((s) => (
            <li key={s.id}>
              <button type="button" aria-pressed={s.id === sel} onClick={() => setSel(s.id)} className={`hw-span k-${s.kind}`}>
                <span className="hw-span-name">
                  <span className="hw-kind">{KIND_LABEL[s.kind]}</span>
                  {s.name}
                </span>
                <span className="hw-span-ms tnum">{s.ms < 1 ? '<1' : Math.round(s.ms)}ms</span>
                <span className="hw-bar" aria-hidden>
                  <span style={{ left: `${total ? (s.start / total) * 100 : 0}%`, width: `${total ? Math.max(0.8, (s.ms / total) * 100) : 0}%` }} />
                </span>
              </button>
            </li>
          ))}
          {busy && <li className="hw-span-h small muted" aria-busy="true">다음 단계 진행 중…</li>}
        </ol>

        <section className="hw-detail" aria-label="단계 내용">
          {!cur ? <p className="empty small">단계를 고르면 입력·출력이 보입니다.</p> : (
            <>
              <h3>{cur.name}</h3>
              <dl className="hw-dl hw-meta">
                {cur.meta.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
              </dl>
              {cur.extra?.map((x) => (
                <details key={x.title} open={x.title === 'system'}>
                  <summary>{x.title === 'system' ? '시스템 지침 (system)' : '사용자 메시지 (user)'}</summary>
                  <pre className="hw-pre">{x.title === 'user' ? preview(JSON.parse(x.text)) : x.text}</pre>
                </details>
              ))}
              {cur.input !== undefined && (
                <details>
                  <summary>입력</summary>
                  <pre className="hw-pre">{preview(cur.input)}</pre>
                </details>
              )}
              {cur.output !== undefined && (
                <details open={!cur.extra}>
                  <summary>출력</summary>
                  <pre className="hw-pre">{preview(cur.output)}</pre>
                </details>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
