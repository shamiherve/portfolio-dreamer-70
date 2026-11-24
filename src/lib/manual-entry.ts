import { eventSchema, eventKey, referenceKey, ledgerSchema, readLedger, instruments, LEDGER_KEY, splitCheck, type LedgerEvent } from "./ledger";
import { assertIncoming, potentialDuplicate, readCompleteBackup } from "./backup-restoration";
import { atomicLocalWrite, type LocalStorageAccess } from "./local-transaction";
import { buildMoves } from "./performance";
import { SNAPSHOTS_KEY, snapshotsSchema } from "./performance";
import type { Portfolio } from "./portfolio";
import type { Wealth } from "./wealth";

/** Manual entries reuse the single ledger (equilibre.ledger.v1); amount = gross, fees separate, as for imports. */
export const manualTypes = ["deposit", "withdrawal", "buy", "sell", "dividend", "fee", "tax", "split", "corporate_action"] as const;
export type ManualType = typeof manualTypes[number];
export interface ManualInput { accountId: "pea" | "cto"; type: ManualType; date: string; instrumentId: string; quantity: string; price: string; gross: string; fees: string; net: string; splitRatio: string }
export const emptyInput = (): ManualInput => ({ accountId: "pea", type: "deposit", date: "", instrumentId: "", quantity: "", price: "", gross: "", fees: "0", net: "", splitRatio: "" });
export const needsInstrument = (t: ManualType) => ["buy", "sell", "dividend", "split", "corporate_action"].includes(t);
export const needsQuantity = (t: ManualType) => ["buy", "sell", "split", "corporate_action"].includes(t);
export const needsPrice = (t: ManualType) => t === "buy" || t === "sell";
export const hasCash = (t: ManualType) => t !== "split" && t !== "corporate_action";
const num = (s: string) => { const t = s.trim().replace(/\s/g, "").replace(",", "."); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Signed cash effect, identical to performance.buildMoves: outflows include fees once. */
export function netCash(type: ManualType, gross: number, fees: number) {
  switch (type) {
    case "deposit": case "sell": case "dividend": return r2(gross - fees);
    case "withdrawal": case "buy": case "fee": case "tax": return r2(-gross - fees);
    default: return 0;
  }
}
export function isManual(e: LedgerEvent) { return e.source.origin === "manual"; }

export interface Draft { event: LedgerEvent | null; errors: string[]; warnings: string[]; cash: number; quantityDelta: number; heldBefore: number | null; heldAfter: number | null }
export function heldAt(events: LedgerEvent[], portfolio: Portfolio, accountId: string, isin: string, date: string) {
  return Math.round(buildMoves(events, portfolio).moves.filter(m => m.account === accountId && m.isin === isin && m.date <= date).reduce((q, m) => q + m.dq, 0) * 1e8) / 1e8;
}
function minRunning(events: LedgerEvent[], portfolio: Portfolio, accountId: string, isin: string) {
  const ms = buildMoves(events, portfolio).moves.filter(m => m.account === accountId && m.isin === isin).sort((a, b) => a.date.localeCompare(b.date) || b.dq - a.dq);
  let q = 0, min = 0; for (const m of ms) { q += m.dq; min = Math.min(min, q); } return Math.round(min * 1e8) / 1e8;
}

export function buildDraft(input: ManualInput, ctx: { portfolio: Portfolio; wealth: Wealth; events: LedgerEvent[]; id: string; now: string; replacing?: string }): Draft {
  const errors: string[] = [], warnings: string[] = [];
  const others = ctx.events.filter(e => e.id !== ctx.replacing);
  const t = input.type;
  if (!input.date) errors.push("Date de l’opération obligatoire.");
  else if (input.date > ctx.now.slice(0, 10)) errors.push("Date future refusée.");
  const inst = needsInstrument(t) ? instruments(ctx.portfolio, ctx.wealth).find(i => i.id === input.instrumentId && i.accountId === input.accountId) : undefined;
  if (needsInstrument(t) && !inst) errors.push("Instrument obligatoire, choisi dans le référentiel du compte.");
  if (inst && !inst.isin) errors.push("Instrument sans ISIN : enregistrement impossible.");
  const quantity = num(input.quantity), price = num(input.price), grossIn = num(input.gross), feesIn = num(input.fees) ?? 0, netIn = num(input.net), ratio = num(input.splitRatio);
  if (needsQuantity(t) && t !== "corporate_action" && (quantity === null || Number.isNaN(quantity) || quantity <= 0)) errors.push("Quantité strictement positive obligatoire.");
  if (needsPrice(t) && price !== null && (Number.isNaN(price) || price <= 0)) errors.push("Prix d’exécution invalide (laissez vide s’il est inconnu).");
  if (t === "split" && (ratio === null || Number.isNaN(ratio) || ratio <= 0 || ratio === 1)) errors.push("Ratio de split obligatoire (ex. 4 pour 1 → 4).");
  const gross = hasCash(t) ? grossIn : 0, fees = hasCash(t) ? feesIn : 0;
  if (hasCash(t) && (gross === null || Number.isNaN(gross) || gross <= 0)) errors.push("Montant brut strictement positif obligatoire.");
  if (Number.isNaN(fees) || fees < 0) errors.push("Frais invalides : montant positif ou nul.");
  if ((t === "fee" || t === "tax") && fees > 0) errors.push("Pour une ligne de frais ou de taxe, saisissez le montant en brut et 0 en frais : ils ne seraient sinon comptés deux fois.");
  const cash = gross !== null && !Number.isNaN(gross) && !Number.isNaN(fees) ? netCash(t, gross, fees) : 0;
  if (hasCash(t)) {
    if (netIn === null || Number.isNaN(netIn)) errors.push("Montant net obligatoire, pour contrôle de cohérence.");
    else if (Math.abs(Math.abs(netIn) - Math.abs(cash)) > 0.005) errors.push(`Incohérence : brut ${gross} ${["deposit", "sell", "dividend"].includes(t) ? "−" : "+"} frais ${fees} = ${Math.abs(cash).toFixed(2)} €, pas ${Math.abs(netIn).toFixed(2)} €.`);
  }
  if (needsPrice(t) && price && quantity && gross && Math.abs(price * quantity - gross) > 0.02) warnings.push(`Prix × quantité = ${(price * quantity).toFixed(2)} € diffère du brut ${gross.toFixed(2)} € : vérifiez le prix.`);
  if (needsPrice(t) && price === null) warnings.push("Prix d’exécution non renseigné : conservé comme indisponible, jamais calculé.");
  const isin = inst?.isin ?? null;
  const held = isin && input.date ? heldAt(others, ctx.portfolio, input.accountId, isin, input.date) : null;
  let dq = t === "buy" ? (quantity ?? 0) : t === "sell" ? -(quantity ?? 0) : 0;
  let splitDelta: number | null = null;
  if (t === "split" && held !== null && ratio) { splitDelta = Math.round(held * (ratio - 1) * 1e8) / 1e8; dq = splitDelta; if (held <= 0) errors.push("Aucune quantité reconstituée détenue à cette date : split impossible."); if (quantity && Math.abs(quantity - splitDelta) > 1e-6) errors.push(`Variation saisie ${quantity} ≠ ${splitDelta} attendue (${held} × (${ratio} − 1)).`); }
  if (t === "corporate_action") warnings.push("Opération sur titres conservée telle quelle : elle n’est pas interprétée dans les quantités ni dans les espèces.");
  if (errors.length) return { event: null, errors, warnings, cash, quantityDelta: dq, heldBefore: held, heldAfter: held === null ? null : held + dq };
  const original = ctx.events.find(e => e.id === ctx.replacing);
  const raw = {
    id: ctx.id, accountId: input.accountId, type: t, operationDate: input.date, settlementDate: null, timestamp: null,
    isin, instrumentId: inst?.id ?? null, instrumentName: inst?.name ?? "",
    quantity: t === "split" ? splitDelta : needsQuantity(t) ? (quantity ?? 0) : null, executionPrice: needsPrice(t) ? price : null,
    amount: hasCash(t) ? r2(gross ?? 0) : 0, fees: r2(fees), taxes: 0, withholding: 0, currency: "EUR", fxRate: 1,
    splitRatio: t === "split" ? ratio : null, transferId: null,
    source: { broker: input.accountId === "pea" ? "fortuneo" : "trade-republic", file: "saisie-manuelle", sheet: "Saisie manuelle", row: 1, reference: `manual:${ctx.id}`, importedAt: original?.source.importedAt ?? ctx.now, origin: "manual" },
  };
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) return { event: null, errors: parsed.error.issues.map(i => i.message), warnings, cash, quantityDelta: dq, heldBefore: held, heldAfter: null };
  const event = parsed.data;
  const dup = potentialDuplicate(event, others);
  if (dup) errors.push(`Doublon potentiel : opération ${isManual(dup) ? "saisie" : "importée"} identique le ${dup.operationDate}. Enregistrement bloqué.`);
  if (isin && minRunning([...others, event], ctx.portfolio, input.accountId, isin) < -1e-9) errors.push(t === "sell" ? `Vente impossible : ${held ?? 0} part(s) reconstituée(s) détenue(s) au ${input.date}.` : "Cette opération rendrait une quantité négative à une date ultérieure.");
  if (t === "sell" && held !== null && quantity && quantity > held + 1e-9 && !errors.some(e => e.startsWith("Vente"))) errors.push(`Vente supérieure aux ${held} part(s) détenue(s).`);
  return { event: errors.length ? null : event, errors, warnings, cash, quantityDelta: dq, heldBefore: held, heldAfter: held === null ? null : Math.round((held + dq) * 1e8) / 1e8 };
}

/** Adds, replaces or deletes one manual event in the existing ledger; imported events are never touched. Returns pruned stale snapshot count. */
export function writeManualChange(storage: LocalStorageAccess, change: { add?: LedgerEvent; remove?: string }, expected: Record<string, string | null>) {
  const safety = readCompleteBackup(storage);
  const before = readLedger(storage);
  const removed = change.remove ? before.events.find(e => e.id === change.remove) : undefined;
  if (change.remove && !removed) throw new Error("Opération introuvable : relisez les données.");
  if (removed && !isManual(removed)) throw new Error("Seules les opérations saisies manuellement peuvent être modifiées ou supprimées ; les opérations importées sont protégées.");
  if (change.add && !isManual(change.add)) throw new Error("Provenance manuelle requise.");
  const others = before.events.filter(e => e.id !== change.remove);
  if (change.add) {
    if (others.some(e => e.id === change.add!.id)) throw new Error("Identifiant déjà utilisé.");
    assertIncoming(change.add, others, instruments(safety.backup.portfolio, safety.backup.wealth), safety.backup.portfolio);
  }
  const next = ledgerSchema.parse({ ...before, events: change.add ? [...others, change.add] : others, updatedAt: new Date().toISOString() });
  const keys = next.events.map(eventKey), refs = next.events.flatMap(e => referenceKey(e) ?? []);
  if (new Set(keys).size !== keys.length || new Set(refs).size !== refs.length) throw new Error("Doublons dans le grand livre : enregistrement refusé.");
  if (before.events.filter(e => !isManual(e)).some(e => !next.events.some(n => JSON.stringify(n) === JSON.stringify(e)))) throw new Error("Une opération importée serait modifiée : refusé.");
  if (next.events.some(e => e.type === "split" && e.isin === "US29082A1079") && splitCheck(next.events).issues.length && !splitCheck(before.events).issues.length) throw new Error("Split Embraer incohérent : refusé.");
  atomicLocalWrite(storage, { [LEDGER_KEY]: JSON.stringify(next) }, safety.content, expected);
  const from = [removed?.operationDate, change.add?.operationDate].filter((d): d is string => !!d).sort()[0];
  return { safety, pruned: from ? pruneSnapshots(storage, from) : 0 };
}
/** Recorded daily snapshots on/after a changed date no longer match the ledger: drop them (today's is re-recorded on next visit). */
export function pruneSnapshots(storage: LocalStorageAccess, from: string) {
  const raw = storage.getItem(SNAPSHOTS_KEY); if (!raw) return 0;
  const s = snapshotsSchema.parse(JSON.parse(raw));
  const kept = s.items.filter(i => i.date < from);
  if (kept.length !== s.items.length) storage.setItem(SNAPSHOTS_KEY, JSON.stringify({ ...s, items: kept }));
  return s.items.length - kept.length;
}
