import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, History } from "lucide-react";
import { type Portfolio } from "@/lib/portfolio";
import { pct, pp } from "@/lib/rebalance";

export function downloadJson(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const inputClass = "w-full rounded-md border border-input bg-surface px-3 py-2 text-sm";
export function TargetEditor({ portfolio }: { portfolio: Portfolio; commit: (p: Portfolio) => void }) {
  const [comparison, setComparison] = useState("");
  const active = portfolio.targets.find(t => t.id === portfolio.activeTargetId);
  const old = portfolio.targets.find(t => t.id === comparison);
  return <div className="space-y-8">
    <header className="space-y-2"><h1 className="text-2xl font-semibold">Pondérations cibles ETF</h1><p className="text-sm text-muted-foreground">Pondérations figées, propres aux ETF. Elles sont distinctes des objectifs globaux par compte et classe.</p></header>
    <section className="space-y-4 border-y border-border py-6">
      <div className="flex flex-wrap justify-between gap-3"><h2 className="font-medium">Pondérations de référence</h2><Button variant="outline" size="sm" onClick={() => downloadJson(JSON.stringify({ date: active?.date ?? null, source: active?.source ?? null, weights: portfolio.positions.map(p => ({ isin: p.isin, weight: p.target })) }, null, 2), "ponderations.json")}><Download />Exporter les pondérations</Button></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border"><th className="py-3">ETF / ISIN</th><th className="text-right">Cible</th></tr></thead><tbody>{portfolio.positions.map(p => <tr key={p.id} className="border-b border-border"><td className="py-3">{p.name}<span className="block font-mono text-xs text-muted-foreground">{p.isin}</span></td><td className="text-right font-mono">{pct(p.target)}</td></tr>)}</tbody></table></div>
      <p className="text-sm">Total : {portfolio.positions.reduce((s, p) => s + p.target, 0).toFixed(2)} %</p>
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
