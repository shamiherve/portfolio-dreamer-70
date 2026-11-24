import { useCallback, useEffect, useState } from "react";
import type { Category } from "./rebalance";
import { assertNoPendingTransaction, recoverLocalTransaction } from "./local-transaction";
import { simulationsSchema, SIMULATIONS_KEY, makeId } from "./portfolio";
import { notifyLocalData, subscribeLocalData } from "./local-data-events";

export type Simulation = {
  id: string;
  name: string;
  categories: Category[];
  budget: string;
  savedAt: number;
};

const STORAGE_KEY = SIMULATIONS_KEY;

function read(): Simulation[] {
  if (typeof window === "undefined") return [];
  try {
    recoverLocalTransaction(window.localStorage);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return simulationsSchema.parse(parsed);
  } catch {
    throw new Error("Simulations locales illisibles : données conservées, enregistrement bloqué.");
  }
}

export function useSimulations() {
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const refresh = () => { try { setSimulations(read()); setHydrated(true); } catch { setHydrated(false); } };
    refresh(); return subscribeLocalData([STORAGE_KEY], refresh);
  }, []);

  const persist = useCallback((next: Simulation[]) => {
    assertNoPendingTransaction(window.localStorage);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(simulationsSchema.parse(next)));
    notifyLocalData([STORAGE_KEY]);
  }, []);

  const save = useCallback(
    (sim: Omit<Simulation, "id" | "savedAt"> & { id?: string }) => {
      const now = Date.now();
      const current = read();
      const id = sim.id ?? makeId();
      const entry: Simulation = {
        id,
        name: sim.name.trim() || "Simulation sans nom",
        categories: sim.categories,
        budget: sim.budget,
        savedAt: now,
      };
      const exists = current.some((s) => s.id === id);
      const next = exists
        ? current.map((s) => (s.id === id ? entry : s))
        : [entry, ...current];
      persist(next);
      return entry;
    },
    [persist],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      persist(
        read().map((s) =>
          s.id === id ? { ...s, name: name.trim() || s.name } : s,
        ),
      );
    },
    [persist],
  );

  const remove = useCallback(
    (id: string) => {
      persist(read().filter((s) => s.id !== id));
    },
    [persist],
  );

  return { simulations, hydrated, save, rename, remove };
}

export const formatDate = (ts: number) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
