import { z } from "zod";
import { computeRebalance, type Category } from "./rebalance";

const amount = z.number().finite().nonnegative();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Date invalide");
const categorySchema = z.object({ id: z.string().min(1), name: z.string(), value: amount, target: amount.max(100) });
const uniqueIds = <T extends { id: string }>(items: T[]) => new Set(items.map((i) => i.id)).size === items.length;
export const simulationSchema = z.object({
  id: z.string().min(1), name: z.string(), categories: z.array(categorySchema).refine(uniqueIds),
  budget: z.string().refine((s) => Number.isFinite(Number(s.replace(/\s/g, "").replace(",", "."))) && Number(s.replace(/\s/g, "").replace(",", ".")) >= 0), savedAt: amount,
});
export const simulationsSchema = z.array(simulationSchema).refine(uniqueIds);
const positionSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), isin: z.string(), quantity: amount,
  price: amount.positive().nullable(), priceDate: date.nullable(), target: amount.max(100),
}).refine((p) => p.price === null ? p.priceDate === null : p.priceDate !== null, "Un cours nécessite une date");
const weightSchema = z.object({ id: z.string().min(1), name: z.string(), weight: amount.max(100) });
export const targetSchema = z.object({
  id: z.string().min(1), date, source: z.string().trim().min(1), validatedAt: z.string().datetime(),
  weights: z.array(weightSchema).min(1).refine(uniqueIds).refine((w) => validTargets(w.map((i) => i.weight)), "La somme doit être 100 %"),
});
export const portfolioSchema = z.object({
  positions: z.array(positionSchema).refine(uniqueIds), budget: amount,
  updatedAt: z.string().datetime().nullable(), targets: z.array(targetSchema).refine(uniqueIds),
  activeTargetId: z.string().nullable(),
  transactions: z.array(z.object({ id: z.string().min(1), positionId: z.string(), name: z.string(), type: z.enum(["buy", "sell"]), quantity: amount.positive(), price: amount.positive(), date })).refine(uniqueIds),
}).superRefine((p, ctx) => {
  if (p.activeTargetId === null) return;
  const active = p.targets.find((t) => t.id === p.activeTargetId);
  if (!active || active.weights.length !== p.positions.length || p.positions.some((pos) => !active.weights.some((w) => w.id === pos.id && w.weight === pos.target))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Cibles actives incohérentes" });
  }
});
export type Position = z.infer<typeof positionSchema>;
export type TargetSnapshot = z.infer<typeof targetSchema>;
export type Portfolio = z.infer<typeof portfolioSchema>;
export const PORTFOLIO_KEY = "equilibre.portfolio.v1";
export const SIMULATIONS_KEY = "equilibre.simulations.v1";
export const makeId = () => crypto.randomUUID();
export function validTargets(weights: number[]) {
  return weights.length > 0 && weights.every((w) => Number.isFinite(w) && w >= 0 && w <= 100) && Math.abs(weights.reduce((s, w) => s + w, 0) - 100) < 0.01;
}
export function initialPortfolio(): Portfolio {
  return {
    positions: [
      { id: "sp500", name: "BNP Paribas Easy S&P 500", isin: "FR0011550185", quantity: 0, price: null, priceDate: null, target: 0 },
      { id: "europe", name: "BNP Paribas Easy STOXX Europe 600", isin: "FR0011550193", quantity: 0, price: null, priceDate: null, target: 0 },
      { id: "japan", name: "Amundi PEA Japon TOPIX", isin: "FR0013411980", quantity: 0, price: null, priceDate: null, target: 0 },
      { id: "emerging", name: "Amundi PEA Émergent ESG Transition", isin: "FR0013412020", quantity: 0, price: null, priceDate: null, target: 0 },
    ], budget: 0, updatedAt: null, targets: [], activeTargetId: null, transactions: [],
  };
}
export const asCategories = (positions: Position[]): Category[] => positions.map((p) => ({ id: p.id, name: p.name, value: p.quantity * (p.price ?? 0), target: p.target }));

/** Continuous engine is preserved; the separate whole-share layer never spends reserved cash. */
export function purchaseProposal(positions: Position[], budget: number) {
  const safeBudget = Number.isFinite(budget) ? Math.max(0, budget) : 0;
  const categories = asCategories(positions);
  const continuous = computeRebalance(categories, safeBudget);
  const missingValuation = positions.some((p) => p.quantity > 0 && p.price === null);
  const valid = continuous.targetsValid && !missingValuation;
  const wholeShares = positions.every((p) => p.target === 0 || (p.price !== null && p.price > 0));
  if (!valid) return { continuous, valid, missingValuation, wholeShares, lines: [], spent: 0, cash: safeBudget, maxGap: 0 };
  const buys = continuous.lines.map((l, i) => {
    const p = positions[i];
    return wholeShares && p?.price ? Math.floor((l.injected + 1e-9) / p.price) : 0;
  });
  let invested = wholeShares ? buys.map((q, i) => q * (positions[i]?.price ?? 0)) : continuous.lines.map((l) => l.injected);
  // Choose affordable additional shares that improve distance to the continuous optimum.
  // At most one rounded-up share per ETF; large budgets do not create long loops.
  if (wholeShares) {
    const roundedUp = new Set<number>();
    for (let pass = 0; pass < positions.length; pass++) {
      const remaining = safeBudget - invested.reduce((s, v) => s + v, 0);
      let best = -1; let benefit = 0;
      positions.forEach((p, i) => {
        const price = p.price;
        if (!price || p.target <= 0 || price > remaining + 1e-8 || roundedUp.has(i)) return;
        const gap = (continuous.lines[i]?.injected ?? 0) - (invested[i] ?? 0);
        const gain = gap * gap - (gap - price) * (gap - price);
        if (gain > benefit) { best = i; benefit = gain; }
      });
      if (best < 0) break;
      buys[best] = (buys[best] ?? 0) + 1;
      invested[best] = (invested[best] ?? 0) + (positions[best]?.price ?? 0);
      roundedUp.add(best);
    }
  }
  const spent = invested.reduce((s, v) => s + v, 0);
  const finalTotal = continuous.total + spent;
  const lines = continuous.lines.map((l, i) => {
    const injection = invested[i] ?? 0;
    const finalValue = l.value + injection;
    const finalWeight = finalTotal > 0 ? finalValue / finalTotal * 100 : 0;
    return { ...l, injected: injection, shares: wholeShares ? buys[i] ?? 0 : null, finalValue, finalWeight, gapToTargetPp: finalWeight - l.target };
  });
  return { continuous, valid, missingValuation, wholeShares, lines, spent, cash: Math.max(0, safeBudget - spent), maxGap: Math.max(0, ...lines.map((l) => Math.abs(l.gapToTargetPp))) };
}

export function applyTargets(p: Portfolio, snapshot: TargetSnapshot): Portfolio {
  const checked = targetSchema.parse(snapshot);
  if (checked.weights.length !== p.positions.length || p.positions.some((pos) => !checked.weights.some((w) => w.id === pos.id))) throw new Error("Les ETF des cibles ne correspondent pas au portefeuille.");
  return portfolioSchema.parse({ ...p, positions: p.positions.map((pos) => ({ ...pos, target: checked.weights.find((w) => w.id === pos.id)?.weight ?? 0 })), targets: [...p.targets, checked], activeTargetId: checked.id, updatedAt: checked.validatedAt });
}
export function recordTransaction(p: Portfolio, input: Portfolio["transactions"][number]): Portfolio {
  const pos = p.positions.find((i) => i.id === input.positionId);
  if (!pos) throw new Error("ETF introuvable.");
  if (input.type === "sell" && input.quantity > pos.quantity) throw new Error("La vente dépasse le nombre de parts détenues.");
  const next = { ...p, transactions: [input, ...p.transactions], positions: p.positions.map((i) => i.id === pos.id ? { ...i, quantity: i.quantity + (input.type === "buy" ? input.quantity : -input.quantity) } : i), updatedAt: new Date().toISOString() };
  return portfolioSchema.parse(next);
}
const backupSchema = z.object({ format: z.literal("equilibre-backup"), version: z.literal(1), exportedAt: z.string().datetime(), portfolio: portfolioSchema, simulations: simulationsSchema });
export type Backup = z.infer<typeof backupSchema>;
export function parseBackup(raw: string): Backup { return backupSchema.parse(JSON.parse(raw)); }
export function exportBackup(portfolio: Portfolio, simulations: unknown): string {
  return JSON.stringify(backupSchema.parse({ format: "equilibre-backup", version: 1, exportedAt: new Date().toISOString(), portfolio, simulations }), null, 2);
}
export function importWeights(raw: string, positions: Position[]) {
  const schema = z.object({ date, source: z.string().trim().min(1), weights: z.array(z.object({ isin: z.string().min(1), weight: amount.max(100) })).min(1) });
  const data = schema.parse(JSON.parse(raw));
  if (data.weights.length !== positions.length || new Set(data.weights.map((w) => w.isin)).size !== positions.length || !validTargets(data.weights.map((w) => w.weight))) throw new Error("Les pondérations doivent couvrir chaque ISIN et totaliser 100 %.");
  const weights = positions.map((p) => {
    const found = data.weights.find((w) => w.isin === p.isin);
    if (!found) throw new Error(`ISIN absent : ${p.isin}`);
    return found.weight;
  });
  return { date: data.date, source: data.source, weights };
}

/** Future providers must return real dated data; no provider is active by default. */
export interface MarketDataSource {
  getQuotes(isins: string[]): Promise<{ isin: string; price: number; date: string; source: string }[]>;
  getReferenceWeights(): Promise<{ date: string; source: string; weights: { isin: string; weight: number }[] }>;
}
export const configuredMarketDataSource: MarketDataSource | null = null;