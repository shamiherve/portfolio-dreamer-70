import { z } from "zod";
import type { Portfolio } from "./portfolio";
import type { Wealth } from "./wealth";

export const LEDGER_KEY = "equilibre.ledger.v1";
export const operationTypes = ["deposit", "withdrawal", "buy", "sell", "dividend", "fee", "tax", "split", "transfer_in", "transfer_out", "corporate_action"] as const;
export type OperationType = typeof operationTypes[number];
export const operationLabels: Record<OperationType, string> = { deposit: "Versement externe", withdrawal: "Retrait externe", buy: "Achat", sell: "Vente", dividend: "Dividende", fee: "Frais", tax: "Taxe", split: "Split", transfer_in: "Transfert entrant", transfer_out: "Transfert sortant", corporate_action: "Opération sur titres" };
export function realDate(s: string) {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(realDate);
const amount = z.number().finite().nonnegative();
export const eventSchema = z.object({
  id: z.string().min(1), accountId: z.string().min(1), type: z.enum(operationTypes),
  operationDate: date, settlementDate: date.nullable(), timestamp: z.string().datetime({ offset: true }).nullable(),
  isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/).nullable(), instrumentId: z.string().nullable(), instrumentName: z.string(),
  quantity: amount.nullable(), executionPrice: amount.nullable(), amount, fees: amount, taxes: amount, withholding: amount,
  currency: z.string().regex(/^[A-Z]{3}$/), fxRate: z.number().finite().positive().nullable(),
  splitRatio: z.number().finite().positive().nullable(), transferId: z.string().nullable(),
  source: z.object({ broker: z.enum(["fortuneo", "trade-republic"]), file: z.string(), sheet: z.string(), row: z.number().int().positive(), reference: z.string(), importedAt: z.string().datetime(), originalColumns: z.array(z.object({ heading: z.string(), value: z.string() }).strict()).optional() }).strict(),
}).strict().superRefine((e, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (["buy", "sell"].includes(e.type) && (!e.isin || !e.quantity || (e.executionPrice !== null && e.executionPrice <= 0) || e.amount <= 0)) issue("Achat/vente incomplet : ISIN, quantité et montant requis ; un prix indisponible reste null.");
  if (e.currency === "EUR" && e.fxRate !== 1) issue("Taux EUR attendu : 1.");
  if (e.type === "split" && (!e.isin || !e.splitRatio || e.splitRatio === 1 || e.quantity === null || e.amount !== 0 || e.fees !== 0 || e.taxes !== 0 || e.withholding !== 0)) issue("Split : ISIN, ratio et variation de quantité requis ; aucun flux financier.");
  if (e.type.startsWith("transfer_") && !e.transferId) issue("Transfert : référence commune des deux mouvements requise.");
});
export type LedgerEvent = z.infer<typeof eventSchema>;
export const ledgerSchema = z.object({ version: z.literal(1), events: z.array(eventSchema).refine(es => new Set(es.map(e => e.id)).size === es.length, "Identifiants dupliqués"), updatedAt: z.string().datetime().nullable() }).strict();
export type Ledger = z.infer<typeof ledgerSchema>;
export const emptyLedger = (): Ledger => ({ version: 1, events: [], updatedAt: null });
export function readLedger(storage: Pick<Storage, "getItem">): Ledger {
  const raw = storage.getItem(LEDGER_KEY);
  return raw === null ? emptyLedger() : ledgerSchema.parse(JSON.parse(raw));
}
export function instruments(portfolio: Portfolio, wealth: Wealth) {
  return [...portfolio.positions.map(p => ({ id: `etf:${p.id}`, accountId: "pea", isin: p.isin, name: p.name })), ...wealth.holdings.map(h => ({ id: `w:${h.id}`, accountId: h.accountId, isin: h.isin, name: h.name }))];
}
// Exact economic key excludes file/line and UI labels so retrying another export cannot duplicate cash.
export function eventKey(e: LedgerEvent) {
  return JSON.stringify([e.accountId, e.type, e.operationDate, e.settlementDate, e.timestamp, e.isin, e.quantity, e.executionPrice, e.amount, e.fees, e.taxes, e.withholding, e.currency, e.fxRate, e.splitRatio, e.transferId]);
}
export function referenceKey(e: LedgerEvent) { return e.source.reference ? `${e.accountId}\u0000${e.source.broker}\u0000${e.source.reference}\u0000${e.type}` : null; }
export function existingEtf(e: LedgerEvent, portfolio: Portfolio) {
  if (e.accountId !== "pea" || (e.type !== "buy" && e.type !== "sell")) return null;
  return portfolio.transactions.find(t => t.type === e.type && (t.date === e.operationDate || t.date === e.settlementDate) && t.quantity === e.quantity && Math.abs(t.price * t.quantity - e.amount) <= 0.02 && portfolio.positions.find(p => p.id === t.positionId)?.isin === e.isin) ?? null;
}
export const RECONCILIATION = {
  pea: { deposit: 1515, buy: 1523.56, fees: 0, taxes: 1.12, dividend: 4.10, balance: -5.58, since: "2026-01-01" },
  cto: { deposit: 558, buy: 548.30, fees: 8, taxes: 0, dividend: 0, balance: 1.70, since: "2026-07-01" },
} as const;
export function cashSummary(events: LedgerEvent[], accountId: string) {
  const buckets = new Map<string, { deposit: number; buy: number; sell: number; dividend: number; fees: number; taxes: number; withholding: number; withdrawal: number; transfers: number; balance: number }>();
  for (const e of events.filter(e => e.accountId === accountId)) {
    const b = buckets.get(e.currency) ?? { deposit: 0, buy: 0, sell: 0, dividend: 0, fees: 0, taxes: 0, withholding: 0, withdrawal: 0, transfers: 0, balance: 0 };
    if (["deposit", "buy", "sell", "dividend", "withdrawal"].includes(e.type)) b[e.type as "deposit" | "buy" | "sell" | "dividend" | "withdrawal"] += e.amount;
    b.fees += e.fees + (e.type === "fee" ? e.amount : 0);
    b.taxes += e.taxes + (e.type === "tax" ? e.amount : 0); b.withholding += e.withholding;
    if (e.type === "transfer_in") b.transfers += e.amount;
    if (e.type === "transfer_out") b.transfers -= e.amount;
    b.balance = b.deposit + b.sell + b.dividend + b.transfers - b.withdrawal - b.buy - b.fees - b.taxes - b.withholding;
    buckets.set(e.currency, b);
  }
  return [...buckets].map(([currency, b]) => ({ currency, ...b }));
}
export function splitCheck(events: LedgerEvent[]) {
  const relevant = events.filter(e => e.isin === "US29082A1079" && e.accountId === "cto");
  let quantity = 0;
  const issues: string[] = [];
  for (const e of [...relevant].sort((a, b) => a.operationDate.localeCompare(b.operationDate))) {
    if (e.type === "buy") quantity += e.quantity ?? 0;
    if (e.type === "sell") quantity -= e.quantity ?? 0;
    if (e.type === "split") {
      if (Math.abs(quantity * ((e.splitRatio ?? 1) - 1) - (e.quantity ?? 0)) > 1e-6) issues.push("Embraer : variation de quantité incohérente avec le ratio et les achats antérieurs disponibles.");
      quantity += e.quantity ?? 0;
      if (e.operationDate === "2026-11-16" && (e.splitRatio !== 4 || e.quantity !== 3)) issues.push("Embraer 16/11/2026 : contrôle attendu 1 → 4 ADR, soit +3 ADR sans achat ni apport.");
    }
  }
  return { quantity, issues };
}