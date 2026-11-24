import { analyse, type Wealth } from "./wealth";
import type { Portfolio } from "./portfolio";
import { cashSummary, type Ledger } from "./ledger";
import { buildMoves } from "./performance";
import { registryTotal, visibleAccounts, type FinancialRegistry } from "./financial-registry";

/** Current positions and reconstructed cash are distinct sources; never replace saved quantities with incomplete history. */
export function financialSummary(p: Portfolio, w: Wealth, r: FinancialRegistry, ledger: Ledger, date: string) {
  const { moves, issues } = buildMoves(ledger.events.filter(e => e.operationDate <= date), { ...p, transactions: p.transactions.filter(t => t.date <= date) });
  const accounts = visibleAccounts(r, w).map(a => {
    const supported = a.id === "pea" || a.id === "cto";
    const selected = moves.filter(m => m.account === a.id);
    const byCurrency = cashSummary(ledger.events.filter(e => e.operationDate <= date), a.id);
    const cash = supported ? (selected.length && !ledger.events.some(e => e.accountId === a.id && e.operationDate <= date && e.currency !== "EUR") ? selected.reduce((sum, m) => sum + m.cash, 0) : null) : (byCurrency.length === 1 && byCurrency[0]?.currency === "EUR" ? byCurrency[0].balance : null);
    return { account: a, cash: cash === null ? null : Math.round(cash * 100) / 100 };
  });
  const allocationValue = analyse(p, w).total;
  const additionalValue = registryTotal(r, w, date);
  const knownCash = accounts.reduce((sum, a) => sum + (a.cash ?? 0), 0);
  return { accounts, allocationValue, additionalValue, knownCash, total: allocationValue + additionalValue + knownCash, issues };
}