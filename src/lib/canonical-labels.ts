import type { Portfolio } from "./portfolio";
import type { Wealth } from "./wealth";
import type { FinancialRegistry } from "./financial-registry";

/** Registry owns optional labels of legacy references; all numeric sources remain unchanged. */
export function portfolioLabels(p: Portfolio, r: FinancialRegistry): Portfolio {
  return { ...p, positions: p.positions.map(i => ({ ...i, name: r.instruments.find(x => x.legacyRef === `etf:${i.id}`)?.name ?? i.name })) };
}
export function wealthLabels(w: Wealth, r: FinancialRegistry): Wealth {
  return { ...w, accounts: w.accounts.map(a => ({ ...a, name: r.accounts.find(x => x.legacyId === a.id)?.name ?? a.name })), holdings: w.holdings.map(i => ({ ...i, name: r.instruments.find(x => x.legacyRef === `w:${i.id}`)?.name ?? i.name })) };
}