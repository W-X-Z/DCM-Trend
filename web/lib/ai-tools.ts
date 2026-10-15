// AI 질문: 모델이 부를 수 있는 조회 함수. 모두 mart 뷰 읽기 전용이고 행 수를 제한한다.
// SQL 을 모델이 직접 쓰지 않는다(정해진 필터만 받는다).
import 'server-only';
import { select } from './db';
import { fetchDisclosures, hasDartKey } from './opendart';
import { FILING_GROUPS, daysAgo, isIssuer } from './filings';
import { getDisclosureRules, getKeyFilings, searchCompanies } from './queries';

type Json = Record<string, unknown>;
export type Ref = { label: string; href: string };
export type ToolResult = { data: unknown; refs: Ref[] };

const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const clamp = (n: unknown, lo: number, hi: number, d: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d;
};
const eok = (v: unknown) => (v == null ? null : Math.round(Number(v) / 1e8));
const str = (v: unknown, max = 40) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const corpRef = (code: string, name: string): Ref => ({ label: name, href: `/company/${code}` });
const dartRef = (rcept: string | null | undefined, label: string): Ref[] =>
  rcept ? [{ label, href: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcept}` }] : [];

const PRODUCTS = ['bond', 'mezz', 'equity', 'ipo'] as const;

export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'search_companies',
      description: '회사 이름 일부로 회사를 찾는다. 회사 코드(corp_code)가 필요한 다른 조회 전에 먼저 쓴다.',
      parameters: { type: 'object', properties: { q: { type: 'string', description: '회사 이름 일부' } }, required: ['q'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'company_profile',
      description: '회사 개요(시장, 상품별 발행 건수, 최근 회사채 등급, 회사채 미상환 잔액)와 최근 발행 20건.',
      parameters: { type: 'object', properties: { corp_code: { type: 'string' } }, required: ['corp_code'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_deals',
      description: '발행 딜 목록. 회사채는 트랜치(회차)마다 한 행. 금액은 억원. 날짜 기준: 회사채·IPO 납입일, 메자닌·유상증자 결정일.',
      parameters: {
        type: 'object',
        properties: {
          product: { type: 'string', enum: [...PRODUCTS], description: 'bond 회사채, mezz 메자닌(CB·BW·EB), equity 유상증자, ipo' },
          sub_type: { type: 'string', description: '세부 구분. 회사채: 일반회사채/금융채/신종자본증권, 메자닌: CB/BW/EB, 유상증자: 제3자배정/주주배정/일반공모/주주배정후 일반공모, IPO: 일반/스팩' },
          corp_code: { type: 'string' },
          from: { type: 'string', description: 'YYYY-MM-DD' },
          to: { type: 'string', description: 'YYYY-MM-DD' },
          min_amount_eok: { type: 'number' },
          rating_group: { type: 'string', enum: ['AAA', 'AA', 'A', 'BBB'] },
          lead_manager: { type: 'string', description: '대표주관사 이름 일부 (예: NH투자증권)' },
          only_increased: { type: 'boolean' },
          only_undersubscribed: { type: 'boolean' },
          is_public: { type: 'boolean', description: '메자닌 공모 여부' },
          order: { type: 'string', enum: ['date', 'amount'] },
          limit: { type: 'number', description: '최대 50' },
        },
        required: ['product'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bond_issues',
      description: '공모 회사채를 발행(트랜치 묶음) 단위로 조회. 트랜치 조합(예: 2년+3년), 최초→확정 금액, 전체 경쟁률, 가산금리 범위.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string' }, to: { type: 'string' }, corp_code: { type: 'string' },
          rating_group: { type: 'string', enum: ['AAA', 'AA', 'A', 'BBB'] },
          sub_type: { type: 'string', description: '일반회사채/금융채/신종자본증권' },
          tenor_combo: { type: 'string', description: '예: 2년+3년' },
          order: { type: 'string', enum: ['date', 'amount', 'competition'] },
          limit: { type: 'number', description: '최대 60' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'monthly_trend',
      description: '상품별 월별 발행금액(억원)·건수 합계.',
      parameters: {
        type: 'object',
        properties: {
          product: { type: 'string', enum: [...PRODUCTS] },
          from_month: { type: 'string', description: 'YYYY-MM' },
          to_month: { type: 'string', description: 'YYYY-MM' },
        },
        required: ['product'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'maturities',
      description: '공모 회사채 만기 또는 메자닌 조기상환청구(풋) 시작 일정. 회사별로 합쳐 금액 큰 순. 차환 신고서 제출 여부(refi) 포함.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string' }, to: { type: 'string' },
          kind: { type: 'string', enum: ['만기', '풋옵션'] },
          rating_group: { type: 'string', enum: ['AAA', 'AA', 'A', 'BBB'] },
          exclude_financial: { type: 'boolean', description: '금융채 제외 (기본 true)' },
          limit: { type: 'number', description: '최대 40' },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'league_table',
      description: '연도별 대표주관 순위. 대표주관 실적은 딜 금액을 공동 대표주관사 수로 나눈 값.',
      parameters: {
        type: 'object',
        properties: { product: { type: 'string', enum: [...PRODUCTS] }, year: { type: 'number' } },
        required: ['product', 'year'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rates_latest',
      description: '최신 시장금리(국고채 3·5·10년, 회사채 AA-·BBB- 3년, CD 91일, 기준금리)와 1주·1개월·3개월·1년 변화(bp).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recent_feed',
      description: '최근 2주 이례적 발행·주요 공시 카드(홈 피드)와 다가오는 영업 접점(만기·풋·단기 차입).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'company_disclosures',
      description: '회사의 최근 6개월 DART 공시 목록(제목·날짜·분류). 공시 본문 내용은 없다.',
      parameters: { type: 'object', properties: { corp_code: { type: 'string' } }, required: ['corp_code'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'key_filings',
      description:
        '시장 전체(또는 특정 회사)의 최근 120일 주요 공시와 원문에서 읽은 값(금액·자기자본 대비·상대방·변경 후 최대주주 등). ' +
        '묶음: 자금 수요(단기차입금 증가·신규 시설투자·CB 풋 취득·자사주 처분·채무보증), 지배구조·M&A(최대주주 변경·경영권 양수도·지분/영업 양수도·합병·분할), ' +
        '신용·상장 위험(원리금 미지급·채권은행 관리·회생·부도·상장폐지 사유·실질심사·횡령), 자산·실적(유형자산 취득·처분·감자·매출/손익 30% 변동).',
      parameters: {
        type: 'object',
        properties: {
          group: { type: 'string', enum: ['자금 수요', '지배구조·M&A', '신용·상장 위험', '자산·실적'] },
          kind: { type: 'string', description: '공시 종류 이름 일부 (예: 단기차입금, 최대주주, 시설투자, 원리금)' },
          corp_code: { type: 'string' },
          from: { type: 'string', description: 'YYYY-MM-DD (기본: 30일 전)' },
          issuers_only: { type: 'boolean', description: '공모 회사채 발행 이력·등급이 있는 회사만' },
          limit: { type: 'number', description: '최대 40' },
        },
      },
    },
  },
] as const;

export const TOOL_LABEL: Record<string, string> = {
  search_companies: '회사 찾기',
  company_profile: '회사 개요',
  list_deals: '딜 목록',
  bond_issues: '회사채 발행 구조',
  monthly_trend: '월별 추이',
  maturities: '만기·풋 일정',
  league_table: '주관 순위',
  rates_latest: '금리',
  recent_feed: '최근 피드',
  company_disclosures: '공시 목록',
  key_filings: '주요 공시',
};

const DEAL_COLS =
  'deal_key,product_label,sub_type,corp_code,corp_name,series,deal_dt,announce_dt,pricing_dt,amount_krw,initial_amount_krw,is_increased,rating,tenor_months,competition_ratio,is_undersubscribed,final_spread_bp,coupon_pct,ytm_pct,is_public,refix_floor_ratio_pct,dilution_pct,offer_price,ipo_price_vs_band,ipo_demand_ratio,lead_managers,nh_lead,latest_rcept_no';

function slimDeal(d: Json) {
  const out: Json = {
    상품: d.product_label, 구분: d.sub_type, 회사: d.corp_name, corp_code: d.corp_code, 회차: d.series,
    기준일: d.deal_dt, 결정일: d.announce_dt ?? undefined, 수요예측일: d.pricing_dt ?? undefined,
    금액_억원: eok(d.amount_krw), 최초_억원: d.is_increased ? eok(d.initial_amount_krw) : undefined,
    등급: d.rating ?? undefined, 만기_개월: d.tenor_months ?? undefined, 경쟁률: d.competition_ratio ?? undefined,
    미달: d.is_undersubscribed || undefined, 가산금리_bp: d.final_spread_bp ?? undefined, 표면금리: d.coupon_pct ?? undefined,
    만기이자율: d.ytm_pct ?? undefined, 공모: d.is_public ?? undefined, 리픽싱하한_pct: d.refix_floor_ratio_pct ?? undefined,
    신주비율_pct: d.dilution_pct ?? undefined, 공모가: d.offer_price ?? undefined, 밴드대비: d.ipo_price_vs_band ?? undefined,
    대표주관: d.lead_managers ?? undefined, NH대표주관: d.nh_lead || undefined,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== null));
}

export async function runTool(name: string, args: Json): Promise<ToolResult> {
  switch (name) {
    case 'search_companies': {
      const q = str(args.q);
      if (!q) return { data: [], refs: [] };
      const hits = await searchCompanies(q, 8);
      return {
        data: hits.map((h) => ({ corp_code: h.corp_code, 회사: h.corp_name, 시장: h.market, 발행건수: h.deal_count, 최근발행일: h.last_deal_dt })),
        refs: [],
      };
    }
    case 'company_profile': {
      const corp = str(args.corp_code, 12);
      if (!corp) return { data: null, refs: [] };
      const [ov, deals] = await Promise.all([
        select<Json>('v_company_overview', { corp_code: `eq.${corp}` }),
        select<Json>('v_deals', { select: DEAL_COLS, corp_code: `eq.${corp}`, order: 'deal_dt.desc.nullslast', limit: 20 }),
      ]);
      const o = ov[0];
      if (!o) return { data: null, refs: [] };
      return {
        data: {
          회사: o.corp_name, 시장: o.market, 회사채_건수: o.bond_deal_count, 메자닌_건수: o.mezz_deal_count, 유상증자_건수: o.equity_deal_count,
          최근_회사채등급: o.latest_bond_rating, 회사채_미상환잔액_억원: eok(o.outstanding_bond_krw), 그중_1년내_억원: eok(o.outstanding_bond_1y_krw),
          잔액기준일: o.maturity_stlm_dt, 최근발행: deals.map(slimDeal),
        },
        refs: [corpRef(corp, String(o.corp_name))],
      };
    }
    case 'list_deals': {
      const product = PRODUCTS.includes(args.product as never) ? String(args.product) : 'bond';
      const dateCol = product === 'mezz' || product === 'equity' ? 'announce_dt' : 'deal_dt';
      const and: string[] = [];
      if (isDate(args.from)) and.push(`${dateCol}.gte.${args.from}`);
      if (isDate(args.to)) and.push(`${dateCol}.lte.${args.to}`);
      if (args.min_amount_eok != null && Number.isFinite(Number(args.min_amount_eok))) and.push(`amount_krw.gte.${Number(args.min_amount_eok) * 1e8}`);
      const lead = str(args.lead_manager, 20)?.replace(/[^가-힣A-Za-z0-9]/g, '');
      const rows = await select<Json>('v_deals', {
        select: DEAL_COLS,
        product_type: `eq.${product}`,
        status: 'neq.withdrawn',
        sub_type: str(args.sub_type) ? `eq.${str(args.sub_type)}` : undefined,
        corp_code: str(args.corp_code, 12) ? `eq.${str(args.corp_code, 12)}` : undefined,
        rating_group: str(args.rating_group, 4) ? `eq.${str(args.rating_group, 4)}` : undefined,
        lead_managers: lead ? `ilike.*${lead}*` : undefined,
        is_increased: args.only_increased ? 'is.true' : undefined,
        is_undersubscribed: args.only_undersubscribed ? 'is.true' : undefined,
        is_public: typeof args.is_public === 'boolean' ? `is.${args.is_public}` : undefined,
        and: and.length ? `(${and.join(',')})` : undefined,
        order: args.order === 'amount' ? 'amount_krw.desc.nullslast' : `${dateCol}.desc.nullslast`,
        limit: clamp(args.limit, 1, 50, 25),
      });
      return {
        data: { 건수: rows.length, 딜: rows.map(slimDeal) },
        refs: rows.slice(0, 8).flatMap((r) => dartRef(r.latest_rcept_no as string, `${r.corp_name} ${r.product_label} 공시`)),
      };
    }
    case 'bond_issues': {
      const and: string[] = [];
      if (isDate(args.from)) and.push(`deal_dt.gte.${args.from}`);
      if (isDate(args.to)) and.push(`deal_dt.lte.${args.to}`);
      const order = args.order === 'amount' ? 'amount_krw.desc.nullslast' : args.order === 'competition' ? 'competition_ratio.desc.nullslast' : 'deal_dt.desc';
      const rows = await select<Json>('v_bond_issues', {
        select: 'corp_code,corp_name,sub_type,rating,rating_group,pricing_dt,deal_dt,tranche_count,tenor_combo,amount_krw,initial_amount_krw,increase_pct,competition_ratio,is_undersubscribed,spread_min_bp,spread_max_bp,lead_managers,nh_lead,latest_rcept_no',
        corp_code: str(args.corp_code, 12) ? `eq.${str(args.corp_code, 12)}` : undefined,
        rating_group: str(args.rating_group, 4) ? `eq.${str(args.rating_group, 4)}` : undefined,
        sub_type: str(args.sub_type) ? `eq.${str(args.sub_type)}` : undefined,
        tenor_combo: str(args.tenor_combo) ? `eq.${str(args.tenor_combo)}` : undefined,
        and: and.length ? `(${and.join(',')})` : undefined,
        order,
        limit: clamp(args.limit, 1, 60, 30),
      });
      return {
        data: {
          건수: rows.length,
          발행: rows.map((r) => ({
            회사: r.corp_name, corp_code: r.corp_code, 구분: r.sub_type, 등급: r.rating, 수요예측일: r.pricing_dt, 납입일: r.deal_dt,
            트랜치수: r.tranche_count, 조합: r.tenor_combo, 확정_억원: eok(r.amount_krw), 최초_억원: eok(r.initial_amount_krw),
            증액률_pct: r.increase_pct, 경쟁률: r.competition_ratio, 미달: r.is_undersubscribed || undefined,
            가산금리_bp: r.spread_min_bp == null ? undefined : r.spread_min_bp === r.spread_max_bp ? r.spread_min_bp : `${r.spread_min_bp}~${r.spread_max_bp}`,
            대표주관: r.lead_managers, NH대표주관: r.nh_lead || undefined,
          })),
        },
        refs: rows.slice(0, 8).flatMap((r) => dartRef(r.latest_rcept_no as string, `${r.corp_name} 회사채 공시`)),
      };
    }
    case 'monthly_trend': {
      const product = PRODUCTS.includes(args.product as never) ? String(args.product) : 'bond';
      const view = { bond: 'v_bond_trend_monthly', mezz: 'v_mezz_trend_monthly', equity: 'v_equity_trend_monthly', ipo: 'v_ipo_trend_monthly' }[product]!;
      const from = /^\d{4}-\d{2}$/.test(String(args.from_month)) ? `${args.from_month}-01` : `${Number(today().slice(0, 4)) - 1}${today().slice(4, 7)}-01`;
      const to = /^\d{4}-\d{2}$/.test(String(args.to_month)) ? `${args.to_month}-01` : today();
      const rows = await select<Json>(view, { select: 'month,deal_count,amount_krw', and: `(month.gte.${from},month.lte.${to})`, order: 'month.asc', limit: 2000 });
      const by = new Map<string, { 월: string; 금액_억원: number; 건수: number }>();
      for (const r of rows) {
        const m = String(r.month).slice(0, 7);
        const e = by.get(m) ?? { 월: m, 금액_억원: 0, 건수: 0 };
        e.금액_억원 += Number(r.amount_krw ?? 0) / 1e8;
        e.건수 += Number(r.deal_count ?? 0);
        by.set(m, e);
      }
      return { data: [...by.values()].map((e) => ({ ...e, 금액_억원: Math.round(e.금액_억원) })), refs: [{ label: '발행 동향', href: `/trends/${product}` }] };
    }
    case 'maturities': {
      if (!isDate(args.from) || !isDate(args.to)) return { data: '날짜 형식 오류(YYYY-MM-DD)', refs: [] };
      const kind = args.kind === '풋옵션' ? '풋옵션' : '만기';
      const rows = await select<Json>('v_maturities', {
        select: 'corp_code,corp_name,event_dt,amount_krw,rating,rating_group,sub_type,nh_lead,refi_signal',
        and: `(event_dt.gte.${args.from},event_dt.lt.${args.to})`,
        product_type: `eq.${kind === '만기' ? 'bond' : 'mezz'}`,
        event_type: `eq.${kind}`,
        rating_group: str(args.rating_group, 4) ? `eq.${str(args.rating_group, 4)}` : undefined,
        sub_type: kind === '만기' && args.exclude_financial !== false ? 'neq.금융채' : undefined,
        order: 'event_dt.asc',
        limit: 1000,
      });
      const by = new Map<string, { corp_code: string; 회사: string; 금액_억원: number; 첫일정: string; 건수: number; 등급?: string; NH대표주관이력: boolean; 차환신고서: boolean }>();
      for (const r of rows) {
        const k = String(r.corp_code);
        const e = by.get(k) ?? { corp_code: k, 회사: String(r.corp_name), 금액_억원: 0, 첫일정: String(r.event_dt), 건수: 0, 등급: (r.rating as string) ?? undefined, NH대표주관이력: false, 차환신고서: false };
        e.금액_억원 += Number(r.amount_krw ?? 0) / 1e8;
        e.건수 += 1;
        e.NH대표주관이력 ||= Boolean(r.nh_lead);
        e.차환신고서 ||= Boolean(r.refi_signal);
        by.set(k, e);
      }
      const list = [...by.values()].map((e) => ({ ...e, 금액_억원: Math.round(e.금액_억원) })).sort((a, b) => b.금액_억원 - a.금액_억원).slice(0, clamp(args.limit, 1, 40, 25));
      return { data: { 회사수: by.size, 목록: list }, refs: [{ label: '만기도래', href: '/maturities' }] };
    }
    case 'league_table': {
      const product = PRODUCTS.includes(args.product as never) ? String(args.product) : 'bond';
      const year = clamp(args.year, 2019, 2100, Number(today().slice(0, 4)));
      const rows = await select<Json>('v_league_table_yearly', { product_type: `eq.${product}`, year: `eq.${year}`, lead_deals: 'gt.0', order: 'lead_rank.asc', limit: 15 });
      return {
        data: rows.map((r) => ({ 순위: r.lead_rank, 증권사: r.firm, 대표주관건수: r.lead_deals, 대표주관실적_억원: eok(r.lead_credit_krw), 인수금액_억원: eok(r.uw_amount_krw) })),
        refs: [{ label: '발행 동향', href: `/trends/${product}` }],
      };
    }
    case 'rates_latest': {
      const rows = await select<Json>('v_rate_latest', { order: 'sort_order.asc' });
      return {
        data: rows.map((r) => ({ 지표: r.label_ko, 기준일: r.dt, 값: r.value, 변화_1주_bp: r.chg_1w_bp, 변화_1개월_bp: r.chg_1m_bp, 변화_3개월_bp: r.chg_3m_bp, 변화_1년_bp: r.chg_1y_bp })),
        refs: [{ label: '금리', href: '/rates' }],
      };
    }
    case 'recent_feed': {
      const [feed, touch] = await Promise.all([
        select<Json>('v_feed', { order: 'rank.asc' }),
        select<Json>('v_insight_issues', { order: 'rank.asc' }),
      ]);
      return {
        data: {
          최근2주: feed.map((f) => ({ 구분: f.tag, 종류: f.kind_label, 회사: f.corp_name, corp_code: f.corp_code, 날짜: f.event_dt, 제목: f.headline, 내용: f.body })),
          다가오는접점: touch.map((t) => ({ 회사: t.corp_name, corp_code: t.corp_code, 제목: t.title, 내용: t.why, 날짜: t.event_dt })),
        },
        refs: [{ label: '홈 피드', href: '/' }],
      };
    }
    case 'key_filings': {
      const from = isDate(args.from) ? args.from : daysAgo(30);
      const corp = str(args.corp_code, 12);
      const group = str(args.group, 12);
      const kind = str(args.kind, 20);
      let rows = await getKeyFilings({ since: from, corps: corp ? [corp] : undefined, grp: group });
      if (kind) rows = rows.filter((r) => r.label.includes(kind) || r.report_nm.includes(kind));
      if (args.issuers_only === true) rows = rows.filter(isIssuer);
      const lim = clamp(args.limit, 1, 40, 25);
      const top = rows.slice(0, lim);
      return {
        data: {
          전체건수: rows.length,
          목록: top.map((r) => ({
            날짜: r.rcept_dt, 회사: r.corp_name, corp_code: r.corp_code, 종류: r.label, 묶음: r.grp,
            최근회사채등급: r.latest_bond_rating ?? undefined, 내용: r.facts,
          })),
        },
        refs: [
          { label: '주요 공시', href: `/filings${group ? `?g=${FILING_GROUPS.find((g) => g.grp === group)?.key ?? ''}` : ''}` },
          ...top.slice(0, 4).flatMap((r) => dartRef(r.rcept_no, `${r.corp_name} ${r.label}`)),
        ],
      };
    }
    case 'company_disclosures': {
      const corp = str(args.corp_code, 12);
      if (!corp || !hasDartKey()) return { data: 'DART 공시 목록을 조회할 수 없습니다.', refs: [] };
      const list = await fetchDisclosures(corp, await getDisclosureRules());
      return {
        data: list.filter((d) => d.importance <= 2).slice(0, 25).map((d) => ({ 날짜: d.rcept_dt, 제목: d.report_nm, 분류: d.category, rcept_no: d.rcept_no })),
        refs: list.filter((d) => d.importance <= 1).slice(0, 5).flatMap((d) => dartRef(d.rcept_no, d.report_nm)),
      };
    }
    default:
      return { data: `알 수 없는 도구: ${name}`, refs: [] };
  }
}
