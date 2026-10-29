'use client';

// 흐름도: 초안 작성·채팅 → 제안서 Agent(의도 해석 → 실행 계획) → 초안(미리보기 → 확인 → PPT·PDF), 확인 뒤 다음 요청으로 돌아감.
// Agent 아래에 암묵지(Skill)·도구(Tool)·기억(Memory), 도구 아래에 데이터 수집 → 외부·내부 데이터.
// 아키텍처 구성도(DCM 제안서 Agent p2)와 같은 깊이. 상자를 누르면 아래에 짧게 열린다.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ACTION_TYPES, type ActionType } from '@/lib/deck/agent';
import { PARTS, SECTIONS, TEMPLATES, templateOf, type ItemId, type Section } from '@/lib/deck/catalog';
import { KIND_LABEL, SLIDES as TIP_SLIDES, forGrade, type Knowledge } from '@/lib/deck/knowledge';
import type { DataReport } from '@/lib/deck/sources';
import type { Slide } from '@/lib/deck/model';
import type { DeckData, DeckInput } from '@/lib/deck/types';
import { rowsOf, type DataRow } from './DataView';

type Node = 'entry' | 'agent' | 'out' | 'tacit' | 'tool' | 'memory' | 'collect' | 'ext' | 'int';

// 도식 좌표 (960 × 440, 좁으면 비율대로 줄임)
const W = 960;
const H = 440;
const BOX: Record<Node, [x: number, y: number, w: number, h: number]> = {
  entry: [0, 28, 200, 76],
  agent: [280, 28, 400, 76],
  out: [760, 28, 200, 76],
  tacit: [168, 168, 196, 64],
  tool: [382, 168, 196, 64],
  memory: [596, 168, 196, 64],
  collect: [382, 270, 196, 56],
  ext: [272, 370, 196, 64],
  int: [492, 370, 196, 64],
};
const EDGES: { a: Node; b: Node; d: string; arrow?: boolean; dash?: boolean }[] = [
  { a: 'entry', b: 'agent', d: 'M200 66 H277', arrow: true },
  { a: 'agent', b: 'out', d: 'M680 66 H757', arrow: true },
  { a: 'out', b: 'entry', d: 'M860 28 V10 H100 V25', arrow: true },
  { a: 'agent', b: 'tacit', d: 'M480 104 V136 H266 V168' },
  { a: 'agent', b: 'tool', d: 'M480 104 V168' },
  { a: 'agent', b: 'memory', d: 'M480 104 V136 H694 V168' },
  { a: 'tool', b: 'collect', d: 'M480 232 V270' },
  { a: 'collect', b: 'ext', d: 'M480 326 V348 H370 V370' },
  { a: 'collect', b: 'int', d: 'M480 326 V348 H590 V370', dash: true },
];

const ACTION_LABEL: Record<ActionType, string> = {
  tranches: '트랜치', max_amount: '최대 증액', pay_date: '납입일', demand_date: '수요예측일', band: '금리 밴드',
  coupon: '이자 지급', rating: '등급', fee: '수수료', series: '회차', slides: '장표 넣기·빼기', template: '템플릿',
  peer_scope: '비교 범위', sales_ai: 'Sales 전략 문안', edit_text: '문안 고치기', goto: '장표 이동', reset: '처음으로',
};

// 작성 규칙: 현업 관행에서 온 것 (rules.ts·validate.ts 와 같은 내용)
const RULES: [string, string][] = [
  ['발행 시기', '기준일 + 25영업일, 150일 안 만기가 있으면 2주 전 납입, 12/15~31 피함'],
  ['증액 한도', '최근 4회 최대 배율 × 신고 금액, 100억 단위 올림'],
  ['금리 밴드', '개별민평 ±30bp'],
  ['비교 사례', '같은 등급 최근 1년, 보증·담보부·공기업 제외'],
  ['문안', '데이터에 있는 숫자만, 출처 없는 전망은 뺌'],
];

// 출처 문자열 → 기관 (한 줄이 여러 기관일 수 있음)
const PROVIDERS: [string, RegExp][] = [
  ['DART', /DART/],
  ['한국은행', /한국은행|ECOS/],
  ['미 연준', /연준|Federal|FOMC/],
  ['금융감독원', /금융감독원/],
  ['공휴일', /공휴일/],
  ['DM 판', /DM 판|Discussion Material/],
  ['증권사 리포트·언론', /리포트|언론|뉴스|이데일리|증권(?!신고서|발행)/],
];
function byProvider(rows: DataRow[], named: boolean): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const hits = named ? PROVIDERS.filter(([, re]) => re.test(r.source)).map(([n]) => n) : [r.source];
    for (const n of hits.length ? hits : [r.source]) m.set(n, (m.get(n) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

// 도식을 칸 너비에 맞춰 줄임
function Fit({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setK(Math.min(1, el.clientWidth / W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="fl-fit">
      <div style={{ width: W * k, height: H * k, margin: '0 auto' }}>
        <div className="fl-canvas" style={{ width: W, height: H, transform: `scale(${k})` }}>{children}</div>
      </div>
    </div>
  );
}

export function FlowView({ report, data, input, tips, slides, avail, checks, examples, onGo, onData }: {
  report: DataReport;
  data: DeckData;
  input: DeckInput;
  tips: Knowledge[];
  slides: Slide[];
  avail: (id: ItemId) => boolean;
  checks: number;
  examples: string[];
  onGo: (i: number) => void;
  onData: () => void;
}) {
  const [on, setOn] = useState<Node>('agent');
  const ext = rowsOf(report, 'ext');
  const int = rowsOf(report, 'int');
  const myTips = forGrade(tips, data.company.rating_group);

  const box = (id: Node, body: ReactNode, cls = '') => {
    const [x, y, w, h] = BOX[id];
    return (
      <button
        type="button"
        className={`fl-node n-${id}${cls ? ` ${cls}` : ''}`}
        style={{ left: x, top: y, width: w, height: h }}
        aria-pressed={on === id}
        onClick={() => setOn(id)}
      >
        {body}
      </button>
    );
  };
  const lit = (e: (typeof EDGES)[number]) => e.a === on || e.b === on;

  return (
    <div className="dk2-flow">
      <Fit>
        <svg className="fl-edges" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
          <defs>
            {(['', 'on'] as const).map((k) => (
              <marker key={k} id={`fl-ah${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" className={k ? 'is-on' : undefined} />
              </marker>
            ))}
          </defs>
          {[...EDGES].sort((a, b) => Number(lit(a)) - Number(lit(b))).map((e) => (
            <path
              key={`${e.a}-${e.b}`}
              d={e.d}
              className={`fl-e${lit(e) ? ' is-on' : ''}${e.dash ? ' is-dash' : ''}`}
              markerEnd={e.arrow ? `url(#fl-ah${lit(e) ? 'on' : ''})` : undefined}
            />
          ))}
          <text x="480" y="14" className={`fl-edge-label${on === 'out' || on === 'entry' ? ' is-on' : ''}`} textAnchor="middle">다음 요청</text>
        </svg>

        {box('entry', <><strong>초안 작성 · 채팅</strong><span>회사 고르기 · 요청</span></>)}
        {box(
          'agent',
          <>
            <strong>제안서 Agent</strong>
            <span className="fl-agent-steps">
              <em>의도 해석 <i>LLM</i></em>
              <b aria-hidden>→</b>
              <em>실행 계획 <i>코드</i></em>
            </span>
          </>,
          'is-core',
        )}
        {box('out', <><strong>초안 {slides.length}장</strong><span>미리보기 → 확인 → PPT·PDF</span></>)}
        {box('tacit', <><strong>암묵지 <i className="fl-kind">Skill</i></strong><span>템플릿 · 목차 · 팁 · 규칙</span></>, 'is-tacit')}
        {box('tool', <><strong>도구 <i className="fl-kind">Tool</i></strong><span>계산 · 조회 · 문안 · 산출 · 검수</span></>)}
        {box('memory', <><strong>기억 <i className="fl-kind">Memory</i></strong><span>덱 상태 · 대화</span></>)}
        {box('collect', <><strong>데이터 수집</strong><span>{data.asof} 기준</span></>)}
        {box('ext', <><strong>외부 데이터</strong><span>{ext.length}건 · DART · 한국은행 등</span></>)}
        {box('int', <><strong>내부 데이터</strong><span><b className="dk2-unlinked">미연계</b> {int.length}건</span></>, 'is-dashed')}
      </Fit>

      <section className="fl-detail" aria-live="polite">
        {on === 'entry' && (
          <>
            <Head title="초안 작성 · 채팅" />
            <Kv
              rows={[
                ['초안 작성', '회사를 고르면 기본 조건으로 바로 만듦'],
                ['채팅', '딜 조건 · 전략 · 문안 바꾸기'],
                ['다음 요청', '초안을 확인하고 다시 채팅'],
              ]}
            />
            <Chips label="예시" list={examples} />
          </>
        )}

        {on === 'agent' && (
          <>
            <Head title="제안서 Agent" />
            <div className="fl-steps">
              <div>
                <strong>의도 해석</strong><span className="fl-tag">LLM</span>
                <p>요청 → 행동 목록</p>
              </div>
              <b aria-hidden>→</b>
              <div>
                <strong>실행 계획</strong><span className="fl-tag is-code">코드</span>
                <p>값 검사 → 반영 → 다시 계산</p>
              </div>
            </div>
            <Chips label={`할 수 있는 행동 ${ACTION_TYPES.length}`} list={ACTION_TYPES.map((a) => ACTION_LABEL[a])} />
          </>
        )}

        {on === 'out' && (
          <>
            <Head title={`초안 ${slides.length}장`} extra={checks ? <span className="muted small">확인할 곳 {checks}곳</span> : null} />
            <ol className="fl-slides">
              {slides.map((s, i) => (
                <li key={`${s.id}-${i}`}>
                  <button type="button" className="linklike" onClick={() => onGo(i)}>
                    <span className="muted tnum">{i + 1}</span> {s.title}
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}

        {on === 'tacit' && <Tacit input={input} tips={myTips} avail={avail} />}

        {on === 'tool' && (
          <>
            <Head title="도구" kind="Tool" />
            <ul className="fl-cards">
              {([
                ['계산', '코드', '발행 일정 · 증액 한도 · 밴드'],
                ['조회', '코드', '공시 · 금리 · 발행 사례'],
                ['문안', '규칙 · LLM', '장표 문안, Sales 전략만 LLM'],
                ['산출', '코드', 'PPT · PDF'],
                ['검수', '코드', checks ? `숫자 대조 · 확인할 곳 ${checks}곳` : '숫자 대조'],
              ] as const).map(([k, how, v]) => (
                <li key={k}>
                  <strong>{k}</strong>
                  <span className={`fl-tag${how === '코드' ? ' is-code' : ''}`}>{how}</span>
                  <p>{v}</p>
                </li>
              ))}
            </ul>
          </>
        )}

        {on === 'memory' && (
          <>
            <Head title="기억" kind="Memory" />
            <Kv
              rows={[
                ['덱 상태', '조건 · 문안, 이 브라우저에 저장'],
                ['대화', '최근 6개 메시지'],
                ['회사·담당자 메모', <span key="m" className="muted">정책 정해지면</span>],
              ]}
            />
          </>
        )}

        {on === 'collect' && (
          <>
            <Head title="데이터 수집" />
            <Kv
              rows={[
                ['시점', `초안을 열 때 · ${data.asof} 기준`],
                ['외부', `${ext.length}건`],
                ['내부', <span key="i">{int.length}건 <b className="dk2-unlinked">미연계</b></span>],
              ]}
            />
            <More onData={onData} />
          </>
        )}

        {on === 'ext' && (
          <>
            <Head title="외부 데이터" extra={<span className="muted small tnum">{ext.length}건</span>} />
            <Kv rows={byProvider(ext, true).map(([n, c]) => [n, `${c}건`])} />
            <More onData={onData} />
          </>
        )}

        {on === 'int' && (
          <>
            <Head title="내부 데이터" extra={<b className="dk2-unlinked">미연계</b>} />
            <Kv rows={byProvider(int, false).map(([n, c]) => [n, `${c}건`])} />
            <More onData={onData} />
          </>
        )}
      </section>
    </div>
  );
}

function Head({ title, kind, extra }: { title: string; kind?: string; extra?: ReactNode }) {
  return (
    <h3 className="fl-head">
      {title}
      {kind && <i className="fl-kind">{kind}</i>}
      {extra}
    </h3>
  );
}

function Kv({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="fl-kv">
      {rows.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Chips({ label, list }: { label: string; list: string[] }) {
  return (
    <div className="fl-chips">
      <p className="muted small">{label}</p>
      <ul>
        {list.map((x) => <li key={x}>{x}</li>)}
      </ul>
    </div>
  );
}

function More({ onData }: { onData: () => void }) {
  return (
    <button type="button" className="dk2-more" onClick={onData}>
      데이터 탭에서 보기
    </button>
  );
}

function Tacit({ input, tips, avail }: { input: DeckInput; tips: Knowledge[]; avail: (id: ItemId) => boolean }) {
  const [tab, setTab] = useState<'tpl' | 'toc' | 'tips' | 'rules'>('tpl');
  const cur = templateOf(input.items);
  const bySlide = TIP_SLIDES.map(([k, label]) => [label, tips.filter((t) => t.slide === k)] as const).filter(([, xs]) => xs.length);
  const parts: { key: string; label: string; secs: Section[] }[] = [
    ...PARTS.map((p) => ({ key: p.key, label: `${p.key}. ${p.label}`, secs: SECTIONS.filter((s) => s.part === p.key) })),
    { key: 'A', label: 'Appendix', secs: SECTIONS.filter((s) => s.appendix) },
  ];
  return (
    <>
      <Head title="암묵지" kind="Skill" />
      <div className="fl-subtabs" role="tablist" aria-label="암묵지">
        {([['tpl', `템플릿 ${TEMPLATES.length}`], ['toc', '목차'], ['tips', `장표별 팁 ${tips.length}`], ['rules', `작성 규칙 ${RULES.length}`]] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'tpl' && (
        <ul className="fl-cards is-2">
          {TEMPLATES.map((t) => (
            <li key={t.key} className={cur === t.key ? 'is-on' : undefined}>
              <strong>{t.label}</strong>
              {cur === t.key && <span className="fl-tag is-code">지금</span>}
              <p>{t.hint}</p>
            </li>
          ))}
        </ul>
      )}

      {tab === 'toc' && (
        <dl className="fl-kv fl-toc">
          {parts.map((p) => (
            <div key={p.key}>
              <dt>{p.label}</dt>
              <dd>
                <ul>
                  {p.key === 'A'
                    ? p.secs.flatMap((s) => s.items).map((i) => (
                        <li key={i.id} className={input.items[i.id] && avail(i.id) ? 'is-on' : undefined}>{i.title}</li>
                      ))
                    : p.secs.map((s) => {
                        const n = s.items.filter((i) => input.items[i.id] && avail(i.id)).length;
                        return (
                          <li key={s.key} className={n ? 'is-on' : undefined}>
                            {s.label} <span className="tnum">{n}/{s.items.length}</span>
                          </li>
                        );
                      })}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {tab === 'tips' && (
        bySlide.length ? (
          <dl className="fl-kv fl-tips">
            {bySlide.map(([label, xs]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <ul>
                    {xs.map((k) => (
                      <li key={k.id}><span className="fl-tag">{KIND_LABEL[k.kind]}</span>{k.body}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="muted">이 등급에 맞는 장표별 팁이 아직 없어요.</p>
        )
      )}

      {tab === 'rules' && <Kv rows={RULES} />}
    </>
  );
}
