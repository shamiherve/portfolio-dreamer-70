import { asCategories, validTargets, type Position } from './portfolio';
import { computeRebalance } from './rebalance';

export const TARGET_TOLERANCE_PP = 0.05;
export function equilibriumScore(weights: number[], targets: number[]) {
  if (!validTargets(targets) || weights.length !== targets.length || weights.some(w => !Number.isFinite(w) || w < 0) || Math.abs(weights.reduce((a, b) => a + b, 0) - 100) > 0.01) return null;
  return Math.max(0, Math.min(100, 100 - weights.reduce((s, w, i) => s + Math.abs(w - (targets[i] ?? 0)), 0) / 2));
}
export function scoreLabel(score: number) {
  return score >= 90 ? 'Excellent' : score >= 75 ? 'Bon' : score >= 50 ? 'Modéré' : 'Déséquilibre important';
}
export function evaluatePurchases(positions: Position[], units: number[], budget: number) {
  if (!Number.isFinite(budget) || budget < 0 || units.length !== positions.length) throw new Error('Budget invalide.');
  const spent = units.reduce((s, q, i) => {
    const p = positions[i];
    if (!Number.isSafeInteger(q) || q < 0 || !p || (q > 0 && (!p.price || p.target === 0))) throw new Error('Les achats doivent être des parts entières, avec un cours et une cible positive.');
    return s + q * (p.price ?? 0);
  }, 0);
  if (spent > budget + 1e-8) throw new Error('Ces achats dépassent le budget disponible.');
  const total = positions.reduce((s, p) => s + p.quantity * (p.price ?? 0), 0);
  const finalTotal = total + spent;
  const lines = positions.map((p, i) => {
    const shares = units[i] ?? 0;
    const injected = shares * (p.price ?? 0);
    const currentWeight = total ? p.quantity * (p.price ?? 0) / total * 100 : 0;
    const finalWeight = finalTotal ? (p.quantity * (p.price ?? 0) + injected) / finalTotal * 100 : 0;
    return { ...p, shares, injected, currentWeight, finalWeight, projectedQuantity: p.quantity + shares, gapToTargetPp: finalWeight - p.target };
  });
  const currentScore = equilibriumScore(lines.map(l => l.currentWeight), positions.map(p => p.target));
  const projectedScore = equilibriumScore(lines.map(l => l.finalWeight), positions.map(p => p.target));
  return { lines, total, finalTotal, spent, cash: Math.max(0, budget - spent), currentScore, projectedScore,
    maxGap: Math.max(0, ...lines.map(l => Math.abs(l.gapToTargetPp))),
    loss: lines.reduce((s, l) => s + l.gapToTargetPp ** 2, 0) };
}

/** Exact enumeration when tractable; bounded deterministic search otherwise.
 * The continuous engine is used only to initialize the separate integer search. */
export function wholeUnitProposal(positions: Position[], budget: number, mode: 'budget' | 'target') {
  const continuous = computeRebalance(asCategories(positions), budget);
  const valid = validTargets(positions.map(p => p.target)) && positions.every(p => p.price !== null || (p.quantity === 0 && p.target === 0));
  const theoreticalMinimum = continuous.minInjection;
  const priceSum = positions.reduce((s, p) => s + (p.target > 0 ? p.price ?? 0 : 0), 0);
  // Mode A has an explicit finite search envelope; never promise an unbounded integer optimum.
  const limit = mode === 'target' ? Number.isFinite(theoreticalMinimum) ? theoreticalMinimum + priceSum : 0 : Math.max(0, Number.isFinite(budget) ? budget : 0);
  const zero = positions.map(() => 0);
  let best = evaluatePurchases(positions, zero, limit);
  if (!valid || (mode === 'target' && !Number.isFinite(theoreticalMinimum))) return { ...best, valid, exhaustive: true, limit, theoreticalMinimum, toleranceReached: false, units: zero, continuous };
  const counts = positions.map(p => p.price && p.target > 0 ? Math.floor((limit + 1e-8) / p.price) : 0);
  const exhaustive = counts.reduce((n, c) => n * (c + 1), 1) <= 100_000;
  let chosen = zero;
  const consider = (units: number[]) => {
    const candidate = evaluatePurchases(positions, units, limit);
    const reached = candidate.finalTotal > 0 && candidate.maxGap <= TARGET_TOLERANCE_PP;
    const bestReached = best.finalTotal > 0 && best.maxGap <= TARGET_TOLERANCE_PP;
    const better = mode === 'target' && (reached || bestReached)
      ? reached && (!bestReached || candidate.spent < best.spent - 1e-8 || (Math.abs(candidate.spent - best.spent) < 1e-8 && candidate.loss < best.loss))
      : candidate.loss < best.loss - 1e-10 || (Math.abs(candidate.loss - best.loss) < 1e-10 && candidate.spent < best.spent);
    if (better) { best = candidate; chosen = [...units]; }
  };
  if (exhaustive) {
    const units = [...zero];
    const visit = (i: number, remaining: number) => {
      if (i === positions.length) { consider(units); return; }
      const price = positions[i]?.price ?? 0;
      const max = price > 0 ? Math.min(counts[i] ?? 0, Math.floor((remaining + 1e-8) / price)) : 0;
      for (let q = 0; q <= max; q++) { units[i] = q; visit(i + 1, remaining - q * price); }
    };
    visit(0, limit);
  } else {
    const seed = computeRebalance(asCategories(positions), mode === 'target' ? theoreticalMinimum : limit);
    consider(seed.lines.map((l, i) => positions[i]?.price ? Math.floor(l.injected / (positions[i]?.price ?? 1)) : 0));
    // Coordinate additions, removals and swaps avoid buying merely to spend the cash.
    for (let pass = 0; pass < 150; pass++) {
      const before = chosen.join(',');
      const start = [...chosen];
      for (let i = 0; i < positions.length; i++) {
        for (const delta of [-1, 1]) {
          const next = [...start]; next[i] = (next[i] ?? 0) + delta;
          if ((next[i] ?? 0) < 0 || (next[i] ?? 0) > (counts[i] ?? 0)) continue;
          try { consider(next); } catch { /* Unaffordable candidate. */ }
        }
        if ((start[i] ?? 0) === 0) continue;
        for (let j = 0; j < positions.length; j++) {
          if (i === j) continue;
          const next = [...start]; next[i] = (next[i] ?? 0) - 1; next[j] = (next[j] ?? 0) + 1;
          if ((next[j] ?? 0) > (counts[j] ?? 0)) continue;
          try { consider(next); } catch { /* Unaffordable candidate. */ }
        }
      }
      if (chosen.join(',') === before) break;
    }
  }
  return { ...best, units: chosen, valid, exhaustive, limit, theoreticalMinimum, toleranceReached: best.finalTotal > 0 && best.maxGap <= TARGET_TOLERANCE_PP, continuous };
}