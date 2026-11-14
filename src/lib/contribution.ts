import { computeRebalance, type Category } from "./rebalance";
import { analyse, simulateContribution, unifiedLines, ETF_ACCOUNT, ETF_CLASS, type Holding, type Wealth } from "./wealth";
import type { Portfolio } from "./portfolio";
import { wholeUnitProposal } from "./whole-unit";

/** Value of the account selector for the global optimisation. */
export const ALL_ACCOUNTS = "all";

export interface AllocationCell { accountId: string; classId: string; target: number; value: number; }
export interface CellSplit { accountId: string; classId: string; value: number; }
type Analysis = ReturnType<typeof analyse>;
type IdValue = { id: string; value: number };

/**
 * Joint account × class cells from the validated mapping (cell targets sum to 100 %).
 * Holdings outside every mapped cell are reported separately: their weight can only shrink by dilution.
 */
export function allocationCells(portfolio: Portfolio, w: Wealth): { cells: AllocationCell[]; unmapped: { name: string; value: number }[] } {
  const mapped = w.mapping.filter(m => m.target > 0);
  const values = new Map<string, number>();
  const unmapped: { name: string; value: number }[] = [];
  for (const l of unifiedLines(portfolio, w)) {
    if (l.value <= 0) continue;
    if (mapped.some(m => m.accountId === l.accountId && m.classId === l.classId)) {
      const key = `${l.accountId}|${l.classId}`;
      values.set(key, (values.get(key) ?? 0) + l.value);
    } else unmapped.push({ name: l.name, value: l.value });
  }
  return { cells: mapped.map(m => ({ accountId: m.accountId, classId: m.classId, target: m.target, value: values.get(`${m.accountId}|${m.classId}`) ?? 0 })), unmapped };
}

const cellCategories = (cells: AllocationCell[]): Category[] => cells.map(c => ({ id: `${c.accountId}|${c.classId}`, name: `${c.accountId}|${c.classId}`, value: c.value, target: c.target }));

/** Simulated value-only holdings, one per cell with a positive injection; never persisted. */
const simHoldings = (split: CellSplit[]): Holding[] => split.filter(s => s.value > 1e-9).map(s => ({ id: `sim-${s.accountId}-${s.classId}`, name: "Apport simulé", isin: "", ticker: "", exchange: "", accountId: s.accountId, classId: s.classId, kind: "value", currency: "EUR", quantity: 0, price: null, fxRate: 1, fractional: false, value: s.value, priceDate: null }));

function aggregate(split: CellSplit[]) {
  const byAccount = new Map<string, number>(); const byClass = new Map<string, number>();
  for (const s of split) { byAccount.set(s.accountId, (byAccount.get(s.accountId) ?? 0) + s.value); byClass.set(s.classId, (byClass.get(s.classId) ?? 0) + s.value); }
  return { byAccount: [...byAccount.entries()].map(([id, value]) => ({ id, value })), byClass: [...byClass.entries()].map(([id, value]) => ({ id, value })) };
}

/**
 * Buy-only split of an amount across every account. Candidates: joint water-filling on the
 * account × class targets (reuses computeRebalance) plus each single-account split (reuses
 * simulateContribution). The candidate with the best displayed equilibrium score wins, so the
 * global optimisation is never worse than the best single account; ties prefer fewer operations.
 */
export function optimizeAllAccounts(portfolio: Portfolio, w: Wealth, amount: number) {
  const { cells, unmapped } = allocationCells(portfolio, w);
  const safe = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const before = analyse(portfolio, w);
  const project = (split: CellSplit[]) => analyse(portfolio, { ...w, holdings: [...w.holdings, ...simHoldings(split)] });
  const joint: CellSplit[] = computeRebalance(cellCategories(cells), safe).lines.map((l, i) => ({ accountId: cells[i]!.accountId, classId: cells[i]!.classId, value: l.injected }));
  const candidates: CellSplit[][] = [joint];
  for (const acc of w.accounts) {
    const s = simulateContribution(portfolio, w, safe, acc.id);
    if (s.unallocated > 0) continue;
    candidates.push(s.split.filter(x => x.value > 1e-9).map(x => ({ accountId: acc.id, classId: x.classId, value: x.value })));
  }
  let split = joint; let after = project(joint);
  for (const candidate of candidates.slice(1)) {
    const projected = project(candidate);
    const score = projected.score ?? -1; const bestScore = after.score ?? -1;
    const ops = candidate.filter(x => x.value > 0.005).length; const bestOps = split.filter(x => x.value > 0.005).length;
    if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && ops < bestOps)) { split = candidate; after = projected; }
  }
  return { before, after, split, ...aggregate(split), unallocated: cells.length ? 0 : safe, unmapped };
}

/**
 * Minimal buy-only injection reaching the joint targets exactly (theoretical), plus the
 * whole-unit investable version: only the PEA ETF cell is constrained to integer shares,
 * other classes accept any amount. Nothing is sold; overweight cells are diluted.
 */
export function minimalToTargets(portfolio: Portfolio, w: Wealth) {
  const { cells, unmapped } = allocationCells(portfolio, w);
  const before = analyse(portfolio, w);
  const base = computeRebalance(cellCategories(cells), 0);
  const theoretical = Number.isFinite(base.minInjection) ? base.minInjection : null;
  if (theoretical === null || unmapped.length > 0 || cells.length === 0) {
    return { before, possible: false as const, theoretical, unmapped, split: [] as CellSplit[], byAccount: [] as IdValue[], byClass: [] as IdValue[], after: before, investable: null, etfPlan: null };
  }
  const optimal = computeRebalance(cellCategories(cells), theoretical);
  const split: CellSplit[] = optimal.lines.map((l, i) => ({ accountId: cells[i]!.accountId, classId: cells[i]!.classId, value: l.injected }));
  const after = analyse(portfolio, { ...w, holdings: [...w.holdings, ...simHoldings(split)] });
  const etfCell = split.find(s => s.accountId === ETF_ACCOUNT && s.classId === ETF_CLASS);
  let investable: { amount: number; leftover: number; split: CellSplit[]; byAccount: IdValue[]; byClass: IdValue[]; after: Analysis } | null = null;
  let etfPlan: ReturnType<typeof wholeUnitProposal> | null = null;
  if (etfCell && etfCell.value > 1e-9) {
    try {
      const plan = wholeUnitProposal(portfolio.positions, etfCell.value, "budget");
      if (plan.valid) {
        etfPlan = plan;
        const realSplit = split.map(s => s === etfCell ? { ...s, value: plan.spent } : s);
        const invested = realSplit.reduce((t, s) => t + s.value, 0);
        investable = { amount: invested, leftover: Math.max(0, theoretical - invested), split: realSplit, ...aggregate(realSplit), after: analyse(portfolio, { ...w, holdings: [...w.holdings, ...simHoldings(realSplit)] }) };
      }
    } catch { etfPlan = null; investable = null; }
  } else {
    investable = { amount: theoretical, leftover: 0, split, ...aggregate(split), after };
  }
  return { before, possible: true as const, theoretical, unmapped, split, ...aggregate(split), after, investable, etfPlan };
}
