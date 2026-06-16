/**
 * Pure analytics primitives behind the AI Insights endpoints — real statistics (least-squares trend,
 * z-score anomaly detection, weighted scoring) so insights are deterministic and unit-testable, and
 * work tenant-locally without the Python ML service. The resilient ML bridge (MlService) remains the
 * path for heavier models; these power the always-on dashboard.
 */

/** Least-squares linear regression over (index, value); returns slope + intercept. */
export function linearFit(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: values[0]! };
  const xs = values.map((_, i) => i);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * values[i]!, 0);
  const sumXX = xs.reduce((a, x) => a + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/** Forecast the next `periods` values by extrapolating the least-squares trend (floored at 0). */
export function linearForecast(values: number[], periods: number): number[] {
  const { slope, intercept } = linearFit(values);
  const n = values.length;
  return Array.from({ length: periods }, (_, k) => Math.max(0, Math.round(intercept + slope * (n + k))));
}

export interface Anomaly {
  index: number;
  value: number;
  z: number;
}

/** Flag points whose z-score exceeds `threshold` (default 2σ). Needs ≥3 points and non-zero variance. */
export function zScoreAnomalies(values: number[], threshold = 2): Anomaly[] {
  const n = values.length;
  if (n < 3) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  if (sd === 0) return [];
  const out: Anomaly[] = [];
  values.forEach((value, index) => {
    const z = (value - mean) / sd;
    if (Math.abs(z) >= threshold) out.push({ index, value, z: Math.round(z * 100) / 100 });
  });
  return out;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

/** Lead score 0–100: rating (HOT/WARM/COLD), estimated value, and recency (fresher = hotter). */
export function scoreLead(input: { rating: string; estValueMinor: number; ageDays: number }): number {
  const ratingPts = input.rating === 'HOT' ? 45 : input.rating === 'WARM' ? 28 : 12;
  const valuePts = Math.min(35, input.estValueMinor / 100 / 5000); // ~PKR 175k → full 35
  const recencyPts = Math.max(0, 20 - input.ageDays * 0.5); // decays over ~40 days
  return clamp(ratingPts + valuePts + recencyPts);
}

/** Attrition risk 0–100: short tenure, high recent absence and unused-leave pressure raise risk. */
export function scoreAttrition(input: { tenureDays: number; absenceRate: number; openLeaveDays: number }): number {
  const tenurePts = input.tenureDays < 180 ? 35 : input.tenureDays < 365 ? 22 : input.tenureDays < 1095 ? 10 : 4;
  const absencePts = Math.min(45, input.absenceRate * 100 * 1.5); // 30% absence → full 45
  const leavePts = Math.min(20, input.openLeaveDays * 1.5);
  return clamp(tenurePts + absencePts + leavePts);
}

/** Risk band for a 0–100 score. */
export function riskBand(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  return score >= 66 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
}

/** Days until stock runs out at the recent average daily demand (null = no demand / never). */
export function daysToStockout(onHand: number, avgDailyDemand: number): number | null {
  if (avgDailyDemand <= 0) return null;
  return Math.round(onHand / avgDailyDemand);
}
