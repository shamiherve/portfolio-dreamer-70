import { Link } from "@tanstack/react-router";
import { registryLines, registryTotal, visibleAccounts } from "@/lib/financial-registry";
import { useFinancialRegistry } from "@/lib/use-financial-registry";
import type { Wealth } from "@/lib/wealth";
import { eur } from "@/lib/rebalance";
import { FinancialHistory } from "./financial-history";

export function AdditionalFinancial({ wealth, legacyTotal }: { wealth: Wealth; legacyTotal: number }) {
  const { registry, ready, error } = useFinancialRegistry();
  if (!ready) return null;
  if (error) return <p role="alert" className="text-sm text-destructive">{error} Total étendu indisponible.</p>;
  const date = new Date().toISOString().slice(0, 10);
  const lines = registryLines(registry, wealth, date);
  if (!lines.length) return null;
  const accounts = visibleAccounts(registry, wealth);
  const total = registryTotal(registry, wealth, date);
  return <section className="space-y-4 border-y border-border py-4" aria-label="Nouveaux supports financiers">
    <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-lg font-semibold">Patrimoine financier étendu</h2><Link to="/gestion" className="text-sm underline">Gérer mes comptes et instruments</Link></div>
    <p className="font-mono text-xl">{eur(legacyTotal + total)}</p><p className="text-xs text-muted-foreground">Périmètre existant {eur(legacyTotal)} + nouveaux supports {eur(total)}. Allocations, scores et recommandations restent sur leur périmètre figé.</p>
    <div className="overflow-x-auto"><table className="w-full min-w-[500px] text-left text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="p-2">Compte</th><th className="p-2">Support</th><th className="p-2">Date de valorisation</th><th className="p-2">Valeur €</th></tr></thead><tbody>{lines.map(({ instrument: i, valuation: v }) => <tr key={i.id} className="border-t border-border"><td className="p-2">{accounts.find(a => a.id === i.accountId)?.name}</td><td className="p-2">{i.name}</td><td className="p-2">{v?.date ?? "—"}</td><td className="p-2 font-mono">{v ? eur(v.value) : "Non renseignée (non comptée)"}</td></tr>)}</tbody><tfoot><tr className="border-t border-border"><td colSpan={3} className="p-2">Total des nouveaux supports</td><td className="p-2 font-mono">{eur(total)}</td></tr></tfoot></table></div>
    {accounts.filter(a => lines.some(l => l.instrument.accountId === a.id)).map(a => <p key={a.id} className="text-sm">{a.name} — nouveaux supports : <span className="font-mono">{eur(lines.filter(l => l.instrument.accountId === a.id).reduce((s, l) => s + (l.valuation?.value ?? 0), 0))}</span></p>)}
    <FinancialHistory registry={registry} wealth={wealth} />
  </section>;
}