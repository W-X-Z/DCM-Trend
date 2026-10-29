import { select, selectAll, rpc, inList } from './db';
import { TREND_DEAL_COLS, type TrendDeal } from './period';
import type {
  BondIssue, BondTrendRow, Comp, FeedItem, CompanyHit, CompanyOverview, DataStatus, Deal, DisclosureRule, EquityTrendRow,
  FeeRow, InsightFact, InsightIssue, IpoTrendRow, LeagueRow, Maturity, MaturityMonth, Metric, MezzTrendRow,
  ExpansionCompany, ExpansionEvent, KeyFiling, NotableDeal, PolicyEvent, ProductType, RateLatest, RatePoint, ShortDebt, SpreadPoint,
} from './types';

export async function getDataStatus(): Promise<DataStatus | null> {
  const rows = await select<DataStatus>('v_data_status');
  return rows[0] ?? null;
}

export async function searchCompanies(q: string, lim = 20): Promise<CompanyHit[]> {
  return rpc<CompanyHit[]>('search_companies', { q, lim });
}

export async function getCompany(corp: string): Promise<CompanyOverview | null> {
  const rows = await select<CompanyOverview>('v_company_overview', { corp_code: `eq.${corp}` });
  return rows[0] ?? null;
}

export async function getCompanyDeals(corp: string): Promise<Deal[]> {
  return select<Deal>('v_deals', { corp_code: `eq.${corp}`, order: 'deal_dt.desc.nullslast', limit: 200 });
}

export async function getDeals(keys: string[]): Promise<Deal[]> {
  if (!keys.length) return [];
  return select<Deal>('v_deals', { deal_key: inList(keys) });
}

export async function getRecentDeals(product: ProductType, opts: { subTypes?: string[]; limit?: number } = {}): Promise<Deal[]> {
  return select<Deal>('v_deals', {
    product_type: `eq.${product}`,
    sub_type: opts.subTypes?.length ? inList(opts.subTypes) : undefined,
    deal_dt: 'not.is.null',
    order: 'deal_dt.desc,amount_krw.desc.nullslast',
    limit: opts.limit ?? 30,
  });
}

export async function getSimilar(dealKey: string, limit = 8): Promise<{ comp: Comp; deal: Deal }[]> {
  const comps = await rpc<Comp[]>('similar_deals', { p_deal_key: dealKey, p_limit: limit });
  const deals = await getDeals(comps.map((c) => c.deal_key));
  const byKey = new Map(deals.map((d) => [d.deal_key, d]));
  return comps.flatMap((c) => (byKey.has(c.deal_key) ? [{ comp: c, deal: byKey.get(c.deal_key)! }] : []));
}

export async function getNotable(since: string, limit = 60): Promise<{ deal: Deal; reasons: NotableDeal[] }[]> {
  const rows = await select<NotableDeal>('v_notable_deals', {
    deal_dt: `gte.${since}`,
    order: 'deal_dt.desc',
    limit,
  });
  const keys = [...new Set(rows.map((r) => r.deal_key))];
  const deals = await getDeals(keys);
  const byKey = new Map(deals.map((d) => [d.deal_key, d]));
  return keys.flatMap((k) =>
    byKey.has(k) ? [{ deal: byKey.get(k)!, reasons: rows.filter((r) => r.deal_key === k) }] : [],
  );
}

const TREND_VIEW: Record<ProductType, string> = {
  bond: 'v_bond_trend_monthly',
  mezz: 'v_mezz_trend_monthly',
  equity: 'v_equity_trend_monthly',
  ipo: 'v_ipo_trend_monthly',
};

export async function getTrend<T extends BondTrendRow | MezzTrendRow | EquityTrendRow | IpoTrendRow>(product: ProductType, since: string): Promise<T[]> {
  return select<T>(TREND_VIEW[product], { month: `gte.${since}`, order: 'month.asc' });
}

export async function getFees(product: ProductType, since: string): Promise<FeeRow[]> {
  return select<FeeRow>('v_fee_stats', { product_type: `eq.${product}`, quarter: `gte.${since}`, order: 'quarter.asc' });
}

export async function getLeague(product: ProductType, year: number, limit = 10): Promise<LeagueRow[]> {
  return select<LeagueRow>('v_league_table_yearly', {
    product_type: `eq.${product}`,
    year: `eq.${year}`,
    lead_deals: 'gt.0',
    order: 'lead_rank.asc',
    limit,
  });
}

export async function getMetrics(product: ProductType): Promise<Metric[]> {
  return select<Metric>('v_metric_catalog', { or: `(product_type.is.null,product_type.eq.${product})` });
}

export async function getUiParam<T>(key: string): Promise<T | null> {
  const rows = await select<{ key: string; value: T }>('v_ui_params', { key: `eq.${key}` });
  return rows[0]?.value ?? null;
}

// 만기·풋옵션 -------------------------------------------------------------
export async function getMaturities(opts: { from: string; to: string; product?: ProductType; corp?: string; eventType?: string }): Promise<Maturity[]> {
  return select<Maturity>('v_maturities', {
    and: `(event_dt.gte.${opts.from},event_dt.lt.${opts.to})`,
    product_type: opts.product ? `eq.${opts.product}` : undefined,
    corp_code: opts.corp ? `eq.${opts.corp}` : undefined,
    event_type: opts.eventType ? `eq.${opts.eventType}` : undefined,
    order: 'event_dt.asc,amount_krw.desc.nullslast',
    limit: 1000,
  });
}

export async function getShortDebt(limit = 200, corp?: string, includeFinancial = true): Promise<ShortDebt[]> {
  return select<ShortDebt>('v_company_short_debt', {
    corp_code: corp ? `eq.${corp}` : undefined,
    total_1y_krw: corp ? undefined : 'gt.0',
    is_financial: includeFinancial ? undefined : 'eq.false',
    order: 'total_1y_krw.desc.nullslast',
    limit,
  });
}

export async function getMaturityMonthly(from: string, to: string): Promise<MaturityMonth[]> {
  return select<MaturityMonth>('v_maturity_monthly', { and: `(month.gte.${from},month.lt.${to})`, order: 'month.asc' });
}

// 인사이트 -----------------------------------------------------------------
export async function getInsightFacts(): Promise<InsightFact[]> {
  return rpc<InsightFact[]>('insight_facts', {});
}

export async function getInsightIssues(): Promise<InsightIssue[]> {
  return select<InsightIssue>('v_insight_issues', { order: 'rank.asc' });
}

export async function getFeed(): Promise<FeedItem[]> {
  return select<FeedItem>('v_feed', { order: 'rank.asc' });
}

// 발행 동향 기간 집계용 딜 (필요한 열만)
export async function getTrendDeals(product: ProductType, since: string): Promise<TrendDeal[]> {
  const rows = await selectAll<TrendDeal>('v_deals', {
    select: TREND_DEAL_COLS,
    product_type: `eq.${product}`,
    deal_dt: `gte.${since}`,
    status: product === 'ipo' ? 'neq.withdrawn' : undefined,
    order: 'deal_dt.asc,deal_key.asc',
  });
  return rows;
}

// 회사채 발행(트랜치 묶음). since 는 납입일 기준
export async function getBondIssues(since: string, subTypes?: string[] | null): Promise<BondIssue[]> {
  return selectAll<BondIssue>('v_bond_issues', {
    deal_dt: `gte.${since}`,
    sub_type: subTypes?.length ? inList(subTypes) : undefined,
    order: 'deal_dt.desc,amount_krw.desc.nullslast',
  });
}

// 금리 ---------------------------------------------------------------------
export async function getRateLatest(): Promise<RateLatest[]> {
  return select<RateLatest>('v_rate_latest', { order: 'sort_order.asc' });
}

export async function getRates(since: string, keys: string[]): Promise<RatePoint[]> {
  return selectAll<RatePoint>('v_rates_daily', { select: 'series_key,dt,value', dt: `gte.${since}`, series_key: inList(keys), order: 'dt.asc' });
}

export async function getSpreads(since: string): Promise<SpreadPoint[]> {
  return selectAll<SpreadPoint>('v_rate_spreads_daily', { dt: `gte.${since}`, order: 'dt.asc' });
}

export async function getPolicyEvents(): Promise<PolicyEvent[]> {
  return select<PolicyEvent>('v_policy_events', { order: 'event_dt.asc' });
}

export async function getDisclosureRules(): Promise<DisclosureRule[]> {
  return select<DisclosureRule>('v_disclosure_rules', { order: 'priority.asc' });
}

// 주요 공시 (시장 전체, 최근 120일). corps 를 주면 그 회사들만
export async function getKeyFilings(opts: { since: string; grp?: string; corps?: string[]; limit?: number }): Promise<KeyFiling[]> {
  const q = {
    rcept_dt: `gte.${opts.since}`,
    grp: opts.grp ? `eq.${opts.grp}` : undefined,
    corp_code: opts.corps?.length ? inList(opts.corps) : undefined,
    order: 'rcept_dt.desc,weight.desc,size_krw.desc.nullslast',
  };
  return opts.limit ? select<KeyFiling>('v_key_filings', { ...q, limit: opts.limit }) : selectAll<KeyFiling>('v_key_filings', q);
}

// 회사채 발행(트랜치 묶음): 한 회사 또는 등급군
export async function getBondIssuesBy(opts: { corp?: string; ratingGroup?: string; since?: string; limit?: number }): Promise<BondIssue[]> {
  return select<BondIssue>('v_bond_issues', {
    corp_code: opts.corp ? `eq.${opts.corp}` : undefined,
    rating_group: opts.ratingGroup ? `eq.${opts.ratingGroup}` : undefined,
    deal_dt: opts.since ? `gte.${opts.since}` : undefined,
    order: 'deal_dt.desc,amount_krw.desc.nullslast',
    limit: opts.limit ?? 200,
  });
}

// 사업 확장 기업 (최근 1년): 회사별 묶음과 공시별 근거
export async function getExpansionCompanies(): Promise<ExpansionCompany[]> {
  return selectAll<ExpansionCompany>('v_expansion_companies', { order: 'amount_krw.desc.nullslast,last_dt.desc' });
}

export async function getExpansionEvents(): Promise<ExpansionEvent[]> {
  return selectAll<ExpansionEvent>('v_expansion_events', { order: 'decided_dt.desc,amount_krw.desc.nullslast' });
}

// 홈 영업 추천: 회사들의 공모 회사채 주관 이력 (회사가 많아 나눠 조회)
export async function getBondHistory(corps: string[], since: string): Promise<Pick<BondIssue, 'corp_code' | 'deal_dt' | 'lead_managers' | 'nh_lead' | 'nh_involved'>[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < corps.length; i += 120) chunks.push(corps.slice(i, i + 120));
  const parts = await Promise.all(
    chunks.map((c) =>
      selectAll<Pick<BondIssue, 'corp_code' | 'deal_dt' | 'lead_managers' | 'nh_lead' | 'nh_involved'>>('v_bond_issues', {
        select: 'corp_code,deal_dt,lead_managers,nh_lead,nh_involved',
        corp_code: inList(c),
        deal_dt: `gte.${since}`,
        order: 'deal_dt.desc,issue_key.asc',
      }),
    ),
  );
  return parts.flat();
}

// 최근 조달(공시된 발행)과 NH 대표주관 이력: 주요공시 목록의 '최근 1년 조달'·'NH 이력' 표시용
export type FundingDeal = Pick<Deal, 'corp_code' | 'product_type' | 'product_label' | 'sub_type' | 'amount_krw' | 'deal_dt' | 'nh_lead' | 'is_public'>;
export async function getFundingSince(since: string): Promise<FundingDeal[]> {
  return selectAll<FundingDeal>('v_deals', {
    select: 'corp_code,product_type,product_label,sub_type,amount_krw,deal_dt,nh_lead,is_public',
    deal_dt: `gte.${since}`,
    status: 'neq.withdrawn',
    order: 'deal_dt.desc,deal_key.asc',
  });
}

export async function getNhLeadCorps(): Promise<string[]> {
  const rows = await selectAll<{ corp_code: string }>('v_deals', { select: 'corp_code', nh_lead: 'is.true', order: 'corp_code.asc,deal_key.asc' });
  return [...new Set(rows.map((r) => r.corp_code))];
}
