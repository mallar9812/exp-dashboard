function normalCDF(x: number): number {
  const a1 =  0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 =  1.061405429, p  = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
  return 0.5 * (1 + sign * y);
}

export interface StatResult {
  pValue: number;
  confidence: number;
  significant: boolean;
}

/** Z-test for two proportions: treatment vs control */
export function zTestProportion(
  num1: number, den1: number,   // treatment
  num0: number, den0: number    // control
): StatResult {
  if (den0 <= 0 || den1 <= 0) return { pValue: 1, confidence: 0, significant: false };
  const p0 = num0 / den0;
  const p1 = num1 / den1;
  const pPool = (num0 + num1) / (den0 + den1);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / den0 + 1 / den1));
  if (se === 0) return { pValue: 1, confidence: 0, significant: false };
  const z = (p1 - p0) / se;
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));
  return { pValue, confidence: (1 - pValue) * 100, significant: pValue < 0.05 };
}
