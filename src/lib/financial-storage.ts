import { readCompleteBackup } from "./backup-restoration";
import { atomicLocalWrite, snapshot, type LocalStorageAccess } from "./local-transaction";
import { validateRegistry, readRegistry, visibleInstruments, emptyRegistry, REGISTRY_KEY, type FinancialRegistry } from "./financial-registry";
import { assertNoNewIdentityIssues } from "./business-guards";

/** Recheck current browser references, download verified complete backup, then journal only the independent registry. */
export function writeRegistry(storage: LocalStorageAccess, update: (r: FinancialRegistry) => FinancialRegistry, expected: Record<string, string | null>, download: (content: string, name: string) => void) {
  const safety = readCompleteBackup(storage);
  const before = readRegistry(storage);
  const next = validateRegistry(update(before), safety.backup.portfolio, safety.backup.wealth, true);
  const p = safety.backup.portfolio, w = safety.backup.wealth;
  assertNoNewIdentityIssues({ p, w, r: before }, { p, w, r: next });
  for (const i of next.instruments.filter(x => x.legacyRef)) {
    if (before.instruments.some(old => JSON.stringify(old) === JSON.stringify(i))) continue;
    const original = visibleInstruments(emptyRegistry(), p, w).find(x => x.id === i.legacyRef);
    if (!original || ["id", "accountId", "isin", "ticker", "exchange", "currency", "type", "quantity", "mode", "classId"].some(k => original[k as keyof typeof original] !== i[k as keyof typeof i])) throw new Error("Identité, quantité et cotation existantes protégées.");
  }
  if (before.valuations.some(v => !next.valuations.some(n => JSON.stringify(n) === JSON.stringify(v)))) throw new Error("Les valorisations précédentes ne peuvent pas être supprimées ou écrasées.");
  if (before.accounts.some(a => !next.accounts.some(n => n.id === a.id)) || before.instruments.some(i => !next.instruments.some(n => n.id === i.id))) throw new Error("Désactivez les comptes et instruments ; leur suppression est interdite.");
  for (const i of before.instruments) if (next.instruments.find(n => n.id === i.id)?.accountId !== i.accountId && before.valuations.some(v => v.instrumentId === i.id)) throw new Error("Compte associé protégé : des valorisations existent.");
  const incoming = next.valuations.filter(v => !before.valuations.some(old => old.id === v.id));
  for (const old of before.instruments) if (safety.backup.ledger.events.some(e => e.instrumentId === old.id)) {
    const i = next.instruments.find(x => x.id === old.id);
    if (!i || i.isin !== old.isin || i.accountId !== old.accountId) throw new Error("Instrument référencé par les opérations : identité et compte protégés.");
  }
  if (incoming.some(v => !next.accounts.some(a => a.id === v.accountId && a.active) && !["pea", "cto"].includes(v.accountId))) throw new Error("Compte inactif : valorisation refusée.");
  if (JSON.stringify(snapshot(storage)) !== JSON.stringify(expected)) throw new Error("Les données ont changé : rechargez avant d’enregistrer.");
  download(safety.content, safety.filename);
  atomicLocalWrite(storage, { [REGISTRY_KEY]: JSON.stringify(next) }, safety.content, expected);
  return next;
}