import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useWealth } from "@/lib/use-wealth";
import { targetIssues, PARENT_GROUPS } from "@/lib/wealth";

export function AllocationSettings() {
  const { wealth, hydrated, error } = useWealth();
  if (!hydrated) return <p className="p-8">Chargement…</p>;
  const issues = targetIssues(wealth);
  return <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
    <header><p className="text-xs uppercase tracking-wide text-muted-foreground">Objectifs de référence</p><h1 className="text-2xl font-semibold">Allocation cible</h1><p className="mt-2 text-sm text-muted-foreground">Allocations figées. Les nouveaux comptes et supports ne changent ni ces objectifs, ni leurs dénominateurs.</p></header>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <section className="space-y-2"><h2 className="font-semibold">Par compte</h2>{wealth.accounts.map(a => <div key={a.id} className="flex justify-between gap-3 border-b border-border/60 py-2"><span>{a.name}</span><span className="font-mono">{a.target} %</span></div>)}</section>
    <section className="space-y-2"><h2 className="font-semibold">Par classe d’actifs</h2>
      {Object.entries(PARENT_GROUPS).map(([pid, pname]) => <p key={pid} className="text-sm text-muted-foreground">{pname} (parente) = {wealth.classes.filter(c => c.parent === pid).reduce((s, c) => s + c.target, 0)} % — non additionnée au total.</p>)}
      {wealth.classes.map(c => <div key={c.id} className="flex justify-between gap-3 border-b border-border/60 py-2"><span className={c.parent ? "pl-4" : ""}>{c.parent && "↳ "}{c.name}</span><span className="font-mono">{c.target} %</span></div>)}
    </section>
    <section className="space-y-2"><h2 className="font-semibold">Répartition compte × classe</h2><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="p-2">Compte</th>{wealth.classes.map(c => <th key={c.id} className="p-2">{c.name}</th>)}</tr></thead><tbody>{wealth.accounts.map(a => <tr key={a.id} className="border-b border-border/60"><td className="p-2">{a.name}</td>{wealth.classes.map(c => <td key={c.id} className="p-2 font-mono">{wealth.mapping.find(m => m.accountId === a.id && m.classId === c.id)?.target ?? 0} %</td>)}</tr>)}</tbody></table></div></section>
    {issues.length > 0 && <div role="alert" className="text-sm text-warning">{issues.join(" ")} Aucun objectif corrigé automatiquement.</div>}
    <Button asChild variant="outline"><Link to="/targets">Consulter les pondérations ETF</Link></Button>
  </main>;
}
