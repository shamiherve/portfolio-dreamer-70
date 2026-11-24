import { useRef, useState } from "react";
import { Download, Upload, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseRestoration, readCompleteBackup, restoreBackup, snapshot, type Restoration } from "@/lib/backup-restoration";
import { SAFETY_KEY, recoverLocalTransaction } from "@/lib/local-transaction";
import { downloadJson } from "./target-editor";

export function FullBackupExport({ ready }: { ready: boolean }) {
  const [summary, setSummary] = useState<ReturnType<typeof readCompleteBackup> | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ restoration: Restoration; expected: Record<string, string | null>; name: string } | null>(null);
  const [safetyAvailable, setSafetyAvailable] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  return <section className="space-y-3 border-y border-border py-4" aria-label="Sauvegarde patrimoniale complète">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold">Sauvegarde patrimoniale complète · v2</h2>
      <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={!ready} onClick={() => {
        setSummary(null); setError("");
        try {
          const result = readCompleteBackup(localStorage);
          downloadJson(result.content, result.filename);
          setSummary(result);
        } catch {
          setError("Export complet refusé : données illisibles, champs inconnus ou relations incohérentes. Aucune donnée modifiée. L’export ETF reste disponible ; une migration explicite sera nécessaire pour des champs ou une version non reconnus.");
        }
      }}><Download className="text-success" />Exporter mon patrimoine complet</Button>
      <Button size="sm" variant="outline" disabled={!ready} onClick={() => file.current?.click()}><Upload className="text-info" />Restaurer une sauvegarde</Button>
      <Button size="sm" variant="ghost" disabled={!ready} onClick={() => {
        try { const raw = localStorage.getItem(SAFETY_KEY); if (!raw) throw new Error("Aucune copie de sécurité locale disponible."); parseRestoration(raw); downloadJson(raw, "equilibre-copie-securite.json"); setError(""); }
        catch (e) { setError(e instanceof Error ? e.message : "Copie indisponible."); }
      }}><ShieldCheck className="text-destructive" />Télécharger la copie de sécurité</Button>
      </div>
      <input ref={file} className="hidden" type="file" accept=".json,application/json" aria-label="Fichier de restauration complète" onChange={async e => {
        const f = e.target.files?.[0]; e.target.value = ""; setPending(null); setError(""); if (!f) return;
        try { if (f.size > 20 * 1024 * 1024) throw new Error("Sauvegarde trop volumineuse : maximum 20 Mo."); recoverLocalTransaction(localStorage); const restoration = parseRestoration(await f.text()); setPending({ restoration, expected: snapshot(localStorage), name: f.name }); }
        catch (err) { setError(`Restauration refusée : ${err instanceof Error ? err.message : "fichier invalide"}. Aucune donnée remplacée.`); }
      }} />
    </div>
    {pending && <div role="dialog" aria-label="Confirmer la restauration complète" className="space-y-3 border-l-2 border-warning bg-surface-muted p-4">
      <h3 className="font-semibold">Restaurer « {pending.name} » ?</h3>
      <p className="text-sm">{pending.restoration.backup.portfolio.positions.length} positions ETF · {pending.restoration.backup.simulations.length} simulations{pending.restoration.kind !== "etf-v1" ? ` · ${pending.restoration.backup.wealth.holdings.length} positions non-ETF · ${pending.restoration.backup.wealth.accounts.length} comptes` : ""}{pending.restoration.kind === "complete-v2" ? ` · ${pending.restoration.backup.ledger.events.length} événements` : ""}.</p>
      <p className="text-sm text-warning">{pending.restoration.kind === "etf-v1" ? "Ancienne sauvegarde ETF : seuls ETF et simulations seront remplacés. Patrimoine, thème et grand livre restent inchangés." : pending.restoration.kind === "complete-v1" ? "Sauvegarde complète v1 : patrimoine et thème remplacés, grand livre actuel conservé car absent du fichier." : "Données patrimoniales, grand livre et thème remplacés. Comptes/instruments supplémentaires et instantanés remplacés seulement si leur section est présente ; sinon conservés après contrôle des références."} Une copie de sécurité locale sera vérifiée avant remplacement. Fermez les autres onglets de l’application.</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => {
        try { restoreBackup(localStorage, pending.restoration, pending.expected); setSafetyAvailable(true); setPending(null); window.location.reload(); }
        catch (err) { setError(err instanceof Error ? err.message : "Restauration impossible."); }
      }}>Confirmer la restauration</Button><Button size="sm" variant="outline" onClick={() => setPending(null)}>Annuler</Button></div>
    </div>}
    {safetyAvailable && <p role="status" className="text-sm text-success">Restauration enregistrée. Copie de sécurité locale conservée.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {summary && <div role="status" className="space-y-2 text-sm">
      <p>Fichier complet v2 généré, téléchargement déclenché le {new Date(summary.backup.exportedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} (Paris).</p>
      <p className="text-muted-foreground">{summary.backup.portfolio.positions.length} positions ETF · {summary.backup.wealth.holdings.length} positions non-ETF · {summary.backup.wealth.accounts.length} comptes · {summary.backup.wealth.classes.length} classes · {summary.backup.simulations.length} simulations · {summary.backup.ledger.events.length} événements financiers · thème</p>
      {summary.backup.financialRegistry && <p className="text-muted-foreground">Gestion financière : {summary.backup.financialRegistry.accounts.length} comptes/renseignements · {summary.backup.financialRegistry.instruments.length} instruments/renseignements · {summary.backup.financialRegistry.valuations.length} valorisations et corrections conservées.</p>}
      {summary.backup.snapshots && <p className="text-muted-foreground">{summary.backup.snapshots.items.length} instantanés quotidiens inclus.</p>}
      {summary.warnings.map(w => <p key={w} className="text-warning">{w}</p>)}
      <p className="text-muted-foreground">Brouillons non enregistrés exclus. Aucun PRU ou historique absent n’est ajouté. Conservez ce fichier privé ; vérifiez sa présence dans vos téléchargements. Les sauvegardes complètes v1 et les anciennes sauvegardes ETF restent compatibles avec un périmètre explicite.</p>
    </div>}
  </section>;
}