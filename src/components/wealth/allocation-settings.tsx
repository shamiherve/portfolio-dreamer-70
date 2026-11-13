import { useEffect, useState } from "react";
import { Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWealth } from "@/lib/use-wealth";
import { initialWealth, targetIssues, PARENT_GROUPS, type Wealth } from "@/lib/wealth";
import { field } from "./shared";

export function AllocationSettings() {
  const { wealth, hydrated, error, commit } = useWealth();
  const [d, setD] = useState<Wealth>(wealth);
  const [msg, setMsg] = useState("");
  useEffect(() => { if (hydrated) setD(wealth); }, [hydrated, wealth]);
  if (!hydrated) return <p className="p-8">Chargement…</p>;
  const issues = targetIssues(d);
  const pctIn = (v: number, on: (n: number) => void, label: string) => <input aria-label={label} className={`${field} w-24 text-right font-mono`} type="number" min="0" max="100" step="0.1" value={v} onChange={e => on(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} />;
  const mapVal = (a: string, c: string) => d.mapping.find(m => m.accountId === a && m.classId === c)?.target ?? 0;
  const setMap = (a: string, c: string, t: number) => setD(x => ({ ...x, mapping: [...x.mapping.filter(m => !(m.accountId === a && m.classId === c)), ...(t > 0 ? [{ accountId: a, classId: c, target: t }] : [])] }));
  return <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
    <header><p className="text-xs uppercase tracking-wide text-muted-foreground">Paramètres</p><h1 className="text-2xl font-semibold">Allocation cible</h1></header>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <section className="space-y-2"><h2 className="font-semibold">Par compte</h2>
      {d.accounts.map((a, i) => <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 py-2"><span>{a.name}</span><span className="flex items-center gap-3"><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={a.fractionalAllowed} onChange={e => setD(x => ({ ...x, accounts: x.accounts.map((y, j) => j === i ? { ...y, fractionalAllowed: e.target.checked } : y) }))} />Fractions</label>{pctIn(a.target, t => setD(x => ({ ...x, accounts: x.accounts.map((y, j) => j === i ? { ...y, target: t } : y) })), `Cible ${a.name}`)} %</span></div>)}
    </section>
    <section className="space-y-2"><h2 className="font-semibold">Par classe d’actifs</h2>
      {Object.entries(PARENT_GROUPS).map(([pid, pname]) => <p key={pid} className="text-sm text-muted-foreground">{pname} (parente) = {d.classes.filter(c => c.parent === pid).reduce((s, c) => s + c.target, 0)} % — calculée, non additionnée au total.</p>)}
      {d.classes.map((c, i) => <div key={c.id} className="flex items-center justify-between gap-3 border-b border-border/60 py-2"><span className={c.parent ? "pl-4" : ""}>{c.parent && "↳ "}{c.name}</span><span>{pctIn(c.target, t => setD(x => ({ ...x, classes: x.classes.map((y, j) => j === i ? { ...y, target: t } : y) })), `Cible ${c.name}`)} %</span></div>)}
      <p className="text-sm">Total des catégories non superposées : <strong className="font-mono">{d.classes.reduce((s, c) => s + c.target, 0).toFixed(1)} %</strong></p>
    </section>
    <section className="space-y-2"><h2 className="font-semibold">Répartition compte × classe</h2>
      <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="px-2 py-2">Compte</th>{d.classes.map(c => <th key={c.id} className="px-2 py-2">{c.name}</th>)}</tr></thead>
        <tbody>{d.accounts.map(a => <tr key={a.id} className="border-b border-border/60"><td className="px-2 py-2">{a.name}</td>{d.classes.map(c => <td key={c.id} className="px-2 py-2">{pctIn(mapVal(a.id, c.id), t => setMap(a.id, c.id, t), `${a.name} ${c.name}`)}</td>)}</tr>)}</tbody></table></div>
    </section>
    {issues.length > 0 ? <div role="alert" className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm"><p className="font-medium">Cibles incohérentes : enregistrement bloqué</p><ul className="ml-5 list-disc">{issues.map(x => <li key={x}>{x}</li>)}</ul></div> : <p className="text-sm text-success">Cibles cohérentes : comptes, classes et répartition totalisent 100 %.</p>}
    <div className="flex gap-2"><Button disabled={issues.length > 0} onClick={() => { try { commit(w => ({ ...w, accounts: d.accounts, classes: d.classes, mapping: d.mapping })); setMsg("Cibles enregistrées."); } catch (e) { setMsg(e instanceof Error ? e.message : "Erreur"); } }}><Save />Enregistrer les cibles</Button>
      <Button variant="ghost" onClick={() => { const i = initialWealth(); setD(x => ({ ...x, accounts: i.accounts, classes: i.classes, mapping: i.mapping })); }}><RotateCcw />Cibles initiales</Button></div>
    {msg && <p role="status" className="text-sm">{msg}</p>}
  </main>;
}
