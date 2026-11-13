import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readFullBackup } from "@/lib/full-backup";
import { downloadJson } from "./target-editor";

export function FullBackupExport({ ready }: { ready: boolean }) {
  const [summary, setSummary] = useState<ReturnType<typeof readFullBackup> | null>(null);
  const [error, setError] = useState("");
  return <section className="space-y-3 border-y border-border py-4" aria-label="Sauvegarde patrimoniale complète">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold">Sauvegarde patrimoniale complète · v1</h2>
      <Button size="sm" variant="outline" disabled={!ready} onClick={() => {
        setSummary(null); setError("");
        try {
          const result = readFullBackup(localStorage);
          downloadJson(result.content, result.filename);
          setSummary(result);
        } catch {
          setError("Export complet refusé : données illisibles, champs inconnus ou relations incohérentes. Aucune donnée modifiée. L’export ETF reste disponible ; une migration explicite sera nécessaire pour des champs ou une version non reconnus.");
        }
      }}><Download />Exporter mon patrimoine complet</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {summary && <div role="status" className="space-y-2 text-sm">
      <p>Fichier complet v1 généré, téléchargement déclenché le {new Date(summary.backup.exportedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} (Paris).</p>
      <p className="text-muted-foreground">{summary.backup.portfolio.positions.length} positions ETF · {summary.backup.wealth.holdings.length} positions non-ETF · {summary.backup.wealth.accounts.length} comptes · {summary.backup.wealth.classes.length} classes · {summary.backup.simulations.length} simulations</p>
      {summary.warnings.map(w => <p key={w} className="text-warning">{w}</p>)}
      <p className="text-muted-foreground">Brouillons non enregistrés exclus. Aucun PRU ou historique absent n’est ajouté. Conservez ce fichier privé ; vérifiez sa présence dans vos téléchargements. La restauration complète n’est pas encore disponible ; l’import actuel reste limité aux sauvegardes ETF.</p>
    </div>}
  </section>;
}