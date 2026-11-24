import { useState } from "react";
import { Button } from "@/components/ui/button";
import { appendLedger, readCompleteBackup, parseRestoration, type CompleteBackup } from "@/lib/backup-restoration";
import { snapshot } from "@/lib/local-transaction";
import { planConsolidatedImport } from "@/lib/history-commit";
import type { finalHistoryReview } from "@/lib/history-final-review";
import type { ImportSheet } from "@/lib/history-import";
import { downloadJson } from "@/components/portfolio/target-editor";

type Report = { imported: number; present: number; informational: number; rejected: number; cash: { pea: number; cto: number }; unchanged: string[]; changed: string[]; backup: string };
const KEYS: [string, string][] = [["equilibre.portfolio.v1", "Positions ETF, cours, objectifs"], ["equilibre.wealth.v1", "Patrimoine, comptes, allocations"], ["equilibre.simulations.v1", "Simulations"], ["equilibre.theme.v1", "Thème"]];
export function ConsolidatedImport({ review, sheets, data, expected, usualBrowser, onDone }: { review: ReturnType<typeof finalHistoryReview>; sheets: ImportSheet[]; data: CompleteBackup; expected: Record<string, string | null>; usualBrowser: boolean; onDone: () => void }) {
  const [report, setReport] = useState<Report | null>(null); const [error, setError] = useState("");
  const plan = planConsolidatedImport(review, sheets, data.ledger, usualBrowser);
  const run = () => {
    setError("");
    try {
      const before = snapshot(localStorage);
      const backup = readCompleteBackup(localStorage); parseRestoration(backup.content); // verifiable full backup before any write
      downloadJson(backup.content, backup.filename);
      appendLedger(localStorage, { version: 1, events: [...data.ledger.events, ...plan.incoming], updatedAt: new Date().toISOString() }, expected);
      const after = snapshot(localStorage);
      setReport({ imported: plan.incoming.length, present: plan.present, informational: plan.informational, rejected: plan.rejected, cash: plan.cash, unchanged: KEYS.filter(([k]) => before[k] === after[k]).map(([, l]) => l), changed: KEYS.filter(([k]) => before[k] !== after[k]).map(([, l]) => l), backup: backup.filename });
      onDone();
    } catch (e) { setError(`Import interrompu, aucune donnée modifiée : ${e instanceof Error ? e.message : "erreur inconnue"}`); }
  };
  if (report) return <section className="space-y-2 border-y border-border py-4 text-sm" aria-label="Compte rendu d’import"><h2 className="text-lg font-semibold text-success">Import terminé</h2>
    <p>{report.imported} opérations importées · {report.present} doublons évités (déjà présentes) · {report.informational} lignes informatives ignorées · {report.rejected} anomalie(s).</p>
    <p>Soldes espèces : PEA {report.cash.pea} € · CTO {report.cash.cto} €.</p>
    <p>Sauvegarde complète téléchargée : {report.backup} · copie de sécurité locale conservée.</p>
    <p>Inchangés : {report.unchanged.join(", ") || "—"}.{report.changed.length ? <span className="text-destructive"> Modifiés : {report.changed.join(", ")}.</span> : null}</p></section>;
  return <section className="space-y-3 border-y border-border py-4" aria-label="Import du fichier consolidé"><h2 className="text-lg font-semibold">Import dans le grand livre · contrôles préalables</h2>
    <ul className="space-y-1 text-sm">{plan.checks.map(c => <li key={c.label} className={c.ok ? "text-success" : "text-destructive"}>{c.ok ? "✓" : "✗"} {c.label} — <span className="text-muted-foreground">{c.detail}</span></li>)}</ul>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={!plan.ok} onClick={run}>Sauvegarder puis importer {plan.incoming.length} opérations</Button>
    {!plan.ok && <p className="text-xs text-muted-foreground">Import bloqué tant qu’un contrôle échoue ; aucune donnée n’est modifiée.</p>}
    <p className="text-xs text-muted-foreground">Seul le grand livre est complété ; positions, cours, objectifs et comptes ne sont jamais écrits.</p></section>;
}
