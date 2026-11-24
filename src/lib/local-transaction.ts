import { z } from "zod";

export const DATA_KEYS = ["equilibre.portfolio.v1", "equilibre.wealth.v1", "equilibre.simulations.v1", "equilibre.theme.v1", "equilibre.ledger.v1"] as const;
export const SAFETY_KEY = "equilibre.safety-backup.v1";
export const JOURNAL_KEY = "equilibre.restore-journal.v1";
export type LocalStorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const snapshotSchema = z.object(Object.fromEntries(DATA_KEYS.map(k => [k, z.string().nullable()]))).strict();
const journalSchema = z.object({ version: z.literal(1), phase: z.enum(["prepared", "committed"]), before: snapshotSchema }).strict();
export function snapshot(storage: Pick<Storage, "getItem">): Record<string, string | null> { return Object.fromEntries(DATA_KEYS.map(k => [k, storage.getItem(k)])); }
function put(storage: LocalStorageAccess, key: string, value: string | null) {
  if (value === null) storage.removeItem(key); else storage.setItem(key, value);
  if (storage.getItem(key) !== value) throw new Error("Écriture locale non vérifiée.");
}
/** Rollback journal is persisted before any data write; interrupted transactions recover before hydration. */
export function recoverLocalTransaction(storage: LocalStorageAccess) {
  const raw = storage.getItem(JOURNAL_KEY);
  if (raw === null) return;
  const journal = journalSchema.parse(JSON.parse(raw));
  if (journal.phase === "prepared") {
    let failed = false;
    for (const key of DATA_KEYS) { try { put(storage, key, journal.before[key] as string | null); } catch { failed = true; } }
    if (failed) throw new Error("Retour arrière incomplet : données bloquées. Libérez de l’espace puis rechargez ; la copie de sécurité est conservée.");
  }
  storage.removeItem(JOURNAL_KEY);
  if (storage.getItem(JOURNAL_KEY) !== null) throw new Error("Journal de récupération bloqué : aucune nouvelle écriture autorisée.");
}
export function assertNoPendingTransaction(storage: Pick<Storage, "getItem">) {
  if (storage.getItem(JOURNAL_KEY) !== null) throw new Error("Récupération en attente : rechargez avant toute modification.");
}
export function atomicLocalWrite(storage: LocalStorageAccess, values: Record<string, string | null>, safetyContent: string, expected?: Record<string, string | null>) {
  assertNoPendingTransaction(storage);
  if (Object.keys(values).some(k => !DATA_KEYS.some(allowed => allowed === k))) throw new Error("Clé non autorisée.");
  const before = snapshot(storage);
  if (expected && JSON.stringify(expected) !== JSON.stringify(before)) throw new Error("Les données ont changé depuis la prévisualisation. Relisez le fichier avant de confirmer.");
  put(storage, SAFETY_KEY, safetyContent);
  put(storage, JOURNAL_KEY, JSON.stringify({ version: 1, phase: "prepared", before }));
  try {
    for (const [key, value] of Object.entries(values)) put(storage, key, value);
    put(storage, JOURNAL_KEY, JSON.stringify({ version: 1, phase: "committed", before }));
  } catch {
    try { recoverLocalTransaction(storage); } catch (e) { throw e; }
    throw new Error("Échec d’enregistrement : retour intégral à l’état précédent vérifié. Copie de sécurité conservée.");
  }
  // Committed journals can be safely cleared on next hydration if cleanup is temporarily unavailable.
  try { storage.removeItem(JOURNAL_KEY); } catch { /* committed, never roll back */ }
}