import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { refreshMarket } from "./market.functions";
import { applyMarket, needsRefresh, toInput } from "./market-merge";
import type { Wealth } from "./wealth";

/** Refreshes market quotes for non-ETF holdings; on failure the last valid prices stay in place. */
export function useMarket(wealth: Wealth, ready: boolean, commit: (f: (w: Wealth) => Wealth) => void) {
  const call = useServerFn(refreshMarket);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const running = useRef(false);
  const refresh = useCallback(async (ids?: string[], symbols?: Record<string, string | null>) => {
    if (!ready || running.current) return;
    const items = wealth.holdings.filter(h => !ids || ids.includes(h.id)).map(toInput).map(i => symbols && i.id in symbols ? { ...i, userSymbol: symbols[i.id] ?? null } : i);
    if (!items.length) return;
    running.current = true; setBusy(ids?.length === 1 ? ids[0]! : "all"); setMessage("");
    try {
      const out = await call({ data: { items } });
      commit(w => applyMarket(w, out.results, out.fx, out.fxError, out.at));
      const errs = out.results.filter(r => r.error).length;
      setMessage(`${out.results.length - errs} instrument(s) contrôlé(s)${errs ? `, ${errs} en erreur (derniers cours conservés)` : ""}${out.fxError ? " ; taux BCE indisponibles" : ""}.`);
    } catch (e) {
      setMessage(`Actualisation impossible : ${e instanceof Error ? e.message : "erreur réseau"}. Derniers cours valides conservés.`);
      try { commit(w => ({ ...w, marketMeta: { lastSuccess: w.marketMeta?.lastSuccess ?? null, fxDate: w.marketMeta?.fxDate ?? null, lastAttempt: new Date().toISOString(), lastFailure: new Date().toISOString(), lastError: "Service de cotation injoignable" } })); } catch { /* read-only */ }
    } finally { running.current = false; setBusy(null); }
  }, [ready, wealth.holdings, call, commit]);
  const auto = useRef(false);
  useEffect(() => { if (ready && !auto.current) { auto.current = true; if (needsRefresh(wealth, Date.now())) void refresh(); } }, [ready, wealth, refresh]);
  return { refresh, busy, message };
}
