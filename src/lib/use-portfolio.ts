import { useEffect, useRef, useState } from "react";
import { initialPortfolio, portfolioSchema, PORTFOLIO_KEY, SIMULATIONS_KEY, type Portfolio, type Backup } from "./portfolio";
import { assertNoPendingTransaction, recoverLocalTransaction } from "./local-transaction";
import { restoreBackup } from "./backup-restoration";

export function usePortfolio() {
  const [portfolio, setPortfolio] = useState<Portfolio>(initialPortfolio);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(portfolio);
  useEffect(() => {
    try {
      recoverLocalTransaction(localStorage);
      const raw = localStorage.getItem(PORTFOLIO_KEY);
      if (raw) { const checked = portfolioSchema.parse(JSON.parse(raw)); current.current = checked; setPortfolio(checked); }
    } catch { setError("Les données locales ne peuvent pas être lues. Elles n’ont pas été remplacées. Importez une sauvegarde valide."); }
    setHydrated(true);
  }, []);
  function commit(next: Portfolio | ((current: Portfolio) => Portfolio)) {
    if (!hydrated) throw new Error("Chargement en cours.");
    assertNoPendingTransaction(localStorage);
    const checked = portfolioSchema.parse(typeof next === "function" ? next(current.current) : next);
    try { localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(checked)); }
    catch { throw new Error("Enregistrement impossible dans ce navigateur. Exportez votre sauvegarde."); }
    current.current = checked; setPortfolio(checked); setError(null);
  }
  function restore(backup: Backup) {
    if (!hydrated) throw new Error("Chargement en cours.");
    restoreBackup(localStorage, { kind: "etf-v1", backup });
    current.current = backup.portfolio; setPortfolio(backup.portfolio); setError(null);
  }
  return { portfolio, hydrated, error, commit, restore };
}