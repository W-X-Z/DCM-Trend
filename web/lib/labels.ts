import type { Deal, ProductType } from './types';
import { num, pct, tenor } from './format';

export const PRODUCT_LABEL: Record<ProductType, string> = { bond: '회사채', mezz: '메자닌', equity: '유상증자', ipo: 'IPO' };

// mart.v_deal_features 의 특성 이름 → 화면 표시
export const FEATURE_LABEL: Record<string, string> = {
  rating_notch: '신용등급',
  tenor_months: '만기',
  amount_krw: '금액',
  sub_type: '종류',
  band_type: '밴드 방식',
  market: '시장',
  is_public: '공모 여부',
  shares_ratio_pct: '주식 비율',
  zero_coupon: '0%/0%',
  has_refix: '리픽싱',
  dilution_pct: '신주 비율',
};

// 딜 한 줄 요약 (조건)
export function dealTerms(d: Deal): string[] {
  if (d.product_type === 'bond') {
    const sp = d.final_spread_bp != null ? Number(d.final_spread_bp) : null;
    return [
      d.tenor_months ? `${tenor(d.tenor_months)} 만기` : null,
      d.rating,
      d.coupon_pct != null
        ? `금리 ${pct(d.coupon_pct, 3)}`
        : sp != null
          ? `${d.band_type === '국고채' ? '국고' : '민평'} ${sp > 0 ? '+' : sp < 0 ? '−' : ''}${Math.abs(sp)}bp`
          : null,
      d.competition_ratio != null ? `경쟁률 ${num(d.competition_ratio, 1)}배` : null,
    ].filter(Boolean) as string[];
  }
  if (d.product_type === 'mezz') {
    return [
      d.is_public === null ? null : d.is_public ? '공모' : '사모',
      d.coupon_pct != null && d.ytm_pct != null ? `표면 ${pct(d.coupon_pct, 1)}, 만기 ${pct(d.ytm_pct, 1)}` : null,
      d.conv_price ? `전환가 ${num(d.conv_price)}원` : null,
      d.refix_floor_ratio_pct != null ? `리픽싱 하한 ${num(d.refix_floor_ratio_pct)}%` : null,
    ].filter(Boolean) as string[];
  }
  if (d.product_type === 'ipo') {
    return [
      d.offer_price ? `공모가 ${num(d.offer_price)}원` : null,
      d.ipo_price_vs_band ? `밴드 ${d.ipo_price_vs_band}` : null,
      d.ipo_secondary_pct ? `구주매출 ${pct(d.ipo_secondary_pct, 0)}` : null,
      d.ipo_has_putback ? '환매청구권' : null,
    ].filter(Boolean) as string[];
  }
  return [
    d.dilution_pct != null ? `신주 비율 ${pct(d.dilution_pct, 1)}` : null,
    d.offer_price ? `발행가 ${num(d.offer_price)}원` : null,
    d.underwriting_method,
  ].filter(Boolean) as string[];
}

// 딜 이름: 회사채는 회차, 메자닌은 종류+회차, 유증은 방식
export function dealTitle(d: Deal): string {
  if (d.product_type === 'bond') return d.series ? `제${d.series}회 ${d.sub_type ?? '회사채'}` : d.sub_type ?? '회사채';
  if (d.product_type === 'mezz') {
    const kind = d.sub_type ?? '메자닌';
    // 회차가 없으면 접수번호(14자리)가 들어가므로 표시하지 않는다
    return d.series && d.series.length <= 6 ? `제${d.series}회 ${kind}` : kind;
  }
  if (d.product_type === 'ipo') return d.sub_type && d.sub_type !== '일반' ? `IPO (${d.sub_type})` : 'IPO';
  return d.sub_type ? `${d.sub_type} 유상증자` : '유상증자';
}

export const DATE_BASIS: Record<ProductType, string> = {
  bond: '납입일 기준',
  mezz: '이사회 결의일 기준',
  equity: '이사회 결의일 기준',
  ipo: '납입일 기준',
};
