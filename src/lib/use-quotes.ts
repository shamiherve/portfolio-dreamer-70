import { useCallback, useEffect, useRef, useState } from "react";
import { fetchQuotes, mergeQuotes } from "./euronext-quotes";
import type { Portfolio } from "./portfolio";

const CACHE_DURATION = 15 * 60 * 1000;
const REQUEST_TIMEOUT = 15000;

type QuoteResult = Awaited<ReturnType<typeof fetchQuotes>>;

// Cache partagé entre les deux tableaux de bord.
let cachedResult: QuoteResult | null = null;
let cachedAt = 0;
let pendingRequest: Promise<QuoteResult> | null = null;

// Une seule requête réseau à la fois pour toute l'application.
async function getQuotes(force = false): Promise<QuoteResult> {
  if (
    !force &&
    cachedResult &&
    Date.now() - cachedAt < CACHE_DURATION
  ) {
    return cachedResult;
  }

  // Si une requête est déjà en cours, on la partage.
  if (pendingRequest) {
    return pendingRequest;
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT
  );

  let request: Promise<QuoteResult>;

  request = fetchQuotes(controller.signal)
    .then(result => {
      cachedResult = result;
      cachedAt = Date.now();
      return result;
    })
    .finally(() => {
      clearTimeout(timer);

      if (pendingRequest === request) {
        pendingRequest = null;
      }
    });

  pendingRequest = request;

  return request;
}

export function useQuotes(
  ready: boolean,
  blocked: boolean,
  commit: (next: Portfolio | ((p: Portfolio) => Portfolio)) => void
) {
  const commitRef = useRef(commit);
  const mountedRef = useRef(false);

  const optionsRef = useRef({ ready, blocked });
  optionsRef.current = { ready, blocked };

  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async (force = false) => {
    if (!ready || blocked) return;

    setLoading(true);
    setFailed(false);
    setStatus("");

    try {
      const { quotes, rejected } = await getQuotes(force);

      if (
        !mountedRef.current ||
        !optionsRef.current.ready ||
        optionsRef.current.blocked
      ) {
        return;
      }

      let text = "";

      commitRef.current(current => {
        const result = mergeQuotes(
          current,
          quotes,
          new Date().toISOString()
        );

        text = `${result.matched.length} ETF actualisé(s).${
          result.preserved.length || rejected.length
            ? " Certains cours sont absents, invalides ou plus anciens : derniers cours conservés."
            : ""
        }`;

        return result.portfolio;
      });

      setStatus(text);
    } catch (err) {
      if (!mountedRef.current) return;

      setFailed(true);

      setStatus(
        `${
          err instanceof Error && err.name !== "AbortError"
            ? err.message
            : "Délai de connexion dépassé."
        } Derniers cours conservés ; la saisie manuelle reste disponible.`
      );
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [ready, blocked]);

  useEffect(() => {
    mountedRef.current = true;

    if (ready && !blocked) {
      void refresh();
    }

    return () => {
      mountedRef.current = false;
    };
  }, [ready, blocked, refresh]);

  return {
    refresh: () => refresh(true),
    loading,
    status,
    failed
  };
}