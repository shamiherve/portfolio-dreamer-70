import { useCallback, useEffect, useRef, useState } from "react";
import { fetchQuotes, mergeQuotes } from "./euronext-quotes";
import type { Portfolio } from "./portfolio";

export function useQuotes(ready: boolean, blocked: boolean, commit: (next: Portfolio | ((p: Portfolio) => Portfolio)) => void) {
  const commitRef = useRef(commit);
  useEffect(() => { commitRef.current = commit; }, [commit]);
  const request = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => {
    if (!ready || blocked || request.current) return;
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    setLoading(true); setFailed(false); setStatus("");
    try {
      const { quotes, rejected } = await fetchQuotes(controller.signal);
      if (controller.signal.aborted) return;
      let text = "";
      commitRef.current(current => {
        const result = mergeQuotes(current, quotes, new Date().toISOString());
        text = `${result.matched.length} ETF actualisé(s).${result.preserved.length || rejected.length ? " Certains cours sont absents, invalides ou plus anciens : derniers cours conservés." : ""}`;
        return result.portfolio;
      });
      setStatus(text);
    } catch (err) {
      setFailed(true);
      setStatus(`${err instanceof Error && err.name !== "AbortError" ? err.message : "Délai de connexion dépassé."} Derniers cours conservés ; la saisie manuelle reste disponible.`);
    } finally {
      clearTimeout(timer);
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }, [ready, blocked]);
  useEffect(() => {
    if (ready && !blocked) void refresh();
    return () => { request.current?.abort(); request.current = null; };
  }, [ready, blocked, refresh]);
  return { refresh, loading, status, failed };
}