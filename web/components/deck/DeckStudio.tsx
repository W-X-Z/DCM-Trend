'use client';

// 제안서 작성: 조건 입력 → 일정·사례 선택 → AI 문안 → 미리보기 → PPTX·PDF 내려받기.
// 입력값·문안은 이 브라우저(localStorage)에만 저장한다. 서버에는 공개 데이터 조회와 AI 문안 요청만 보낸다.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info } from '@/components/Ui';
import { bandRange, eok, mdw, ratioX, rate3, yy } from '@/lib/deck/fmt';
import { buildSlides, fileBase } from '@/lib/deck/layout';
import { defaultInput, factsFor, peerPool, ruleText, scheduleOf } from '@/lib/deck/rules';
import { SLIDES, type DeckData, type DeckInput, type DeckText, type SlideId } from '@/lib/deck/types';
import { SlideView } from './SlideView';

type Mode = 'rule' | 'ai' | 'edited';
type Saved = { v: 1; input: DeckInput; text: DeckText | null; mode: Mode; factsKey: string | null; at: string };
const KEY = (corp: string) => `deck:v1:${corp}`;

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

const TEXT_FIELDS: { key: keyof DeckText; slide: SlideId; label: string }[] = [
  { key: 'peers', slide: 'peers', label: '같은 등급 수요예측 사례' },
  { key: 'compare', slide: 'compare', label: '사례 비교' },
  { key: 'schedule', slide: 'schedule', label: '발행 일정(안)' },
  { key: 'structure', slide: 'structure', label: '트랜치·만기 구조' },
  { key: 'rates', slide: 'rates', label: '기준금리·국고채' },
  { key: 'corp', slide: 'corp', label: '회사채 금리' },
  { key: 'views', slide: 'views', label: '증권사별 기준금리 전망' },
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
          setInput({ ...base, ...s.input, slides: { ...base.slides, ...s.input.slides }, band: { ...base.band, ...s.input.band } });
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
      save(corp, { v: 1, input, text: mode === 'rule' ? null : text, mode, factsKey, at });
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
      const r = await fetch('/api/deck/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facts, rule }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'AI 문안을 만들지 못했습니다.');
      setText(j.text);
      setMode('ai');
      setFactsKey(curKey);
      setNote(j.dropped ? `AI 문안 중 근거 숫자가 없거나 전망 표현이 있는 ${j.dropped}줄은 규칙 문안으로 바꿨습니다.` : 'AI 문안을 반영했습니다. 내려받기 전에 숫자를 확인하세요.');
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
        download(await toPptx(slides, name), `${name}.pptx`);
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
              {busy === 'ai' ? 'AI 문안 만드는 중…' : mode === 'ai' ? 'AI 문안 다시 만들기' : 'AI 문안 만들기'}
            </button>
            <Info>회사명과 입력한 조건, 공시·금리 사실 묶음이 OpenAI로 전송됩니다. 결과는 숫자 검증을 거쳐 이 브라우저에만 저장됩니다.</Info>
          </span>
          <button type="button" className="btn" onClick={() => exportAs('pptx')} disabled={!!busy}>{busy === 'pptx' ? 'PPTX 만드는 중…' : 'PPTX 내려받기'}</button>
          <button type="button" className="btn" onClick={() => exportAs('pdf')} disabled={!!busy}>{busy === 'pdf' ? 'PDF 만드는 중…' : 'PDF 내려받기'}</button>
        </div>
      </div>
      <p className="dk-status small" role="status">
        <span className={`dk-mode m-${mode}`}>{mode === 'rule' ? '규칙 문안' : mode === 'ai' ? 'AI 문안' : '직접 고친 문안'}</span>
        {stale && <span className="dk-stale">조건이 바뀌었습니다. 문안을 다시 만들거나 확인하세요.</span>}
        {note && <span>{note}</span>}
        {savedAt && <span className="muted">이 브라우저에 저장됨 {new Date(savedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>}
      </p>

      <div className="dk-layout">
        <form className="dk-form" onSubmit={(e) => e.preventDefault()} aria-label="제안 조건">
          <details open>
            <summary>기본 정보</summary>
            <Field label="표지 회사명"><input value={input.issuer} onChange={(e) => set('issuer', e.target.value)} /></Field>
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
            <Field label="만기" hint="'또는'으로 여러 안을 적으면 만기구조 비교 표에 행으로 나뉩니다."><input value={input.tenors} onChange={(e) => set('tenors', e.target.value)} placeholder="1년 또는 1.5년" /></Field>
            <div className="dk-row">
              <Field label="발행금액(억원)"><NumIn v={input.amountEok} on={(v) => set('amountEok', v)} /></Field>
              <Field label="증액 시 최대(억원)"><NumIn v={input.maxEok} on={(v) => set('maxEok', v)} /></Field>
            </div>
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

          <details>
            <summary>장표 구성 <span className="muted small">{SLIDES.filter((s) => input.slides[s.id]).length}/{SLIDES.length}</span></summary>
            <ul className="dk-toggles">
              {SLIDES.map((s) => (
                <li key={s.id}>
                  <label>
                    <input type="checkbox" checked={input.slides[s.id]} onChange={(e) => set('slides', { ...input.slides, [s.id]: e.target.checked })} />
                    {s.label}
                  </label>
                </li>
              ))}
            </ul>
          </details>

          <details>
            <summary>
              문안 <Info>한 줄이 글머리 하나입니다. **굵게+밑줄**, !!빨강!! 표기를 쓸 수 있습니다. 숫자는 공시·금리 데이터 값이므로 고칠 때 원문을 확인하세요.</Info>
            </summary>
            <Field label="주요 제안 첫 문장">
              <textarea rows={3} value={shownText.lead} onChange={(e) => editText('lead', e.target.value)} />
            </Field>
            {TEXT_FIELDS.filter((f) => input.slides[f.slide]).map((f) => (
              <Field key={f.key} label={f.label}>
                <textarea rows={Math.min(8, (shownText[f.key] as string[]).length + 1)} value={(shownText[f.key] as string[]).join('\n')} onChange={(e) => editText(f.key, e.target.value.split('\n').filter((l) => l.trim()))} />
              </Field>
            ))}
            {input.slides.structure && shownText.structureRows.map((r, i) => (
              <Field key={`sr-${i}`} label={`만기 구조 설명: ${r.label}`}>
                <textarea rows={2} value={r.desc} onChange={(e) => editText('structureRows', shownText.structureRows.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)))} />
              </Field>
            ))}
            {input.slides.strength && shownText.strengths.map((s, i) => (
              <div key={`st-${i}`} className="dk-row">
                <Field label={`강점 ${i + 1} 제목`}><input value={s.title} onChange={(e) => editText('strengths', shownText.strengths.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} /></Field>
                <Field label="내용"><input value={s.text} onChange={(e) => editText('strengths', shownText.strengths.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} /></Field>
              </div>
            ))}
            {mode !== 'rule' && <button type="button" className="linklike small" onClick={() => { setMode('rule'); setText(null); setFactsKey(null); }}>규칙 문안으로 되돌리기</button>}
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
