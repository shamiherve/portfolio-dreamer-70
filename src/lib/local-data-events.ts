/** One notification channel for verified local writes; storage remains the authority. */
export const LOCAL_DATA_EVENT = "equilibre-local-data-changed";
export function notifyLocalData(keys: readonly string[]) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(LOCAL_DATA_EVENT, { detail: keys }));
}
export function subscribeLocalData(keys: readonly string[], read: () => void) {
  const local = (e: Event) => { const changed: unknown = (e as CustomEvent).detail; if (!Array.isArray(changed) || changed.some(k => keys.includes(k))) read(); };
  const external = (e: StorageEvent) => { if (e.key === null || keys.includes(e.key)) read(); };
  window.addEventListener(LOCAL_DATA_EVENT, local);
  window.addEventListener("storage", external);
  window.addEventListener("focus", read);
  return () => { window.removeEventListener(LOCAL_DATA_EVENT, local); window.removeEventListener("storage", external); window.removeEventListener("focus", read); };
}