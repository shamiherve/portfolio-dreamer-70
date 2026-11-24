import { useMemo } from "react";
import { initialWealth, renameAccounts, renameClasses, wealthSchema, WEALTH_KEY, type Wealth } from "./wealth";
import { initialPortfolio, portfolioSchema, PORTFOLIO_KEY } from "./portfolio";
import { assertNoPendingTransaction } from "./local-transaction";
import { readLedger } from "./ledger";
import { readRegistry } from "./financial-registry";
import { useFinancialRegistry } from "./use-financial-registry";
import { wealthLabels } from "./canonical-labels";
import { assertNoNewIdentityIssues, assertWealthChange } from "./business-guards";
import { useLocalRecord } from "./use-local-record";
import { notifyLocalData } from "./local-data-events";

export function useWealth() {
  const local = useLocalRecord(WEALTH_KEY, initialWealth, raw => wealthSchema.parse(raw), "Les données patrimoniales locales sont illisibles ; elles n’ont pas été remplacées.");
  const registry = useFinancialRegistry();
  const wealth = useMemo(() => wealthLabels(renameAccounts(renameClasses(local.value)), registry.registry), [local.value, registry.registry]);
  function commit(next: (w: Wealth) => Wealth) {
    if (!local.ready || local.error || registry.error) throw new Error("Enregistrement indisponible.");
    assertNoPendingTransaction(localStorage);
    const raw = localStorage.getItem(WEALTH_KEY);
    const before = raw === null ? initialWealth() : wealthSchema.parse(JSON.parse(raw));
    const checked = wealthSchema.parse({ ...next(before), updatedAt: new Date().toISOString() });
    const praw = localStorage.getItem(PORTFOLIO_KEY);
    const p = praw === null ? initialPortfolio() : portfolioSchema.parse(JSON.parse(praw));
    const r = readRegistry(localStorage);
    assertWealthChange(before, checked, readLedger(localStorage).events);
    assertNoNewIdentityIssues({ p, w: before, r }, { p, w: checked, r });
    localStorage.setItem(WEALTH_KEY, JSON.stringify(checked));
    notifyLocalData([WEALTH_KEY]);
  }
  return { wealth, hydrated: local.ready && registry.ready, error: local.error ?? registry.error, commit };
}
