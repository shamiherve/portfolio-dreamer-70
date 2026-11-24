import { useEffect, useRef, useState } from "react";
import { initialWealth, renameAccounts, renameClasses, wealthSchema, WEALTH_KEY, type Wealth } from "./wealth";
import { assertNoPendingTransaction, recoverLocalTransaction } from "./local-transaction";

/** Separate local key: never touches the ETF portfolio record. */
export function useWealth() {
  const [wealth, setWealth] = useState<Wealth>(initialWealth);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(wealth);
  const [readOnly, setReadOnly] = useState(false);
  useEffect(() => {
    try { recoverLocalTransaction(localStorage); const raw = localStorage.getItem(WEALTH_KEY); if (raw) { const w = renameAccounts(renameClasses(wealthSchema.parse(JSON.parse(raw)))); localStorage.setItem(WEALTH_KEY, JSON.stringify(w)); current.current = w; setWealth(w); } }
    catch { setReadOnly(true); setError("Les données patrimoniales locales sont illisibles ; elles n’ont pas été remplacées."); }
    setHydrated(true);
  }, []);
  function commit(next: (w: Wealth) => Wealth) {
    if (!hydrated || readOnly) throw new Error("Enregistrement indisponible.");
    assertNoPendingTransaction(localStorage);
    const checked = wealthSchema.parse({ ...next(current.current), updatedAt: new Date().toISOString() });
    localStorage.setItem(WEALTH_KEY, JSON.stringify(checked));
    current.current = checked; setWealth(checked);
  }
  return { wealth, hydrated, error, commit };
}
