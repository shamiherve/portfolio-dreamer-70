import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Download, Upload, ArrowUpRight, Save } from "lucide-react";
import { usePortfolio } from "@/lib/use-portfolio";
import { exportBackup, makeId, parseBackup, purchaseProposal, recordTransaction, SIMULATIONS_KEY, type Backup, type Position } from "@/lib/portfolio";
import { eur, pct, pp } from "@/lib/rebalance";
import { downloadJson } from "./target-editor";

const field = "w-full rounded-md border border-input bg-surface px-2 py-2 text-sm outline-none focus:ring-1 focus:ring-ring";
const nonnegative = (s: string) => Math.max(0, Number(s) || 0);

function PositionForm({ position, onSave, onCancel }: { position: Position; onSave: (p: Position) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(position);
  const [message, setMessage] = useState("");
  return <form onSubmit={(e) => {
    e.preventDefault();
    if (draft.price !== null && !draft.priceDate) { setMessage("Renseignez la date du cours."); return; }
    try { onSave(draft); } catch (err) { setMessage(err instanceof Error ? err.message : "Saisie invalide."); }
  }} className="space-y-4 border-y border-border bg-surface-muted/50 py-5">
    <h3 className="font-medium">Modifier la position</h3>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="space-y-1 text-xs text-muted-foreground">Nom de l’ETF<input required className={field} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label className="space-y-1 text-xs text-muted-foreground">ISIN<input className={field} value={draft.isin} onChange={(e) => setDraft({ ...draft, isin: e.target.value })} /></label>
      <label className="space-y-1 text-xs text-muted-foreground">Nombre de parts<input className={field} type="number" min="0" step="any" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: nonnegative(e.target.value) })} /></label>
      <label className="space-y-1 text-xs text-muted-foreground">Dernier cours connu (€)<input className={field} type="number" min="0.000001" step="any" value={draft.price ?? ""} placeholder="Non renseigné" onChange={(e) => setDraft({ ...draft, price: e.target.value && Number(e.target.value) > 0 ? Number(e.target.value) : null, priceDate: e.target.value && Number(e.target.value) > 0 ? draft.priceDate : null })} /></label>
      <label className="space-y-1 text-xs text-muted-foreground">Date du cours<input className={field} type="date" disabled={draft.price === null} value={draft.priceDate ?? ""} onChange={(e) => setDraft({ ...draft, priceDate: e.target.value || null })} /></label>
      <div className="space-y-1 text-xs text-muted-foreground"><span>Valeur de la position</span><p className="py-2 font-mono text-lg text-foreground">{draft.price === null && draft.quantity > 0 ? "Non valorisée" : eur(draft.quantity * (draft.price ?? 0))}</p></div>
    </div>
    <div className="flex gap-2"><Button type="submit" size="sm"><Save />Enregistrer la position</Button><Button type="button" size="sm" variant="ghost" onClick={onCancel}>Annuler</Button></div>
    {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
  </form>;
}

export function Dashboard() {
  const { portfolio, hydrated, error, commit, restore } = usePortfolio();
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Backup | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const proposal = purchaseProposal(portfolio.positions, portfolio.budget);
  const result = proposal.continuous;
  const [transactionPosition, setTransactionPosition] = useState("");
  const [transactionType, setTransactionType] = useState<"buy" | "sell">("buy");
  const [transactionQuantity, setTransactionQuantity] = useState("");
  const [transactionPrice, setTransactionPrice] = useState("");
  const [transactionDate, setTransactionDate] = useState("");
  const status = !proposal.valid ? "Données à compléter" : result.impossibleWithoutSale ? "Objectif impossible sans vente" : proposal.maxGap < 0.05 ? "Objectif atteint" : "Objectif partiellement atteint";
  const statusClass = !proposal.valid ? "text-muted-foreground" : result.impossibleWithoutSale ? "text-destructive" : proposal.maxGap < 0.05 ? "text-success" : "text-warning";
  const active = portfolio.targets.find((t) => t.id === portfolio.activeTargetId);
  const run = (fn: () => void, success?: string) => {
    try { fn(); if (success) setMessage(success); }
    catch (e) { setMessage(e instanceof Error && !e.message.startsWith("[") ? e.message : "Données invalides : vérifiez les nombres et les dates."); }
  };
  const edit = portfolio.positions.find((p) => p.id === editing);
  return <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div className="space-y-2"><p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">PEA · Approximation MSCI ACWI</p><h1 className="text-2xl font-semibold">Mon portefeuille ETF</h1><p className="text-xs text-muted-foreground">Actualisation automatique non configurée</p></div><div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={!hydrated} onClick={() => run(() => downloadJson(exportBackup(portfolio, JSON.parse(localStorage.getItem(SIMULATIONS_KEY) ?? "[]")), "equilibre-sauvegarde.json"), "Sauvegarde exportée.")}><Download />Exporter la sauvegarde</Button>
      <Button size="sm" variant="outline" disabled={!hydrated} onClick={() => file.current?.click()}><Upload />Importer une sauvegarde</Button>
      <input ref={file} aria-label="Importer une sauvegarde" type="file" className="hidden" accept=".json,application/json" onChange={async (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        try { setPending(parseBackup(await f.text())); setMessage(""); } catch { setMessage("Import refusé : fichier invalide ou version non reconnue. Vos données restent intactes."); }
        e.target.value = "";
      }} />
    </div></header>
    <p className="border-l-2 border-warning pl-3 text-xs text-muted-foreground">Données conservées dans ce navigateur uniquement. Exportez régulièrement une sauvegarde ; effacer les données du navigateur les supprimera.</p>
    {!hydrated && <p role="status" className="text-sm text-muted-foreground">Chargement des données locales…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {pending && <section role="dialog" aria-label="Confirmer le remplacement des données" className="space-y-3 rounded-md border border-border bg-surface p-5"><h2 className="font-semibold">Remplacer les données existantes ?</h2><p className="text-sm text-muted-foreground">Cette sauvegarde remplacera les positions, cibles, transactions et simulations de ce navigateur ({pending.portfolio.positions.length} positions, {pending.simulations.length} simulations). Exportez d’abord vos données actuelles si nécessaire.</p><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => run(() => { restore(pending); setPending(null); setEditing(null); }, "Sauvegarde importée.")}>Confirmer le remplacement</Button><Button size="sm" variant="outline" onClick={() => setPending(null)}>Annuler</Button></div></section>}
    <section className="grid gap-6 border-y border-border py-6 sm:grid-cols-2 lg:grid-cols-4">
      <div><p className="text-xs text-muted-foreground">Valeur totale des positions</p><p className="mt-2 font-mono text-2xl">{proposal.missingValuation ? "Incomplète" : eur(result.total)}</p>{proposal.missingValuation && <p className="mt-1 text-xs text-warning">Valeur connue : {eur(result.total)}</p>}</div>
      <div><p className="text-xs text-muted-foreground">Prochain versement</p><label className="mt-2 flex items-center gap-2"><input aria-label="Montant du prochain versement" type="number" min="0" step="any" disabled={!hydrated} value={portfolio.budget} onChange={(e) => run(() => commit({ ...portfolio, budget: nonnegative(e.target.value) }))} className="w-full max-w-44 rounded-md border border-input bg-surface px-2 py-1 font-mono text-xl outline-none focus:ring-1 focus:ring-ring" /><span className="text-muted-foreground">€</span></label></div>
      <div><p className="text-xs text-muted-foreground">Dernière actualisation manuelle</p><p className="mt-2 text-sm">{portfolio.updatedAt ? new Date(portfolio.updatedAt).toLocaleString("fr-FR") : "Aucune donnée enregistrée"}</p><p className="mt-1 text-[11px] text-muted-foreground">Les dates des cours figurent ci-dessous.</p></div>
      <div><p className="text-xs text-muted-foreground">Écart maximal après investissement</p><p className={`mt-2 font-mono text-2xl ${statusClass}`}>{proposal.valid ? `${proposal.maxGap.toFixed(2)} pp` : "—"}</p><p className={`mt-1 text-xs ${statusClass}`}>● {status}</p></div>
    </section>
    <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Positions détenues</h2><Button disabled={!hydrated} variant="outline" size="sm" onClick={() => run(() => {
      const p: Position = { id: makeId(), name: "Nouvel ETF", isin: "", quantity: 0, price: null, priceDate: null, target: 0 };
      commit({ ...portfolio, positions: [...portfolio.positions, p], activeTargetId: null, updatedAt: new Date().toISOString() }); setEditing(p.id);
    })}><Plus />Ajouter un ETF</Button></div>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-border bg-surface-muted/50 text-[11px] text-muted-foreground"><tr><th className="px-3 py-3">ETF / ISIN</th><th className="px-3 text-right">Parts</th><th className="px-3 text-right">Cours / date</th><th className="px-3 text-right">Valeur</th><th className="px-3 text-right">Réel</th><th className="px-3 text-right">Cible</th><th className="px-3 text-right">Écart</th><th /></tr></thead><tbody>
      {portfolio.positions.map((p, i) => { const line = result.lines[i]; return <tr key={p.id} className="border-b border-border"><td className="min-w-48 px-3 py-4"><Button className="h-auto max-w-80 whitespace-normal p-0 text-left text-sm" variant="link" disabled={!hydrated} onClick={() => setEditing(p.id)}>{p.name}</Button><span className="mt-1 block font-mono text-[10px] text-muted-foreground">{p.isin || "ISIN non renseigné"}</span></td><td className="px-3 text-right font-mono">{p.quantity}</td><td className="min-w-28 px-3 text-right font-mono text-xs">{p.price === null ? "Non renseigné" : eur(p.price)}<span className="mt-1 block text-[10px] text-muted-foreground">{p.priceDate ?? "Date absente"}</span></td><td className="whitespace-nowrap px-3 text-right font-mono text-xs">{p.quantity > 0 && p.price === null ? "—" : eur(line?.value ?? 0)}</td><td className="px-3 text-right font-mono text-xs">{proposal.missingValuation ? "—" : pct(line?.currentWeight ?? 0)}</td><td className="px-3 text-right font-mono text-xs">{pct(p.target)}</td><td className="whitespace-nowrap px-3 text-right font-mono text-xs text-muted-foreground">{proposal.missingValuation ? "—" : pp((line?.currentWeight ?? 0) - p.target)}</td><td className="px-2"><Button title={`Supprimer ${p.name}`} aria-label={`Supprimer ${p.name}`} disabled={!hydrated} variant="ghost" size="icon" onClick={() => {
        if (window.confirm(`Supprimer ${p.name} des positions ? Son historique de transactions sera conservé.`)) run(() => commit({ ...portfolio, positions: portfolio.positions.filter((pos) => pos.id !== p.id), activeTargetId: null, updatedAt: new Date().toISOString() }));
      }}><Trash2 className="text-muted-foreground" /></Button></td></tr>; })}
    </tbody></table></div>
    {edit && <PositionForm key={edit.id} position={edit} onCancel={() => setEditing(null)} onSave={(p) => { commit({ ...portfolio, positions: portfolio.positions.map((pos) => pos.id === p.id ? p : pos), updatedAt: new Date().toISOString() }); setEditing(null); setMessage("Position enregistrée."); }} />}
    <div className="flex flex-wrap justify-between gap-3 text-xs"><span className={result.targetsValid ? "text-success" : "text-warning"}>Total des cibles : {result.targetSum.toFixed(2)} %{!result.targetsValid && " · Pondérations à renseigner"}</span><Button asChild size="sm" variant="link" className="h-auto p-0"><Link to="/targets">Modifier les pondérations cibles<ArrowUpRight /></Link></Button></div>
    {active && <p className="text-xs text-muted-foreground">Cibles du {active.date} · Source : {active.source}</p>}
    </section>
    <section className="grid gap-8 border-t border-border pt-7 lg:grid-cols-2">
      <div className="space-y-5"><h2 className="font-semibold">Actuel → Après injection → Cible</h2><div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground"><span className="flex items-center gap-2"><span className="h-2 w-4 bg-border" />Actuel</span><span className="flex items-center gap-2"><span className="h-2 w-4 bg-accent" />Après</span><span className="flex items-center gap-2"><span className="h-2 w-4 bg-foreground" />Cible</span></div>
        {portfolio.positions.map((p, i) => <div key={p.id} className="space-y-2"><p className="text-xs font-medium">{p.name}</p>{[{ label: "Actuel", value: proposal.missingValuation ? null : result.lines[i]?.currentWeight ?? 0, cls: "bg-border" }, { label: "Après", value: proposal.valid ? proposal.lines[i]?.finalWeight ?? 0 : null, cls: "bg-accent" }, { label: "Cible", value: p.target, cls: "bg-foreground" }].map((bar) => <div key={bar.label} className="flex items-center gap-3"><span className="w-10 shrink-0 text-[10px] text-muted-foreground">{bar.label}</span><meter aria-label={`${bar.label} ${p.name}`} min="0" max="100" value={bar.value ?? 0} className={`allocation-meter ${bar.cls} h-2 min-w-0 flex-1`} /><span className="w-14 shrink-0 text-right font-mono text-[11px]">{bar.value === null ? "—" : pct(bar.value)}</span></div>)}</div>)}
      </div>
      <div className="space-y-5"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">Proposition d’achat sans vente</h2><span className={`text-xs ${statusClass}`}>{status}</span></div>
        <p className="text-xs text-muted-foreground">{proposal.wholeShares ? "Parts entières · optimisation arrondie de la répartition théorique" : "Montants théoriques fractionnaires : cours manquants pour acheter des parts entières."}</p>
        {!proposal.valid ? <p className="border-l-2 border-warning pl-3 text-sm text-warning">{proposal.missingValuation ? "Renseignez les cours des positions détenues pour valoriser le portefeuille." : "Validez des pondérations totalisant 100 % pour obtenir une proposition."}</p> : <>
        <div className="divide-y divide-border">{proposal.lines.map((l) => <div key={l.id} className="space-y-2 py-4"><div className="flex flex-wrap justify-between gap-2 text-sm"><span>{l.name}</span><span className="font-mono">{eur(l.injected)}</span></div><div className="flex flex-wrap justify-between gap-2 font-mono text-[11px] text-muted-foreground"><span>{l.shares === null ? "Fractionnaire théorique" : `${l.shares} part${l.shares > 1 ? "s" : ""}`} · Après : {pct(l.finalWeight)}</span><span>Écart : {pp(l.gapToTargetPp)}</span></div></div>)}</div>
        <div className="grid grid-cols-2 gap-4 border-t border-border pt-4"><div><p className="text-xs text-muted-foreground">Montant investi</p><p className="mt-1 font-mono">{eur(proposal.spent)}</p></div><div><p className="text-xs text-muted-foreground">Liquidités restantes</p><p className="mt-1 font-mono">{eur(proposal.cash)}</p></div><div><p className="text-xs text-muted-foreground">Valeur finale des positions</p><p className="mt-1 font-mono">{eur(result.total + proposal.spent)}</p></div><div><p className="text-xs text-muted-foreground">Injection minimale théorique</p><p className="mt-1 font-mono">{eur(result.minInjection)}</p></div></div>
        <p className="text-[11px] text-muted-foreground">Poids calculés hors liquidités. L’alignement exact est théorique et peut être impossible avec des parts entières.</p>
        {Number.isFinite(result.shortfall) && result.shortfall > 0 && <p className="text-xs text-warning">Il manque encore {eur(result.shortfall)} pour atteindre exactement vos objectifs (calcul théorique sans vente).</p>}
        {result.impossibleWithoutSale && <p className="text-xs text-destructive">Une position détenue a une cible de 0 % : l’objectif exact est impossible sans vente.</p>}
        </>}
        <p className="text-xs text-muted-foreground">Proposition uniquement : aucun ordre ni aucune transaction ne sont exécutés.</p>
      </div>
    </section>
    <section className="space-y-5 border-t border-border pt-7"><h2 className="font-semibold">Historique des transactions</h2>
      <form className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={(e) => { e.preventDefault(); run(() => {
        const p = portfolio.positions.find((i) => i.id === transactionPosition); if (!p) throw new Error("Choisissez un ETF.");
        commit(recordTransaction(portfolio, { id: makeId(), positionId: p.id, name: p.name, type: transactionType, quantity: Number(transactionQuantity), price: Number(transactionPrice), date: transactionDate }));
        setTransactionQuantity(""); setTransactionPrice("");
      }, "Transaction enregistrée ; nombre de parts mis à jour."); }}>
        <label className="space-y-1 text-xs text-muted-foreground">ETF<select required className={field} value={transactionPosition} onChange={(e) => setTransactionPosition(e.target.value)}><option value="">Choisir</option>{portfolio.positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="space-y-1 text-xs text-muted-foreground">Opération<select className={field} value={transactionType} onChange={(e) => setTransactionType(e.target.value === "sell" ? "sell" : "buy")}><option value="buy">Achat</option><option value="sell">Vente</option></select></label>
        <label className="space-y-1 text-xs text-muted-foreground">Parts<input required className={field} type="number" min="0.000001" step="any" value={transactionQuantity} onChange={(e) => setTransactionQuantity(e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Prix unitaire (€)<input required className={field} type="number" min="0.000001" step="any" value={transactionPrice} onChange={(e) => setTransactionPrice(e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground">Date<input required className={field} type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} /></label>
        <Button type="submit" disabled={!hydrated} size="sm"><Plus />Enregistrer</Button>
      </form>
      <p className="text-[11px] text-muted-foreground">Une transaction ajuste les parts détenues ; son prix d’exécution ne remplace pas le dernier cours connu.</p>
      {!portfolio.transactions.length && <p className="text-sm text-muted-foreground">Aucune transaction enregistrée.</p>}
      <ul className="divide-y divide-border">{portfolio.transactions.map((t) => <li key={t.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><span><span className={t.type === "buy" ? "text-success" : "text-destructive"}>{t.type === "buy" ? "Achat" : "Vente"}</span> · {t.name}<span className="mt-1 block text-xs text-muted-foreground">{t.date}</span></span><span className="font-mono text-xs">{t.quantity} parts × {eur(t.price)} = {eur(t.quantity * t.price)}</span></li>)}</ul>
    </section>
    <footer className="border-t border-border py-6 text-xs text-muted-foreground">Approximation du MSCI ACWI. Les calculs ne constituent pas un conseil en investissement.</footer>
  </main>;
}