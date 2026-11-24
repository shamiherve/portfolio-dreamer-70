import { useState, type ReactNode } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { field } from "./shared";
import { accountTypes, instrumentTypes, type FinancialAccount, type FinancialInstrument, type Valuation } from "@/lib/financial-registry";
import type { Wealth } from "@/lib/wealth";

export function F({ name, children }: { name: string; children: ReactNode }) { return <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground"><span>{name}</span>{children}</label>; }
function Actions({ cancel }: { cancel: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  return <div className="space-y-3 border-t border-border pt-3"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Je confirme ces données réelles et la sauvegarde avant enregistrement.</label><div className="flex flex-wrap gap-2"><Button size="sm" type="submit" disabled={!confirmed}><Save />Sauvegarder puis enregistrer</Button><Button size="sm" type="button" variant="ghost" onClick={cancel}>Annuler</Button></div></div>;
}
export function AccountForm({ initial, wealth, save, cancel }: { initial: FinancialAccount; wealth: Wealth; save: (a: FinancialAccount) => void; cancel: () => void }) {
  const [d, setD] = useState(initial);
  const set = (patch: Partial<FinancialAccount>) => setD(x => ({ ...x, ...patch }));
  return <form className="space-y-4 border-y border-border py-4" aria-label="Compte financier" onSubmit={e => { e.preventDefault(); save(d); }}>
    <h2 className="font-semibold">{initial.name ? "Modifier le compte" : "Nouveau compte"}</h2>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <F name="Nom du compte"><input className={field} aria-label="Nom du compte" value={d.name} required onChange={e => set({ name: e.target.value })} /></F>
      <F name="Type de compte"><select className={field} aria-label="Type de compte" value={d.type} disabled={Boolean(d.legacyId)} onChange={e => set({ type: e.target.value as FinancialAccount["type"] })}>{Object.entries(accountTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></F>
      <F name="Établissement"><input className={field} value={d.institution} onChange={e => set({ institution: e.target.value })} /></F>
      <F name="Devise de référence"><input className={field} required pattern="[A-Z]{3}" maxLength={3} value={d.currency} disabled={Boolean(d.legacyId)} onChange={e => set({ currency: e.target.value.toUpperCase() })} /></F>
      <F name="Date d’ouverture (facultative)"><input className={field} type="date" value={d.openedAt ?? ""} max={new Date().toISOString().slice(0, 10)} onChange={e => set({ openedAt: e.target.value || null })} /></F>
      <F name="Mode de valorisation"><select className={field} value={d.mode} disabled={Boolean(d.legacyId)} onChange={e => set({ mode: e.target.value as FinancialAccount["mode"] })}><option value="manual">Manuel</option><option value="auto">Automatique</option></select></F>
      {!d.legacyId && <F name="Rattachement à un objectif existant (facultatif)"><select className={field} value={d.targetAccountId ?? ""} onChange={e => set({ targetAccountId: e.target.value || null })}><option value="">Aucun — hors périmètre cible figé</option>{wealth.accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.target} %</option>)}</select></F>}
      <F name="Statut"><select className={field} value={d.active ? "active" : "inactive"} onChange={e => set({ active: e.target.value === "active" })}><option value="active">Actif</option><option value="inactive">Inactif</option></select></F>
    </div>
    <Actions cancel={cancel} />
  </form>;
}
export function InstrumentForm({ initial, accounts, wealth, save, cancel, hasHistory }: { initial: FinancialInstrument; accounts: FinancialAccount[]; wealth: Wealth; save: (i: FinancialInstrument) => void; cancel: () => void; hasHistory: boolean }) {
  const [d, setD] = useState(initial);
  const set = (patch: Partial<FinancialInstrument>) => setD(x => ({ ...x, ...patch }));
  const locked = Boolean(d.legacyRef);
  return <form className="space-y-4 border-y border-border py-4" aria-label="Instrument financier" onSubmit={e => { e.preventDefault(); save(d); }}>
    <h2 className="font-semibold">{initial.name ? "Modifier l’instrument" : "Nouvel instrument"}</h2>
    {locked && <p className="text-sm text-muted-foreground">Position existante protégée : identité, quantité et cotation inchangées.</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <F name="Nom de l’instrument"><input className={field} aria-label="Nom de l’instrument" required value={d.name} onChange={e => set({ name: e.target.value })} /></F>
      <F name="Compte associé"><select className={field} aria-label="Compte associé" value={d.accountId} disabled={locked || hasHistory} onChange={e => set({ accountId: e.target.value })}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}{!a.active ? " (inactif)" : ""}</option>)}</select></F>
      <F name="Type de support"><select className={field} aria-label="Type de support" disabled={locked} value={d.type} onChange={e => set({ type: e.target.value as FinancialInstrument["type"] })}>{Object.entries(instrumentTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></F>
      <F name="ISIN (facultatif)"><input className={field} disabled={locked} value={d.isin} onChange={e => set({ isin: e.target.value.toUpperCase() })} /></F>
      <F name="Ticker (facultatif)"><input className={field} disabled={locked} value={d.ticker} onChange={e => set({ ticker: e.target.value })} /></F>
      <F name="Place de cotation (facultative)"><input className={field} disabled={locked} value={d.exchange} onChange={e => set({ exchange: e.target.value })} /></F>
      <F name="Devise"><input className={field} disabled={locked} pattern="[A-Z]{3}" maxLength={3} required value={d.currency} onChange={e => set({ currency: e.target.value.toUpperCase() })} /></F>
      <F name="Valorisation du support"><select className={field} disabled={locked} value={d.mode} onChange={e => set({ mode: e.target.value as FinancialInstrument["mode"] })}><option value="manual">Valeur manuelle en euros</option><option value="auto">Cours automatique</option></select></F>
      <F name="Quantité réelle"><input className={field} type="number" min="0" step="any" disabled={locked} value={d.quantity} onChange={e => set({ quantity: Number(e.target.value) })} /></F>
      <F name="Classe existante (facultative)"><select className={field} disabled={locked} value={d.classId ?? ""} onChange={e => set({ classId: e.target.value || null })}><option value="">Aucune — hors périmètre cible figé</option>{wealth.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></F>
      <F name="Statut du support"><select className={field} value={d.active ? "active" : "inactive"} onChange={e => set({ active: e.target.value === "active" })}><option value="active">Actif</option><option value="inactive">Inactif</option></select></F>
    </div>
    <Actions cancel={cancel} />
  </form>;
}
export function ValuationForm({ initial, instrument, save, cancel }: { initial: Valuation; instrument: FinancialInstrument; save: (v: Valuation) => void; cancel: () => void }) {
  const [d, setD] = useState(initial);
  const [value, setValue] = useState(initial.supersedes ? String(initial.value) : "");
  const [flowKnown, setFlowKnown] = useState(initial.externalFlow !== null);
  const [flow, setFlow] = useState(String(initial.externalFlow ?? 0));
  return <form className="space-y-4 border-y border-border py-4" aria-label="Valorisation manuelle" onSubmit={e => { e.preventDefault(); save({ ...d, value: Number(value), externalFlow: flowKnown ? Number(flow) : null }); }}>
    <h2 className="font-semibold">{initial.supersedes ? "Corriger la valorisation" : "Nouvelle valorisation"} · {instrument.name}</h2>
    <div className="grid gap-3 sm:grid-cols-2">
      <F name="Date de valorisation"><input aria-label="Date de valorisation" className={field} required type="date" max={new Date().toISOString().slice(0, 10)} value={d.date} onChange={e => setD(x => ({ ...x, date: e.target.value }))} /></F>
      <F name="Valeur totale du support (€)"><input aria-label="Valeur totale du support" className={field} required type="number" min="0" step="0.01" value={value} onChange={e => setValue(e.target.value)} /></F>
      <F name="Commentaire (facultatif)"><input className={field} value={d.comment} onChange={e => setD(x => ({ ...x, comment: e.target.value }))} /></F>
      <div className="space-y-2"><label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={flowKnown} onChange={e => setFlowKnown(e.target.checked)} />Apports et retraits depuis la valorisation précédente connus</label>{flowKnown && <F name="Flux externe net (€ ; 0 si aucun)"><input aria-label="Flux externe net" className={field} required type="number" step="0.01" value={flow} onChange={e => setFlow(e.target.value)} /></F>}</div>
    </div>
    <p className="text-xs text-muted-foreground">Sans flux documentés, la performance est indisponible. Une correction conserve l’ancienne valeur dans l’historique.</p>
    <Actions cancel={cancel} />
  </form>;
}