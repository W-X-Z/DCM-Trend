import { select, selectAll, rpc, inList } from './db';
import type {
  BondTrendRow, Comp, CompanyHit, CompanyOverview, DataStatus, Deal, DisclosureRule, EquityTrendRow,
  FeeRow, InsightFact, InsightSummary, IpoTrendRow, LeagueRow, Maturity, MaturityMonth, Metric, MezzTrendRow,
  NotableDeal, PolicyEvent, ProductType, RateLatest, RatePoint, ShortDebt, SpreadPoint,
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

export async function getShortDebt(limit = 200, corp?: string): Promise<ShortDebt[]> {
  return select<ShortDebt>('v_company_short_debt', {
    corp_code: corp ? `eq.${corp}` : undefined,
    total_1y_krw: corp ? undefined : 'gt.0',
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

export async function getInsightSummaries(): Promise<InsightSummary[]> {
  return select<InsightSummary>('v_insight_summaries');
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
