import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { eur } from "@/lib/rebalance";
import type { Row } from "@/lib/wealth";

export const field = "w-full rounded-md border border-input bg-surface px-2 py-2 text-sm outline-none focus:ring-1 focus:ring-ring";
export const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
export const sevClass = { ok: "text-success", moderate: "text-warning", high: "text-destructive" } as const;
export const statusLabel = { under: "Sous-pondéré", balanced: "Équilibré", over: "Surpondéré" } as const;
export const fmtPct = (n: number) => `${n.toFixed(1)} %`;
export const fmtPp = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)} pp`;

export function Donut({ title, data }: { title: string; data: { name: string; value: number; pct: number }[] }) {
  const has = data.some(d => d.value > 0);
  return <figure className="rounded-lg border border-border bg-surface p-4">
    <figcaption className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</figcaption>
    <div className="h-40">{has ? <ResponsiveContainer><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="90%" stroke="var(--surface)" isAnimationActive={false}>{data.map((d, i) => <Cell key={d.name} fill={PALETTE[i % PALETTE.length]} />)}</Pie><Tooltip formatter={(v: number) => eur(v)} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", color: "var(--popover-foreground)" }} /></PieChart></ResponsiveContainer> : <p className="grid h-full place-items-center text-sm text-muted-foreground">Aucune valeur</p>}</div>
    <ul className="mt-2 space-y-1 text-xs">{data.map((d, i) => <li key={d.name} className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />{d.name}</span><span className="font-mono">{fmtPct(d.pct)} · {eur(d.value)}</span></li>)}</ul>
  </figure>;
}

export function AllocationTable({ rows, label, children }: { rows: Row[]; label: string; children?: (r: Row) => React.ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
    <thead className="text-left text-xs text-muted-foreground"><tr className="border-b border-border">{[label, "Cible", "Actuel", "Valeur cible", "Valeur actuelle", "Écart pp", "Écart €", "Statut"].map(h => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
    <tbody>{rows.map(r => <tr key={r.id} className="border-b border-border/60">
      <td className="px-2 py-2">{children ? children(r) : r.name}</td>
      <td className="px-2 py-2 font-mono">{fmtPct(r.target)}</td><td className="px-2 py-2 font-mono">{fmtPct(r.actual)}</td>
      <td className="px-2 py-2 font-mono">{eur(r.targetValue)}</td><td className="px-2 py-2 font-mono">{eur(r.value)}</td>
      <td className={`px-2 py-2 font-mono ${sevClass[r.severity]}`}>{fmtPp(r.diffPp)}</td><td className={`px-2 py-2 font-mono ${sevClass[r.severity]}`}>{r.diffEur >= 0 ? "+" : "−"}{eur(Math.abs(r.diffEur))}</td>
      <td className={`px-2 py-2 ${sevClass[r.severity]}`}><span aria-hidden>● </span>{statusLabel[r.status]}</td>
    </tr>)}</tbody></table></div>;
}
