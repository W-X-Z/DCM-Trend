export type ProductType = 'bond' | 'mezz' | 'equity';

export const PRODUCTS: { key: ProductType; label: string; unitNote: string }[] = [
  { key: 'bond', label: '회사채', unitNote: '공모 회사채, 납입일 기준' },
  { key: 'mezz', label: '메자닌', unitNote: 'CB, BW, EB 발행 결정, 이사회 결의일 기준' },
  { key: 'equity', label: '유상증자', unitNote: '유상증자 결정, 이사회 결의일 기준' },
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
