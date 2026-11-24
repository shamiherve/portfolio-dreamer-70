import { emptyRegistry, registrySchema, REGISTRY_KEY } from "./financial-registry";
import { useLocalRecord } from "./use-local-record";

export function useFinancialRegistry() {
  const local = useLocalRecord(REGISTRY_KEY, emptyRegistry, raw => registrySchema.parse(raw), "Comptes et instruments illisibles : données conservées, saisie bloquée.");
  return { registry: local.value, ready: local.ready, error: local.error, setRegistry: local.setValue };
}
