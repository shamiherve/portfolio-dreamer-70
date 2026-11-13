import { useEffect, useRef, useState } from "react";
import { initialWealth, wealthSchema, WEALTH_KEY, type Wealth } from "./wealth";

/** Separate local key: never touches the ETF portfolio record. */
export function useWealth() {
  const [wealth, setWealth] = useState<Wealth>(initialWealth);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(wealth);
  const [readOnly, setReadOnly] = useState(false);
  useEffect(() => {
    try { const raw = localStorage.getItem(WEALTH_KEY); if (raw) { const w = wealthSchema.parse(JSON.parse(raw)); current.current = w; setWealth(w); } }
    catch { setReadOnly(true); setError("Les données patrimoniales locales sont illisibles ; elles n’ont pas été remplacées."); }
    setHydrated(true);
  }, []);
  function commit(next: (w: Wealth) => Wealth) {
    if (!hydrated || readOnly) throw new Error("Enregistrement indisponible.");
    const checked = wealthSchema.parse({ ...next(current.current), updatedAt: new Date().toISOString() });
    localStorage.setItem(WEALTH_KEY, JSON.stringify(checked));
    current.current = checked; setWealth(checked);
  }
  return { wealth, hydrated, error, commit };
}
