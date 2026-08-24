export type Category = {
  id: string;
  name: string;
  value: number;
  target: number; // percent
};

export type AllocationLine = {
  id: string;
  name: string;
  value: number;
  target: number;
  currentWeight: number; // %
  finalValue: number;
  finalWeight: number; // %
  injected: number;
  deltaPp: number; // finalWeight - currentWeight
  gapToTargetPp: number; // finalWeight - target
};

export type RebalanceResult = {
  total: number;
  finalTotal: number;
  budget: number;
  lines: AllocationLine[];
  minInjection: number;
  targetSum: number;
  targetsValid: boolean;
  maxGapPp: number;
};

/**
 * Water-filling allocation: minimise squared deviation to target weights
 * with x_i >= 0 and sum(x_i) = budget (no sales allowed).
 * Optimal solution: x_i = max(0, lambda * w_i - v_i) with lambda chosen so the sum matches.
 */
function allocate(values: number[], weights: number[], budget: number): number[] {
  const n = values.length;
  if (n === 0) return [];

  const pairs = values.map((v, i) => ({ v, w: weights[i] ?? 0 }));

  const breakpoints = pairs
    .filter((p) => p.w > 0)
    .map((p) => p.v / p.w)
    .sort((a, b) => a - b);

  const need = (lambda: number) =>
    pairs.reduce((acc, p) => acc + (p.w > 0 ? Math.max(0, lambda * p.w - p.v) : 0), 0);

  let lo = breakpoints.length > 0 ? (breakpoints[0] as number) : 0;
  for (const bp of breakpoints) {
    if (need(bp) >= budget) break;
    lo = bp;
  }

  const slope = pairs.reduce(
    (acc, p) => acc + (p.w > 0 && lo * p.w - p.v >= 0 ? p.w : 0),
    0,
  );
  const lambda = slope > 0 ? lo + (budget - need(lo)) / slope : lo;

  return pairs.map((p) => (p.w > 0 ? Math.max(0, lambda * p.w - p.v) : 0));
}

export function computeRebalance(categories: Category[], budget: number): RebalanceResult {
  const total = categories.reduce((a, c) => a + (c.value || 0), 0);
  const targetSum = categories.reduce((a, c) => a + (c.target || 0), 0);
  const targetsValid = Math.abs(targetSum - 100) < 0.01;

  const weights = categories.map((c) => (c.target || 0) / 100);
  const values = categories.map((c) => c.value || 0);
  const safeBudget = Math.max(0, budget || 0);

  const injections = allocate(values, weights, safeBudget);
  const finalTotal = total + safeBudget;

  const lines: AllocationLine[] = categories.map((c, i) => {
    const value = values[i] ?? 0;
    const injected = injections[i] ?? 0;
    const currentWeight = total > 0 ? (value / total) * 100 : 0;
    const finalValue = value + injected;
    const finalWeight = finalTotal > 0 ? (finalValue / finalTotal) * 100 : 0;
    return {
      id: c.id,
      name: c.name,
      value,
      target: c.target || 0,
      currentWeight,
      finalValue,
      finalWeight,
      injected,
      deltaPp: finalWeight - currentWeight,
      gapToTargetPp: finalWeight - (c.target || 0),
    };
  });

  // Minimal injection to hit targets exactly without selling:
  // final total must be at least max(v_i / w_i).
  const requiredTotal = categories.reduce((max, _c, i) => {
    const w = weights[i] ?? 0;
    const v = values[i] ?? 0;
    if (w <= 0) return v > 0 ? Infinity : max;
    return Math.max(max, v / w);
  }, 0);
  const minInjection = Number.isFinite(requiredTotal)
    ? Math.max(0, requiredTotal - total)
    : Infinity;

  const maxGapPp = lines.reduce((m, l) => Math.max(m, Math.abs(l.gapToTargetPp)), 0);

  return {
    total,
    finalTotal,
    budget: safeBudget,
    lines,
    minInjection,
    targetSum,
    targetsValid,
    maxGapPp,
  };
}

export const eur = (n: number) =>
  Number.isFinite(n)
    ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n)
    : "—";

export const pct = (n: number) => `${n.toFixed(1)} %`;

export const pp = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)} pp`;
