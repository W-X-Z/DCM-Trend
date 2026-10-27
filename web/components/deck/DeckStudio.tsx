'use client';

// 제안서 초안: 회사를 고르면 바로 장표 초안이 보인다. 목차는 템플릿 칩·개별 선택으로 바꾸고,
// '관련 데이터' 탭에서 공시·금리 데이터와 장표별 사용 데이터(외부·내부)를, '검토' 탭·장표 위 표시로 사람이 확인할 곳을 보여 준다.
// 조건·일정·사례·문안을 고친 뒤 PPTX·PDF 로 내려받는다.
// 입력값·문안은 이 브라우저(localStorage)에만 저장한다. 서버에는 공개 데이터·노하우 조회와 AI 문안 요청만 보낸다.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info } from '@/components/Ui';
import { bandRange, eok, mdw, ratioX, rate3, yy } from '@/lib/deck/fmt';
import { BACK, FRONT, SECTIONS, TEMPLATES, planOf, templateOf, type Item, type ItemId } from '@/lib/deck/catalog';
import { KIND_LABEL, forGrade, type Knowledge, type KnowledgeSlide } from '@/lib/deck/knowledge';
import { available, buildSlides, fileBase, staticSubs } from '@/lib/deck/layout';
import { defaultInput, factsFor, peerPool, ruleText, scheduleOf, totalEok } from '@/lib/deck/rules';
import { dataReport, STATUS_LABEL, type DataReport } from '@/lib/deck/sources';
import { qaChecks, type Qa } from '@/lib/deck/qa';
import { MARK_LABEL, reviewMarks, type Mark } from '@/lib/deck/review';
import type { Draft } from '@/lib/proposal';
import { PAGE } from '@/lib/deck/theme';
import type { Slide } from '@/lib/deck/model';
import type { DeckData, DeckInput, DeckText } from '@/lib/deck/types';
import { SlideView, type ViewMark } from './SlideView';

type Mode = 'rule' | 'ai' | 'edited';
// 고칠 항목 탭: 평소에는 접어 두고 장표만 크게 보인다
type Tab = 'review' | 'data' | 'toc' | 'terms' | 'schedule' | 'peers' | 'text' | 'internal' | 'cover';
const TABS: [Tab, string][] = [
  ['data', '관련 데이터'], ['review', '검토'], ['toc', '목차'], ['terms', '발행 조건'], ['schedule', '일정'], ['peers', '수요예측 사례'], ['text', '문안'], ['internal', '내부 데이터'], ['cover', '표지'],
];
// v3: 기본형 목차(2026-10-27). 이전 버전에 저장된 목차 선택은 버리고 새 기본값을 쓴다.
type Saved = { v: 2 | 3; input: DeckInput; text: DeckText | null; mode: Mode; factsKey: string | null; at: string };
const KEY = (corp: string) => `deck:v2:${corp}`;
// 검토 표시에서 '확인'한 항목(내용이 바뀌면 키가 바뀌어 다시 보인다)
const RKEY = (corp: string) => `deck:review:${corp}`;
function loadSet(k: string) {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(k) ?? '[]'));
  } catch {
    return new Set<string>();
  }
}

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
  { key: 'structure', item: 'terms', label: '제안 Term-sheet' },
  { key: 'sizing', item: 'sizing', label: '트랜치 검토' },
  { key: 'schedule', item: 'schedule', label: '발행일정(안)' },
  { key: 'sales', item: 'sales', label: 'Sales 전략' },
  { key: 'pipeline', item: 'pipeline', label: '수요예측 예정 내역' },
  { key: 'rates', item: 'rates', label: '금리 동향' },
  { key: 'bok', item: 'bok', label: '금통위' },
  { key: 'fomc', item: 'fomc', label: 'FOMC' },
  { key: 'views', item: 'views', label: '증권사별 국내 기준금리 전망' },
  { key: 'usviews', item: 'usviews', label: '증권사별 미국 기준금리 전망' },
  { key: 'forecast', item: 'forecast', label: '기준금리 및 국고채 금리 전망' },
  { key: 'peers', item: 'peers', label: '같은 등급 수요예측 결과' },
  { key: 'compare', item: 'compare', label: '미매각 사례 분석' },
  { key: 'corp', item: 'corp', label: '최근 발행금리' },
  { key: 'league', item: 'league', label: '연간 League Table' },
  { key: 'maturity', item: 'maturity', label: '공모사채 만기도래 현황' },
];

const TERM_NOTES: [keyof DeckText['termNotes'], string][] = [
  ['rating', '신용등급'], ['tenor', '만기'], ['amount', '발행금액'], ['band', '금리 밴드'], ['coupon', '이자지급'],
  ['demand', '수요예측일'], ['pay', '발행일'], ['uw', '인수희망금액'], ['fee', '수수료'],
];
// 내부 데이터 자리: 사내 시스템에서는 연계로 채우고, 프로토타입에서는 테스트용으로 붙여넣는다
const INTERNAL: [keyof DeckInput['internal'], string, string][] = [
  ['minpyeong', '개별민평·등급민평 (민평 4사)', '트랜치 검토 오른쪽 위 금리 표를 대체합니다. 연결되지 않으면 ECOS 국고·회사채 금리를 씁니다.'],
  ['rateFc', 'NH 분기별 금리 전망표 (NH 리서치)', '3-① 기준금리 및 국고채 금리 장표의 전망표가 됩니다. 연결되지 않으면 공개 전망표를 씁니다.'],
  ['creditFc', 'NH 등급별 회사채 금리 전망표 (NH 리서치)', '3-② 회사채 금리 장표(AA+~A- 2·3·5년)를 만듭니다. 연결되지 않으면 장표를 생략합니다.'],
  ['investors', '기관별 참여·배정 내역 (NH 수요예측 북)', 'Sales 전략 장표(기본 꺼짐) 아래에 들어갑니다.'],
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
  // 처음에는 장표 초안과 관련 데이터를 함께 보여 준다
  const [tab, setTab] = useState<Tab | null>('data');
  const [cur, setCur] = useState(0);
  // 검토 표시: 장표 위 강조(켜고 끄기), 표시 밖 흐리게, 검토할 장표만 넘기기, 확인한 항목 숨기기
  const [showMarks, setShowMarks] = useState(true);
  const [focus, setFocus] = useState(false);
  const [onlyReview, setOnlyReview] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [activeMark, setActiveMark] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null | 'error'>(null);

  useEffect(() => {
    setDone(loadSet(RKEY(corp)));
    // 관련 데이터(공시·금리 요약): 제안서 초안 화면 오른쪽 '관련 데이터' 탭
    let alive = true;
    setDraft(null);
    fetch(`/api/proposal?corp=${encodeURIComponent(corp)}&type=bond&format=json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => alive && setDraft(j as Draft))
      .catch(() => alive && setDraft('error'));
    return () => {
      alive = false;
    };
  }, [corp]);
  const confirm = useCallback((keys: string[], v = true) => {
    setDone((x) => {
      const n = new Set(x);
      for (const k of keys) (v ? n.add(k) : n.delete(k));
      try {
        localStorage.setItem(RKEY(corp), JSON.stringify([...n]));
      } catch {
        /* 무시 */
      }
      return n;
    });
  }, [corp]);

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
          const items = s.v === 3 ? { ...base.items, ...s.input.items } : base.items;
          const peerKeys = s.v === 3 ? s.input.peerKeys : base.peerKeys;
          setInput({ ...base, ...s.input, items, peerKeys, band: { ...base.band, ...s.input.band }, internal: { ...base.internal, ...s.input.internal } });
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
  // 데이터 사용 현황·검수 (켠 장표 기준)
  const report = useMemo(() => (data && input ? dataReport(data, input, available(data, input)) : null), [data, input]);
  const qa = useMemo(() => {
    if (!data || !input || !shownText) return [] as Qa[];
    const plan = planOf(input.items, available(data, input));
    const shown = new Set(plan.sections.flatMap((s) => s.items.map((i) => i.id)));
    return qaChecks(data, input, shownText, { on: (id) => shown.has(id), edited: mode === 'edited', extraAllowed: [tips.map((k) => k.body)] });
  }, [data, input, shownText, mode, tips]);
  const marks = useMemo(() => (data && input && shownText ? reviewMarks(slides, data, input, shownText, qa) : []), [slides, data, input, shownText, qa]);
  const openMarks = useMemo(() => marks.filter((m) => !done.has(m.key)), [marks, done]);

  // 저장 (입력이 바뀌면 0.6초 뒤)
  useEffect(() => {
    if (!input) return;
    const t = setTimeout(() => {
      const at = new Date().toISOString();
      save(corp, { v: 3, input, text: mode === 'rule' ? null : text, mode, factsKey, at });
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
  if (!data || !input || !shownText) return <Loading />;

  const sch = scheduleOf(data, input);
  const pool = peerPool(data, input.peerScope);
  const myTips = forGrade(tips, data.company.rating_group);
  const at = Math.min(cur, Math.max(slides.length - 1, 0));
  const targets = slides[at] ? editTargets(slides[at].id) : [];
  const curItem = slides[at] ? slides[at].id.replace(/-\d+$/, '') : '';
  const curSrcs = report?.items.find((x) => x.id === curItem)?.srcs ?? [];
  const curQa = qa.filter((x) => x.item === curItem && x.level === 'warn').length;
  // 장표별 남은 검토 수, '검토할 장표만' 이면 그 장표만 넘긴다
  const perSlide = new Map<number, number>();
  for (const m of openMarks) perSlide.set(m.slide, (perSlide.get(m.slide) ?? 0) + 1);
  const order = onlyReview && perSlide.size ? slides.map((_, i) => i).filter((i) => perSlide.has(i)) : slides.map((_, i) => i);
  const curMarks = openMarks.filter((m) => m.slide === at);
  const viewMarks: ViewMark[] = showMarks ? curMarks.map((m, i) => ({ ...m, n: i + 1 })) : [];
  const tpl = templateOf(input.items);
  const go = (i: number) => {
    setCur(i);
    setActiveMark(null);
  };

  // 탭 버튼: 같은 탭을 다시 누르면 닫는다
  const toggle = (t: Tab) => setTab((x) => (x === t ? null : t));
  // 장표 아래 바로가기: 그 탭을 열고, anchor 가 있으면 그 칸으로 옮겨 간다
  function open(t: Tab, anchor?: string) {
    setTab(t);
    if (anchor) {
      // 창 전체가 아니라 패널 안에서만 그 칸으로 옮긴다
      setTimeout(() => {
        const el = document.getElementById(anchor);
        const box = el?.closest('.dk-form') as HTMLElement | null;
        if (el && box) box.scrollTo({ top: el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 8, behavior: 'smooth' });
        (el?.querySelector('textarea, input') as HTMLElement | null)?.focus({ preventScroll: true });
      }, 60);
    }
  }

  const panel: Record<Tab, React.ReactNode> = {
    terms: (
      <>
        <Field label="회사명 표기"><input value={input.issuer} onChange={(e) => set('issuer', e.target.value)} /></Field>
        <div className="dk-row">
          <Field label="회차"><input value={input.series} onChange={(e) => set('series', e.target.value)} inputMode="numeric" /></Field>
          <Field label="신용등급"><input value={input.rating} onChange={(e) => set('rating', e.target.value)} /></Field>
        </div>
        <Field label="등급 비고"><input value={input.ratingNote} onChange={(e) => set('ratingNote', e.target.value)} /></Field>
        <h4 className="dk-sub">트랜치</h4>
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
        <p className="small dk-reset"><button type="button" className="linklike" onClick={reset}>입력값 처음으로</button></p>
      </>
    ),
    schedule: (
      <>
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
      </>
    ),
    peers: (
      <>
        <div className="seg dk-seg" role="group" aria-label="사례 범위">
          {(['group', 'notch'] as const).map((sc) => (
            <button key={sc} type="button" aria-pressed={input.peerScope === sc} onClick={() => set('peerScope', sc)}>
              {sc === 'group' ? `${data.company.rating_group ?? ''}등급 전체` : `${data.company.rating ?? ''}만`}
            </button>
          ))}
        </div>
        <p className="small muted dk-count">표 {input.peerKeys.length}건 · 비교 {input.compareKeys.length}/3</p>
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
      </>
    ),
    toc: <Toc data={data} input={input} set={set} />,
    text: (
      <>
        <p className="small dk-text-head">
          <span className={`dk-mode m-${mode}`}>{mode === 'rule' ? '규칙 문안' : mode === 'ai' ? '노하우 반영 문안' : '직접 고친 문안'}</span>
          <Info>한 줄이 글머리 하나입니다. **굵게+밑줄**, !!빨강!! 표기를 쓸 수 있습니다. 숫자는 공시·금리 데이터 값이므로 고칠 때 원문을 확인하세요.</Info>
          {mode !== 'rule' && <button type="button" className="linklike" onClick={() => { setMode('rule'); setText(null); setFactsKey(null); }}>규칙 문안으로 되돌리기</button>}
        </p>
        <Tips list={myTips} slide="all" />
        <div id="dk-t-lead">
          <Field label="주요 제안 첫 문장">
            <textarea rows={3} value={shownText.lead} onChange={(e) => editText('lead', e.target.value)} />
          </Field>
        </div>
        {TEXT_FIELDS.filter((f) => input.items[f.item]).map((f) => (
          <div key={f.key} id={`dk-t-${f.key}`}>
            <Field label={f.label}>
              <textarea rows={Math.min(8, (shownText[f.key] as string[]).length + 1)} value={(shownText[f.key] as string[]).join('\n')} onChange={(e) => editText(f.key, e.target.value.split('\n').filter((l) => l.trim()))} />
            </Field>
            <Tips list={myTips} slide={f.item as KnowledgeSlide} />
          </div>
        ))}
        {input.items.terms && (
          <fieldset className="dk-notes" id="dk-t-termNotes">
            <legend className="dk-label">발행조건 표 비고</legend>
            {TERM_NOTES.map(([k, label]) => (
              <label key={k} className="dk-note-row">
                <span className="small muted">{label}</span>
                <input value={shownText.termNotes[k]} onChange={(e) => editText('termNotes', { ...shownText.termNotes, [k]: e.target.value })} />
              </label>
            ))}
          </fieldset>
        )}
        {input.items.strength && (
          <div id="dk-t-strengths">
            {shownText.strengths.map((st, i) => (
              <div key={`st-${i}`} className="dk-row">
                <Field label={`강점 ${i + 1} 제목`}><input value={st.title} onChange={(e) => editText('strengths', shownText.strengths.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} /></Field>
                <Field label="내용"><input value={st.text} onChange={(e) => editText('strengths', shownText.strengths.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} /></Field>
              </div>
            ))}
          </div>
        )}
      </>
    ),
    data: report ? <DataPanel report={report} draft={draft} goTo={(id) => { const i = slides.findIndex((s) => s.id.replace(/-\d+$/, '') === id); if (i >= 0) go(i); }} /> : null,
    review: (
      <ReviewPanel marks={marks} done={done} slides={slides} cur={at}
        goTo={(m) => { go(m.slide); setActiveMark(m.key); setShowMarks(true); }}
        fix={(m) => { const t = markTarget(m); open(t.tab, t.anchor); }}
        confirm={confirm} />
    ),
    internal: (
      <>
        <p className="small muted dk-panel-note">
          사내 시스템에서 연계로 채워질 자리입니다. 프로토타입에서는 엑셀 표를 붙여넣어 시험할 수 있습니다.
          <Info>첫 줄은 머리글, 첫 열은 항목입니다. 이 브라우저에만 저장되고 AI 문안 요청에는 보내지 않습니다. 비워 두면 각 장표는 외부 데이터로 대체하거나 생략하고, 그 내용은 '데이터·검수' 탭에 남습니다.</Info>
        </p>
        {INTERNAL.map(([k, label, where]) => (
          <Field key={k} label={label} hint={where}>
            <textarea rows={3} className="dk-tsv" placeholder="엑셀에서 표를 복사해 붙여넣기" value={input.internal[k]} onChange={(e) => set('internal', { ...input.internal, [k]: e.target.value })} />
          </Field>
        ))}
      </>
    ),
    cover: (
      <>
        <Field label="표지 제목"><input value={input.coverTitle} onChange={(e) => set('coverTitle', e.target.value)} /></Field>
        <Field label="제안 월"><input value={input.month} onChange={(e) => set('month', e.target.value)} placeholder="2026. 11" /></Field>
        <div id="dk-a-back">
          <Field label="뒷표지 부서명"><input value={input.dept} onChange={(e) => set('dept', e.target.value)} /></Field>
          <Field label="연락처" hint="직접 입력한 경우에만 표시합니다. 이 브라우저에만 저장됩니다."><textarea rows={3} value={input.contacts} onChange={(e) => set('contacts', e.target.value)} /></Field>
        </div>
      </>
    ),
  };
  const tabLabel = (t: Tab) => TABS.find((x) => x[0] === t)![1];
  const tabMeta: Partial<Record<Tab, string>> = {
    peers: `${input.peerKeys.length}건`,
    toc: `${slides.length}장`,
    text: mode === 'rule' ? '' : mode === 'ai' ? 'AI' : '수정',
    review: openMarks.length ? `${openMarks.length}` : '완료',
    data: report?.intMissing.length ? `내부 미연결 ${report.intMissing.length}` : '',
  };

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
            <button type="button" className="btn dk-cta" onClick={runAi} disabled={!!busy} aria-busy={busy === 'ai'}>
              {busy === 'ai' ? '노하우 반영 중…' : mode === 'ai' ? '노하우 다시 반영(AI)' : '노하우 반영(AI)'}
            </button>
            <Info>기본 문안은 공시·금리 숫자로 규칙이 만듭니다. 이 버튼은 현업 노하우(이 회사 등급·켠 장표에 맞는 것)를 더해 AI가 판단 문장을 고칩니다. 사실에 없는 숫자나 출처 없는 시장 전망이 든 줄은 규칙 문안으로 되돌립니다. 회사명·조건·숫자가 OpenAI로 전송되고, 결과는 이 브라우저에만 저장됩니다.</Info>
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => exportAs('pptx')} disabled={!!busy}>{busy === 'pptx' ? 'PPTX 만드는 중…' : 'PPTX'}</button>
          <button type="button" className="btn btn-ghost" onClick={() => exportAs('pdf')} disabled={!!busy}>{busy === 'pdf' ? 'PDF 만드는 중…' : 'PDF'}</button>
        </div>
      </div>

      <div className="dk-tplbar">
        <div className="dk-tpl" role="group" aria-label="목차 템플릿">
          <span className="dk-tpl-k small">목차</span>
          {TEMPLATES.map((t) => (
            <button key={t.key} type="button" className="dk-chip" aria-pressed={tpl === t.key} title={t.hint} onClick={() => { set('items', t.items()); go(0); }}>
              {t.label}
            </button>
          ))}
          {!tpl && <span className="dk-chip is-custom" aria-current="true">직접 선택</span>}
          <button type="button" className="linklike small" onClick={() => open('toc')}>장표 고르기 ({slides.length}장)</button>
        </div>
        <div className="dk-rv" role="group" aria-label="검토 표시">
          <button type="button" className={`dk-rv-count${openMarks.length ? '' : ' is-done'}`} onClick={() => open('review')}>
            {openMarks.length ? <>검토 필요 <strong className="tnum">{openMarks.length}</strong></> : '검토 완료'}
          </button>
          <label className="dk-switch small"><input type="checkbox" checked={showMarks} onChange={(e) => setShowMarks(e.target.checked)} />강조 표시</label>
          <label className="dk-switch small"><input type="checkbox" checked={focus} disabled={!showMarks} onChange={(e) => setFocus(e.target.checked)} />검토할 곳만 보기</label>
          <label className="dk-switch small"><input type="checkbox" checked={onlyReview} onChange={(e) => { setOnlyReview(e.target.checked); if (e.target.checked && !perSlide.has(at)) { const n = [...perSlide.keys()].sort((a, b) => a - b)[0]; if (n != null) go(n); } }} />검토할 장표만</label>
        </div>
      </div>

      <div className="dk-tabbar">
        <nav className="dk-tabs" aria-label="고칠 항목">
          {TABS.map(([t, label]) => (
            <button key={t} type="button" className="dk-tab" aria-pressed={tab === t} aria-controls="dk-panel" onClick={() => toggle(t)}>
              {label}{tabMeta[t] && <span className="dk-tab-meta">{tabMeta[t]}</span>}
            </button>
          ))}
        </nav>
        <p className="dk-status small" role="status">
          {stale && <span className="dk-stale">조건이 바뀌었습니다. 문안을 다시 만들거나 확인하세요.</span>}
          {note && <span>{note}</span>}
          {savedAt && !note && !stale && <span className="muted">이 브라우저에 저장됨 {new Date(savedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>}
        </p>
      </div>

      <div className={`dk-work${tab ? ' has-panel' : ''}`}>
        <Rail slides={slides} cur={at} setCur={go} order={order} counts={showMarks ? perSlide : new Map()} />
        <Stage slides={slides} cur={at} setCur={go} busy={busy === 'ai'} order={order}
          marks={viewMarks} focus={showMarks && focus} active={activeMark} onPick={(k) => setActiveMark((x) => (x === k ? null : k))}
          review={showMarks ? curMarks : []}
          onFix={(m) => { const t = markTarget(m); open(t.tab, t.anchor); }}
          onDone={(keys) => { confirm(keys); setActiveMark(null); }}
          edit={targets.map((x) => ({ label: x.label, go: () => open(x.tab, x.anchor) }))}
          srcs={curSrcs.length ? { ext: curSrcs.filter((s) => s.kind === 'ext' && s.status !== 'missing').length, miss: curSrcs.filter((s) => s.kind === 'int' && s.status === 'missing').length, alt: curSrcs.filter((s) => s.status === 'alt').length, warn: curQa, go: () => open('data', `dk-d-${curItem}`) } : null} />
        {tab && (
          <aside className="dk-panel" id="dk-panel" aria-label={tabLabel(tab)}>
            <div className="dk-panel-h">
              <h3>{tabLabel(tab)}</h3>
              <button type="button" className="dk-x" aria-label="닫기" onClick={() => setTab(null)}>×</button>
            </div>
            <form className="dk-form" onSubmit={(e) => e.preventDefault()} aria-label={tabLabel(tab)}>
              {panel[tab]}
            </form>
          </aside>
        )}
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

// 목차: 공모 회사채 기본형(CJ프레시웨이 2026-03 구성). 켜고 끄면 목차·쪽 제목 번호가 다시 매겨진다.
// 대한항공형 상세 장표(Sales 전략·미매각 사례·NH 강점 등)는 기본으로 꺼 두었다.
function Toc({ data, input, set }: { data: DeckData; input: DeckInput; set: Setter }) {
  const avail = available(data, input);
  const on = input.items;
  const plan = planOf(on, avail);
  const labels = new Map(plan.sections.flatMap((s) => s.items.map((i) => [i.id, i.label] as const)));
  const count = [...FRONT, ...SECTIONS.flatMap((x) => x.items), BACK].filter((i) => on[i.id] && avail(i.id)).length;
  const toggle = (id: ItemId, v: boolean) => set('items', { ...on, [id]: v });
  const tpl = templateOf(on);
  const row = (i: Item) => {
    const ok = avail(i.id);
    return (
      <li key={i.id}>
        <label className={ok ? undefined : 'muted'}>
          <input type="checkbox" checked={!!on[i.id] && ok} disabled={!ok} onChange={(e) => toggle(i.id, e.target.checked)} />
          <span>{labels.get(i.id) ?? i.title}</span>
          {i.kind === 'static' && <span className="dk-tag">템플릿</span>}
          {!ok && <span className="small">{i.id === 'credit_fc' ? '내부 데이터 미연결' : '자료 없음'}</span>}
        </label>
        {i.note && <span className="dk-toc-note small muted">{i.note}</span>}
      </li>
    );
  };
  const staticOn = (['ir', 'nh_org'] as ItemId[]).some((id) => on[id]);
  return (
    <>
      <div className="dk-tpl dk-tpl-panel" role="group" aria-label="목차 템플릿">
        {TEMPLATES.map((t) => (
          <button key={t.key} type="button" className="dk-chip" aria-pressed={tpl === t.key} onClick={() => set('items', t.items())}>{t.label}</button>
        ))}
        {!tpl && <span className="dk-chip is-custom" aria-current="true">직접 선택</span>}
      </div>
      <p className="small muted dk-count">{TEMPLATES.find((t) => t.key === tpl)?.hint ?? '템플릿에서 장표를 더하거나 뺐습니다.'} · {count}개 항목</p>
      <ul className="dk-toc">{FRONT.map((i) => row(i))}</ul>
      {SECTIONS.map((sec) => (
        <fieldset key={sec.key} className="dk-toc-sec">
          <legend>{sec.label}</legend>
          <ul className="dk-toc">{sec.items.map((i) => row(i))}</ul>
        </fieldset>
      ))}
      <ul className="dk-toc">{row(BACK)}</ul>
      {staticOn && (
        <Field label="담당 커버리지 부서" hint="템플릿 장표(IR 전략·업무 분장)의 부서명 자리에 들어갑니다.">
          <input value={input.coverDept} onChange={(e) => set('coverDept', e.target.value)} />
        </Field>
      )}
    </>
  );
}

// 관련 데이터: 공시·금리 요약(제안서 초안 데이터) + 장표별 사용 데이터(외부·내부) + 연결하면 채워질 내부 데이터
const DRAFT_ST: Record<string, string> = { filled: '채움', partial: '일부', needed: '추가 필요' };
function DataPanel({ report, draft, goTo }: { report: DataReport; draft: Draft | null | 'error'; goTo: (id: string) => void }) {
  return (
    <>
      <p className="small dk-panel-note">
        외부 데이터 <strong>{report.extSources.length}</strong>개 출처 사용 · 내부 데이터 미연결 <strong>{report.intMissing.length}</strong>건{report.omitted.length ? <> · 생략 <strong>{report.omitted.length}</strong>장</> : null}
        <Info>외부 데이터는 사외에서 누구나 접근 가능한 공개 자료(DART·ECOS·한국은행·미 연준·증권사 공개 리포트), 내부 데이터는 NH 자체 자료와 구독 데이터(민평 4사·FnGuide 등)입니다. 내부 데이터는 사내 시스템에서 연계하면 채워지고, 프로토타입에서는 '내부 데이터' 탭에 붙여넣어 시험할 수 있습니다. Appendix '데이터 사용 현황'을 켜면 같은 내용이 덱에 들어갑니다.</Info>
      </p>
      <section className="dk-dsec">
        <h4 className="dk-sub">회사·시장 데이터</h4>
        {draft === null && <p className="small muted">공시·금리 요약을 불러오는 중…</p>}
        {draft === 'error' && <p className="small muted">공시·금리 요약을 불러오지 못했습니다. 장표는 그대로 쓸 수 있습니다.</p>}
        {draft && draft !== 'error' && (
          <div className="dk-draft">
            {draft.sections.map((x, i) => (
              <details key={x.key} className={`dk-dr st-${x.status}`} open={i < 2}>
                <summary>
                  <span className="dk-dr-t">{x.title}</span>
                  <span className="dk-dr-st">{DRAFT_ST[x.status]}</span>
                </summary>
                {x.lines.map((l) => <p key={l} className="small">{l}</p>)}
                {x.table && (
                  <div className="dk-dr-tbl">
                    <table className="data compact">
                      <thead><tr>{x.table.head.map((h, j) => <th key={`${h}-${j}`} className={x.table!.num?.includes(j) ? 'num' : undefined}>{h}</th>)}</tr></thead>
                      <tbody>
                        {x.table.rows.slice(0, 12).map((r, k) => (
                          <tr key={k}>{r.map((v, j) => <td key={j} className={x.table!.num?.includes(j) ? 'num' : undefined}>{v}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                    {x.table.rows.length > 12 && <p className="small muted">외 {x.table.rows.length - 12}행</p>}
                  </div>
                )}
                {!!x.needs?.length && (
                  <ul className="dk-dr-need small">
                    {x.needs.map((n) => <li key={n.data}><span className="dk-src-tag">내부</span>{n.data} <span className="muted">· {n.from}</span></li>)}
                  </ul>
                )}
                {x.basis && <p className="small muted">출처: {x.basis}</p>}
              </details>
            ))}
            <p className="small muted">기준일 {draft.asof}. 숫자는 공시 값 그대로입니다.</p>
          </div>
        )}
      </section>
      {!!report.intMissing.length && (
        <section className="dk-dsec">
          <h4 className="dk-sub">연결하면 채워질 내부 데이터</h4>
          <ul className="dk-miss">
            {report.intMissing.map((m) => (
              <li key={m.label}><strong>{m.label}</strong> <span className="muted">({m.source})</span><br /><span className="small">{m.items.join(', ')} — {m.note}</span></li>
            ))}
          </ul>
        </section>
      )}
      <section className="dk-dsec">
        <h4 className="dk-sub">장표별 사용 데이터</h4>
        <ul className="dk-srcs">
          {report.items.map((x) => (
            <li key={x.id} id={`dk-d-${x.id}`}>
              <button type="button" className="linklike dk-srcs-h" onClick={() => goTo(x.id)}>{x.label}</button>
              <ul>
                {x.srcs.map((s) => (
                  <li key={`${s.kind}-${s.label}`} className={`s-${s.kind}-${s.status}`}>
                    <span className="dk-src-tag">{STATUS_LABEL[s.kind][s.status]}</span>
                    {s.label} <span className="muted">· {s.source}{s.asof ? ` · ${s.asof}` : ''}</span>
                    {s.note && <span className="dk-src-note small">{s.note}</span>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {report.omitted.map((o) => (
            <li key={`om-${o.id}`} className="dk-srcs-omit">
              <span className="dk-srcs-h">{o.label}</span> <span className="small muted">생략 — {o.reason}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

// 검토: 사람이 정하거나 확인할 곳(장표 순). 확인하면 숨기고, 내용이 바뀌면 다시 보인다.
function ReviewPanel({ marks, done, slides, cur, goTo, fix, confirm }: {
  marks: Mark[]; done: Set<string>; slides: Slide[]; cur: number;
  goTo: (m: Mark) => void; fix: (m: Mark) => void; confirm: (keys: string[], v?: boolean) => void;
}) {
  const open = marks.filter((m) => !done.has(m.key));
  const closed = marks.filter((m) => done.has(m.key));
  const by = new Map<number, Mark[]>();
  for (const m of open) by.set(m.slide, [...(by.get(m.slide) ?? []), m]);
  const kinds = (['input', 'judge', 'data', 'stale'] as const).map((k) => [k, open.filter((m) => m.kind === k).length] as const).filter(([, n]) => n);
  return (
    <>
      <p className="small dk-panel-note">
        남은 검토 <strong>{open.length}</strong> · 확인 {closed.length}
        <Info>기본값 그대로인 조건(입력 확인), 제안 판단 문장(판단 확인), 대체·이상 데이터(데이터 확인), 오래된 자료(갱신 필요)를 장표 위에 표시합니다. 표시는 화면에만 보이고 PPTX·PDF 에는 들어가지 않습니다. 확인한 항목은 숨기고, 그 내용이 바뀌면 다시 보입니다.</Info>
      </p>
      {!!kinds.length && (
        <p className="dk-rv-kinds small">
          {kinds.map(([k, n]) => <span key={k} className={`mk-${k}`}>{MARK_LABEL[k]} {n}</span>)}
        </p>
      )}
      {!open.length && <p className="small muted">검토할 곳이 없습니다. 내려받기 전에 숫자만 한 번 더 확인하세요.</p>}
      <ol className="dk-rv-all-list">
        {[...by.entries()].sort((a, b) => a[0] - b[0]).map(([i, ms]) => (
          <li key={i} className={i === cur ? 'is-cur' : undefined}>
            <button type="button" className="linklike dk-srcs-h" onClick={() => goTo(ms[0])}><span className="muted tnum">{i + 1}쪽</span> {slides[i]?.title}</button>
            <ul>
              {ms.map((m) => (
                <li key={m.key} className={`mk-${m.kind}`}>
                  <span className="dk-rv-kind">{MARK_LABEL[m.kind]}</span>
                  <button type="button" className="linklike dk-rv-text" onClick={() => goTo(m)}>{m.text}</button>
                  <span className="dk-rv-act">
                    <button type="button" className="linklike" onClick={() => fix(m)}>고치기</button>
                    <button type="button" className="dk-rv-ok" onClick={() => confirm([m.key])}>확인</button>
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {open.length > 1 && <p className="small"><button type="button" className="linklike" onClick={() => confirm(open.map((m) => m.key))}>모두 확인</button></p>}
      {!!closed.length && <p className="small"><button type="button" className="linklike" onClick={() => confirm(closed.map((m) => m.key), false)}>확인한 {closed.length}개 다시 보기</button></p>}
    </>
  );
}

// 검토 항목 → 고칠 탭
function markTarget(m: Mark): { tab: Tab; anchor?: string } {
  const what = m.key.split(':')[1] ?? '';
  if (['rating', 'tenor', 'amount', 'band', 'fee'].includes(what)) return { tab: 'terms' };
  if (what === 'pay' || what === 'cal' || m.item === 'schedule') return { tab: 'schedule' };
  if (what === 'contacts') return { tab: 'cover', anchor: 'dk-a-back' };
  if (what === 'month' || m.item === 'cover') return { tab: 'cover' };
  if (what === 'minpyeong' || m.item === 'credit_fc' || (m.item === 'forecast' && m.kind === 'stale')) return { tab: 'internal' };
  if (m.item === 'peers' && m.kind === 'data') return { tab: 'peers' };
  if (m.kind === 'judge' || m.kind === 'stale') return { tab: 'text', anchor: `dk-t-${TEXT_OF[m.item] ?? m.item}` };
  return { tab: 'data', anchor: `dk-d-${m.item}` };
}

function NumIn({ v, on, step }: { v: number | null; on: (v: number | null) => void; step?: string }) {
  return <input type="number" inputMode="decimal" step={step ?? '1'} value={v ?? ''} onChange={(e) => on(e.target.value === '' ? null : Number(e.target.value))} />;
}

// 장표별 고치기 바로가기: 조건이 바뀌는 장표는 해당 탭, 요약 상자는 문안 칸으로
const TEXT_OF: Record<string, string> = {
  sizing: 'sizing', sales: 'sales', pipeline: 'pipeline', rates: 'rates', bok: 'bok', fomc: 'fomc', views: 'views', usviews: 'usviews',
  forecast: 'forecast', peers: 'peers', compare: 'compare', corp: 'corp', league: 'league', strength: 'strengths', maturity: 'maturity', schedule: 'schedule', terms: 'structure',
};
function editTargets(id: string): { tab: Tab; anchor?: string; label: string }[] {
  const base = id.replace(/-\d+$/, '');
  const out: { tab: Tab; anchor?: string; label: string }[] = [];
  if (base === 'cover') out.push({ tab: 'cover', label: '표지 고치기' });
  if (base === 'back') out.push({ tab: 'cover', anchor: 'dk-a-back', label: '뒷표지 고치기' });
  if (base === 'contents' || base.startsWith('folder')) out.push({ tab: 'toc', label: '목차 고치기' });
  if (base === 'terms') out.push({ tab: 'terms', label: '발행 조건 고치기' });
  if (base === 'schedule') out.push({ tab: 'schedule', label: '일정 고치기' });
  if (base === 'peers' || base === 'compare') out.push({ tab: 'peers', label: '사례 고르기' });
  if (base === 'sales' || base === 'forecast' || base === 'credit_fc' || base === 'sizing' || base === 'terms') out.push({ tab: 'internal', label: '내부 데이터' });
  if (base === 'datareport') out.push({ tab: 'data', label: '관련 데이터 보기' });
  if (TEXT_OF[base]) out.push({ tab: 'text', anchor: `dk-t-${TEXT_OF[base]}`, label: '문안 고치기' });
  return out;
}

function Loading() {
  return (
    <div className="dk dk-loading" aria-busy="true">
      <div className="dk-skel"><span>공시·금리 데이터를 모아 장표를 만드는 중…</span></div>
    </div>
  );
}

// 왼쪽 장표 목록(썸네일)
function Rail({ slides, cur, setCur, order, counts }: { slides: Slide[]; cur: number; setCur: (i: number) => void; order: number[]; counts: Map<number, number> }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cur]);
  return (
    <ol className="dk-rail" ref={ref} aria-label="장표 목록">
      {order.map((i) => {
        const s = slides[i];
        const n = counts.get(i) ?? 0;
        return (
          <li key={`${s.id}-${i}`}>
            <button type="button" aria-current={i === cur} aria-label={`${i + 1}. ${s.title}${n ? `, 검토 ${n}` : ''}`} onClick={() => setCur(i)}>
              <span className="dk-rail-no tnum" aria-hidden>{i + 1}</span>
              <span className="dk-rail-thumb">
                <SlideView slide={s} width={128} />
                {n > 0 && <span className="dk-rail-badge tnum" aria-hidden>{n}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// 가운데 큰 장표: 화면 높이에 맞춰 키우고, ←·→ 로 넘긴다
type SrcBadge = { ext: number; miss: number; alt: number; warn: number; go: () => void } | null;
type StageProps = {
  slides: Slide[]; cur: number; setCur: (i: number) => void; edit: { label: string; go: () => void }[]; busy: boolean; srcs: SrcBadge; order: number[];
  marks: ViewMark[]; focus: boolean; active: string | null; onPick: (key: string) => void; review: Mark[]; onFix: (m: Mark) => void; onDone: (keys: string[]) => void;
};
function Stage({ slides, cur, setCur, edit, busy, srcs, order, marks, focus, active, onPick, review, onFix, onDone }: StageProps) {
  const ref = useRef<HTMLElement>(null);
  const [w, setW] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 안쪽 폭(여백 제외)과 화면 높이(머리말·아래 줄 제외) 안에 들어가게
    const fit = () => {
      const cs = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const maxH = Math.max(280, window.innerHeight - 330);
      setW(Math.max(240, Math.floor(Math.min(inner, (maxH * PAGE.w) / PAGE.h))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, []);
  // 넘기기는 order(검토할 장표만이면 그 장표들) 안에서
  const n = order.length;
  const pos = Math.max(0, order.indexOf(cur));
  const prev = pos > 0 ? order[pos - 1] : null;
  const next = pos < n - 1 ? order[pos + 1] : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || e.altKey || e.metaKey || e.ctrlKey)) return;
      if ((e.key === 'ArrowRight' || e.key === 'PageDown') && next != null) setCur(next);
      else if ((e.key === 'ArrowLeft' || e.key === 'PageUp') && prev != null) setCur(prev);
      else if (e.key === 'Home' && n) setCur(order[0]);
      else if (e.key === 'End' && n) setCur(order[n - 1]);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [order, n, prev, next, setCur]);
  const s = slides[cur];
  return (
    <section className="dk-stage" ref={ref} aria-label="장표 보기">
      <div className={`dk-stage-frame${busy ? ' is-busy' : ''}`} style={{ width: w }}>
        {s && <SlideView slide={s} width={w} marks={marks} focus={focus} active={active} onPick={onPick} />}
      </div>
      {review.length > 0 && (
        <ol className="dk-rv-list" style={{ width: w }} aria-label="이 장표에서 확인할 곳">
          {review.map((m, i) => (
            <li key={m.key} className={`mk-${m.kind}${active === m.key ? ' is-active' : ''}`}>
              <button type="button" className="dk-rv-pin tnum" onClick={() => onPick(m.key)} aria-label={`${i + 1}번 위치 강조`}>{i + 1}</button>
              <span className="dk-rv-kind">{MARK_LABEL[m.kind]}</span>
              <span className="dk-rv-text">{m.text}</span>
              <span className="dk-rv-act">
                <button type="button" className="linklike" onClick={() => onFix(m)}>고치기</button>
                <button type="button" className="dk-rv-ok" onClick={() => onDone([m.key])}>확인</button>
              </span>
            </li>
          ))}
          {review.length > 1 && <li className="dk-rv-all"><button type="button" className="linklike small" onClick={() => onDone(review.map((m) => m.key))}>이 장표 모두 확인</button></li>}
        </ol>
      )}
      <div className="dk-stage-foot" style={{ width: w }}>
        <div className="dk-nav">
          <button type="button" aria-label="이전 장표" disabled={prev == null} onClick={() => prev != null && setCur(prev)}>‹</button>
          <span className="tnum" aria-live="polite">{slides.length ? cur + 1 : 0} / {slides.length}{n < slides.length ? ` (검토 ${pos + 1}/${n})` : ''}</span>
          <button type="button" aria-label="다음 장표" disabled={next == null} onClick={() => next != null && setCur(next)}>›</button>
          <span className="dk-stage-title">{s?.title}</span>
        </div>
        {(!!edit.length || srcs) && (
          <div className="dk-stage-edit small">
            {srcs && (
              <button type="button" className="dk-src-badge" onClick={srcs.go} title="이 장표에 쓴 데이터">
                <span className="b-ext">외부 {srcs.ext}</span>
                {!!srcs.alt && <span className="b-alt">대체 {srcs.alt}</span>}
                {!!srcs.miss && <span className="b-miss">내부 미연결 {srcs.miss}</span>}
                {!!srcs.warn && <span className="b-warn">경고 {srcs.warn}</span>}
              </button>
            )}
            {edit.map((x) => <button key={x.label} type="button" className="linklike" onClick={x.go}>{x.label}</button>)}
          </div>
        )}
      </div>
    </section>
  );
}
