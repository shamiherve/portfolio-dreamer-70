import { useEffect, useState } from "react";
import { readRegistry, emptyRegistry, REGISTRY_KEY, type FinancialRegistry } from "./financial-registry";
import { recoverLocalTransaction } from "./local-transaction";

export function useFinancialRegistry() {
  const [registry, setRegistry] = useState<FinancialRegistry>(emptyRegistry);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const read = () => { try { recoverLocalTransaction(localStorage); setRegistry(readRegistry(localStorage)); setError(null); } catch { setError("Comptes et instruments illisibles : données conservées, saisie bloquée."); } setReady(true); };
    read();
    const changed = (e: StorageEvent) => { if (e.key === REGISTRY_KEY || e.key === null) read(); };
    window.addEventListener("storage", changed); window.addEventListener("financial-registry-changed", read);
    return () => { window.removeEventListener("storage", changed); window.removeEventListener("financial-registry-changed", read); };
  }, []);
  return { registry, ready, error, setRegistry };
}