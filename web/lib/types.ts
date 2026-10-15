export type ProductType = 'bond' | 'mezz' | 'equity' | 'ipo';

export const PRODUCTS: { key: ProductType; label: string; unitNote: string }[] = [
  { key: 'bond', label: '회사채', unitNote: '공모 회사채, 납입일 기준' },
  { key: 'mezz', label: '메자닌', unitNote: 'CB, BW, EB 발행 결정, 이사회 결의일 기준' },
  { key: 'equity', label: '유상증자', unitNote: '상장사 유상증자 결정, 이사회 결의일 기준' },
  { key: 'ipo', label: 'IPO', unitNote: '비상장사 공모(스팩 포함), 납입일 기준' },
];

export type Deal = {
  deal_key: string;
  product_type: ProductType;
  product_label: string;
  sub_type: string | null;
  corp_code: string;
  corp_name: string;
  market: string | null;
  stock_code: string | null;
  series: string | null;
  is_public: boolean | null;
  status: string;
  announce_dt: string | null;
  pricing_dt: string | null;
  payment_dt: string | null;
  deal_dt: string | null;
  amount_krw: number | null;
  initial_amount_krw: number | null;
  amount_eok: number | null;
  is_increased: boolean;
  bond_name: string | null;
  rating: string | null;
  rating_notch: number | null;
  rating_group: string | null;
  tenor_months: number | null;
  maturity_dt: string | null;
  coupon_pct: number | null;
  yield_pct: number | null;
  band_type: string | null;
  competition_ratio: number | null;
  final_spread_bp: number | null;
  is_undersubscribed: boolean;
  ytm_pct: number | null;
  conv_price: number | null;
  refix_floor_ratio_pct: number | null;
  conv_start_dt: string | null;
  shares_ratio_pct: number | null;
  articles_remaining_krw: number | null;
  dilution_pct: number | null;
  offer_price: number | null;
  underwriting_method: string | null;
  lead_managers: string | null;
  underwriters: string | null;
  fee_bp: number | null;
  nh_involved: boolean;
  nh_lead: boolean;
  latest_rcept_no: string | null;
  dart_url: string | null;
  put_start_dt: string | null;
  ipo_secondary_pct: number | null;
  ipo_has_putback: boolean | null;
  ipo_band_low: number | null;
  ipo_band_high: number | null;
  ipo_demand_ratio: number | null;
  ipo_subscription_dt: string | null;
  ipo_price_vs_band: string | null;
};

export type CompanyHit = {
  corp_code: string;
  corp_name: string;
  stock_code: string | null;
  market: string | null;
  deal_count: number;
  last_deal_dt: string | null;
  match_score: number;
};

export type CompanyOverview = {
  corp_code: string;
  corp_name: string;
  market: string | null;
  stock_code: string | null;
  induty_code: string | null;
  bond_deal_count: number;
  mezz_deal_count: number;
  equity_deal_count: number;
  last_deal_dt: string | null;
  latest_bond_rating: string | null;
  articles_remaining_krw: number | null;
  maturity_stlm_dt: string | null;
  outstanding_bond_krw: number | null;
  outstanding_bond_1y_krw: number | null;
};

export type Comp = { deal_key: string; score: number; max_score: number; matched: string[]; unmatched: string[] };

export type NotableDeal = {
  deal_key: string;
  deal_dt: string;
  product_type: ProductType;
  product_label: string;
  corp_code: string;
  corp_name: string;
  reason: string;
  detail: string;
};

export type LeagueRow = {
  product_type: ProductType;
  year: number;
  firm: string;
  is_nh: boolean;
  lead_deals: number;
  lead_credit_krw: number | null;
  uw_amount_krw: number | null;
  fee_krw: number | null;
  lead_rank: number;
  uw_rank: number;
};

export type FeeRow = {
  product_type: ProductType;
  quarter: string;
  rating_group: string;
  sub_type: string | null;
  deal_count: number;
  uw_amount_krw: number;
  fee_krw: number;
  fee_bp: number;
};

export type DataStatus = {
  last_refresh_at: string | null;
  latest_filing_dt: string | null;
  first_deal_dt: string | null;
  latest_deal_dt: string | null;
  bond_deals: number;
  mezz_deals: number;
  equity_deals: number;
};

export type Metric = { metric_key: string; product_type: ProductType | null; label_ko: string; definition_ko: string; unit: string | null; status: 'draft' | 'agreed' };

export type BondTrendRow = {
  month: string; category: string | null; rating_group: string | null; deal_count: number; amount_krw: number | null;
  avg_yield_pct_w: number | null; avg_tenor_months: number | null; avg_competition: number | null; demand_known_count: number;
  undersub_count: number; fixed_band_count: number; band_known_count: number; increased_count: number;
};
export type MezzTrendRow = {
  month: string; kind: string | null; market: string | null; is_public: boolean | null; deal_count: number; amount_krw: number | null;
  zero_coupon_count: number; avg_ytm_pct: number | null; refix_low_count: number; refix_known_count: number; avg_shares_ratio_pct: number | null;
};
export type EquityTrendRow = {
  month: string; method: string | null; market: string | null; deal_count: number; amount_krw: number | null;
  avg_dilution_pct: number | null; firm_commitment_count: number; standby_count: number; method_known_count: number;
};

export type IpoTrendRow = {
  month: string; sub_type: string | null; market: string | null; deal_count: number; amount_krw: number | null;
  avg_secondary_pct: number | null; putback_count: number; avg_demand_ratio: number | null; demand_known_count: number;
  above_band_count: number; in_band_count: number; below_band_count: number; band_known_count: number;
};

export type Maturity = {
  deal_key: string; product_type: ProductType; product_label: string; sub_type: string | null;
  corp_code: string; corp_name: string; market: string | null; series: string | null; is_public: boolean | null;
  event_type: '만기' | '풋옵션'; event_dt: string; days_left: number; issue_dt: string | null; maturity_dt: string | null;
  amount_krw: number | null; tenor_months: number | null; coupon_pct: number | null; yield_pct: number | null; ytm_pct: number | null;
  rating: string | null; rating_group: string | null; lead_managers: string | null; nh_involved: boolean; nh_lead: boolean;
  dart_url: string | null; refi_signal: boolean;
};

export type MaturityMonth = { month: string; product_type: ProductType; event_type: string; tranche_count: number; company_count: number; amount_krw: number | null; nh_lead_count: number };

export type InsightUnit = 'krw' | 'count' | 'pct' | 'months' | 'bp' | 'rate';
export type InsightFact = {
  scope: string; fact_key: string; label_ko: string; unit: InsightUnit; compare: string;
  value_now: number | null; value_base: number | null; change: number | null;
  period_now: string; period_base: string; score: number | null; is_notable: boolean; priority: number; rule_status: string;
};
export type InsightIssue = {
  asof: string; model: string | null; created_at: string; rank: number; kind: 'issue' | 'touchpoint';
  corp_code: string; corp_name: string; title: string; why: string; angle: string;
  signal_key: string; signal_label: string; event_dt: string | null; rcept_no: string | null;
};

export type RateLatest = {
  series_key: string; label_ko: string; grp: string; sort_order: number; dt: string; value: number;
  chg_1w_bp: number | null; chg_1m_bp: number | null; chg_3m_bp: number | null; chg_1y_bp: number | null;
  source: 'ecos' | 'research'; source_url: string | null;
};
export type RatePoint = { series_key: string; dt: string; value: number };
export type SpreadPoint = { dt: string; aa_spread_bp: number | null; bbb_aa_gap_bp: number | null; term_spread_bp: number | null };
export type PolicyEvent = { event_dt: string; kind: string; label_ko: string; source: string | null };
export type DisclosureRule = { priority: number; pattern: string; category: string; importance: number };
export type Disclosure = { rcept_no: string; rcept_dt: string; report_nm: string; flr_nm: string; rm: string; category: string; importance: number };

export type ShortDebt = {
  corp_code: string; corp_name: string; market: string | null; period_key: string; stlm_dt: string | null;
  bond_1y_krw: number | null; bond_private_1y_krw: number | null; bond_total_krw: number | null;
  cp_1y_krw: number | null; cp_3m_krw: number | null; stb_krw: number | null; total_1y_krw: number | null;
  is_financial: boolean;
};

export type FeedItem = {
  asof: string; model: string | null; created_at: string; rank: number;
  tag: '발행' | '공시'; kind: string; kind_label: string | null;
  corp_code: string; corp_name: string; headline: string; body: string; point: string;
  event_dt: string | null; rcept_no: string | null; ref_key: string | null; label: string | null;
  flags: string[] | null; tone: 'alert' | null; written_by: string | null;
};

export type BondTranche = {
  deal_key: string; series: string | null; tenor_months: number | null; tenor_label: string | null; tenor_bucket: string;
  amount_krw: number | null; initial_amount_krw: number | null; demand_krw: number | null; competition_ratio: number | null;
  final_spread_bp: number | null; coupon_pct: number | null; band_low: number | null; band_high: number | null;
  is_increased: boolean | null; is_undersubscribed: boolean | null; lead_managers: string | null; nh_lead: boolean | null;
};

export type BondIssue = {
  issue_key: string; corp_code: string; corp_name: string; market: string | null; sub_type: string | null; base_series: string;
  pricing_dt: string | null; deal_dt: string | null; rating: string | null; rating_group: string | null; rating_notch: number | null;
  tranche_count: number; amount_krw: number | null; initial_amount_krw: number | null; demand_krw: number | null;
  competition_ratio: number | null; is_increased: boolean | null; increase_pct: number | null; is_undersubscribed: boolean | null;
  tenor_combo: string; tenor_min: number | null; tenor_max: number | null; spread_min_bp: number | null; spread_max_bp: number | null;
  tranches: BondTranche[]; lead_managers: string | null; nh_lead: boolean | null; nh_involved: boolean | null; latest_rcept_no: string | null;
};
