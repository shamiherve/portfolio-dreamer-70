import { Link } from "@tanstack/react-router";
import { registryLines, visibleAccounts } from "@/lib/financial-registry";
import { useFinancialRegistry } from "@/lib/use-financial-registry";
import type { Wealth } from "@/lib/wealth";
import { eur } from "@/lib/rebalance";
import { FinancialHistory } from "./financial-history";
import { usePortfolio } from "@/lib/use-portfolio";
import { useLocalRecord } from "@/lib/use-local-record";
import { LEDGER_KEY, emptyLedger, ledgerSchema } from "@/lib/ledger";
import { financialSummary } from "@/lib/financial-summary";

export function AdditionalFinancial({ wealth }: { wealth: Wealth }) {
  const { registry, ready, error } = useFinancialRegistry();
  const { portfolio, hydrated, error: pe } = usePortfolio();
  const ledger = useLocalRecord(LEDGER_KEY, emptyLedger, raw => ledgerSchema.parse(raw), "Grand livre illisible : espèces indisponibles.");
  if (!ready || !hydrated || !ledger.ready) return null;
  if (error || pe || ledger.error) return <p role="alert" className="text-sm text-destructive">{error ?? pe ?? ledger.error} Total étendu indisponible.</p>;
  const date = new Date().toISOString().slice(0, 10);
  const lines = registryLines(registry, wealth, date);

  const accounts = visibleAccounts(registry, wealth);
  const summary = financialSummary(portfolio, wealth, registry, ledger.value, date);
  const total = summary.additionalValue;
  return <section className="space-y-4 border-y border-border py-4" aria-label="Nouveaux supports financiers">
    <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-lg font-semibold">Patrimoine financier consolidé</h2><Link to="/gestion" className="text-sm underline">Gérer mes comptes et instruments</Link></div>
    <p className="font-mono text-xl">{eur(summary.total)}</p><p className="text-xs text-muted-foreground">Total connu : positions {eur(summary.allocationValue)} + nouveaux supports {eur(total)} + espèces documentées {eur(summary.knownCash)}. Les espèces absentes du grand livre restent indisponibles, et non supposées nulles. Allocations, scores et recommandations restent sur leur périmètre figé.</p>
    <div className="flex flex-wrap gap-6 text-sm">{summary.accounts.map(({ account: a, cash }) => <p key={a.id}>{a.name} · espèces reconstituées : <strong className="font-mono">{cash === null ? "Indisponibles" : eur(cash)}</strong></p>)}</div>
    {summary.issues.map(i => <p key={i} role="alert" className="text-sm text-warning">{i}</p>)}
    <div className="overflow-x-auto"><table className="w-full min-w-[500px] text-left text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="p-2">Compte</th><th className="p-2">Support</th><th className="p-2">Quantité enregistrée</th><th className="p-2">Date de valorisation</th><th className="p-2">Valeur €</th></tr></thead><tbody>{lines.map(({ instrument: i, valuation: v }) => <tr key={i.id} className="border-t border-border"><td className="p-2">{accounts.find(a => a.id === i.accountId)?.name}</td><td className="p-2">{i.name}</td><td className="p-2 font-mono">{i.quantity}</td><td className="p-2">{v?.date ?? "—"}</td><td className="p-2 font-mono">{v ? eur(v.value) : "Non renseignée (non comptée)"}</td></tr>)}</tbody><tfoot><tr className="border-t border-border"><td colSpan={4} className="p-2">Total des nouveaux supports</td><td className="p-2 font-mono">{eur(total)}</td></tr></tfoot></table></div>
    {accounts.filter(a => lines.some(l => l.instrument.accountId === a.id)).map(a => <p key={a.id} className="text-sm">{a.name} — nouveaux supports : <span className="font-mono">{eur(lines.filter(l => l.instrument.accountId === a.id).reduce((s, l) => s + (l.valuation?.value ?? 0), 0))}</span></p>)}
    <FinancialHistory registry={registry} wealth={wealth} />
  </section>;
}