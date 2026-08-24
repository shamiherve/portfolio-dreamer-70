import { useCallback, useEffect, useState } from "react";
import type { Category } from "./rebalance";

export type Simulation = {
  id: string;
  name: string;
  categories: Category[];
  budget: string;
  savedAt: number;
};

const STORAGE_KEY = "equilibre.simulations.v1";

function read(): Simulation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Simulation[]) : [];
  } catch {
    return [];
  }
}

export function useSimulations() {
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSimulations(read());
    setHydrated(true);
  }, []);

  const persist = useCallback((next: Simulation[]) => {
    setSimulations(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* quota or private mode: ignore */
    }
  }, []);

  const save = useCallback(
    (sim: Omit<Simulation, "id" | "savedAt"> & { id?: string }) => {
      const now = Date.now();
      const current = read();
      const id = sim.id ?? `sim-${now}-${Math.floor(now % 100000)}`;
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
