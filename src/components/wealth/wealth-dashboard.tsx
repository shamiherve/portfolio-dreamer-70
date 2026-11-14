import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePortfolio } from "@/lib/use-portfolio";
import { useQuotes } from "@/lib/use-quotes";
import { useWealth } from "@/lib/use-wealth";
import { useMarket } from "@/lib/use-market";
import { QuoteStatusPanel } from "./quote-status";
import { analyse, bestAccount, recommendations, simulateContribution, ETF_ACCOUNT, ETF_CLASS, type Wealth } from "@/lib/wealth";
import { ALL_ACCOUNTS, minimalToTargets, optimizeAllAccounts, type CellSplit } from "@/lib/contribution";
import { wholeUnitProposal, scoreLabel } from "@/lib/whole-unit";
import { eur } from "@/lib/rebalance";
import type { Position } from "@/lib/portfolio";
import { AllocationTable, Donut, field, fmtPct, fmtPp, sevClass } from "./shared";

const ts = (s: string | null | undefined) => s ? new Date(s).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) : "—";
const scoreText = (s: number | null) => s === null ? "—" : `${Math.round(s)} / 100`;

export function WealthDashboard() {
  const { portfolio, hydrated, error, commit } = usePortfolio();
  const { wealth, hydrated: wh, error: we, commit: wcommit } = useWealth();
  const market = useMarket(wealth, wh && !we, wcommit);
  const quotes = useQuotes(hydrated, Boolean(error), commit);
  const a = useMemo(() => analyse(portfolio, wealth), [portfolio, wealth]);
  const [mode, setMode] = useState<"amount" | "target">("amount");
  const [amount, setAmount] = useState("1000");
  const [account, setAccount] = useState(ETF_ACCOUNT);
  const amt = Math.max(0, Number(amount.replace(",", ".")) || 0);
  const single = mode === "amount" && account !== ALL_ACCOUNTS;
  const sim = useMemo(() => single ? simulateContribution(portfolio, wealth, amt, account) : null, [single, portfolio, wealth, amt, account]);
  const allSim = useMemo(() => mode === "amount" && account === ALL_ACCOUNTS ? optimizeAllAccounts(portfolio, wealth, amt) : null, [mode, account, portfolio, wealth, amt]);
  const targetPlan = useMemo(() => mode === "target" ? minimalToTargets(portfolio, wealth) : null, [mode, portfolio, wealth]);
  const best = useMemo(() => single ? bestAccount(portfolio, wealth, amt) : null, [single, portfolio, wealth, amt]);
  const etfPart = single ? (sim?.split.find(s => s.classId === ETF_CLASS)?.value ?? 0) : (allSim?.byClass.find(c => c.id === ETF_CLASS)?.value ?? 0);
  const etfPlan = useMemo(() => { try { return mode === "amount" && amt > 0 && etfPart > 0 ? wholeUnitProposal(portfolio.positions, etfPart, "budget") : null; } catch { return null; } }, [mode, amt, portfolio.positions, etfPart]);
  if (!hydrated || !wh) return <p className="p-8">Chargement des données locales…</p>;
  const name = (id: string, list: { id: string; name: string }[]) => list.find(x => x.id === id)?.name ?? id;
  const causes = [...a.classRows, ...a.accountRows].filter(r => r.status !== "balanced").sort((x, y) => Math.abs(y.diffPp) - Math.abs(x.diffPp)).slice(0, 3);
  const under = a.classRows.filter(r => r.status === "under").sort((x, y) => x.diffEur - y.diffEur);
  const over = a.classRows.filter(r => r.status === "over").sort((x, y) => y.diffPp - x.diffPp);
  const underAcc = a.accountRows.filter(r => r.status === "under").sort((x, y) => x.diffEur - y.diffEur);
  const all = [...a.classRows, ...a.accountRows];
  const maxEur = all.length ? all.reduce((m, r) => Math.abs(r.diffEur) > Math.abs(m.diffEur) ? r : m) : null;
  const maxPp = all.length ? all.reduce((m, r) => Math.abs(r.diffPp) > Math.abs(m.diffPp) ? r : m) : null;
  const overall = a.total > 0 ? a.classRows.reduce((s, r) => s + Math.abs(r.diffPp), 0) / 2 : 0;
  return <main className="mx-auto max-w-7xl space-y-10 px-4 py-8 sm:px-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Vue globale</p><h1 className="text-2xl font-semibold">Dashboard Patrimonial</h1></div>
      <div className="text-right text-xs text-muted-foreground"><p>Dernière valorisation : {a.lastDate ? new Date(a.lastDate).toLocaleDateString("fr-FR") : "—"} · Cours ETF vérifiés : {ts(portfolio.quotesCheckedAt)}</p>
        <Button size="sm" variant="ghost" onClick={() => void quotes.refresh()} disabled={quotes.loading}><RefreshCw className={quotes.loading ? "animate-spin" : ""} />Actualiser les cours ETF</Button>{quotes.status && <p>{quotes.status}</p>}</div>
    </header>
    <QuoteStatusPanel portfolio={portfolio} wealth={wealth} busy={market.busy !== null || quotes.loading} message={[market.message, quotes.status].filter(Boolean).join(" ")} onRefresh={() => { void quotes.refresh(); void market.refresh(); }} />
    {(error || we) && <p role="alert" className="text-sm text-destructive">{error ?? we}</p>}
    {a.issues.length > 0 && <div role="alert" className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm"><p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" />Cibles incohérentes — résultats à interpréter avec prudence</p><ul className="ml-6 list-disc">{a.issues.map(i => <li key={i}>{i}</li>)}</ul><Link to="/allocation" className="underline">Corriger les cibles</Link></div>}
    {a.unvalued.length > 0 && <p className="text-sm text-warning">Positions sans cours, comptées à 0 € : {a.unvalued.join(", ")}.</p>}

    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Valeur totale" value={eur(a.total)} />
      <Stat label="Score d’équilibre global" value={scoreText(a.score)} hint={a.score === null ? "Portefeuille vide" : scoreLabel(a.score)} />
      <Stat label="Écart global (classes)" value={`${overall.toFixed(1)} pp`} hint="½ Σ |écart| par classe" />
      <Stat label="Scores détaillés" value={`${scoreText(a.classScore)} · ${scoreText(a.accountScore)}`} hint="Classes d’actifs · Comptes" />
      {a.accountRows.map(r => <Stat key={r.id} label={r.name} value={eur(r.value)} hint={`${fmtPct(r.actual)} actuel · cible ${fmtPct(r.target)}`} />)}
    </section>
    {causes.length > 0 && <p className="text-sm text-muted-foreground">Principales causes d’écart : {causes.map(c => `${c.name} (${fmtPp(c.diffPp)})`).join(" ; ")}.</p>}

    <section className="space-y-3"><h2 className="text-lg font-semibold">Allocation</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Donut title="Actuel par classe" data={a.classRows.map(r => ({ name: r.name, value: r.value, pct: r.actual }))} />
        <Donut title="Cible par classe" data={a.classRows.map(r => ({ name: r.name, value: r.targetValue, pct: r.target }))} />
        <Donut title="Actuel par compte" data={a.accountRows.map(r => ({ name: r.name, value: r.value, pct: r.actual }))} />
        <Donut title="Cible par compte" data={a.accountRows.map(r => ({ name: r.name, value: r.targetValue, pct: r.target }))} />
      </div>
      {a.parents.map(p => <p key={p.id} className="text-sm"><strong>{p.name}</strong> (catégorie parente, non additionnée) : cible {fmtPct(p.target)} · actuel {fmtPct(p.actual)} · {eur(p.value)} = {p.children.map(c => name(c, wealth.classes)).join(" + ")}</p>)}
    </section>

    <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Cible vs actuel — classes d’actifs</h2><Link to="/allocation" className="text-sm underline">Modifier les cibles</Link></div>
      <AllocationTable label="Classe d’actifs" rows={a.classRows}>{r => { const c = wealth.classes.find(x => x.id === r.id); return c?.parent ? <span className="pl-4 before:mr-1 before:content-['↳']">{r.name}</span> : r.name; }}</AllocationTable></section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Cible vs actuel — comptes</h2><AllocationTable label="Compte" rows={a.accountRows} /></section>

    <section className="space-y-3"><h2 className="text-lg font-semibold">Analyse & recommandations</h2>
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <Mini label="Classe la plus sous-pondérée" v={under[0] ? `${under[0].name} (${eur(under[0].diffEur)})` : "Aucune"} />
        <Mini label="Classe la plus surpondérée" v={over[0] ? `${over[0].name} (${fmtPp(over[0].diffPp)})` : "Aucune"} />
        <Mini label="Compte le plus sous-pondéré" v={underAcc[0] ? `${underAcc[0].name} (${eur(underAcc[0].diffEur)})` : "Aucun"} />
        <Mini label="Plus grand écart en €" v={maxEur && a.total > 0 ? `${maxEur.name} (${eur(maxEur.diffEur)})` : "—"} />
        <Mini label="Plus grand écart en pp" v={maxPp && a.total > 0 ? `${maxPp.name} (${fmtPp(maxPp.diffPp)})` : "—"} />
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm">{recommendations(a).map(r => <li key={r}>{r}</li>)}</ul>
      <p className="text-xs text-muted-foreground">Informations uniquement : aucune vente n’est jamais recommandée et aucun ordre n’est passé.</p>
    </section>

    <section className="space-y-4 rounded-lg border border-border bg-surface p-4"><h2 className="text-lg font-semibold">Simulateur d’apport</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs text-muted-foreground">Mode<select aria-label="Mode de simulation" className={field} value={mode} onChange={e => setMode(e.target.value as "amount" | "target")}><option value="amount">Simuler un apport</option><option value="target">Atteindre mes cibles</option></select></label>
        {mode === "amount" && <label className="space-y-1 text-xs text-muted-foreground">Montant (€)<input aria-label="Montant de l’apport" className={field} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>}
        {mode === "amount" && <label className="space-y-1 text-xs text-muted-foreground">Compte<select aria-label="Compte de l’apport" className={field} value={account} onChange={e => setAccount(e.target.value)}><option value={ALL_ACCOUNTS}>Tous les comptes — Optimisation globale</option>{wealth.accounts.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        {mode === "amount" && single && <div className="text-sm"><p className="text-xs text-muted-foreground">Destination la plus utile</p><p className="py-2 font-medium">{best && amt > 0 ? `${name(best.id, wealth.accounts)} (score ${Math.round(best.score)})` : "—"}</p></div>}
      </div>

      {mode === "amount" && amt > 0 && sim && <>
        <p className="text-sm">Score global : {scoreText(sim.before.score)} → <strong>{scoreText(sim.after.score)}</strong>. Valeur après apport : {eur(sim.after.total)}.</p>
        {sim.unallocated > 0 && <p className="text-sm text-warning">Ce compte n’a aucune classe cible : l’apport ne peut pas être réparti.</p>}
        <ClassSimTable before={sim.before} after={sim.after} split={new Map(sim.split.map(s => [s.classId, s.value]))} />
        {etfPlan && etfPlan.valid && <EtfPlanBlock positions={portfolio.positions} plan={etfPlan} part={etfPart} />}
      </>}

      {mode === "amount" && amt > 0 && allSim && <>
        <p className="text-sm">Score global : {scoreText(allSim.before.score)} → <strong>{scoreText(allSim.after.score)}</strong>. Valeur après apport : {eur(allSim.after.total)}.</p>
        {allSim.unallocated > 0 && <p className="text-sm text-warning">Aucune combinaison compte × classe cible : l’apport ne peut pas être réparti.</p>}
        {allSim.unmapped.length > 0 && <p className="text-sm text-warning">Hors cibles compte × classe : {allSim.unmapped.map(u => `${u.name} (${eur(u.value)})`).join(", ")} — leur poids ne peut diminuer que par dilution.</p>}
        <SplitSummary byAccount={allSim.byAccount} byClass={allSim.byClass} wealth={wealth} />
        <CellTable split={allSim.split} wealth={wealth} />
        <ClassSimTable before={allSim.before} after={allSim.after} split={new Map(allSim.byClass.map(c => [c.id, c.value]))} />
        {etfPlan && etfPlan.valid && <EtfPlanBlock positions={portfolio.positions} plan={etfPlan} part={etfPart} />}
      </>}

      {mode === "target" && targetPlan && <TargetPlanView plan={targetPlan} wealth={wealth} positions={portfolio.positions} />}
      <p className="text-xs text-muted-foreground">Simulation uniquement, achats seulement : aucune transaction n’est exécutée ni enregistrée.</p>
    </section>
  </main>;
}
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) { return <div className="rounded-lg border border-border bg-surface p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-xl">{value}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>; }
function Mini({ label, v }: { label: string; v: string }) { return <div className="rounded-md border border-border p-3"><p className="text-xs text-muted-foreground">{label}</p><p>{v}</p></div>; }

const nm = (id: string, list: { id: string; name: string }[]) => list.find(x => x.id === id)?.name ?? id;

function SplitSummary({ byAccount, byClass, wealth }: { byAccount: { id: string; value: number }[]; byClass: { id: string; value: number }[]; wealth: Wealth }) {
  return <div className="grid gap-3 text-sm sm:grid-cols-2">
    <div><p className="font-medium">Répartition recommandée par compte</p><ul className="list-disc pl-5">{byAccount.map(a => <li key={a.id}>{nm(a.id, wealth.accounts)} : <span className="font-mono">{eur(a.value)}</span></li>)}</ul></div>
    <div><p className="font-medium">Répartition recommandée par classe</p><ul className="list-disc pl-5">{byClass.map(c => <li key={c.id}>{nm(c.id, wealth.classes)} : <span className="font-mono">{eur(c.value)}</span></li>)}</ul></div>
  </div>;
}

function CellTable({ split, wealth }: { split: CellSplit[]; wealth: Wealth }) {
  const data = split.filter(s => s.value > 0.005);
  if (!data.length) return null;
  return <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm">
    <thead className="text-left text-xs text-muted-foreground"><tr className="border-b border-border">{["Compte", "Classe", "Apport recommandé"].map(h => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
    <tbody>{data.map(s => <tr key={`${s.accountId}|${s.classId}`} className="border-b border-border/60"><td className="px-2 py-2">{nm(s.accountId, wealth.accounts)}</td><td className="px-2 py-2">{nm(s.classId, wealth.classes)}</td><td className="px-2 py-2 font-mono">{eur(s.value)}</td></tr>)}</tbody></table></div>;
}

function ClassSimTable({ before, after, split }: { before: ReturnType<typeof analyse>; after: ReturnType<typeof analyse>; split: Map<string, number> }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
    <thead className="text-left text-xs text-muted-foreground"><tr className="border-b border-border">{["Classe", "Apport", "Actuel", "Cible", "Après", "Écart après"].map(h => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
    <tbody>{after.classRows.map((r, i) => { const b = before.classRows[i]!; return <tr key={r.id} className="border-b border-border/60">
      <td className="px-2 py-2">{r.name}</td><td className="px-2 py-2 font-mono">{eur(split.get(r.id) ?? 0)}</td>
      <td className="px-2 py-2 font-mono">{fmtPct(b.actual)}</td><td className="px-2 py-2 font-mono">{fmtPct(r.target)}</td><td className="px-2 py-2 font-mono">{fmtPct(r.actual)}</td>
      <td className={`px-2 py-2 font-mono ${sevClass[r.severity]}`}>{fmtPp(r.diffPp)}</td>
    </tr>; })}</tbody></table></div>;
}

function EtfPlanBlock({ positions, plan, part }: { positions: Position[]; plan: NonNullable<ReturnType<typeof wholeUnitProposal>>; part: number }) {
  return <div className="text-sm"><p className="font-medium">Part ETF ({eur(part)}) en parts entières :</p>
    <ul className="list-disc pl-5">{positions.map((p, i) => (plan.units[i] ?? 0) > 0 && <li key={p.id}>{plan.units[i]} × {p.name} (≈ {eur((plan.units[i] ?? 0) * (p.price ?? 0))})</li>)}</ul>
    <p className="text-muted-foreground">Dépensé {eur(plan.spent)} · reste {eur(Math.max(0, part - plan.spent))}. <Link to="/" className="underline">Ajuster dans le Portefeuille ETF</Link></p></div>;
}

function TargetPlanView({ plan, wealth, positions }: { plan: NonNullable<ReturnType<typeof minimalToTargets>>; wealth: Wealth; positions: Position[] }) {
  if (!plan.possible) return <div className="space-y-2 text-sm">
    <p className="text-warning">Les cibles exactes ne sont pas atteignables par une stratégie sans vente{plan.unmapped.length > 0 ? ` : ${plan.unmapped.map(u => `${u.name} (${eur(u.value)})`).join(", ")} se trouvent hors des combinaisons compte × classe cibles` : ""}.</p>
    <p className="text-muted-foreground">Aucun montant minimal fiable ne peut être calculé. Utilisez « Simuler un apport » pour approcher le meilleur équilibre possible.</p>
  </div>;
  const shown = plan.investable ?? plan;
  return <>
    <div className="grid gap-3 sm:grid-cols-2">
      <Mini label="Minimum théorique (sans contrainte de parts)" v={eur(plan.theoretical)} />
      <Mini label="Minimum réellement investissable" v={plan.investable ? `${eur(plan.investable.amount)}${plan.investable.leftover > 0.01 ? ` · reliquat ${eur(plan.investable.leftover)}` : ""}` : "Non calculable : cours ETF manquants"} />
    </div>
    <p className="text-xs text-muted-foreground">Le minimum théorique est un calcul mathématique sans contrainte de parts entières : il n’est pas nécessairement réalisable en pratique.</p>
    <p className="text-sm">Score global : {scoreText(plan.before.score)} → <strong>{scoreText(shown.after.score)}</strong>. Valeur après investissement : {eur(shown.after.total)}.</p>
    <SplitSummary byAccount={shown.byAccount} byClass={shown.byClass} wealth={wealth} />
    <CellTable split={shown.split} wealth={wealth} />
    {plan.etfPlan && <EtfPlanBlock positions={positions} plan={plan.etfPlan} part={plan.byClass.find(c => c.id === ETF_CLASS)?.value ?? 0} />}
    <ClassSimTable before={plan.before} after={shown.after} split={new Map(shown.byClass.map(c => [c.id, c.value]))} />
  </>;
}
