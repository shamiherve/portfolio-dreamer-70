import { z } from "zod";
import type { Portfolio } from "./portfolio";

/** Global wealth model. ETF holdings are NOT stored here: they are read from the ETF portfolio (single source of truth). */
export const WEALTH_KEY = "equilibre.wealth.v1";
const pctSchema = z.number().finite().min(0).max(100);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const accountSchema = z.object({ id: z.string().min(1), name: z.string().trim().min(1), target: pctSchema, fractionalAllowed: z.boolean() });
export const assetClassSchema = z.object({ id: z.string().min(1), name: z.string().trim().min(1), parent: z.string().nullable(), target: pctSchema });
export const mappingSchema = z.object({ accountId: z.string().min(1), classId: z.string().min(1), target: pctSchema });
const iso = z.string().datetime();
/** Market data is kept apart from the position itself: quantities are never touched by updates. */
export const marketSchema = z.object({
  status: z.enum(["verified", "corrected", "manual", "none"]), provider: z.enum(["yahoo", "manual", "none"]),
  symbol: z.string().nullable(), userSymbol: z.string().nullable(), priceMode: z.enum(["auto", "manual"]),
  original: z.object({ name: z.string(), isin: z.string(), ticker: z.string(), exchange: z.string(), currency: z.string() }),
  verified: z.object({ name: z.string(), isin: z.string(), ticker: z.string(), exchange: z.string(), currency: z.string() }).nullable(),
  issues: z.array(z.string()), candidates: z.array(z.object({ symbol: z.string(), exchange: z.string(), name: z.string() })),
  audit: z.array(z.object({ at: iso, field: z.string(), from: z.string(), to: z.string(), reason: z.string() })),
  quote: z.object({ price: z.number().positive(), currency: z.string(), timestamp: iso, retrievedAt: iso }).nullable(),
  pending: z.object({ price: z.number().positive(), currency: z.string(), timestamp: iso, reason: z.string() }).nullable(),
  fx: z.object({ rate: z.number().positive(), date: date, source: z.string() }).nullable(),
  quoteStatus: z.enum(["ok", "stale", "review", "error", "manual", "none"]), lastError: z.string().nullable(),
  lastSuccessAt: iso.nullable(), checkedAt: iso.nullable(),
});
export type MarketInfo = z.infer<typeof marketSchema>;
export const holdingSchema = z.object({
  id: z.string().min(1), name: z.string().trim().min(1), isin: z.string(), ticker: z.string(), exchange: z.string(),
  accountId: z.string().min(1), classId: z.string().min(1), kind: z.enum(["quantity", "value"]),
  currency: z.string().regex(/^[A-Z]{3}$/), quantity: z.number().finite().nonnegative(), price: z.number().finite().positive().nullable(),
  fxRate: z.number().finite().positive(), fractional: z.boolean(), value: z.number().finite().nonnegative(), priceDate: date.nullable(),
  market: marketSchema.optional(),
});
export const wealthSchema = z.object({
  version: z.literal(1), accounts: z.array(accountSchema).min(1), classes: z.array(assetClassSchema).min(1),
  mapping: z.array(mappingSchema), holdings: z.array(holdingSchema), updatedAt: z.string().datetime().nullable(),
  marketMeta: z.object({ lastSuccess: iso.nullable(), lastFailure: iso.nullable(), lastError: z.string().nullable(), lastAttempt: iso.nullable(), fxDate: date.nullable() }).optional(),
});
export type Account = z.infer<typeof accountSchema>;
export type AssetClass = z.infer<typeof assetClassSchema>;
export type Holding = z.infer<typeof holdingSchema>;
export type Wealth = z.infer<typeof wealthSchema>;
export const ETF_ACCOUNT = "pea";
export const ETF_CLASS = "etf";
export const PARENT_GROUPS: Record<string, string> = { equity: "Actions" };

export function initialWealth(): Wealth {
  return {
    version: 1,
    accounts: [
      { id: "pea", name: "PEA Fortuneo", target: 75, fractionalAllowed: false },
      { id: "cto", name: "CTO Trade Republic", target: 15, fractionalAllowed: true },
      { id: "av", name: "Assurance-vie Linxea Spirit 2", target: 10, fractionalAllowed: false },
    ],
    classes: [
      { id: "etf", name: "ETF actions", parent: "equity", target: 70 },
      { id: "stocks", name: "Actions individuelles", parent: "equity", target: 15 },
      { id: "bonds", name: "Fonds & obligations", parent: null, target: 10 },
      { id: "gold", name: "Métaux précieux (or)", parent: null, target: 5 },
    ],
    mapping: [
      { accountId: "pea", classId: "etf", target: 70 }, { accountId: "pea", classId: "stocks", target: 5 },
      { accountId: "cto", classId: "stocks", target: 10 }, { accountId: "cto", classId: "gold", target: 5 },
      { accountId: "av", classId: "bonds", target: 10 },
    ],
    holdings: [
      { id: "gold-ishares", name: "iShares Physical Gold ETC", isin: "IE00B4ND3602", ticker: "SGLN", exchange: "", accountId: "cto", classId: "gold", kind: "quantity", currency: "EUR", quantity: 0, price: null, fxRate: 1, fractional: true, value: 0, priceDate: null },
      { id: "fonds-euro", name: "Fonds Euro Nouvelle Génération", isin: "", ticker: "", exchange: "", accountId: "av", classId: "bonds", kind: "value", currency: "EUR", quantity: 0, price: null, fxRate: 1, fractional: false, value: 0, priceDate: null },
    ],
    updatedAt: null,
  };
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
export function decimals(n: number) { const s = String(n); return s.includes("e-") ? 99 : (s.split(".")[1]?.length ?? 0); }

/** Validates one holding against account quantity rules. Returns an error message or null. */
export function holdingError(h: Holding, w: Wealth): string | null {
  const parsed = holdingSchema.safeParse(h);
  if (!parsed.success) return "Champs invalides : vérifiez nom, devise (3 lettres), quantité, cours et taux de change.";
  const account = w.accounts.find(a => a.id === h.accountId);
  if (!account) return "Compte inconnu.";
  if (!w.classes.some(c => c.id === h.classId)) return "Classe d’actifs inconnue.";
  if (h.currency === "EUR" && h.fxRate !== 1) return "Le taux de change d’une ligne en EUR doit être 1.";
  if (h.kind === "quantity") {
    if (!h.fractional || !account.fractionalAllowed) { if (!Number.isInteger(h.quantity)) return `${account.name} : parts entières uniquement.`; }
    else if (decimals(h.quantity) > 6) return "Fractions limitées à 6 décimales.";
    if (h.price !== null && !h.priceDate) return "Renseignez la date du cours.";
    if (h.quantity > 0 && h.price === null) return "Une quantité détenue nécessite un cours.";
  } else if (h.value > 0 && !h.priceDate) return "Renseignez la date de valorisation.";
  return null;
}
export const holdingValue = (h: Holding) => h.kind === "value" ? h.value : h.quantity * (h.price ?? 0) * h.fxRate;

export interface Line { id: string; name: string; source: "etf" | "manual"; accountId: string; classId: string; value: number; date: string | null; ref?: Holding }
/** Unified list: each holding appears exactly once. */
export function unifiedLines(portfolio: Portfolio, w: Wealth): Line[] {
  const etfs: Line[] = portfolio.positions.map(p => ({ id: `etf:${p.id}`, name: p.name, source: "etf", accountId: ETF_ACCOUNT, classId: ETF_CLASS, value: p.quantity * (p.price ?? 0), date: p.priceDate }));
  const manual: Line[] = w.holdings.map(h => ({ id: `w:${h.id}`, name: h.name, source: "manual", accountId: h.accountId, classId: h.classId, value: holdingValue(h), date: h.priceDate, ref: h }));
  return [...etfs, ...manual];
}

export type Status = "under" | "balanced" | "over";
export interface Row { id: string; name: string; target: number; actual: number; targetValue: number; value: number; diffPp: number; diffEur: number; status: Status; severity: "ok" | "moderate" | "high" }
export const BALANCED_PP = 1; export const MODERATE_PP = 3;
function rows(items: { id: string; name: string; target: number }[], values: Map<string, number>, total: number): Row[] {
  return items.map(i => {
    const value = values.get(i.id) ?? 0; const actual = total > 0 ? value / total * 100 : 0; const targetValue = total * i.target / 100;
    const diffPp = actual - i.target; const a = Math.abs(diffPp);
    return { id: i.id, name: i.name, target: i.target, actual, targetValue, value, diffPp, diffEur: value - targetValue,
      status: a <= BALANCED_PP ? "balanced" : diffPp < 0 ? "under" : "over", severity: a <= BALANCED_PP ? "ok" : a <= MODERATE_PP ? "moderate" : "high" };
  });
}
/** 100 − half the sum of absolute deviations (same transparent formula as the ETF score). */
export const dimensionScore = (r: Row[], total: number) => total > 0 ? Math.max(0, Math.min(100, 100 - sum(r.map(x => Math.abs(x.diffPp))) / 2)) : null;

export function targetIssues(w: Wealth): string[] {
  const issues: string[] = [];
  if (!near(sum(w.accounts.map(a => a.target)), 100)) issues.push(`Les cibles par compte totalisent ${sum(w.accounts.map(a => a.target)).toFixed(2)} % au lieu de 100 %.`);
  if (!near(sum(w.classes.map(c => c.target)), 100)) issues.push(`Les cibles par classe d’actifs totalisent ${sum(w.classes.map(c => c.target)).toFixed(2)} % au lieu de 100 %.`);
  for (const a of w.accounts) { const m = sum(w.mapping.filter(x => x.accountId === a.id).map(x => x.target)); if (!near(m, a.target)) issues.push(`${a.name} : la répartition compte × classe totalise ${m.toFixed(2)} % pour une cible de ${a.target} %.`); }
  for (const c of w.classes) { const m = sum(w.mapping.filter(x => x.classId === c.id).map(x => x.target)); if (!near(m, c.target)) issues.push(`${c.name} : la répartition compte × classe totalise ${m.toFixed(2)} % pour une cible de ${c.target} %.`); }
  return issues;
}

export function analyse(portfolio: Portfolio, w: Wealth) {
  const lines = unifiedLines(portfolio, w);
  const total = sum(lines.map(l => l.value));
  const by = (key: "accountId" | "classId") => { const m = new Map<string, number>(); for (const l of lines) m.set(l[key], (m.get(l[key]) ?? 0) + l.value); return m; };
  const classRows = rows(w.classes, by("classId"), total);
  const accountRows = rows(w.accounts, by("accountId"), total);
  const parents = Object.entries(PARENT_GROUPS).map(([id, name]) => { const kids = classRows.filter(r => w.classes.find(c => c.id === r.id)?.parent === id); return { id, name, target: sum(kids.map(k => k.target)), actual: sum(kids.map(k => k.actual)), value: sum(kids.map(k => k.value)), children: kids.map(k => k.id) }; });
  const classScore = dimensionScore(classRows, total); const accountScore = dimensionScore(accountRows, total);
  const score = classScore === null || accountScore === null ? null : (classScore + accountScore) / 2;
  const unvalued = portfolio.positions.filter(p => p.quantity > 0 && p.price === null).map(p => p.name).concat(w.holdings.filter(h => h.kind === "quantity" && h.quantity > 0 && h.price === null).map(h => h.name));
  const dates = lines.map(l => l.date).filter((d): d is string => !!d).sort();
  return { lines, total, classRows, accountRows, parents, classScore, accountScore, score, issues: targetIssues(w), unvalued, lastDate: dates.at(-1) ?? null };
}

const fmtEur = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Math.abs(n));
/** Informational, strictly buy-only messages: overweight lines are only reported, never sold. */
export function recommendations(a: ReturnType<typeof analyse>): string[] {
  if (a.total <= 0) return ["Renseignez vos positions pour obtenir une analyse."];
  const out: string[] = [];
  const sorted = (r: Row[]) => [...r].sort((x, y) => x.diffEur - y.diffEur);
  for (const r of sorted(a.classRows)) {
    if (r.status === "under") out.push(`${r.name} : sous-pondéré de ${fmtEur(r.diffEur)} (${Math.abs(r.diffPp).toFixed(1)} pp). Destination prioritaire pour vos prochains apports.`);
    if (r.status === "over") out.push(`${r.name} : surpondéré de ${r.diffPp.toFixed(1)} pp. Aucune action n’est requise : orientez simplement vos prochains apports vers les catégories sous-pondérées.`);
  }
  for (const r of sorted(a.accountRows)) {
    if (r.status === "under") out.push(`${r.name} : en dessous de sa cible de ${fmtEur(r.diffEur)}.`);
    if (r.status === "over") out.push(`${r.name} : au-dessus de sa cible de ${r.diffPp.toFixed(1)} pp ; privilégiez les autres comptes pour vos apports.`);
  }
  return out.length ? out : ["Votre allocation est équilibrée : poursuivez vos apports selon vos cibles."];
}

/** Buy-only contribution split: water-fills the allowed classes of the chosen account toward global class targets. */
export function simulateContribution(portfolio: Portfolio, w: Wealth, amount: number, accountId: string) {
  const a = analyse(portfolio, w);
  const safe = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const allowed = w.mapping.filter(m => m.accountId === accountId && m.target > 0).map(m => m.classId);
  const finalTotal = a.total + safe;
  const add = new Map<string, number>();
  if (safe > 0 && allowed.length) {
    const deficit = (id: string) => { const r = a.classRows.find(x => x.id === id)!; return finalTotal * r.target / 100 - r.value - (add.get(id) ?? 0); };
    let left = safe;
    const totalDeficit = sum(allowed.map(id => Math.max(0, deficit(id))));
    if (totalDeficit <= left) { for (const id of allowed) { const d = Math.max(0, deficit(id)); add.set(id, d); left -= d; } }
    else {
      // Raise the lowest fill levels first (exact water-filling on relative deficit).
      const items = allowed.map(id => ({ id, d: Math.max(0, deficit(id)) })).sort((x, y) => y.d - x.d);
      let level = 0; let k = 1;
      for (; k <= items.length; k++) { level = (sum(items.slice(0, k).map(i => i.d)) - left) / k; if (level >= (items[k]?.d ?? 0)) break; }
      for (const i of items.slice(0, k)) add.set(i.id, Math.max(0, i.d - level));
      left = 0;
    }
    if (left > 1e-9) { const tw = sum(allowed.map(id => w.mapping.find(m => m.accountId === accountId && m.classId === id)!.target)); for (const id of allowed) add.set(id, (add.get(id) ?? 0) + left * w.mapping.find(m => m.accountId === accountId && m.classId === id)!.target / tw); }
  }
  const projected = { ...portfolio, positions: portfolio.positions };
  const extraHoldings: Holding[] = [...add.entries()].map(([classId, value]) => ({ id: `sim-${classId}`, name: "Apport simulé", isin: "", ticker: "", exchange: "", accountId, classId, kind: "value", currency: "EUR", quantity: 0, price: null, fxRate: 1, fractional: false, value, priceDate: null }));
  const after = analyse(projected, { ...w, holdings: [...w.holdings, ...extraHoldings] });
  return { before: a, after, split: [...add.entries()].map(([classId, value]) => ({ classId, value })), unallocated: allowed.length ? 0 : safe };
}
export function bestAccount(portfolio: Portfolio, w: Wealth, amount: number) {
  let best: { id: string; score: number } | null = null;
  for (const acc of w.accounts) { const s = simulateContribution(portfolio, w, amount, acc.id).after.score; if (s !== null && (!best || s > best.score)) best = { id: acc.id, score: s }; }
  return best;
}
