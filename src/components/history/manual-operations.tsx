import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { downloadJson } from "@/components/portfolio/target-editor";
import { readCompleteBackup, type CompleteBackup } from "@/lib/backup-restoration";
import { instruments, existingEtf, operationLabels, type LedgerEvent } from "@/lib/ledger";
import { visibleAccounts, emptyRegistry } from "@/lib/financial-registry";
import { buildDraft, emptyInput, hasCash, isManual, manualTypes, needsInstrument, netCash, needsPrice, needsQuantity, writeManualChange, type ManualInput, type ManualType } from "@/lib/manual-entry";

const inputClass = "w-full rounded-md border border-input bg-surface px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring";
const money = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
const fromEvent = (e: LedgerEvent): ManualInput => ({ accountId: e.accountId, type: e.type as ManualType, date: e.operationDate, instrumentId: e.instrumentId ?? "", quantity: e.quantity === null ? "" : String(e.quantity), price: e.executionPrice === null ? "" : String(e.executionPrice), gross: String(e.amount), fees: String(e.fees), net: String(Math.abs(netCash(e.type as ManualType, e.amount, e.fees))), splitRatio: e.splitRatio === null ? "" : String(e.splitRatio) });

export function ManualOperations({ data, expected, onSaved }: { data: CompleteBackup | null; expected: Record<string, string | null> | null; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ManualInput>(emptyInput());
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const [id, setId] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())));
  const set = (p: Partial<ManualInput>) => { setForm(f => ({ ...f, ...p })); setConfirmed(false); };
  const now = new Date().toISOString();
  const draft = useMemo(() => data ? buildDraft(form, { portfolio: data.portfolio, wealth: data.wealth, events: data.ledger.events, registry: data.financialRegistry ?? emptyRegistry(), id: editing ?? `manual-${id}`, now, ...(editing ? { replacing: editing } : {}) }) : null, [data, form, editing, id]);
  const known = data ? instruments(data.portfolio, data.wealth, data.financialRegistry).filter(i => i.accountId === form.accountId && i.isin) : [];
  const accounts = data ? visibleAccounts(data.financialRegistry ?? emptyRegistry(), data.wealth) : [];
  const legacy = data?.portfolio.transactions.filter(t => !data.ledger.events.some(e => existingEtf(e, data.portfolio)?.id === t.id)) ?? [];
  const events = [...(data?.ledger.events ?? [])].sort((a, b) => b.operationDate.localeCompare(a.operationDate));
  const run = (change: { add?: LedgerEvent; remove?: string }, done: string) => {
    if (!expected) return; setError("");
    try {
      const backup = readCompleteBackup(localStorage); downloadJson(backup.content, backup.filename);
      const { pruned } = writeManualChange(localStorage, change, expected);
      setMessage(`${done} Sauvegarde complète téléchargée. Vues et courbes actualisées depuis les données partagées${pruned ? ` ; ${pruned} instantané(s) devenu(s) obsolète(s) retiré(s)` : ""}.`);
      setOpen(false); setEditing(null); setDeleting(null); setForm(emptyInput()); setConfirmed(false); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement refusé."); }
  };
  const t = form.type;
  return <section className="space-y-4 border-b border-border pb-6" aria-label="Saisie manuelle">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Opérations du grand livre</h2><p className="text-sm text-muted-foreground">Import Excel et saisie manuelle alimentent le même grand livre. Les opérations importées sont protégées ; seules les saisies manuelles se modifient.</p></div>
      <Button disabled={!data} onClick={() => { setId(crypto.randomUUID()); setOpen(o => !o); setEditing(null); setForm(emptyInput()); setConfirmed(false); }}><Plus />Ajouter une opération</Button></div>
    {message && <p role="status" className="text-sm">{message}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {open && data && <div className="space-y-4 rounded-md border border-border p-4">
      <h3 className="font-medium">{editing ? "Modifier l’opération saisie" : "Nouvelle opération"}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-xs text-muted-foreground">Compte<select aria-label="Compte" className={inputClass} value={form.accountId} onChange={e => set({ accountId: e.target.value, instrumentId: "" })}>{accounts.filter(a => a.active && a.currency === "EUR").map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label className="space-y-1 text-xs text-muted-foreground">Type<select aria-label="Type" className={inputClass} value={t} onChange={e => set({ type: e.target.value as ManualType })}>{manualTypes.map(x => <option key={x} value={x}>{x === "corporate_action" ? "Autre opération sur titres" : operationLabels[x]}</option>)}</select></label>
        <label className="space-y-1 text-xs text-muted-foreground">Date de l’opération<input aria-label="Date de l’opération" type="date" className={inputClass} value={form.date} max={now.slice(0, 10)} onChange={e => set({ date: e.target.value })} /></label>
        {needsInstrument(t) && <label className="space-y-1 text-xs text-muted-foreground">Instrument<select aria-label="Instrument" className={inputClass} value={form.instrumentId} onChange={e => set({ instrumentId: e.target.value })}><option value="">Choisir…</option>{known.map(i => <option key={i.id} value={i.id}>{i.name} · {i.isin}</option>)}</select></label>}
        {needsQuantity(t) && t !== "corporate_action" && <label className="space-y-1 text-xs text-muted-foreground">{t === "split" ? "Parts ajoutées (contrôle)" : "Quantité"}<input aria-label="Quantité" inputMode="decimal" className={inputClass} value={form.quantity} onChange={e => set({ quantity: e.target.value })} /></label>}
        {t === "split" && <label className="space-y-1 text-xs text-muted-foreground">Ratio (1 → N)<input inputMode="decimal" className={inputClass} value={form.splitRatio} onChange={e => set({ splitRatio: e.target.value })} /></label>}
        {needsPrice(t) && <label className="space-y-1 text-xs text-muted-foreground">Prix d’exécution (facultatif)<input inputMode="decimal" className={inputClass} value={form.price} onChange={e => set({ price: e.target.value })} /></label>}
        {hasCash(t) && <>
          <label className="space-y-1 text-xs text-muted-foreground">Montant brut (€)<input aria-label="Montant brut (€)" inputMode="decimal" className={inputClass} value={form.gross} onChange={e => set({ gross: e.target.value })} /></label>
          {t !== "fee" && t !== "tax" && <label className="space-y-1 text-xs text-muted-foreground">Frais (€)<input inputMode="decimal" className={inputClass} value={form.fees} onChange={e => set({ fees: e.target.value })} /></label>}
          <label className="space-y-1 text-xs text-muted-foreground">Montant net (€)<input aria-label="Montant net (€)" inputMode="decimal" className={inputClass} value={form.net} onChange={e => set({ net: e.target.value })} /></label>
        </>}
      </div>
      {hasCash(t) && <p className="text-xs text-muted-foreground">{["buy", "withdrawal"].includes(t) ? "Net débité = brut + frais." : ["fee", "tax"].includes(t) ? "Net débité = brut." : "Net crédité = brut − frais."} Les frais ne sont déduits qu’une seule fois.</p>}
      {draft && <div className="space-y-2 border-t border-border pt-3 text-sm">
        <h4 className="font-medium">Récapitulatif et conséquences</h4>
        <ul className="space-y-1">
          <li>{form.accountId.toUpperCase()} · {t === "corporate_action" ? "Opération sur titres" : operationLabels[t]} · {form.date || "date manquante"}{draft.event?.instrumentName ? ` · ${draft.event.instrumentName} (${draft.event.isin})` : ""}</li>
          <li>Espèces : {draft.cash >= 0 ? "+" : ""}{money(draft.cash)}{t === "deposit" || t === "withdrawal" ? " · apport/retrait externe, neutralisé dans la performance" : t === "buy" ? " · converties en titres, sans hausse artificielle du patrimoine" : ""}</li>
          {draft.heldBefore !== null && <li>Quantité reconstituée à cette date : {draft.heldBefore} → {draft.heldAfter}</li>}
          <li className="text-muted-foreground">{editing && !data.ledger.events.find(e => e.id === editing)?.source.positionApplied ? "Correction d’une ancienne saisie : positions conservées, rapprochement nécessaire." : "Les achats, ventes et splits confirmés ajustent uniquement la quantité de la position référencée ; aucune position historique n’est créée."} Objectifs et cours inchangés ; historique recalculé depuis le {form.date || "…"}.</li>
        </ul>
        {draft.warnings.map(w => <p key={w} className="text-xs text-muted-foreground">⚠ {w}</p>)}
        {draft.errors.map(e => <p key={e} role="alert" className="text-xs text-destructive">✗ {e}</p>)}
        <label className="flex items-start gap-2"><Checkbox checked={confirmed} disabled={!draft.event} onCheckedChange={c => setConfirmed(c === true)} aria-label="Confirmer l’opération" /><span>Je confirme cette opération et ses conséquences.</span></label>
        <div className="flex gap-2"><Button disabled={!draft.event || !confirmed} onClick={() => draft.event && run(editing ? { remove: editing, add: draft.event } : { add: draft.event }, editing ? "Opération modifiée." : "Opération enregistrée.")}>Sauvegarder puis enregistrer</Button><Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Annuler</Button></div>
      </div>}
    </div>}
    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs" aria-label="Opérations du grand livre"><thead className="border-b border-border text-muted-foreground"><tr><th className="py-2">Date</th><th>Compte</th><th>Type</th><th>Instrument</th><th>Quantité</th><th>Brut</th><th>Frais</th><th>Provenance</th><th /></tr></thead>
      <tbody>{events.slice(0, 200).map(e => <tr key={e.id} className="border-b border-border/60"><td className="py-2">{e.operationDate}</td><td>{accounts.find(a => a.id === e.accountId)?.name ?? e.accountId}</td><td>{operationLabels[e.type]}</td><td>{data ? instruments(data.portfolio, data.wealth, data.financialRegistry).find(i => i.id === e.instrumentId)?.name ?? e.instrumentName : e.instrumentName || "—"}</td><td>{e.quantity ?? "—"}</td><td>{money(e.amount)}</td><td>{money(e.fees)}</td><td>{isManual(e) ? "Saisie manuelle" : "Import"}</td>
        <td className="text-right">{isManual(e) && (deleting === e.id
          ? <span className="inline-flex gap-1"><Button size="sm" variant="destructive" onClick={() => run({ remove: e.id }, "Opération supprimée.")}>Confirmer la suppression</Button><Button size="sm" variant="ghost" onClick={() => setDeleting(null)}>Annuler</Button></span>
          : <span className="inline-flex gap-1"><Button size="icon" variant="ghost" aria-label="Modifier" onClick={() => { setEditing(e.id); const f = fromEvent(e); setForm(f); setOpen(true); setConfirmed(false); }}><Pencil /></Button><Button size="icon" variant="ghost" aria-label="Supprimer" onClick={() => setDeleting(e.id)}><Trash2 /></Button></span>)}</td></tr>)}
        {legacy.map(t => <tr key={`etf:${t.id}`} className="border-b border-border/60"><td className="py-2">{t.date}</td><td>{accounts.find(a => a.id === "pea")?.name ?? "PEA"}</td><td>{operationLabels[t.type]}</td><td>{data?.portfolio.positions.find(p => p.id === t.positionId)?.name ?? t.name}</td><td>{t.quantity}</td><td>{money(t.quantity * t.price)}</td><td>Non documentés</td><td>Transaction ETF antérieure</td><td /></tr>)}
        {!events.length && !legacy.length && <tr><td colSpan={9} className="py-3 text-muted-foreground">Aucune opération enregistrée.</td></tr>}</tbody></table></div>
  </section>;
}
