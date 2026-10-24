'use client';

// 제안서 작성: 조건 입력 → 일정·사례 선택 → 문안(규칙, 또는 현업 노하우를 반영한 AI 문안) → 미리보기 → PPTX·PDF 내려받기.
// 입력값·문안은 이 브라우저(localStorage)에만 저장한다. 서버에는 공개 데이터·노하우 조회와 AI 문안 요청만 보낸다.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info } from '@/components/Ui';
import { bandRange, eok, mdw, ratioX, rate3, yy } from '@/lib/deck/fmt';
import { BACK, FRONT, SECTIONS, defaultItems, type Item, type ItemId } from '@/lib/deck/catalog';
import { KIND_LABEL, forGrade, type Knowledge, type KnowledgeSlide } from '@/lib/deck/knowledge';
import { available, buildSlides, fileBase, staticSubs } from '@/lib/deck/layout';
import { defaultInput, factsFor, peerPool, ruleText, scheduleOf, totalEok } from '@/lib/deck/rules';
import type { DeckData, DeckInput, DeckText } from '@/lib/deck/types';
import { SlideView } from './SlideView';

type Mode = 'rule' | 'ai' | 'edited';
type Saved = { v: 2; input: DeckInput; text: DeckText | null; mode: Mode; factsKey: string | null; at: string };
const KEY = (corp: string) => `deck:v2:${corp}`;

function load(corp: string): Saved | null {
  try {
    const s = localStorage.getItem(KEY(corp));
    return s ? (JSON.parse(s) as Saved) : null;
  } catch {
    return null;
  }
}
function save(corp: string, s: Saved) {
  try {
    localStorage.setItem(KEY(corp), JSON.stringify(s));
  } catch {
    /* 저장 공간이 없거나 막힘: 이번 화면에서만 유지 */
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// 장표별 요약 상자 문안 (목차에서 켠 장표만 보인다)
const TEXT_FIELDS: { key: keyof DeckText; item: ItemId; label: string }[] = [
  { key: 'structure', item: 'terms', label: '발행조건 제안(案)' },
  { key: 'sizing', item: 'sizing', label: '적정 발행규모 및 트랜치 구성' },
  { key: 'schedule', item: 'schedule', label: '발행 일정' },
  { key: 'sales', item: 'sales', label: 'Sales 전략' },
  { key: 'pipeline', item: 'pipeline', label: '수요예측 예정 내역' },
  { key: 'rates', item: 'rates', label: '금리 동향' },
  { key: 'bok', item: 'bok', label: '금통위' },
  { key: 'fomc', item: 'fomc', label: 'FOMC' },
  { key: 'views', item: 'views', label: '증권사별 국내 기준금리 전망' },
  { key: 'usviews', item: 'usviews', label: '증권사별 미국 기준금리 전망' },
  { key: 'forecast', item: 'forecast', label: '금리 전망(NH투자증권 리서치)' },
  { key: 'peers', item: 'peers', label: '수요예측 결과' },
  { key: 'compare', item: 'compare', label: '미매각 사례 분석' },
  { key: 'corp', item: 'corp', label: '회사채 금리' },
  { key: 'league', item: 'league', label: '연간 League Table' },
  { key: 'maturity', item: 'maturity', label: '등급별 회사채 만기도래' },
];

const TERM_NOTES: [keyof DeckText['termNotes'], string][] = [
  ['rating', '신용등급'], ['tenor', '만기'], ['amount', '발행금액'], ['band', '금리 밴드'], ['coupon', '이자지급'],
  ['demand', '수요예측일'], ['pay', '발행일'], ['uw', '인수희망금액'], ['fee', '수수료'],
];
const INTERNAL: [keyof DeckInput['internal'], string, string][] = [
  ['rateFc', '리서치 금리 전망표', '금리 전망 장표의 전망표를 대체합니다(예: NH 리서치 월간 전망표).'],
  ['creditFc', '등급별 회사채 금리 전망표', '금리 전망 장표 2쪽(AA+~A- 2·3·5년 전망)을 만듭니다.'],
  ['minpyeong', '개별민평·등급민평 표', '적정 발행규모 장표 오른쪽 위 금리 표를 대체합니다.'],
  ['investors', '기관별 참여·배정 내역', 'Sales 전략 장표 아래에 들어갑니다.'],
];

export function DeckStudio({ corp }: { corp: string }) {
  const [data, setData] = useState<DeckData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [input, setInput] = useState<DeckInput | null>(null);
  const [text, setText] = useState<DeckText | null>(null);
  const [mode, setMode] = useState<Mode>('rule');
  const [factsKey, setFactsKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<'' | 'ai' | 'pptx' | 'pdf'>('');
  const [note, setNote] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [tips, setTips] = useState<Knowledge[]>([]);

  // 현업 노하우(장표별): 문안 칸 아래에 보여 주고, AI 문안에 넣는다
  useEffect(() => {
    fetch('/api/deck/knowledge', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((j) => setTips(j.items ?? []))
      .catch(() => setTips([]));
  }, []);

  useEffect(() => {
    let alive = true;
    setData(null);
    setErr(null);
    fetch(`/api/deck/data?corp=${encodeURIComponent(corp)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? '데이터를 불러오지 못했습니다.');
        return j as DeckData;
      })
      .then((d) => {
        if (!alive) return;
        setData(d);
        const s = load(corp);
        const base = defaultInput(d);
        if (s) {
          setInput({ ...base, ...s.input, items: { ...base.items, ...s.input.items }, band: { ...base.band, ...s.input.band }, internal: { ...base.internal, ...s.input.internal } });
          setText(s.text);
          setMode(s.mode);
          setFactsKey(s.factsKey);
          setSavedAt(s.at);
        } else {
          setInput(base);
          setText(null);
          setMode('rule');
        }
      })
      .catch((e: Error) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [corp]);

  const rule = useMemo(() => (data && input ? ruleText(data, input) : null), [data, input]);
  const facts = useMemo(() => (data && input ? factsFor(data, input) : null), [data, input]);
  const curKey = useMemo(() => (facts ? JSON.stringify(facts).length + ':' + hash(JSON.stringify(facts)) : null), [facts]);
  const shownText = mode === 'rule' || !text ? rule : text;
  const slides = useMemo(() => (data && input && shownText ? buildSlides(data, input, shownText) : []), [data, input, shownText]);
  const stale = mode !== 'rule' && factsKey && curKey && factsKey !== curKey;

  // 저장 (입력이 바뀌면 0.6초 뒤)
  useEffect(() => {
    if (!input) return;
    const t = setTimeout(() => {
      const at = new Date().toISOString();
      save(corp, { v: 2, input, text: mode === 'rule' ? null : text, mode, factsKey, at });
      setSavedAt(at);
    }, 600);
    return () => clearTimeout(t);
  }, [corp, input, text, mode, factsKey]);

  const set = useCallback(<K extends keyof DeckInput>(k: K, v: DeckInput[K]) => setInput((x) => (x ? { ...x, [k]: v } : x)), []);

  async function runAi() {
    if (!facts || !rule) return;
    setBusy('ai');
    setNote(null);
    try {
      const slides = Object.entries(input!.items).filter(([, v]) => v).map(([k]) => k);
      const r = await fetch('/api/deck/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facts, rule, grade: data?.company.rating_group ?? null, slides }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'AI 문안을 만들지 못했습니다.');
      setText(j.text);
      setMode('ai');
      setFactsKey(curKey);
      const used = j.applied ? `노하우 ${j.applied}개를 반영했습니다.` : '반영할 노하우가 없어 문장만 다듬었습니다.';
      setNote(j.dropped ? `${used} 근거 숫자가 없거나 전망 표현이 있는 ${j.dropped}줄은 규칙 문안으로 바꿨습니다.` : `${used} 내려받기 전에 숫자를 확인하세요.`);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function exportAs(kind: 'pptx' | 'pdf') {
    if (!input || !slides.length) return;
    setBusy(kind);
    setNote(null);
    try {
      const name = fileBase(input);
      if (kind === 'pptx') {
        const { toPptx } = await import('@/lib/deck/render-pptx');
        download(await toPptx(slides, name, staticSubs(data!, input)), `${name}.pptx`);
      } else {
        const { toPdf } = await import('@/lib/deck/render-pdf');
        download(await toPdf(slides, name), `${name}.pdf`);
      }
    } catch (e) {
      setNote(`파일을 만들지 못했습니다: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  function editText(k: keyof DeckText, v: unknown) {
    const base = mode === 'rule' || !text ? rule! : text;
    setText({ ...base, [k]: v });
    if (mode === 'rule') setFactsKey(curKey);
    setMode('edited');
  }

  function reset() {
    if (!data) return;
    try {
      localStorage.removeItem(KEY(corp));
    } catch {
      /* 무시 */
    }
    setInput(defaultInput(data));
    setText(null);
    setMode('rule');
    setFactsKey(null);
    setNote('기본값으로 되돌렸습니다.');
  }

  if (err) return <p className="empty">{err} <Link href="/proposal">다른 회사 고르기</Link></p>;
  if (!data || !input || !shownText) return <p className="empty" aria-busy="true">공시·금리 데이터를 모으는 중입니다…</p>;

  const sch = scheduleOf(data, input);
  const pool = peerPool(data, input.peerScope);
  const myTips = forGrade(tips, data.company.rating_group);

  return (
    <div className="dk">
      <div className="dk-bar">
        <div className="dk-who">
          <h2>{data.company.corp_name}</h2>
          <span className="muted small">
            {data.company.rating ?? '등급 미확인'} · 공모 회사채 {data.company.bond_count}회 · 데이터 {data.asof}
          </span>
        </div>
        <div className="dk-actions">
          <span className="dk-ai">
            <button type="button" className="btn btn-ghost" onClick={runAi} disabled={!!busy}>
              {busy === 'ai' ? '노하우 반영 중…' : mode === 'ai' ? '노하우 다시 반영(AI)' : '노하우 반영(AI)'}
            </button>
            <Info>기본 문안은 공시·금리 숫자로 규칙이 만듭니다. 이 버튼은 현업 노하우(이 회사 등급·켠 장표에 맞는 것)를 더해 AI가 판단 문장을 고칩니다. 사실에 없는 숫자나 출처 없는 시장 전망이 든 줄은 규칙 문안으로 되돌립니다. 회사명·조건·숫자가 OpenAI로 전송되고, 결과는 이 브라우저에만 저장됩니다.</Info>
          </span>
          <button type="button" className="btn" onClick={() => exportAs('pptx')} disabled={!!busy}>{busy === 'pptx' ? 'PPTX 만드는 중…' : 'PPTX 내려받기'}</button>
          <button type="button" className="btn" onClick={() => exportAs('pdf')} disabled={!!busy}>{busy === 'pdf' ? 'PDF 만드는 중…' : 'PDF 내려받기'}</button>
        </div>
      </div>
      <p className="dk-status small" role="status">
        <span className={`dk-mode m-${mode}`}>{mode === 'rule' ? '규칙 문안' : mode === 'ai' ? '노하우 반영 문안' : '직접 고친 문안'}</span>
        {stale && <span className="dk-stale">조건이 바뀌었습니다. 문안을 다시 만들거나 확인하세요.</span>}
        {note && <span>{note}</span>}
        {savedAt && <span className="muted">이 브라우저에 저장됨 {new Date(savedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>}
      </p>

      <div className="dk-layout">
        <form className="dk-form" onSubmit={(e) => e.preventDefault()} aria-label="제안 조건">
          <details open>
            <summary>기본 정보</summary>
            <Field label="회사명 표기"><input value={input.issuer} onChange={(e) => set('issuer', e.target.value)} /></Field>
            <Field label="표지 제목"><input value={input.coverTitle} onChange={(e) => set('coverTitle', e.target.value)} /></Field>
            <div className="dk-row">
              <Field label="회차"><input value={input.series} onChange={(e) => set('series', e.target.value)} inputMode="numeric" /></Field>
              <Field label="제안 월"><input value={input.month} onChange={(e) => set('month', e.target.value)} placeholder="2026. 11" /></Field>
            </div>
            <div className="dk-row">
              <Field label="신용등급"><input value={input.rating} onChange={(e) => set('rating', e.target.value)} /></Field>
              <Field label="등급 비고"><input value={input.ratingNote} onChange={(e) => set('ratingNote', e.target.value)} /></Field>
            </div>
          </details>

          <details open>
            <summary>발행 조건</summary>
            <Tranches input={input} set={set} />
            <Field label="이자지급">
              <select value={input.coupon} onChange={(e) => set('coupon', e.target.value)}>
                {['3개월 이표채', '월단위 이표채', '6개월 이표채', '만기일시'].map((x) => <option key={x}>{x}</option>)}
              </select>
            </Field>
            <Field label="금리 밴드">
              <select value={input.band.type} onChange={(e) => set('band', { ...input.band, type: e.target.value as DeckInput['band']['type'] })}>
                <option value="later">추후 결정</option>
                <option value="fixed">고정금리(%)</option>
                <option value="spread">개별민평(bp)</option>
              </select>
            </Field>
            {input.band.type !== 'later' && (
              <div className="dk-row">
                <Field label={input.band.type === 'fixed' ? '하단(%)' : '하단(bp)'}><NumIn v={input.band.low} on={(v) => set('band', { ...input.band, low: v })} step="any" /></Field>
                <Field label={input.band.type === 'fixed' ? '상단(%)' : '상단(bp)'}><NumIn v={input.band.high} on={(v) => set('band', { ...input.band, high: v })} step="any" /></Field>
              </div>
            )}
            <Field label="밴드 비고"><input value={input.bandNote} onChange={(e) => set('bandNote', e.target.value)} /></Field>
            <Field label="인수희망금액"><input value={input.uw} onChange={(e) => set('uw', e.target.value)} /></Field>
            <div className="dk-row">
              <Field label="인수수수료(bp)"><NumIn v={input.feeUw} on={(v) => set('feeUw', v)} step="any" /></Field>
              <Field label="대표주관수수료(bp)"><NumIn v={input.feeLead} on={(v) => set('feeLead', v)} step="any" /></Field>
            </div>
            <Field label="수수료 비고"><input value={input.feeNote} onChange={(e) => set('feeNote', e.target.value)} /></Field>
          </details>

          <details open>
            <summary>일정</summary>
            <Field label="희망 납입일"><input type="date" value={input.pay} onChange={(e) => set('pay', e.target.value)} /></Field>
            {sch && (
              <>
                <fieldset className="dk-radios">
                  <legend>수요예측일</legend>
                  {sch.demandOptions.map((d2, i) => (
                    <label key={d2}>
                      <input type="radio" name="demand" checked={sch.demand === d2} onChange={() => set('demand', d2)} />
                      {mdw(d2)} <span className="muted small">{['7', '6', '5'][i]}영업일 전</span>
                    </label>
                  ))}
                </fieldset>
                <ul className="dk-sched small">
                  <li><span>대표주관계약</span>{mdw(sch.leadContract)}</li>
                  <li><span>증권신고서</span>{mdw(sch.filing)}</li>
                  <li><span>조건확정 정정</span>{mdw(sch.condFix)}</li>
                  <li><span>납입</span><strong>{mdw(sch.pay)}</strong></li>
                </ul>
                {sch.warnings.map((w) => <p key={w} className="dk-warn small">{w}</p>)}
              </>
            )}
          </details>

          <details open>
            <summary>
              비교 사례 <span className="muted small">표 {input.peerKeys.length} · 비교 {input.compareKeys.length}/3</span>
            </summary>
            <div className="seg dk-seg" role="group" aria-label="사례 범위">
              {(['group', 'notch'] as const).map((s) => (
                <button key={s} type="button" aria-pressed={input.peerScope === s} onClick={() => set('peerScope', s)}>
                  {s === 'group' ? `${data.company.rating_group ?? ''}등급 전체` : `${data.company.rating ?? ''}만`}
                </button>
              ))}
            </div>
            <div className="dk-peers" role="table" aria-label="같은 등급 최근 1년 공모 회사채">
              <div role="row" className="dk-peer dk-peer-h small">
                <span role="columnheader">표</span><span role="columnheader">비교</span><span role="columnheader">발행사</span><span role="columnheader">수요예측</span><span role="columnheader">경쟁률</span>
              </div>
              {pool.map((p) => {
                const inT = input.peerKeys.includes(p.key);
                const inC = input.compareKeys.includes(p.key);
                return (
                  <div role="row" key={p.key} className={`dk-peer${p.corp_code === data.company.corp_code ? ' is-self' : ''}`}>
                    <span role="cell"><input type="checkbox" aria-label={`${p.corp_name} 표에 넣기`} checked={inT} onChange={() => set('peerKeys', inT ? input.peerKeys.filter((k) => k !== p.key) : [...input.peerKeys, p.key])} /></span>
                    <span role="cell"><input type="checkbox" aria-label={`${p.corp_name} 비교 장표에 넣기`} checked={inC} disabled={!inC && input.compareKeys.length >= 3} onChange={() => set('compareKeys', inC ? input.compareKeys.filter((k) => k !== p.key) : [...input.compareKeys, p.key])} /></span>
                    <span role="cell" title={`${p.rating ?? ''} ${p.tenor_combo} ${eok(p.amount_krw)}억 ${p.tranches.map((t) => rate3(t.yield_pct)).join('/')} ${p.band_low != null ? bandRange(p) : ''}`}>
                      {p.corp_name} <span className="muted">{p.rating} {p.tenor_combo}</span>
                    </span>
                    <span role="cell" className="tnum">{p.demand_dt ? mdw(p.demand_dt) : yy(p.deal_dt)}</span>
                    <span role="cell" className={`tnum${p.under ? ' neg' : ''}`}>{ratioX(p.ratio)}</span>
                  </div>
                );
              })}
              {!pool.length && <p className="empty small">최근 1년 같은 등급 발행이 없습니다.</p>}
            </div>
          </details>

          <Toc data={data} input={input} set={set} />

          <details>
            <summary>
              문안 <Info>한 줄이 글머리 하나입니다. **굵게+밑줄**, !!빨강!! 표기를 쓸 수 있습니다. 숫자는 공시·금리 데이터 값이므로 고칠 때 원문을 확인하세요.</Info>
            </summary>
            <Tips list={myTips} slide="all" />
            <Field label="주요 제안 첫 문장">
              <textarea rows={3} value={shownText.lead} onChange={(e) => editText('lead', e.target.value)} />
            </Field>
            {TEXT_FIELDS.filter((f) => input.items[f.item]).map((f) => (
              <div key={f.key}>
                <Field label={f.label}>
                  <textarea rows={Math.min(8, (shownText[f.key] as string[]).length + 1)} value={(shownText[f.key] as string[]).join('\n')} onChange={(e) => editText(f.key, e.target.value.split('\n').filter((l) => l.trim()))} />
                </Field>
                <Tips list={myTips} slide={f.item as KnowledgeSlide} />
              </div>
            ))}
            {input.items.terms && (
              <fieldset className="dk-notes">
                <legend className="dk-label">발행조건 표 비고</legend>
                {TERM_NOTES.map(([k, label]) => (
                  <label key={k} className="dk-note-row">
                    <span className="small muted">{label}</span>
                    <input value={shownText.termNotes[k]} onChange={(e) => editText('termNotes', { ...shownText.termNotes, [k]: e.target.value })} />
                  </label>
                ))}
              </fieldset>
            )}
            {input.items.strength && shownText.strengths.map((s, i) => (
              <div key={`st-${i}`} className="dk-row">
                <Field label={`강점 ${i + 1} 제목`}><input value={s.title} onChange={(e) => editText('strengths', shownText.strengths.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} /></Field>
                <Field label="내용"><input value={s.text} onChange={(e) => editText('strengths', shownText.strengths.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} /></Field>
              </div>
            ))}
            {mode !== 'rule' && <button type="button" className="linklike small" onClick={() => { setMode('rule'); setText(null); setFactsKey(null); }}>규칙 문안으로 되돌리기</button>}
          </details>

          <details>
            <summary>
              내부 자료 <Info>공시로 구할 수 없는 표를 엑셀에서 복사해 붙여넣으면 장표에 그대로 들어갑니다. 첫 줄은 머리글, 첫 열은 항목입니다. 이 브라우저에만 저장되고 AI 문안 요청에는 보내지 않습니다.</Info>
            </summary>
            {INTERNAL.map(([k, label, where]) => (
              <Field key={k} label={label} hint={where}>
                <textarea rows={3} className="dk-tsv" placeholder="엑셀에서 표를 복사해 붙여넣기" value={input.internal[k]} onChange={(e) => set('internal', { ...input.internal, [k]: e.target.value })} />
              </Field>
            ))}
          </details>

          <details>
            <summary>뒷표지</summary>
            <Field label="부서명"><input value={input.dept} onChange={(e) => set('dept', e.target.value)} /></Field>
            <Field label="연락처" hint="직접 입력한 경우에만 표시합니다. 이 브라우저에만 저장됩니다."><textarea rows={3} value={input.contacts} onChange={(e) => set('contacts', e.target.value)} /></Field>
          </details>

          <p className="small"><button type="button" className="linklike" onClick={reset}>입력값 처음으로</button></p>
        </form>

        <Preview slides={slides} />
      </div>
    </div>
  );
}

// 이 장표에 쓰는 노하우 (접어 두고 개수만 보인다)
function Tips({ list, slide }: { list: Knowledge[]; slide: KnowledgeSlide }) {
  const mine = list.filter((k) => k.slide === slide);
  if (!mine.length) return null;
  return (
    <details className="dk-tips">
      <summary>{slide === 'all' ? '모든 장표 공통 노하우' : '노하우'} {mine.length}</summary>
      <ul>
        {mine.map((k) => (
          <li key={k.id}><span className="dk-tag">{KIND_LABEL[k.kind]}</span>{k.body}</li>
        ))}
      </ul>
    </details>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="dk-field">
      <span className="dk-label">{label}{hint && <Info>{hint}</Info>}</span>
      {children}
    </label>
  );
}

type Setter = <K extends keyof DeckInput>(k: K, v: DeckInput[K]) => void;

// 트랜치: 만기·최초 신고 금액. 만기 칸에 '1년 또는 1.5년'처럼 쓰면 대안으로 비교한다.
function Tranches({ input, set }: { input: DeckInput; set: Setter }) {
  const tr = input.tranches;
  const put = (i: number, v: Partial<DeckInput['tranches'][number]>) => set('tranches', tr.map((t, j) => (j === i ? { ...t, ...v } : t)));
  const total = totalEok(input);
  return (
    <div className="dk-tranches">
      <div className="dk-tr dk-tr-h small" aria-hidden>
        <span>만기</span><span>금액(억원)</span><span />
      </div>
      {tr.map((t, i) => (
        <div className="dk-tr" key={i}>
          <input aria-label={`트랜치 ${i + 1} 만기`} value={t.tenor} onChange={(e) => put(i, { tenor: e.target.value })} placeholder="3년" />
          <input aria-label={`트랜치 ${i + 1} 금액(억원)`} type="number" inputMode="numeric" value={t.eok ?? ''} onChange={(e) => put(i, { eok: e.target.value === '' ? null : Number(e.target.value) })} />
          <button type="button" className="linklike small" disabled={tr.length <= 1} onClick={() => set('tranches', tr.filter((_, j) => j !== i))} aria-label={`트랜치 ${i + 1} 빼기`}>빼기</button>
        </div>
      ))}
      <div className="dk-tr-foot small">
        <button type="button" className="linklike" onClick={() => set('tranches', [...tr, { tenor: '', eok: null }])} disabled={tr.length >= 5}>트랜치 추가</button>
        <span className="muted">합계 {total ? `${total.toLocaleString('ko-KR')}억원` : '–'}</span>
      </div>
      <Field label="증액 시 최대(억원)"><NumIn v={input.maxEok} on={(v) => set('maxEok', v)} /></Field>
    </div>
  );
}

// 목차: 대한항공 공모사채 제안서 구성. 켜고 끄면 목차·간지·쪽 제목 번호가 다시 매겨진다.
function Toc({ data, input, set }: { data: DeckData; input: DeckInput; set: Setter }) {
  const avail = available(data, input);
  const on = input.items;
  const count = [...FRONT, ...SECTIONS.flatMap((x) => x.groups.flatMap((g) => g.items)), BACK].filter((i) => on[i.id] && avail(i.id)).length;
  const toggle = (id: ItemId, v: boolean) => set('items', { ...on, [id]: v });
  const row = (i: Item, sub = false) => {
    const ok = avail(i.id);
    return (
      <li key={i.id} className={sub ? 'dk-toc-sub' : undefined}>
        <label className={ok ? undefined : 'muted'}>
          <input type="checkbox" checked={!!on[i.id] && ok} disabled={!ok} onChange={(e) => toggle(i.id, e.target.checked)} />
          <span>{i.title}</span>
          {i.kind !== 'gen' && <span className="dk-tag">{i.kind === 'static' ? '템플릿' : '빈 표'}</span>}
          {!ok && <span className="small">자료 없음</span>}
        </label>
        {i.note && ok && <span className="dk-toc-note small muted">{i.note}</span>}
      </li>
    );
  };
  const staticOn = (['ir', 'nh_org'] as ItemId[]).some((id) => on[id]);
  return (
    <details open>
      <summary>목차 <span className="muted small">{count}개 항목</span></summary>
      <ul className="dk-toc">{FRONT.map((i) => row(i))}</ul>
      {SECTIONS.map((sec) => (
        <fieldset key={sec.key} className="dk-toc-sec">
          <legend>{sec.key === 'A' ? 'Appendix' : `${sec.key}. ${sec.label}`}</legend>
          <ul className="dk-toc">
            {sec.groups.map((g) => (g.items.length === 1 && g.items[0].title === g.title
              ? row(g.items[0])
              : (
                <li key={g.title}>
                  <span className="dk-toc-g">{g.title}</span>
                  <ul className="dk-toc">{g.items.map((i) => row(i, true))}</ul>
                </li>
              )))}
          </ul>
        </fieldset>
      ))}
      <ul className="dk-toc">{row(BACK)}</ul>
      {staticOn && (
        <Field label="담당 커버리지 부서" hint="템플릿 장표(IR 전략·업무 분장)의 부서명 자리에 들어갑니다.">
          <input value={input.coverDept} onChange={(e) => set('coverDept', e.target.value)} />
        </Field>
      )}
      <p className="small"><button type="button" className="linklike" onClick={() => set('items', defaultItems())}>기본 목차로</button></p>
    </details>
  );
}

function NumIn({ v, on, step }: { v: number | null; on: (v: number | null) => void; step?: string }) {
  return <input type="number" inputMode="decimal" step={step ?? '1'} value={v ?? ''} onChange={(e) => on(e.target.value === '' ? null : Number(e.target.value))} />;
}

function Preview({ slides }: { slides: ReturnType<typeof buildSlides> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <section className="dk-preview" ref={ref} aria-label="미리보기">
      {slides.map((s, i) => (
        <figure key={`${s.id}-${i}`} className="dk-fig">
          <SlideView slide={s} width={w} />
          <figcaption className="small muted">{i + 1}. {s.title}</figcaption>
        </figure>
      ))}
    </section>
  );
}
