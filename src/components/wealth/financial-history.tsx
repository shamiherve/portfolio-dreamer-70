import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { registryHistory, visibleAccounts, type FinancialRegistry } from "@/lib/financial-registry";
import type { Wealth } from "@/lib/wealth";
import { eur } from "@/lib/rebalance";
import { field } from "./shared";

export function FinancialHistory({ registry, wealth }: { registry: FinancialRegistry; wealth: Wealth }) {
  const accounts = visibleAccounts(registry, wealth).filter(a => registry.valuations.some(v => v.accountId === a.id));
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<"value" | "performance">("value");
  const id = accounts.some(a => a.id === selected) ? selected : accounts[0]?.id;
  if (!id) return null;
  const rows = registryHistory(registry, id);
  return <section className="space-y-3 border-y border-border py-4" aria-label="Historique des nouveaux supports">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Historique des nouveaux supports</h2><div className="flex flex-wrap gap-2">
      <select aria-label="Compte de l’historique manuel" className={field} value={id} onChange={e => setSelected(e.target.value)}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}{!a.active ? " (inactif)" : ""}</option>)}</select>
      <Button variant={mode === "value" ? "default" : "outline"} size="sm" onClick={() => setMode("value")}>Valeur (€)</Button><Button variant={mode === "performance" ? "default" : "outline"} size="sm" onClick={() => setMode("performance")}>Performance (%)</Button>
    </div></div>
    <div className="h-64 w-full"><ResponsiveContainer><LineChart data={rows}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="date" stroke="var(--muted-foreground)" fontSize={11} /><YAxis width={80} stroke="var(--muted-foreground)" fontSize={11} /><Tooltip contentStyle={{ background: "var(--popover)", color: "var(--popover-foreground)", borderColor: "var(--border)" }} formatter={v => mode === "value" ? eur(Number(v)) : `${Number(v).toFixed(2)} %`} /><Line dataKey={mode} name={mode === "value" ? "Valeur totale observée" : "Performance (flux neutralisés)"} stroke="var(--chart-1)" type="stepAfter" dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
    {rows.some(r => r.performance === null) && <p className="text-xs text-warning">Performance indisponible à partir du premier intervalle sans apports/retraits documentés ; aucune variation n’est assimilée à un versement.</p>}
    <details className="text-sm"><summary className="cursor-pointer">Valeurs observées et flux documentés</summary><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Date</th><th className="p-2">Valeur €</th><th className="p-2">Flux externe €</th><th className="p-2">Performance</th></tr></thead><tbody>{rows.map(r => <tr key={r.date} className="border-t border-border"><td className="p-2">{r.date}</td><td className="p-2">{eur(r.value)}</td><td className="p-2">{r.flow === null ? "Non documenté" : eur(r.flow)}</td><td className="p-2">{r.performance === null ? "Indisponible" : `${r.performance.toFixed(2)} %`}</td></tr>)}</tbody></table></div></details>
  </section>;
}