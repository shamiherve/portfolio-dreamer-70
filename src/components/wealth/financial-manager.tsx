import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Pencil, Power, RefreshCw, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePortfolio } from "@/lib/use-portfolio";
import { useWealth } from "@/lib/use-wealth";
import { useFinancialRegistry } from "@/lib/use-financial-registry";
import { accountTypes, instrumentTypes, visibleAccounts, visibleInstruments, saveAccount, saveInstrument, appendValuation, effectiveValuations, latestValuation, registryTotal, valuationFromQuote, type FinancialRegistry, type FinancialAccount, type FinancialInstrument, type Valuation } from "@/lib/financial-registry";
import { writeRegistry } from "@/lib/financial-storage";
import { snapshot } from "@/lib/local-transaction";
import { refreshMarket } from "@/lib/market.functions";
import { downloadJson } from "@/components/portfolio/target-editor";
import { FullBackupExport } from "@/components/portfolio/full-backup-export";
import { eur } from "@/lib/rebalance";
import { makeId } from "@/lib/portfolio";
import { AccountForm, InstrumentForm, ValuationForm } from "./financial-forms";
import { FinancialHistory } from "./financial-history";

type Editor = { kind: "account"; value: FinancialAccount } | { kind: "instrument"; value: FinancialInstrument } | { kind: "valuation"; value: Valuation; instrument: FinancialInstrument };
type Pending = { label: string; update: (r: FinancialRegistry) => FinancialRegistry };
export function FinancialManager() {
  const { portfolio, hydrated, error: pe } = usePortfolio();
  const { wealth, hydrated: wh, error: we } = useWealth();
  const { registry, ready, error, setRegistry } = useFinancialRegistry();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [expected, setExpected] = useState<Record<string, string | null> | null>(null);
  const [tab, setTab] = useState<"accounts" | "instruments" | "values">("accounts");
  const [msg, setMsg] = useState("");
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const callMarket = useServerFn(refreshMarket);
  if (!hydrated || !wh || !ready) return <p className="p-8">Chargement des données locales…</p>;
  const accounts = visibleAccounts(registry, wealth);
  const instruments = visibleInstruments(registry, portfolio, wealth);
  const blocked = Boolean(error || pe || we || busy);
  const name = (id: string) => accounts.find(a => a.id === id)?.name ?? id;
  function start(e: Editor) { setExpected(snapshot(localStorage)); setEditor(e); setFailure(""); setMsg(""); }
  function apply(update: (r: FinancialRegistry) => FinancialRegistry) {
    if (blocked || !expected) return;
    try {
      const next = writeRegistry(localStorage, update, expected, downloadJson);
      setRegistry(next); window.dispatchEvent(new Event("financial-registry-changed"));
      setEditor(null); setPending(null); setExpected(null); setFailure("");
      setMsg("Enregistré. Sauvegarde complète téléchargée ; positions et objectifs existants inchangés.");
    } catch (e) { setFailure(e instanceof Error ? e.message : "Enregistrement refusé."); }
  }
  function toggleAccount(a: FinancialAccount) { setExpected(snapshot(localStorage)); setPending({ label: `${a.active ? "Désactiver" : "Réactiver"} « ${a.name} » ?`, update: r => saveAccount(r, { ...a, active: !a.active }) }); }
  function toggleInstrument(i: FinancialInstrument) { setExpected(snapshot(localStorage)); setPending({ label: `${i.active ? "Désactiver" : "Réactiver"} « ${i.name} » ?`, update: r => saveInstrument(r, { ...i, active: !i.active }) }); }
  const valuationEditor = (i: FinancialInstrument, old?: Valuation) => start({ kind: "valuation", instrument: i, value: { id: makeId(), instrumentId: i.id, accountId: i.accountId, date: old?.date ?? new Date().toISOString().slice(0, 10), value: old?.value ?? 0, comment: old?.comment ?? "", at: new Date().toISOString(), supersedes: old?.id ?? null, externalFlow: old?.externalFlow ?? null, origin: "manual", quote: null } });
  async function requestQuote(i: FinancialInstrument) {
    const before = snapshot(localStorage); setBusy(true); setFailure("");
    try {
      const result = await callMarket({ data: { items: [{ id: i.id, name: i.name, isin: i.isin, ticker: i.ticker, exchange: i.exchange, currency: i.currency, kind: "quantity", userSymbol: null }] } });
      const q = result.results.find(x => x.id === i.id);
      if (!q) throw new Error("Aucun cours reçu ; valorisation manuelle disponible.");
      const v = valuationFromQuote(i, q, result.fx, result.at, makeId());
      const old = latestValuation(registry, i.id, v.date);
      if (old?.date === v.date) v.supersedes = old.id;
      setExpected(before);
      setPending({ label: `Enregistrer ${eur(v.value)} au ${v.date} pour ${i.name} (${v.quote?.symbol}, ${v.quote?.exchange}) ?`, update: r => appendValuation(r, v, new Date().toISOString()) });
    } catch (e) { setFailure(e instanceof Error ? e.message : "Cours indisponible ; dernier montant conservé."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
    <header className="space-y-2"><p className="text-xs uppercase tracking-wide text-muted-foreground">Portefeuille financier</p><h1 className="text-2xl font-semibold">Gérer mes comptes et instruments</h1></header>
    <FullBackupExport ready={!blocked} />
    {(error || pe || we || failure) && <p role="alert" className="text-sm text-destructive">{error ?? pe ?? we ?? failure}</p>}
    {msg && <p role="status" className="text-sm text-success">{msg}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <div role="tablist" aria-label="Gestion financière" className="flex flex-wrap gap-1">{([["accounts", "Comptes"], ["instruments", "Instruments"], ["values", "Valorisations"]] as const).map(([id, label]) => <Button role="tab" aria-selected={tab === id} key={id} variant={tab === id ? "default" : "ghost"} size="sm" onClick={() => { setTab(id); setEditor(null); setPending(null); }}>{label}</Button>)}</div>
      {tab === "accounts" && <Button size="sm" disabled={blocked} onClick={() => start({ kind: "account", value: { id: makeId(), legacyId: null, name: "", type: "other", institution: "", currency: "EUR", openedAt: null, mode: "manual", active: true, targetAccountId: null } })}><Plus />Créer un compte</Button>}
      {tab === "instruments" && <Button size="sm" disabled={blocked || !accounts.some(a => a.active)} onClick={() => start({ kind: "instrument", value: { id: makeId(), legacyRef: null, accountId: accounts.find(a => !a.legacyId && a.active)?.id ?? accounts.find(a => a.active)?.id ?? "", name: "", isin: "", ticker: "", exchange: "", currency: "EUR", type: "other", mode: "manual", active: true, classId: null, quantity: 0 } })}><Plus />Créer un instrument</Button>}
    </div>
    {pending && <section role="dialog" aria-label="Confirmer la modification" className="space-y-3 border-l-2 border-warning bg-surface-muted p-4"><h2 className="font-semibold">{pending.label}</h2><p className="text-sm">Historique et transactions conservés. Sauvegarde complète avant toute écriture ; aucun objectif modifié.</p><div className="flex flex-wrap gap-2"><Button size="sm" disabled={blocked} onClick={() => apply(pending.update)}>Sauvegarder puis confirmer</Button><Button size="sm" variant="ghost" onClick={() => setPending(null)}>Annuler</Button></div></section>}
    {editor?.kind === "account" && <AccountForm key={editor.value.id} initial={editor.value} wealth={wealth} cancel={() => setEditor(null)} save={a => apply(r => saveAccount(r, a))} />}
    {editor?.kind === "instrument" && <InstrumentForm key={editor.value.id} initial={editor.value} wealth={wealth} accounts={accounts} hasHistory={registry.valuations.some(v => v.instrumentId === editor.value.id)} cancel={() => setEditor(null)} save={i => apply(r => saveInstrument(r, i))} />}
    {editor?.kind === "valuation" && <ValuationForm key={editor.value.id} initial={editor.value} instrument={editor.instrument} cancel={() => setEditor(null)} save={v => apply(r => appendValuation(r, { ...v, at: new Date().toISOString() }, new Date().toISOString()))} />}
    {tab === "accounts" && <>
      <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="text-xs text-muted-foreground"><tr>{["Compte", "Type", "Établissement", "Devise", "Ouverture", "Valorisation", "Statut", ""].map((h, k) => <th key={k} className="p-2">{h}</th>)}</tr></thead><tbody>{accounts.map(a => <tr key={a.id} className="border-t border-border"><td className="p-2 font-medium">{a.name}</td><td className="p-2">{accountTypes[a.type]}</td><td className="p-2">{a.institution || "Non renseigné"}</td><td className="p-2">{a.currency}</td><td className="p-2">{a.openedAt ?? "—"}</td><td className="p-2">{a.mode === "auto" ? "Automatique" : "Manuelle"}</td><td className="p-2">{a.active ? "Actif" : "Inactif"}</td><td className="p-2"><div className="flex gap-1"><Button size="icon" variant="ghost" title={`Modifier ${a.name}`} aria-label={`Modifier le compte ${a.name}`} disabled={blocked} onClick={() => start({ kind: "account", value: a })}><Pencil /></Button><Button size="icon" variant="ghost" title={a.active ? "Désactiver" : "Réactiver"} aria-label={`${a.active ? "Désactiver" : "Réactiver"} le compte ${a.name}`} disabled={blocked} onClick={() => toggleAccount(a)}><Power /></Button></div></td></tr>)}</tbody></table></div>
      <p className="text-xs text-muted-foreground">Objectifs existants inchangés : {wealth.accounts.map(a => `${a.name} ${a.target} %`).join(" · ")}. Un objectif d’assurance-vie n’est pas un compte détenu.</p>
    </>}
    {tab === "instruments" && <div className="overflow-x-auto"><table className="w-full min-w-[880px] text-left text-sm"><thead className="text-xs text-muted-foreground"><tr>{["Instrument", "Compte", "Type", "ISIN / ticker", "Place / devise", "Valorisation", "Statut", ""].map((h, k) => <th key={k} className="p-2">{h}</th>)}</tr></thead><tbody>{instruments.map(i => <tr key={i.id} className="border-t border-border"><td className="p-2 font-medium">{i.name}{i.legacyRef && <p className="text-xs font-normal text-muted-foreground">Position existante</p>}</td><td className="p-2">{name(i.accountId)}</td><td className="p-2">{instrumentTypes[i.type]}</td><td className="p-2 font-mono text-xs">{i.isin || "Sans ISIN"}<br />{i.ticker || "Sans ticker"}</td><td className="p-2">{i.exchange || "—"} / {i.currency}</td><td className="p-2">{i.mode === "auto" ? "Automatique" : "Manuelle"}</td><td className="p-2">{i.active ? "Actif" : "Inactif"}</td><td className="p-2"><div className="flex gap-1"><Button size="icon" variant="ghost" title="Modifier" aria-label={`Modifier l’instrument ${i.name}`} disabled={blocked} onClick={() => start({ kind: "instrument", value: i })}><Pencil /></Button><Button size="icon" variant="ghost" title={i.active ? "Désactiver" : "Réactiver"} aria-label={`${i.active ? "Désactiver" : "Réactiver"} l’instrument ${i.name}`} disabled={blocked} onClick={() => toggleInstrument(i)}><Power /></Button>{!i.legacyRef && <Button size="icon" variant="ghost" title="Valorisations" aria-label={`Valorisations de ${i.name}`} onClick={() => { setTab("values"); }}><History /></Button>}</div></td></tr>)}</tbody></table></div>}
    {tab === "values" && <>
      <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="p-2">Support</th><th className="p-2">Compte</th><th className="p-2">Dernière valeur (€)</th><th className="p-2">Date effective</th><th className="p-2" /></tr></thead><tbody>{instruments.filter(i => !i.legacyRef).map(i => { const v = latestValuation(registry, i.id, new Date().toISOString().slice(0, 10)); const a = accounts.find(x => x.id === i.accountId); return <tr key={i.id} className="border-t border-border"><td className="p-2">{i.name}{!i.active && " (inactif)"}</td><td className="p-2">{name(i.accountId)}</td><td className="p-2 font-mono">{v ? eur(v.value) : "Non renseignée"}</td><td className="p-2">{v?.date ?? "—"}</td><td className="p-2"><div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" disabled={blocked || !i.active || !a?.active} onClick={() => valuationEditor(i)}><Plus />Saisir une valeur</Button>{i.mode === "auto" && <Button size="icon" variant="ghost" title="Actualiser le cours" aria-label={`Actualiser ${i.name}`} disabled={blocked || !i.active || !a?.active || i.quantity <= 0} onClick={() => void requestQuote(i)}><RefreshCw /></Button>}</div></td></tr>; })}</tbody></table></div>
      {!instruments.some(i => !i.legacyRef) && <p className="text-sm text-muted-foreground">Aucun nouveau support enregistré. <Link to="/positions" className="underline">Positions existantes</Link></p>}
      {registry.valuations.length > 0 && <section className="space-y-3"><h2 className="text-lg font-semibold">Toutes les valorisations et corrections</h2><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead><tr>{["Date", "Instrument", "Compte", "Valeur €", "Commentaire", "État", ""].map((h, k) => <th key={k} className="p-2">{h}</th>)}</tr></thead><tbody>{[...registry.valuations].reverse().map(v => { const i = instruments.find(x => x.id === v.instrumentId); const effective = effectiveValuations(registry).some(x => x.id === v.id); return <tr key={v.id} className="border-t border-border"><td className="p-2">{v.date}</td><td className="p-2">{i?.name}</td><td className="p-2">{name(v.accountId)}</td><td className="p-2 font-mono">{eur(v.value)}</td><td className="max-w-64 break-words p-2">{v.comment || "—"}</td><td className="p-2">{effective ? v.supersedes ? "Correction active" : "Active" : "Ancienne valeur conservée"}</td><td className="p-2">{i && effective && <Button size="icon" variant="ghost" title="Corriger la valorisation" aria-label={`Corriger ${i.name} du ${v.date}`} disabled={blocked || !i.active || !accounts.find(a => a.id === i.accountId)?.active} onClick={() => valuationEditor(i, v)}><Pencil /></Button>}</td></tr>; })}</tbody></table></div></section>}
      <p className="text-sm">Nouveaux supports actifs valorisés : <strong className="font-mono">{eur(registryTotal(registry, wealth, new Date().toISOString().slice(0, 10)))}</strong> · hors périmètre des allocations figées.</p>
      <FinancialHistory registry={registry} wealth={wealth} />
    </>}
  </main>;
}