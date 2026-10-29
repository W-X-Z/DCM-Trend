'use client';

// 흐름도: 외부 데이터 → 제안서 Agent → 제안서 초안, 아래에서 내부 데이터·암묵지가 Agent 로 들어간다.
// 상자를 누르면 아래에 그 내용이 열린다.
import { useState, type ReactNode } from 'react';
import { PARTS, SECTIONS, TEMPLATES, templateOf, type ItemId } from '@/lib/deck/catalog';
import { KIND_LABEL, SLIDES as TIP_SLIDES, forGrade, type Knowledge } from '@/lib/deck/knowledge';
import type { DataReport } from '@/lib/deck/sources';
import type { Slide } from '@/lib/deck/model';
import type { DeckData, DeckInput } from '@/lib/deck/types';
import { SlideNames, groupExt, rowsOf } from './DataView';

type Node = 'ext' | 'agent' | 'out' | 'int' | 'tacit';

// 제안서 규칙 가운데 현업 관행에서 온 것 (rules.ts·validate.ts 와 같은 내용)
const RULES: [string, string][] = [
  ['발행 시기', '기준일 + 25영업일 이후. 150일 안에 기존 공모채 만기가 있으면 만기 2주 전 납입, 12/15~12/31은 피함'],
  ['증액 한도', '최근 4회 최대 증액 배율(1~2배) × 신고 금액, 100억 단위 올림'],
  ['금리 밴드', '개별민평 ±30bp (현업 샘플 6건 공통)'],
  ['비교 사례', '같은 등급 최근 1년, 보증·담보부로 보이는 회차와 공기업은 제외'],
  ['문안', '데이터에 있는 숫자만 쓰고, 출처 없는 시장 전망·단정 표현은 뺌'],
];

function Box({ id, on, setOn, title, sub, tone }: { id: Node; on: Node; setOn: (n: Node) => void; title: string; sub: ReactNode; tone?: string }) {
  return (
    <button type="button" className={`fl-node n-${id}${tone ? ` ${tone}` : ''}`} aria-pressed={on === id} onClick={() => setOn(id)}>
      <strong>{title}</strong>
      <span>{sub}</span>
    </button>
  );
}

export function FlowView({ report, data, input, tips, slides, avail, onGo }: {
  report: DataReport; data: DeckData; input: DeckInput; tips: Knowledge[]; slides: Slide[]; avail: (id: ItemId) => boolean; onGo: (i: number) => void;
}) {
  const [on, setOn] = useState<Node>('agent');
  const ext = rowsOf(report, 'ext');
  const int = rowsOf(report, 'int');
  const myTips = forGrade(tips, data.company.rating_group);
  const itemCount = SECTIONS.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="dk2-flow">
      <div className="fl-diagram" aria-label="제안서 Agent 흐름도">
        <div className="fl-row">
          <Box id="ext" on={on} setOn={setOn} title="외부 데이터" sub={`${ext.length}건 · DART·ECOS·DM 판`} />
          <span className="fl-arrow" aria-hidden />
          <Box id="agent" on={on} setOn={setOn} title="제안서 Agent" sub="의도 해석 → 실행 계획 → 장표" tone="is-core" />
          <span className="fl-arrow" aria-hidden />
          <Box id="out" on={on} setOn={setOn} title="제안서 초안" sub={`${slides.length}장 · PPT·PDF`} />
        </div>
        <div className="fl-join" aria-hidden><span /></div>
        <div className="fl-row fl-row-b">
          <Box id="int" on={on} setOn={setOn} title="내부 데이터" sub={<><span className="dk2-unlinked">미연계</span> {int.length}건</>} tone="is-dashed" />
          <Box id="tacit" on={on} setOn={setOn} title="암묵지" sub={`템플릿 ${TEMPLATES.length} · 목차 ${itemCount}항목 · 팁 ${myTips.length}`} />
        </div>
      </div>

      <section className="fl-detail" aria-live="polite">
        {on === 'ext' && (
          <>
            <h3>외부 데이터 <span className="muted small tnum">{ext.length}건 · {data.asof} 기준</span></h3>
            <ul className="fl-list">
              {groupExt(ext).map((g) => (
                <li key={g.key}>
                  <strong>{g.label}</strong> <span className="muted small tnum">{g.rows.length}건</span>
                  <p className="small">{g.rows.map((r) => r.label).join(' · ')}</p>
                </li>
              ))}
            </ul>
          </>
        )}

        {on === 'agent' && (
          <>
            <h3>제안서 Agent</h3>
            <ol className="fl-steps">
              <li><strong>의도 해석</strong><span className="fl-tag">LLM</span><p className="small">채팅 요청을 정해진 행동(트랜치·납입일·밴드·장표·문안 등)으로 바꿈</p></li>
              <li><strong>실행 계획</strong><span className="fl-tag is-code">코드</span><p className="small">값 검사 → 입력 반영 → 일정·증액 한도 다시 계산</p></li>
              <li><strong>장표 생성</strong><span className="fl-tag is-code">규칙</span><p className="small">데이터와 규칙 문안으로 장표를 만듦. AI 문안은 Sales 전략 한 장</p></li>
              <li><strong>검수</strong><span className="fl-tag is-code">코드</span><p className="small">데이터에 없는 숫자·출처 없는 전망이 든 문장은 빼고, 확인할 곳을 알림</p></li>
            </ol>
          </>
        )}

        {on === 'out' && (
          <>
            <h3>제안서 초안 <span className="muted small tnum">{slides.length}장</span></h3>
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

        {on === 'int' && (
          <>
            <h3>내부 데이터 <span className="muted small tnum">{int.length}건</span> <span className="dk2-unlinked">미연계</span></h3>
            <ul className="fl-list">
              {int.map((r) => (
                <li key={`${r.label}|${r.source}`}>
                  <strong>{r.label}</strong> <span className="muted small">{r.source}</span>
                  <p className="small">쓰일 장표: <SlideNames list={r.slides} /></p>
                </li>
              ))}
            </ul>
          </>
        )}

        {on === 'tacit' && (
          <Tacit input={input} tips={myTips} avail={avail} />
        )}
      </section>
    </div>
  );
}

function Tacit({ input, tips, avail }: { input: DeckInput; tips: Knowledge[]; avail: (id: ItemId) => boolean }) {
  const [tab, setTab] = useState<'tpl' | 'toc' | 'tips' | 'rules'>('tpl');
  const cur = templateOf(input.items);
  const bySlide = TIP_SLIDES.map(([k, label]) => [label, tips.filter((t) => t.slide === k)] as const).filter(([, xs]) => xs.length);
  return (
    <>
      <h3>암묵지</h3>
      <div className="fl-subtabs" role="tablist" aria-label="암묵지">
        {([['tpl', `템플릿 ${TEMPLATES.length}`], ['toc', '목차'], ['tips', `장표별 팁 ${tips.length}`], ['rules', `작성 규칙 ${RULES.length}`]] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'tpl' && (
        <ul className="fl-list">
          {TEMPLATES.map((t) => (
            <li key={t.key}>
              <strong>{t.label}</strong> {cur === t.key && <span className="fl-tag">지금</span>}
              <p className="small">{t.hint}</p>
            </li>
          ))}
        </ul>
      )}
      {tab === 'toc' && (
        <div className="fl-toc">
          {PARTS.map((p) => (
            <div key={p.key}>
              <p className="fl-toc-h"><strong>{p.key}. {p.label}</strong> <span className="muted small">{p.how}</span></p>
              <ul>
                {SECTIONS.filter((s) => s.part === p.key).map((s) => (
                  <li key={s.key}>
                    <span>{s.label}</span>
                    <span className="small fl-toc-items">
                      {s.items.map((i) => (
                        <span key={i.id} className={input.items[i.id] && avail(i.id) ? 'is-on' : undefined}>{i.title}</span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="small muted">진하게 = 지금 초안에 들어간 장표</p>
        </div>
      )}
      {tab === 'tips' && (
        bySlide.length ? (
          <ul className="fl-list">
            {bySlide.map(([label, xs]) => (
              <li key={label}>
                <strong>{label}</strong> <span className="muted small tnum">{xs.length}</span>
                <ul className="fl-tips">
                  {xs.map((k) => (
                    <li key={k.id} className="small"><span className="fl-tag">{KIND_LABEL[k.kind]}</span>{k.body}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">이 등급에 맞는 장표별 팁이 아직 없어요.</p>
        )
      )}
      {tab === 'rules' && (
        <ul className="fl-list">
          {RULES.map(([k, v]) => (
            <li key={k}><strong>{k}</strong><p className="small">{v}</p></li>
          ))}
        </ul>
      )}
    </>
  );
}
