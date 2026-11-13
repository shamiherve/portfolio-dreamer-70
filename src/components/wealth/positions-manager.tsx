import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Pencil, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePortfolio } from "@/lib/use-portfolio";
import { useWealth } from "@/lib/use-wealth";
import { holdingError, holdingValue, unifiedLines, type Holding, type Wealth } from "@/lib/wealth";
import { makeId } from "@/lib/portfolio";
import { eur } from "@/lib/rebalance";
import { field } from "./shared";

const blank = (w: Wealth): Holding => ({ id: makeId(), name: "", isin: "", ticker: "", exchange: "", accountId: w.accounts.find(a => a.id === "cto")?.id ?? w.accounts[0]!.id, classId: w.classes.find(c => c.id === "stocks")?.id ?? w.classes[0]!.id, kind: "quantity", currency: "EUR", quantity: 0, price: null, fxRate: 1, fractional: false, value: 0, priceDate: null });
const num = (s: string) => s.trim() === "" ? NaN : Number(s.replace(",", "."));

function L({ t, children }: { t: string; children: React.ReactNode }) { return <label className="space-y-1 text-xs text-muted-foreground">{t}{children}</label>; }

function HoldingForm({ initial, wealth, onSave, onCancel }: { initial: Holding; wealth: Wealth; onSave: (h: Holding) => void; onCancel: () => void }) {
  const [d, setD] = useState(initial);
  const [msg, setMsg] = useState("");
  const account = wealth.accounts.find(a => a.id === d.accountId);
  const set = (patch: Partial<Holding>) => setD(x => ({ ...x, ...patch }));
  return <form className="space-y-4 rounded-lg border border-border bg-surface-muted/50 p-4" onSubmit={e => { e.preventDefault(); const err = holdingError(d, wealth); if (err) { setMsg(err); return; } onSave(d); }}>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <L t="Nom"><input aria-label="Nom" required className={field} value={d.name} onChange={e => set({ name: e.target.value })} /></L>
      <L t="ISIN"><input className={field} value={d.isin} onChange={e => set({ isin: e.target.value.toUpperCase() })} /></L>
      <L t="Ticker"><input className={field} value={d.ticker} onChange={e => set({ ticker: e.target.value.toUpperCase() })} /></L>
      <L t="Place de cotation"><input className={field} value={d.exchange} onChange={e => set({ exchange: e.target.value })} /></L>
      <L t="Compte"><select aria-label="Compte" className={field} value={d.accountId} onChange={e => set({ accountId: e.target.value })}>{wealth.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></L>
      <L t="Classe d’actifs"><select aria-label="Classe d’actifs" className={field} value={d.classId} onChange={e => set({ classId: e.target.value })}>{wealth.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></L>
      <L t="Type"><select className={field} value={d.kind} onChange={e => set({ kind: e.target.value as Holding["kind"] })}><option value="quantity">Titres (quantité × cours)</option><option value="value">Valorisation en euros</option></select></L>
      {d.kind === "quantity" ? <>
        <L t="Devise"><input aria-label="Devise" className={field} maxLength={3} value={d.currency} onChange={e => { const c = e.target.value.toUpperCase(); set({ currency: c, fxRate: c === "EUR" ? 1 : d.fxRate }); }} /></L>
        <L t={`Quantité${d.fractional && account?.fractionalAllowed ? " (≤ 6 décimales)" : " (entière)"}`}><input aria-label="Quantité" className={field} type="number" min="0" step={d.fractional && account?.fractionalAllowed ? "0.000001" : "1"} value={Number.isNaN(d.quantity) ? "" : d.quantity} onChange={e => set({ quantity: num(e.target.value) })} /></L>
        <L t={`Cours (${d.currency || "—"})`}><input aria-label="Cours" className={field} type="number" min="0" step="any" value={d.price ?? ""} onChange={e => { const v = num(e.target.value); set({ price: v > 0 ? v : null }); }} /></L>
        <L t="Taux de change vers EUR"><input aria-label="Taux de change" className={field} type="number" min="0" step="any" disabled={d.currency === "EUR"} value={d.fxRate} onChange={e => set({ fxRate: num(e.target.value) })} /></L>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.fractional} disabled={!account?.fractionalAllowed} onChange={e => set({ fractional: e.target.checked })} />Fractions autorisées{!account?.fractionalAllowed && " (non disponible sur ce compte)"}</label>
      </> : <L t="Valorisation (€)"><input aria-label="Valorisation" className={field} type="number" min="0" step="any" value={Number.isNaN(d.value) ? "" : d.value} onChange={e => set({ value: num(e.target.value) })} /></L>}
      <L t="Date du cours / de la valorisation"><input aria-label="Date" className={field} type="date" value={d.priceDate ?? ""} onChange={e => set({ priceDate: e.target.value || null })} /></L>
      <div className="text-xs text-muted-foreground">Valeur en euros<p className="py-2 font-mono text-lg text-foreground">{Number.isFinite(holdingValue(d)) ? eur(holdingValue(d)) : "—"}</p></div>
    </div>
    <div className="flex gap-2"><Button type="submit" size="sm"><Save />Enregistrer</Button><Button type="button" size="sm" variant="ghost" onClick={onCancel}>Annuler</Button></div>
    {msg && <p role="alert" className="text-sm text-destructive">{msg}</p>}
  </form>;
}

export function PositionsManager() {
  const { portfolio, hydrated } = usePortfolio();
  const { wealth, hydrated: wh, error, commit } = useWealth();
  const [editing, setEditing] = useState<Holding | null>(null);
  const [msg, setMsg] = useState("");
  if (!hydrated || !wh) return <p className="p-8">Chargement des données locales…</p>;
  const lines = unifiedLines(portfolio, wealth);
  const total = lines.reduce((s, l) => s + l.value, 0);
  const n = (id: string, list: { id: string; name: string }[]) => list.find(x => x.id === id)?.name ?? id;
  const save = (input: Holding) => { const before = wealth.holdings.find(x => x.id === input.id); const manualEdit = before?.market && before.market.priceMode === "auto" && before.kind === "quantity" && before.price !== input.price; const h = manualEdit ? { ...input, market: { ...before.market!, priceMode: "manual" as const, quoteStatus: "manual" as const } } : input; try { commit(w => ({ ...w, holdings: w.holdings.some(x => x.id === h.id) ? w.holdings.map(x => x.id === h.id ? h : x) : [...w.holdings, h] })); setEditing(null); setMsg(manualEdit ? "Position enregistrée. Cours saisi à la main : la ligne passe en cours manuel (réactivable dans Contrôle des instruments)." : "Position enregistrée."); } catch (e) { setMsg(e instanceof Error ? e.message : "Enregistrement impossible."); } };
  return <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Toutes enveloppes</p><h1 className="text-2xl font-semibold">Positions individuelles</h1></div>
      <Button size="sm" onClick={() => setEditing(blank(wealth))}><Plus />Ajouter une position</Button></header>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {editing && <HoldingForm key={editing.id} initial={editing} wealth={wealth} onSave={save} onCancel={() => setEditing(null)} />}
    {msg && <p className="text-sm text-muted-foreground" role="status">{msg}</p>}
    <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-sm">
      <thead className="text-left text-xs text-muted-foreground"><tr className="border-b border-border">{["Nom", "ISIN / Ticker", "Compte", "Classe", "Quantité", "Cours", "Devise", "Mise à jour", "Valeur €", ""].map(h => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
      <tbody>{lines.map(l => { const h = l.ref; const etf = l.source === "etf" ? portfolio.positions.find(p => `etf:${p.id}` === l.id) : null; return <tr key={l.id} className="border-b border-border/60">
        <td className="px-2 py-2">{l.name}{etf && <span className="ml-2 rounded bg-secondary px-1.5 text-xs">ETF · cours Euronext</span>}</td>
        <td className="px-2 py-2 font-mono text-xs">{etf?.isin ?? h?.isin}{(h?.ticker) && ` · ${h.ticker}`}</td>
        <td className="px-2 py-2">{n(l.accountId, wealth.accounts)}</td><td className="px-2 py-2">{n(l.classId, wealth.classes)}</td>
        <td className="px-2 py-2 font-mono">{etf ? etf.quantity : h?.kind === "value" ? "—" : h?.quantity}</td>
        <td className="px-2 py-2 font-mono">{etf ? (etf.price ?? "—") : h?.kind === "value" ? "—" : (h?.price ?? "—")}</td>
        <td className="px-2 py-2">{etf ? "EUR" : h?.currency}</td><td className="px-2 py-2">{l.date ? new Date(l.date).toLocaleDateString("fr-FR") : "—"}</td>
        <td className="px-2 py-2 font-mono">{eur(l.value)}</td>
        <td className="px-2 py-2 text-right">{etf ? <Link to="/" className="text-xs underline">Gérer</Link> : h && <span className="inline-flex gap-1"><Button size="icon" variant="ghost" aria-label={`Modifier ${l.name}`} onClick={() => setEditing(h)}><Pencil /></Button><Button size="icon" variant="ghost" aria-label={`Supprimer ${l.name}`} onClick={() => { if (confirm(`Supprimer « ${l.name} » ?`)) { commit(w => ({ ...w, holdings: w.holdings.filter(x => x.id !== h.id) })); setMsg("Position supprimée."); } }}><Trash2 /></Button></span>}</td>
      </tr>; })}</tbody>
      <tfoot><tr><td colSpan={8} className="px-2 py-2 font-medium">Total (chaque position comptée une fois)</td><td className="px-2 py-2 font-mono font-medium">{eur(total)}</td><td /></tr></tfoot>
    </table></div>
    <p className="text-xs text-muted-foreground">Les ETF proviennent directement du Portefeuille ETF (source unique) ; les autres cours sont saisis manuellement.</p>
  </main>;
}
