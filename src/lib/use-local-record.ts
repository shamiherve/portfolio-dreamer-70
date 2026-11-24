import { useEffect, useState } from "react";
import { recoverLocalTransaction } from "./local-transaction";
import { subscribeLocalData } from "./local-data-events";

/** Hydrate and subscribe without persisting defaults, normalisations or derived views. */
export function useLocalRecord<T>(key: string, initial: () => T, parse: (raw: unknown) => T, message: string) {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let last: string | null | undefined;
    const read = () => {
      try {
        recoverLocalTransaction(localStorage);
        const raw = localStorage.getItem(key);
        if (raw !== last) { const next = raw === null ? initial() : parse(JSON.parse(raw)); last = raw; setValue(next); }
        setError(null);
      } catch { setError(message); }
      setReady(true);
    };
    read(); return subscribeLocalData([key], read);
    // Parser and initial factories are fixed contracts for each key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { value, ready, error, setValue };
}
