import { readCompleteBackup } from "./backup-restoration";
import { atomicLocalWrite, snapshot, type LocalStorageAccess } from "./local-transaction";
import { validateRegistry, readRegistry, REGISTRY_KEY, type FinancialRegistry } from "./financial-registry";

/** Recheck current browser references, download verified complete backup, then journal only the independent registry. */
export function writeRegistry(storage: LocalStorageAccess, update: (r: FinancialRegistry) => FinancialRegistry, expected: Record<string, string | null>, download: (content: string, name: string) => void) {
  const safety = readCompleteBackup(storage);
  const next = validateRegistry(update(readRegistry(storage)), safety.backup.portfolio, safety.backup.wealth);
  if (JSON.stringify(snapshot(storage)) !== JSON.stringify(expected)) throw new Error("Les données ont changé : rechargez avant d’enregistrer.");
  download(safety.content, safety.filename);
  atomicLocalWrite(storage, { [REGISTRY_KEY]: JSON.stringify(next) }, safety.content, expected);
  return next;
}