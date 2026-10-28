import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Upload, Check, History } from "lucide-react";
import { applyTargets, importWeights, makeId, validTargets, type Portfolio, type TargetSnapshot } from "@/lib/portfolio";
import { pct, pp } from "@/lib/rebalance";

export function downloadJson(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const inputClass = "w-full rounded-md border border-input bg-surface px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring";

export function TargetEditor({ portfolio, commit }: { portfolio: Portfolio; commit: (p: Portfolio) => void }) {
  const [weights, setWeights] = useState<number[]>([]);
  const [date, setDate] = useState("");
  const [source, setSource] = useState("");
  const [pending, setPending] = useState<TargetSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [comparison, setComparison] = useState("");
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { setWeights(portfolio.positions.map((p) => p.target)); }, [portfolio.positions]);
  const sum = weights.reduce((s, w) => s + w, 0);
  const valid = validTargets(weights);
  const active = portfolio.targets.find((t) => t.id === portfolio.activeTargetId);
  const old = portfolio.targets.find((t) => t.id === comparison);
  return <div className="space-y-8">
    <header className="space-y-2"><h1 className="text-2xl font-semibold">Pondérations cibles</h1>
      <p className="max-w-3xl text-sm text-muted-foreground">Ces quatre ETF constituent une approximation du MSCI ACWI, pas une reproduction exacte de l’indice.</p>
      <p className="text-xs text-warning">Aucune pondération de référence connectée. Seules vos données datées et sourcées sont appliquées.</p>
    </header>
    <section className="space-y-5 border-y border-border py-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-medium">Nouvelles cibles</h2><div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => downloadJson(JSON.stringify({ date, source, weights: portfolio.positions.map((p, i) => ({ isin: p.isin, weight: weights[i] ?? 0 })) }, null, 2), "ponderations.json")}><Download />Exporter les pondérations</Button>
        <Button variant="outline" size="sm" onClick={() => file.current?.click()}><Upload />Importer</Button>
        <input ref={file} type="file" accept=".json,application/json" className="hidden" aria-label="Importer les pondérations" onChange={async (e) => {
          const f = e.target.files?.[0]; if (!f) return;
          try { const data = importWeights(await f.text(), portfolio.positions); setWeights(data.weights); setDate(data.date); setSource(data.source); setPending(null); setMessage("Pondérations importées, en attente de validation."); }
          catch { setMessage("Import refusé : vérifiez les ISIN, les poids, la date et la source."); }
          e.target.value = "";
        }} />
      </div></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-xs text-muted-foreground">Date des pondérations<input className={inputClass} type="date" value={date} onChange={(e) => { setDate(e.target.value); setPending(null); }} /></label>
        <label className="space-y-2 text-xs text-muted-foreground">Source des pondérations<input className={inputClass} value={source} onChange={(e) => { setSource(e.target.value); setPending(null); }} placeholder="Source ou URL de référence" /></label>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="py-3">ETF</th><th className="px-3 text-right">Cible actuelle</th><th className="px-3 text-right">Nouvelle cible</th><th className="text-right">Variation</th></tr></thead><tbody>
        {portfolio.positions.map((p, i) => <tr key={p.id} className="border-b border-border"><td className="min-w-40 py-4"><span className="block font-medium">{p.name}</span><span className="font-mono text-[10px] text-muted-foreground">{p.isin}</span></td><td className="px-3 text-right font-mono">{pct(p.target)}</td><td className="px-3"><label className="flex items-center justify-end gap-2"><input aria-label={`Nouvelle cible ${p.name}`} className={`${inputClass} max-w-24 text-right font-mono`} type="number" min="0" max="100" step="0.01" value={weights[i] ?? 0} onChange={(e) => { const v = Math.min(100, Math.max(0, Number(e.target.value) || 0)); setWeights((w) => w.map((x, j) => j === i ? v : x)); setPending(null); }} />%</label></td><td className="text-right font-mono">{pp((weights[i] ?? 0) - p.target)}</td></tr>)}
      </tbody></table></div>
      <div className="flex flex-wrap items-center justify-between gap-4"><span className={`font-mono text-sm ${valid ? "text-success" : "text-destructive"}`}>Total : {sum.toFixed(2)} %</span>
        <Button disabled={!valid || !date || !source.trim()} onClick={() => {
          try { const snapshot = { id: makeId(), date, source, weights: portfolio.positions.map((p, i) => ({ id: p.id, name: p.name, weight: weights[i] ?? 0 })), validatedAt: new Date().toISOString() }; applyTargets(portfolio, snapshot); setPending(snapshot); setMessage(""); }
          catch { setMessage("Les pondérations, leur date ou leur source sont invalides."); }
        }}><Check />Valider les nouvelles cibles</Button>
      </div>
      {pending && <div role="dialog" aria-label="Confirmer les nouvelles cibles" className="space-y-3 border-l-2 border-accent bg-surface-muted p-4"><p className="text-sm">Appliquer ces cibles du {pending.date}, source « {pending.source} » ? Les anciennes cibles resteront dans l’historique.</p><div className="flex gap-2"><Button size="sm" onClick={() => { try { commit(applyTargets(portfolio, pending)); setPending(null); setMessage("Cibles validées et appliquées."); } catch (e) { setMessage(e instanceof Error ? e.message : "Enregistrement impossible."); } }}>Confirmer l’application</Button><Button size="sm" variant="ghost" onClick={() => setPending(null)}>Annuler</Button></div></div>}
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </section>
    <section className="space-y-4"><h2 className="flex items-center gap-2 font-medium"><History className="size-4" />Historique des pondérations validées</h2>
      {active && <p className="text-xs text-muted-foreground">Cibles actives : {active.date} · {active.source}</p>}
      {!portfolio.targets.length && <p className="text-sm text-muted-foreground">Aucune pondération validée.</p>}
      {portfolio.targets.length > 0 && <><label className="block space-y-2 text-xs text-muted-foreground">Comparer avec les cibles actuelles<select className={inputClass} value={comparison} onChange={(e) => setComparison(e.target.value)}><option value="">Choisir une version</option>{[...portfolio.targets].reverse().map((t) => <option key={t.id} value={t.id}>{t.date} — {t.source}</option>)}</select></label>
      {old && <div className="divide-y divide-border">{old.weights.map((w) => <div key={w.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><span>{w.name}</span><span className="font-mono">{pct(w.weight)} → {pct(portfolio.positions.find((p) => p.id === w.id)?.target ?? 0)} <span className="text-muted-foreground">({pp((portfolio.positions.find((p) => p.id === w.id)?.target ?? 0) - w.weight)})</span></span></div>)}</div>}
      <ul className="divide-y divide-border">{[...portfolio.targets].reverse().map((t) => <li key={t.id} className="flex flex-wrap justify-between gap-3 py-4 text-sm"><span>{t.date} · {t.source}<span className="mt-1 block font-mono text-[10px] text-muted-foreground">Validation : {new Date(t.validatedAt).toLocaleString("fr-FR")}</span></span><span className="font-mono text-xs text-muted-foreground">{t.weights.map((w) => pct(w.weight)).join(" / ")}{t.id === portfolio.activeTargetId ? " · Active" : ""}</span></li>)}</ul></>}
    </section>
  </div>;
}