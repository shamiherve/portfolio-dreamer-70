import { portfolioSchema, type Portfolio } from "./portfolio";
import { wealthSchema, type Wealth } from "./wealth";
import { registrySchema, type FinancialRegistry } from "./financial-registry";
import type { LedgerEvent } from "./ledger";

export const positionDelta = (e: LedgerEvent) => e.type === "buy" || e.type === "split" ? e.quantity ?? 0 : e.type === "sell" ? -(e.quantity ?? 0) : 0;
export function applyPositionChanges(p: Portfolio, w: Wealth, r: FinancialRegistry, removed: LedgerEvent | undefined, add: LedgerEvent | undefined) {
  const deltas = new Map<string, { e: LedgerEvent; delta: number }>();
  for (const [e, sign] of [[removed, -1], [add, 1]] as const) {
    if (!e?.instrumentId || (sign === -1 && !e.source.positionApplied) || (sign === 1 && removed && !removed.source.positionApplied)) continue;
    const old = deltas.get(e.instrumentId);
    deltas.set(e.instrumentId, { e, delta: (old?.delta ?? 0) + positionDelta(e) * sign });
  }
  let state = { p, w, r, applied: false };
  for (const { e, delta } of deltas.values()) if (delta) state = applyPositionDelta(state.p, state.w, state.r, { ...e, type: delta > 0 ? "buy" : "sell", quantity: Math.abs(delta) });
  if (add && (!removed || removed.source.positionApplied)) state.applied = Boolean(p.positions.some(i => `etf:${i.id}` === add.instrumentId) || w.holdings.some(i => i.kind === "quantity" && `w:${i.id}` === add.instrumentId) || r.instruments.some(i => !i.legacyRef && i.id === add.instrumentId)) && positionDelta(add) !== 0;
  return state;
}
/** Apply only a newly confirmed manual delta, never replay the imported history into holdings. */
export function applyPositionDelta(p: Portfolio, w: Wealth, r: FinancialRegistry, e: LedgerEvent, direction: 1 | -1 = 1) {
  const delta = positionDelta(e) * direction;
  const id = e.instrumentId;
  if (!id || !delta) return { p, w, r, applied: false };
  const quantity = (q: number, whole: boolean) => {
    const next = Math.round((q + delta) * 1e8) / 1e8;
    if (next < 0 || (whole && !Number.isInteger(next))) throw new Error("Quantité finale négative ou fraction interdite : opération refusée.");
    return next;
  };
  const etf = p.positions.find(i => `etf:${i.id}` === id);
  if (etf) return { p: portfolioSchema.parse({ ...p, positions: p.positions.map(i => i.id === etf.id ? { ...i, quantity: quantity(i.quantity, true) } : i) }), w, r, applied: true };
  const h = w.holdings.find(i => `w:${i.id}` === id);
  if (h?.kind === "quantity") return { p, w: wealthSchema.parse({ ...w, holdings: w.holdings.map(i => i.id === h.id ? { ...i, quantity: quantity(i.quantity, !i.fractional || !w.accounts.find(a => a.id === i.accountId)?.fractionalAllowed) } : i) }), r, applied: true };
  const i = r.instruments.find(x => !x.legacyRef && x.id === id);
  if (i) return { p, w, r: registrySchema.parse({ ...r, instruments: r.instruments.map(x => x.id === i.id ? { ...x, quantity: quantity(x.quantity, i.accountId === "pea") } : x) }), applied: true };
  return { p, w, r, applied: false }; // Historical-only instrument: never create a position.
}