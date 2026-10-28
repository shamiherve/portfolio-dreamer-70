import { useEffect, useState } from "react";
import { initialPortfolio, portfolioSchema, PORTFOLIO_KEY, SIMULATIONS_KEY, type Portfolio, type Backup } from "./portfolio";

export function usePortfolio() {
  const [portfolio, setPortfolio] = useState<Portfolio>(initialPortfolio);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PORTFOLIO_KEY);
      if (raw) setPortfolio(portfolioSchema.parse(JSON.parse(raw)));
    } catch { setError("Les données locales ne peuvent pas être lues. Elles n’ont pas été remplacées. Importez une sauvegarde valide."); }
    setHydrated(true);
  }, []);
  function commit(next: Portfolio) {
    if (!hydrated) throw new Error("Chargement en cours.");
    const checked = portfolioSchema.parse(next);
    try { localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(checked)); }
    catch { throw new Error("Enregistrement impossible dans ce navigateur. Exportez votre sauvegarde."); }
    setPortfolio(checked); setError(null);
  }
  function restore(backup: Backup) {
    const oldPortfolio = localStorage.getItem(PORTFOLIO_KEY);
    const oldSimulations = localStorage.getItem(SIMULATIONS_KEY);
    try {
      localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(backup.portfolio));
      localStorage.setItem(SIMULATIONS_KEY, JSON.stringify(backup.simulations));
    } catch {
      try {
        if (oldPortfolio === null) localStorage.removeItem(PORTFOLIO_KEY); else localStorage.setItem(PORTFOLIO_KEY, oldPortfolio);
        if (oldSimulations === null) localStorage.removeItem(SIMULATIONS_KEY); else localStorage.setItem(SIMULATIONS_KEY, oldSimulations);
      } catch { /* Keep original in-memory state and report failed storage. */ }
      throw new Error("La sauvegarde n’a pas pu être enregistrée.");
    }
    setPortfolio(backup.portfolio); setError(null);
  }
  return { portfolio, hydrated, error, commit, restore };
}