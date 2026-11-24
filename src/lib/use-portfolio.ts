import { useMemo } from "react";
import { initialPortfolio, portfolioSchema, PORTFOLIO_KEY, type Portfolio, type Backup } from "./portfolio";
import { assertNoPendingTransaction } from "./local-transaction";
import { restoreBackup } from "./backup-restoration";
import { readLedger } from "./ledger";
import { initialWealth, wealthSchema, WEALTH_KEY } from "./wealth";
import { readRegistry } from "./financial-registry";
import { useFinancialRegistry } from "./use-financial-registry";
import { portfolioLabels } from "./canonical-labels";
import { assertNoNewIdentityIssues, assertPortfolioChange } from "./business-guards";
import { useLocalRecord } from "./use-local-record";
import { notifyLocalData } from "./local-data-events";

export function usePortfolio() {
  const local = useLocalRecord(PORTFOLIO_KEY, initialPortfolio, raw => portfolioSchema.parse(raw), "Les données ETF sont illisibles ; elles n’ont pas été remplacées.");
  const registry = useFinancialRegistry();
  const portfolio = useMemo(() => portfolioLabels(local.value, registry.registry), [local.value, registry.registry]);
  function commit(next: Portfolio | ((current: Portfolio) => Portfolio)) {
    if (!local.ready || local.error || registry.error) throw new Error("Enregistrement indisponible : données non chargées ou illisibles.");
    assertNoPendingTransaction(localStorage);
    const raw = localStorage.getItem(PORTFOLIO_KEY);
    const before = raw === null ? initialPortfolio() : portfolioSchema.parse(JSON.parse(raw));
    const r = readRegistry(localStorage);
    const checked = portfolioSchema.parse(typeof next === "function" ? next(before) : next);
    const wraw = localStorage.getItem(WEALTH_KEY);
    const w = wraw === null ? initialWealth() : wealthSchema.parse(JSON.parse(wraw));
    assertPortfolioChange(before, checked, readLedger(localStorage).events);
    assertNoNewIdentityIssues({ p: before, w, r }, { p: checked, w, r });
    localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(checked));
    notifyLocalData([PORTFOLIO_KEY]);
  }
  function restore(backup: Backup) {
    if (!local.ready) throw new Error("Chargement en cours.");
    restoreBackup(localStorage, { kind: "etf-v1", backup });
  }
  return { portfolio, hydrated: local.ready && registry.ready, error: local.error ?? registry.error, commit, restore };
}
