import { z } from "zod";
import { parseFullBackup, readFullBackup, THEME_STORAGE_KEY, type FullBackup } from "./full-backup";
import { parseBackup, PORTFOLIO_KEY, SIMULATIONS_KEY, type Backup } from "./portfolio";
import { WEALTH_KEY } from "./wealth";
import { ledgerSchema, readLedger, LEDGER_KEY, eventKey, referenceKey, type Ledger } from "./ledger";
import { atomicLocalWrite, snapshot, type LocalStorageAccess } from "./local-transaction";

export type CompleteBackup = Omit<FullBackup, "version"> & { version: 2; ledger: Ledger };
export function generateCompleteBackup(base: FullBackup, ledger: Ledger) {
  const backup: CompleteBackup = { ...base, version: 2, ledger: ledgerSchema.parse(ledger) };
  const content = JSON.stringify(backup, null, 2);
  parseRestoration(content);
  return { backup, content, filename: `equilibre-patrimoine-complet-v2-${base.exportedAt.replace(/[:.]/g, "-")}.json` };
}
export function readCompleteBackup(storage: Pick<Storage, "getItem">) {
  const old = readFullBackup(storage);
  return { ...generateCompleteBackup(old.backup, readLedger(storage)), warnings: old.warnings };
}
export type Restoration = { kind: "complete-v2"; backup: CompleteBackup } | { kind: "complete-v1"; backup: FullBackup } | { kind: "etf-v1"; backup: Backup };
export function parseRestoration(raw: string): Restoration {
  const b: unknown = JSON.parse(raw);
  const header = z.object({ format: z.string(), version: z.number() }).parse(b);
  if (header.format === "equilibre-backup" && header.version === 1) return { kind: "etf-v1", backup: parseBackup(raw) };
  if (header.format !== "equilibre-full-backup") throw new Error("Format non reconnu.");
  if (header.version === 1) return { kind: "complete-v1", backup: parseFullBackup(raw) };
  if (header.version !== 2 || !b || typeof b !== "object") throw new Error("Version non compatible.");
  const { ledger, ...base } = b as Record<string, unknown>;
  const checked = ledgerSchema.parse(ledger);
  const previous = parseFullBackup(JSON.stringify({ ...base, version: 1 }));
  const accounts = new Set(previous.wealth.accounts.map(a => a.id));
  if (checked.events.some(e => !accounts.has(e.accountId))) throw new Error("Grand livre : compte inconnu.");
  // Historical ISINs/instrument ids are independent and may refer to sold/deleted positions.
  return { kind: "complete-v2", backup: { ...previous, version: 2, ledger: checked } };
}
export function restoreBackup(storage: LocalStorageAccess, pending: Restoration, expected?: Record<string, string | null>) {
  // Revalidate at the write boundary, even when called without the file chooser.
  const checked = parseRestoration(JSON.stringify(pending.backup));
  const safety = readCompleteBackup(storage);
  const b = checked.backup;
  const values: Record<string, string | null> = { [PORTFOLIO_KEY]: JSON.stringify(b.portfolio), [SIMULATIONS_KEY]: JSON.stringify(b.simulations) };
  if (checked.kind !== "etf-v1") {
    values[WEALTH_KEY] = JSON.stringify(checked.backup.wealth); values[THEME_STORAGE_KEY] = checked.backup.theme;
    values[LEDGER_KEY] = checked.kind === "complete-v2" ? JSON.stringify(checked.backup.ledger) : storage.getItem(LEDGER_KEY);
    // A legacy file cannot delete or silently orphan the independent ledger.
    if (checked.kind === "complete-v1" && readLedger(storage).events.some(e => !checked.backup.wealth.accounts.some(a => a.id === e.accountId))) throw new Error("Sauvegarde v1 incompatible avec les comptes du grand livre actuel.");
  }
  atomicLocalWrite(storage, values, safety.content, expected);
  return safety;
}
export function appendLedger(storage: LocalStorageAccess, ledger: Ledger, expected: Record<string, string | null>) {
  const safety = readCompleteBackup(storage);
  const next = ledgerSchema.parse(ledger);
  generateCompleteBackup({ ...safety.backup, version: 1 }, next);
  const keys = next.events.map(eventKey);
  const refs = next.events.flatMap(e => { const key = referenceKey(e); return key ? [key] : []; });
  if (new Set(keys).size !== keys.length || new Set(refs).size !== refs.length) throw new Error("Doublons dans le grand livre : enregistrement refusé.");
  const before = readLedger(storage);
  if (before.events.some(e => !next.events.some(n => JSON.stringify(n) === JSON.stringify(e)))) throw new Error("Import refusé : un événement existant serait modifié ou supprimé.");
  atomicLocalWrite(storage, { [LEDGER_KEY]: JSON.stringify(next) }, safety.content, expected);
}
export { snapshot };