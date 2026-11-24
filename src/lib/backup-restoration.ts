import { z } from "zod";
import { parseFullBackup, readFullBackup, THEME_STORAGE_KEY, type FullBackup } from "./full-backup";
import { parseBackup, PORTFOLIO_KEY, SIMULATIONS_KEY, type Backup } from "./portfolio";
import { WEALTH_KEY } from "./wealth";
import { ledgerSchema, readLedger, LEDGER_KEY, eventKey, referenceKey, existingEtf, instruments, splitCheck, type Ledger, type LedgerEvent } from "./ledger";
import type { Portfolio } from "./portfolio";
import { atomicLocalWrite, snapshot, type LocalStorageAccess } from "./local-transaction";
import { readRegistry, validateRegistry, REGISTRY_KEY, type FinancialRegistry } from "./financial-registry";
import { snapshotsSchema, SNAPSHOTS_KEY, type Snapshots } from "./performance";

export type CompleteBackup = Omit<FullBackup, "version"> & { version: 2; ledger: Ledger; financialRegistry?: FinancialRegistry; snapshots?: Snapshots };
export function generateCompleteBackup(base: FullBackup, ledger: Ledger, extras: { financialRegistry?: FinancialRegistry; snapshots?: Snapshots } = {}) {
  const backup: CompleteBackup = { ...base, ...extras, version: 2, ledger: ledgerSchema.parse(ledger) };
  const content = JSON.stringify(backup, null, 2);
  parseRestoration(content);
  return { backup, content, filename: `equilibre-patrimoine-complet-v2-${base.exportedAt.replace(/[:.]/g, "-")}.json` };
}
export function readCompleteBackup(storage: Pick<Storage, "getItem">) {
  const old = readFullBackup(storage);
  const extras: { financialRegistry?: FinancialRegistry; snapshots?: Snapshots } = {};
  if (storage.getItem(REGISTRY_KEY) !== null) extras.financialRegistry = readRegistry(storage);
  const rawSnapshots = storage.getItem(SNAPSHOTS_KEY);
  if (rawSnapshots !== null) extras.snapshots = snapshotsSchema.parse(JSON.parse(rawSnapshots));
  return { ...generateCompleteBackup(old.backup, readLedger(storage), extras), warnings: old.warnings };
}
export type Restoration = { kind: "complete-v2"; backup: CompleteBackup } | { kind: "complete-v1"; backup: FullBackup } | { kind: "etf-v1"; backup: Backup };
export function parseRestoration(raw: string): Restoration {
  const b: unknown = JSON.parse(raw);
  const header = z.object({ format: z.string(), version: z.number() }).parse(b);
  if (header.format === "equilibre-backup" && header.version === 1) return { kind: "etf-v1", backup: parseBackup(raw) };
  if (header.format !== "equilibre-full-backup") throw new Error("Format non reconnu.");
  if (header.version === 1) return { kind: "complete-v1", backup: parseFullBackup(raw) };
  if (header.version !== 2 || !b || typeof b !== "object") throw new Error("Version non compatible.");
  const { ledger, financialRegistry, snapshots, ...base } = b as Record<string, unknown>;
  const checked = ledgerSchema.parse(ledger);
  const previous = parseFullBackup(JSON.stringify({ ...base, version: 1 }));
  const extras: { financialRegistry?: FinancialRegistry; snapshots?: Snapshots } = {};
  if (financialRegistry !== undefined) extras.financialRegistry = validateRegistry(financialRegistry, previous.portfolio, previous.wealth, true);
  const accounts = new Set([...previous.wealth.accounts.map(a => a.id), ...(extras.financialRegistry?.accounts.map(a => a.id) ?? [])]);
  if (checked.events.some(e => !accounts.has(e.accountId))) throw new Error("Grand livre : compte inconnu.");
  // Historical ISINs/instrument ids are independent and may refer to sold/deleted positions.
  if (snapshots !== undefined) extras.snapshots = snapshotsSchema.parse(snapshots);
  return { kind: "complete-v2", backup: { ...previous, ...extras, version: 2, ledger: checked } };
}
export function restoreBackup(storage: LocalStorageAccess, pending: Restoration, expected?: Record<string, string | null>) {
  // Revalidate at the write boundary, even when called without the file chooser.
  const checked = parseRestoration(JSON.stringify(pending.backup));
  const safety = readCompleteBackup(storage);
  const b = checked.backup;
  const values: Record<string, string | null> = { [PORTFOLIO_KEY]: JSON.stringify(b.portfolio), [SIMULATIONS_KEY]: JSON.stringify(b.simulations) };
  // Absent extension sections have an explicit non-destructive legacy scope.
  const incomingRegistry = checked.kind === "complete-v2" ? checked.backup.financialRegistry : undefined;
  validateRegistry(incomingRegistry ?? readRegistry(storage), b.portfolio, checked.kind === "etf-v1" ? safety.backup.wealth : checked.backup.wealth, true);
  values[REGISTRY_KEY] = incomingRegistry ? JSON.stringify(incomingRegistry) : storage.getItem(REGISTRY_KEY);
  values[SNAPSHOTS_KEY] = checked.kind === "complete-v2" && checked.backup.snapshots ? JSON.stringify(checked.backup.snapshots) : storage.getItem(SNAPSHOTS_KEY);
  if (checked.kind !== "etf-v1") {
    values[WEALTH_KEY] = JSON.stringify(checked.backup.wealth); values[THEME_STORAGE_KEY] = checked.backup.theme;
    values[LEDGER_KEY] = checked.kind === "complete-v2" ? JSON.stringify(checked.backup.ledger) : storage.getItem(LEDGER_KEY);
    // A legacy file cannot delete or silently orphan the independent ledger.
    if (checked.kind === "complete-v1" && readLedger(storage).events.some(e => !checked.backup.wealth.accounts.some(a => a.id === e.accountId) && !readRegistry(storage).accounts.some(a => a.id === e.accountId))) throw new Error("Sauvegarde v1 incompatible avec les comptes du grand livre actuel.");
  }
  atomicLocalWrite(storage, values, safety.content, expected);
  return safety;
}
export function appendLedger(storage: LocalStorageAccess, ledger: Ledger, expected: Record<string, string | null>) {
  const safety = readCompleteBackup(storage);
  const next = ledgerSchema.parse(ledger);
  generateCompleteBackup({ ...safety.backup, version: 1 }, next, { ...(safety.backup.financialRegistry ? { financialRegistry: safety.backup.financialRegistry } : {}) });
  const keys = next.events.map(eventKey);
  const refs = next.events.flatMap(e => { const key = referenceKey(e); return key ? [key] : []; });
  if (new Set(keys).size !== keys.length || new Set(refs).size !== refs.length) throw new Error("Doublons dans le grand livre : enregistrement refusé.");
  const before = readLedger(storage);
  if (before.events.some(e => !next.events.some(n => JSON.stringify(n) === JSON.stringify(e)))) throw new Error("Import refusé : un événement existant serait modifié ou supprimé.");
  const known = instruments(safety.backup.portfolio, safety.backup.wealth, safety.backup.financialRegistry);
  const incoming = next.events.filter(e => !before.events.some(old => old.id === e.id));
  for (const e of incoming) assertIncoming(e, before.events, known, safety.backup.portfolio);
  if (incoming.some(e => e.type === "split" && e.isin === "US29082A1079") && splitCheck(next.events).issues.length) throw new Error("Split Embraer incohérent ou répété : écriture refusée.");
  atomicLocalWrite(storage, { [LEDGER_KEY]: JSON.stringify(next) }, safety.content, expected);
}
export function potentialDuplicate(e: LedgerEvent, others: LedgerEvent[]) {
  return others.find(old => old.id !== e.id && old.accountId === e.accountId && old.type === e.type && old.isin === e.isin && old.operationDate === e.operationDate && old.quantity === e.quantity && Math.abs(old.amount - e.amount) <= 0.02 && (old.timestamp === e.timestamp || old.timestamp === null || e.timestamp === null)) ?? null;
}
/** Shared write-boundary checks for imported and manual events. */
export function assertIncoming(e: LedgerEvent, others: LedgerEvent[], known: ReturnType<typeof instruments>, portfolio: Portfolio) {
  if (e.accountId === "pea" && ["buy", "sell", "dividend", "split"].includes(e.type) && known.filter(k => k.accountId === "pea" && k.isin === e.isin && k.id === e.instrumentId).length !== 1) throw new Error("PEA : instrument absent du référentiel local ; écriture refusée.");
  if (existingEtf(e, portfolio)) throw new Error("Transaction ETF déjà présente dans ce navigateur : écriture refusée.");
  if (potentialDuplicate(e, others)) throw new Error("Doublon potentiel dans le grand livre local : écriture refusée.");
}
export { snapshot };