'use client';

// 구성: 두 Agent 의 구조(Master·역할), 프롬프트·노하우(판 이력·비교·되돌리기·직접 수정), 도구, 데이터, 기억.
// 프롬프트·노하우를 고치면 새 판으로 남고 다음 실행부터 쓰인다(이 브라우저에 저장).
import { useEffect, useMemo, useState } from 'react';
import { ASSETS, BUILDER_ROLES, FIELD_LABEL, MODEL, ROLES, TOOL_DOC, parseItems, parseSections, type AssetKind } from '@/lib/agent/defs';
import { BY_LABEL, DEFAULT_MEMORY, versionsOf, when, type AssetStore, type MemoryFile } from '@/lib/agent/store';
import type { EngineState } from '@/lib/deck/engine';
import { available } from '@/lib/deck/layout';
import { dataReport } from '@/lib/deck/sources';
import type { DeckData } from '@/lib/deck/types';
import { Diff } from './Diff';

type Sec = 'agents' | 'prompt' | 'knowhow' | 'tools' | 'data' | 'memory';

const DECIDE_LABEL: Record<string, string> = {
  tranches: '트랜치', max_amount: '증액 한도', band: '금리 밴드', coupon: '이자지급', pay_date: '납입일', demand_date: '수요예측일', fee: '수수료',
  peer_scope: '사례 범위', peer_cases: '결과 표 사례', compare: '비교 사례', slides: '장표 켜고 끄기', template: '목차 템플릿',
};

export function ConfigPanel({ store, onSave, memory, setMemory, deck, focus }: {
  store: AssetStore;
  onSave: (id: string, text: string, note: string, by: 'manual' | 'rollback') => void;
  memory: MemoryFile[];
  setMemory: (m: MemoryFile[]) => void;
  deck: { state: EngineState | null; data: DeckData | null };
  focus: string | null;
}) {
  const [sec, setSec] = useState<Sec>('agents');
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => {
    if (!focus) return;
    const a = ASSETS.find((x) => x.id === focus);
    if (!a) return;
    setSec(a.kind);
    setPick(a.id);
  }, [focus]);
  const edited = (k: AssetKind) => ASSETS.filter((a) => a.kind === k && versionsOf(store, a.id).length > 1).length;
  const secs: [Sec, string, string][] = [
    ['agents', '구조', '2'],
    ['prompt', '프롬프트', `${ASSETS.filter((a) => a.kind === 'prompt').length}${edited('prompt') ? ` · 고침 ${edited('prompt')}` : ''}`],
    ['knowhow', '노하우', `${ASSETS.filter((a) => a.kind === 'knowhow').length}${edited('knowhow') ? ` · 고침 ${edited('knowhow')}` : ''}`],
    ['tools', '도구', String(TOOL_DOC.length)],
    ['data', '데이터', ''],
    ['memory', '기억', String(memory.length)],
  ];
  const open = (id: string) => {
    const a = ASSETS.find((x) => x.id === id);
    if (!a) return;
    setSec(a.kind);
    setPick(id);
  };
  return (
    <div className="ag-cfg">
      <nav className="ag-cfg-nav" aria-label="구성">
        {secs.map(([k, l, n]) => (
          <button key={k} type="button" aria-current={sec === k ? 'true' : undefined} onClick={() => setSec(k)}>
            {l}
            {n && <span>{n}</span>}
          </button>
        ))}
      </nav>
      <div className="ag-cfg-body">
        {sec === 'agents' && <AgentsView store={store} open={open} />}
        {(sec === 'prompt' || sec === 'knowhow') && <AssetsView kind={sec} store={store} onSave={onSave} pick={pick} setPick={setPick} />}
        {sec === 'tools' && <ToolsView />}
        {sec === 'data' && <DataView deck={deck} />}
        {sec === 'memory' && <MemoryView memory={memory} setMemory={setMemory} />}
      </div>
    </div>
  );
}

function AgentsView({ store, open }: { store: AssetStore; open: (id: string) => void }) {
  const v = (id: string) => versionsOf(store, id).at(-1)!.v;
  const groups = [1, 2, 3, 4, 5].map((o) => ROLES.filter((r) => r.order === o));
  return (
    <div className="ag-agents">
      <h2 className="ag-h2">제안서 Agent <span className="ag-muted">· {MODEL}</span></h2>
      <div className="ag-flow" aria-label="역할 순서">
        <button type="button" className="ag-flow-node is-master" onClick={() => open('dcm.master')}>
          <strong>Master</strong>
          <span>요청 파악 · 역할 배분 · 산출 · v{v('dcm.master')}</span>
        </button>
        <div className="ag-flow-steps">
          {groups.map((g, i) => (
            <div key={i} className="ag-flow-step">
              {g.map((r) => (
                <button key={r.key} type="button" className="ag-flow-node" onClick={() => open(`dcm.${r.key}`)}>
                  <strong>{r.name}</strong>
                  <span>{r.does}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <table className="ag-table ag-roles">
        <thead>
          <tr>
            <th scope="col">역할</th>
            <th scope="col">읽는 노하우</th>
            <th scope="col">정하는 것 (decide)</th>
            <th scope="col">쓰는 문안 (write)</th>
          </tr>
        </thead>
        <tbody>
          {ROLES.map((r) => (
            <tr key={r.key}>
              <th scope="row">
                <button type="button" className="ag-link" onClick={() => open(`dcm.${r.key}`)}>{r.name}</button> <span className="ag-muted">v{v(`dcm.${r.key}`)}</span>
              </th>
              <td>
                {r.knowhow.map((k) => (
                  <button key={k} type="button" className="ag-tag ag-tag-btn" onClick={() => open(k)}>
                    {ASSETS.find((a) => a.id === k)?.title} v{v(k)}
                  </button>
                ))}
              </td>
              <td>{r.decide.map((d) => DECIDE_LABEL[d] ?? d).join(', ') || <span className="ag-muted">없음</span>}</td>
              <td>{r.fields.map((f) => FIELD_LABEL[f]).join(', ') || <span className="ag-muted">{r.key === 'review' ? '의견만' : '없음'}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="ag-h2">Agent Builder <span className="ag-muted">· {MODEL}</span></h2>
      <div className="ag-flow">
        <button type="button" className="ag-flow-node is-master" onClick={() => open('builder.master')}>
          <strong>Builder Master</strong>
          <span>피드백 분류 · 역할 배분 · 개발 요청·기억 기록 · v{v('builder.master')}</span>
        </button>
        <div className="ag-flow-steps">
          <div className="ag-flow-step">
            {BUILDER_ROLES.map((r) => (
              <button key={r.key} type="button" className="ag-flow-node" onClick={() => open(`builder.${r.key}`)}>
                <strong>{r.name}</strong>
                <span>{r.does}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AssetsView({ kind, store, onSave, pick, setPick }: {
  kind: AssetKind; store: AssetStore; onSave: (id: string, text: string, note: string, by: 'manual' | 'rollback') => void; pick: string | null; setPick: (id: string) => void;
}) {
  const list = ASSETS.filter((a) => a.kind === kind);
  const id = pick && list.some((a) => a.id === pick) ? pick : list[0].id;
  const vers = versionsOf(store, id);
  const cur = vers[vers.length - 1];
  const [draft, setDraft] = useState(cur.text);
  const [cmp, setCmp] = useState<number | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    setDraft(cur.text);
    setCmp(null);
    setSaved(null);
  }, [id, cur.v, cur.text]);
  const dirty = draft !== cur.text;
  const meta = (aid: string) => {
    const t = versionsOf(store, aid).at(-1)!.text;
    return kind === 'knowhow' ? `항목 ${parseItems(aid, t).length}` : `부분 ${parseSections(t).length}`;
  };
  const cmpVer = cmp != null ? vers.find((x) => x.v === cmp) : null;
  const prevOf = (v: number) => vers[vers.findIndex((x) => x.v === v) - 1];
  return (
    <div className="ag-skills">
      <div className="ag-skill-list">
        {(['dcm', 'builder'] as const).map((g) => {
          const items = list.filter((a) => a.group === g);
          if (!items.length) return null;
          return (
            <div key={g}>
              <p className="ag-list-head">{g === 'dcm' ? '제안서 Agent' : 'Agent Builder'}</p>
              <ul>
                {items.map((a) => {
                  const vs = versionsOf(store, a.id);
                  return (
                    <li key={a.id}>
                      <button type="button" aria-current={a.id === id ? 'true' : undefined} onClick={() => setPick(a.id)}>
                        <strong>{a.title}</strong>
                        <span className="ag-skill-badges">
                          <em className={vs.length > 1 ? '' : 'is-plain'}>v{vs[vs.length - 1].v}</em>
                          <em className="is-plain">{meta(a.id)}</em>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="ag-editor">
        <div className="ag-editor-head">
          <h2>{list.find((a) => a.id === id)?.title} <span className="ag-muted">v{cur.v} · {BY_LABEL[cur.by]}</span></h2>
          <code className="ag-muted">{id}</code>
        </div>
        <textarea
          className="ag-code ag-editor-text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(null);
          }}
          spellCheck={false}
          aria-label={id}
        />
        <div className="ag-editor-foot">
          <button
            type="button"
            className="btn"
            disabled={!dirty}
            onClick={() => {
              onSave(id, draft, '직접 수정', 'manual');
              setSaved('새 판으로 저장했어요. 다음 실행부터 써요.');
            }}
          >
            저장
          </button>
          <button type="button" className="btn btn-ghost" disabled={!dirty} onClick={() => setDraft(cur.text)}>고친 것 버리기</button>
          <span className="ag-grow" />
          {saved && !dirty && <span className="ag-ok">{saved}</span>}
        </div>
        <h3 className="ag-h3">판 이력 <span className="ag-muted">{vers.length}</span></h3>
        <ol className="ag-vers">
          {[...vers].reverse().map((x) => (
            <li key={x.v} className={x.v === cur.v ? 'is-cur' : ''}>
              <span className="ag-ver">v{x.v}</span>
              <span className="ag-ver-by">{BY_LABEL[x.by]}</span>
              <span className="ag-ver-note">{x.note}</span>
              <time className="ag-muted">{when(x.at)}</time>
              {prevOf(x.v) && (
                <button type="button" className="ag-link" aria-expanded={cmp === x.v} onClick={() => setCmp(cmp === x.v ? null : x.v)}>
                  {cmp === x.v ? '닫기' : `v${prevOf(x.v)!.v}와 비교`}
                </button>
              )}
              {x.v !== cur.v && (
                <button type="button" className="ag-link" onClick={() => onSave(id, x.text, `v${x.v}로 되돌림`, 'rollback')}>이 판으로</button>
              )}
            </li>
          ))}
        </ol>
        {cmpVer && <Diff before={prevOf(cmpVer.v)?.text ?? ''} after={cmpVer.text} label={`v${cmpVer.v} 비교`} />}
      </div>
    </div>
  );
}

function ToolsView() {
  return (
    <div>
      <table className="ag-table">
        <thead>
          <tr>
            <th scope="col">쓰는 곳</th>
            <th scope="col">도구</th>
            <th scope="col">종류</th>
            <th scope="col">하는 일</th>
          </tr>
        </thead>
        <tbody>
          {TOOL_DOC.map((t) => (
            <tr key={t.name}>
              <td>{t.owner}</td>
              <td><code>{t.name}</code></td>
              <td><span className={`ag-kind ${t.kind === '호출' ? 'is-ai' : 'is-code'}`}>{t.kind}</span></td>
              <td>{t.does}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataView({ deck }: { deck: { state: EngineState | null; data: DeckData | null } }) {
  const rep = useMemo(() => {
    if (!deck.state || !deck.data) return null;
    return dataReport(deck.data, deck.state.input, available(deck.data, deck.state.input));
  }, [deck]);
  if (!rep || !deck.data) return <p className="ag-muted">실행에서 회사를 열면 그 초안이 쓰는 데이터가 장표별로 나와요.</p>;
  return (
    <div className="ag-data">
      <p className="ag-muted">{deck.data.company.corp_name} 초안 기준</p>
      <h2 className="ag-h2">외부 데이터</h2>
      <table className="ag-table">
        <thead>
          <tr>
            <th scope="col">장표</th>
            <th scope="col">데이터</th>
            <th scope="col">출처</th>
          </tr>
        </thead>
        <tbody>
          {rep.items.flatMap((it) =>
            it.srcs
              .filter((s) => s.kind === 'ext')
              .map((s, i) => (
                <tr key={`${it.id}-${i}`}>
                  <td>{i === 0 ? it.label : ''}</td>
                  <td>{s.label}{s.status === 'missing' && <span className="ag-kind is-miss">없음</span>}</td>
                  <td className="ag-muted">{s.source}</td>
                </tr>
              )),
          )}
        </tbody>
      </table>
      <h2 className="ag-h2">내부 데이터 <span className="dk2-unlinked">미연계</span></h2>
      <table className="ag-table">
        <thead>
          <tr>
            <th scope="col">데이터</th>
            <th scope="col">출처</th>
            <th scope="col">쓰는 장표</th>
          </tr>
        </thead>
        <tbody>
          {rep.intMissing.map((m) => (
            <tr key={`${m.label}|${m.source}`}>
              <td>{m.label}</td>
              <td className="ag-muted">{m.source}</td>
              <td>{m.items.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemoryView({ memory, setMemory }: { memory: MemoryFile[]; setMemory: (m: MemoryFile[]) => void }) {
  return (
    <div className="ag-memory">
      {memory.map((f, i) => {
        const def = DEFAULT_MEMORY.find((d) => d.path === f.path)?.body ?? '';
        return (
          <section key={f.path} className="ag-mem">
            <div className="ag-mem-head">
              <h2>{f.title}</h2>
              <code>{f.path}</code>
              {f.body !== def && (
                <button type="button" className="ag-link" onClick={() => setMemory(memory.map((m, j) => (j === i ? { ...m, body: def } : m)))}>예시로 되돌리기</button>
              )}
            </div>
            <textarea
              className="ag-code"
              rows={Math.max(3, f.body.split('\n').length + 1)}
              value={f.body}
              onChange={(e) => setMemory(memory.map((m, j) => (j === i ? { ...m, body: e.target.value } : m)))}
              aria-label={`${f.title} 기억`}
            />
          </section>
        );
      })}
    </div>
  );
}
