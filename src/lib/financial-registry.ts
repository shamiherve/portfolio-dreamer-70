import { z } from "zod";
import { realDate } from "./ledger";
import { holdingValue, type Wealth } from "./wealth";
import type { Portfolio } from "./portfolio";
import { quoteProblem, type MarketResult, type FxSnapshot } from "./market";

export const REGISTRY_KEY = "equilibre.financial-registry.v1";
const date = z.string().refine(realDate, "Date invalide.");
const currency = z.string().regex(/^[A-Z]{3}$/, "Devise : trois lettres majuscules.");
export const accountTypes = { pea: "PEA", cto: "CTO", assurance: "Assurance-vie", per: "PER", cash: "Compte espèces", other: "Autre compte financier" } as const;
export const instrumentTypes = { stock: "Action", etf: "ETF", etc: "ETC", euro: "Fonds euros", unit: "Unité de compte", fund: "Fonds", bond: "Obligation", other: "Autre support financier" } as const;
export const financialAccountSchema = z.object({
  id: z.string().min(1).max(80), legacyId: z.string().nullable(), name: z.string().trim().min(1).max(200),
  type: z.enum(["pea", "cto", "assurance", "per", "cash", "other"]), institution: z.string().trim().max(200), currency,
  openedAt: date.nullable(), mode: z.enum(["auto", "manual"]), active: z.boolean(),
  targetAccountId: z.string().nullable(),
}).strict();
export const financialInstrumentSchema = z.object({
  id: z.string().min(1).max(80), legacyRef: z.string().nullable(), accountId: z.string().min(1), name: z.string().trim().min(1).max(200),
  isin: z.string().regex(/^$|^[A-Z]{2}[A-Z0-9]{9}\d$/, "ISIN invalide."), ticker: z.string().max(20), exchange: z.string().max(60), currency,
  type: z.enum(["stock", "etf", "etc", "euro", "unit", "fund", "bond", "other"]), mode: z.enum(["auto", "manual"]), active: z.boolean(),
  classId: z.string().nullable(), quantity: z.number().finite().nonnegative(),
}).strict();
export const valuationSchema = z.object({
  id: z.string().min(1), instrumentId: z.string().min(1), accountId: z.string().min(1), date,
  value: z.number().finite().nonnegative(), comment: z.string().max(2000), at: z.string().datetime(), supersedes: z.string().nullable(),
  origin: z.enum(["manual", "quote"]), externalFlow: z.number().finite().nullable(),
  quote: z.object({ price: z.number().positive(), currency, symbol: z.string(), exchange: z.string(), fxRate: z.number().positive(), fxDate: date }).strict().nullable(),
}).strict();
export const registrySchema = z.object({ version: z.literal(1), accounts: z.array(financialAccountSchema), instruments: z.array(financialInstrumentSchema), valuations: z.array(valuationSchema) }).strict().superRefine((r, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  for (const items of [r.accounts, r.instruments, r.valuations]) if (new Set(items.map(x => x.id)).size !== items.length) issue("Identifiants dupliqués.");
  const activeValues = r.valuations.filter(v => !r.valuations.some(x => x.supersedes === v.id));
  if (new Set(activeValues.map(v => `${v.instrumentId}|${v.date}`)).size !== activeValues.length) issue("Plusieurs valorisations actives du même instrument à la même date.");
  for (const v of r.valuations) {
    const i = r.instruments.find(x => x.id === v.instrumentId);
    if (!i || i.legacyRef || i.accountId !== v.accountId) issue("Valorisation : instrument/compte incohérent ou position existante protégée.");
    if (v.supersedes) {
      const old = r.valuations.find(x => x.id === v.supersedes);
      if (!old || old.instrumentId !== v.instrumentId || old.accountId !== v.accountId || old.at > v.at || old.id === v.id) issue("Révision de valorisation incohérente.");
      if (r.valuations.filter(x => x.supersedes === v.supersedes).length !== 1) issue("Valorisation déjà corrigée.");
      const visited = new Set([v.id]); let cursor: string | null = v.supersedes;
      while (cursor) { if (visited.has(cursor)) { issue("Cycle de corrections de valorisation."); break; } visited.add(cursor); cursor = r.valuations.find(x => x.id === cursor)?.supersedes ?? null; }
    }
    if (v.origin === "quote" && !v.quote) issue("Source du cours manquante.");
  }
});
export type FinancialRegistry = z.infer<typeof registrySchema>;
export type FinancialAccount = z.infer<typeof financialAccountSchema>;
export type FinancialInstrument = z.infer<typeof financialInstrumentSchema>;
export type Valuation = z.infer<typeof valuationSchema>;
export const emptyRegistry = (): FinancialRegistry => ({ version: 1, accounts: [], instruments: [], valuations: [] });
export function readRegistry(storage: Pick<Storage, "getItem">) {
  const raw = storage.getItem(REGISTRY_KEY);
  return raw === null ? emptyRegistry() : registrySchema.parse(JSON.parse(raw));
}

/** Existing positions are read through references, never copied into this registry. The unowned insurance target stays a target. */
export function visibleAccounts(r: FinancialRegistry, w: Wealth): FinancialAccount[] {
  const existing = w.accounts.filter(a => a.id === "pea" || a.id === "cto" || w.holdings.some(h => h.accountId === a.id && holdingValue(h) > 0));
  return [...existing.map(a => r.accounts.find(x => x.legacyId === a.id) ?? { id: a.id, legacyId: a.id, name: a.name, type: a.id === "pea" ? "pea" as const : a.id === "cto" ? "cto" as const : "other" as const, institution: "", currency: "EUR", openedAt: null, mode: "auto" as const, active: true, targetAccountId: a.id }), ...r.accounts.filter(a => !a.legacyId)];
}
export function visibleInstruments(r: FinancialRegistry, p: Portfolio, w: Wealth): FinancialInstrument[] {
  const existing: FinancialInstrument[] = [
    ...p.positions.map(x => ({ id: `etf:${x.id}`, legacyRef: `etf:${x.id}`, accountId: "pea", name: x.name, isin: x.isin, ticker: "", exchange: "Euronext", currency: "EUR", type: "etf" as const, mode: "auto" as const, active: true, classId: "etf", quantity: x.quantity })),
    ...w.holdings.filter(h => h.accountId === "pea" || h.accountId === "cto" || holdingValue(h) > 0).map(h => ({ id: `w:${h.id}`, legacyRef: `w:${h.id}`, accountId: h.accountId, name: h.name, isin: h.isin, ticker: h.ticker, exchange: h.exchange, currency: h.currency, type: h.isin === "IE00B4ND3602" ? "etc" as const : h.kind === "value" ? "fund" as const : "stock" as const, mode: h.kind === "value" || h.market?.priceMode === "manual" ? "manual" as const : "auto" as const, active: true, classId: h.classId, quantity: h.quantity })),
  ];
  return [...existing.map(i => { const override = r.instruments.find(x => x.legacyRef === i.id); return override ? { ...i, name: override.name, active: override.active } : i; }), ...r.instruments.filter(i => !i.legacyRef)];
}
export function validateRegistry(raw: unknown, p: Portfolio, w: Wealth, allowStaleLegacy = false): FinancialRegistry {
  const r = registrySchema.parse(raw);
  const accounts = visibleAccounts(r, w);
  for (const a of r.accounts.filter(x => !x.legacyId)) if (accounts.some(x => x.id !== a.id && x.name.trim().toLocaleLowerCase("fr") === a.name.trim().toLocaleLowerCase("fr") && x.type === a.type && x.institution.trim().toLocaleLowerCase("fr") === a.institution.trim().toLocaleLowerCase("fr") && x.currency === a.currency)) throw new Error("Compte potentiellement déjà présent : même nom, type, établissement et devise. Vérifiez sa fiche existante.");
  if (r.accounts.some(a => a.legacyId && !w.accounts.some(x => x.id === a.legacyId))) throw new Error("Référence de compte existant inconnue.");
  if (new Set(r.accounts.flatMap(a => a.legacyId ? [a.legacyId] : [])).size !== r.accounts.filter(a => a.legacyId).length) throw new Error("Compte existant dupliqué.");
  if (r.accounts.some(a => !a.legacyId && w.accounts.some(x => x.id === a.id))) throw new Error("Identifiant de compte déjà réservé.");
  if (r.accounts.some(a => a.legacyId && a.id !== a.legacyId)) throw new Error("Identifiant du compte existant protégé.");
  for (const a of r.accounts) if (a.targetAccountId && !w.accounts.some(x => x.id === a.targetAccountId)) throw new Error("Rattachement cible inconnu.");
  const original = visibleInstruments(emptyRegistry(), p, w);
  for (const i of r.instruments) {
    if (!accounts.some(a => a.id === i.accountId)) throw new Error("Instrument : compte inconnu.");
    if (i.classId && !w.classes.some(c => c.id === i.classId)) throw new Error("Classe inconnue.");
    if (i.legacyRef) {
      const old = original.find(x => x.id === i.legacyRef);
      // Legacy snapshots may retain older quantities/listings. They are references, never numerical sources.
      const protectedFields = allowStaleLegacy ? ["id", "accountId", "isin"] : ["id", "accountId", "isin", "ticker", "exchange", "currency", "type", "quantity", "mode", "classId"];
      if (!old || protectedFields.some(k => old[k as keyof FinancialInstrument] !== i[k as keyof FinancialInstrument])) throw new Error("Identité, quantité et cotation existantes protégées.");
    } else if (original.some(x => x.id === i.id || (i.isin && x.accountId === i.accountId && x.isin === i.isin))) throw new Error("Instrument déjà présent : utilisez sa ligne existante.");
    if (r.instruments.some(x => x.id !== i.id && x.accountId === i.accountId && i.isin && x.isin === i.isin)) throw new Error("ISIN déjà présent dans ce compte.");
  }
  return r;
}
export function effectiveValuations(r: FinancialRegistry) {
  const replaced = new Set(r.valuations.flatMap(v => v.supersedes ? [v.supersedes] : []));
  return r.valuations.filter(v => !replaced.has(v.id)).sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
}
export function latestValuation(r: FinancialRegistry, id: string, date: string) { return effectiveValuations(r).filter(v => v.instrumentId === id && v.date <= date).at(-1) ?? null; }
/** Only explicit, active new accounts/supports with real dated valuations enter the additional actual total. Never the frozen allocation engine. */
export function registryLines(r: FinancialRegistry, w: Wealth, date: string) {
  const accounts = visibleAccounts(r, w);
  return r.instruments.filter(i => !i.legacyRef && i.active && accounts.some(a => a.id === i.accountId && a.active)).map(i => ({ instrument: i, valuation: latestValuation(r, i.id, date) }));
}
export function registryTotal(r: FinancialRegistry, w: Wealth, date: string) { return registryLines(r, w, date).reduce((s, x) => s + (x.valuation?.value ?? 0), 0); }
export function saveAccount(r: FinancialRegistry, account: FinancialAccount) {
  return registrySchema.parse({ ...r, accounts: [...r.accounts.filter(x => x.id !== account.id), financialAccountSchema.parse(account)] });
}
export function saveInstrument(r: FinancialRegistry, i: FinancialInstrument) {
  const before = r.instruments.find(x => x.id === i.id);
  if (before && before.accountId !== i.accountId && r.valuations.some(v => v.instrumentId === i.id)) throw new Error("Compte associé protégé : des valorisations existent.");
  return registrySchema.parse({ ...r, instruments: [...r.instruments.filter(x => x.id !== i.id), financialInstrumentSchema.parse(i)] });
}
export function appendValuation(r: FinancialRegistry, v: Valuation, now: string) {
  const i = r.instruments.find(x => x.id === v.instrumentId);
  if (!i || i.legacyRef || !i.active) throw new Error("Instrument absent, inactif ou existant protégé.");
  if (v.date > now.slice(0, 10)) throw new Error("Date future refusée.");
  if (r.valuations.some(x => x.id === v.id)) throw new Error("Identifiant déjà enregistré.");
  if (!v.supersedes && effectiveValuations(r).some(x => x.instrumentId === v.instrumentId && x.date === v.date)) throw new Error("Une valorisation existe à cette date : choisissez Modifier (l’ancienne sera conservée).");
  if (v.supersedes && !effectiveValuations(r).some(x => x.id === v.supersedes)) throw new Error("Valorisation déjà corrigée.");
  return registrySchema.parse({ ...r, valuations: [...r.valuations, valuationSchema.parse(v)] });
}
/** Returns observed dates only. Unknown external flows break performance, rather than inventing investment returns. */
export function registryHistory(r: FinancialRegistry, accountId: string) {
  const vs = effectiveValuations(r).filter(v => v.accountId === accountId);
  const dates = [...new Set(vs.map(v => v.date))].sort();
  let previous: number | null = null, index: number | null = 1;
  return dates.map(d => {
    const ids = [...new Set(vs.filter(v => v.date <= d).map(v => v.instrumentId))];
    const value = ids.reduce((s, id) => s + (vs.filter(v => v.instrumentId === id && v.date <= d).at(-1)?.value ?? 0), 0);
    const current = vs.filter(v => v.date === d);
    const flow = current.every(v => v.externalFlow !== null) ? current.reduce((s, v) => s + (v.externalFlow ?? 0), 0) : null;
    if (previous !== null) index = index === null || flow === null || previous <= 0 ? null : index * (value - flow) / previous;
    previous = value;
    return { date: d, value, performance: index === null ? null : (index - 1) * 100, flow };
  });
}
/** Validated automatic quote → dated total valuation of the newly entered quantity; no legacy state is reachable. */
export function valuationFromQuote(i: FinancialInstrument, result: MarketResult, fx: FxSnapshot | null, now: string, id: string): Valuation {
  const q = result.quote, identity = result.resolution.verified;
  if (i.legacyRef || i.mode !== "auto" || !q || result.error || !identity || !["verified", "corrected"].includes(result.resolution.status)) throw new Error(result.error ?? (result.resolution.issues.join(" ") || "Cours non vérifié : saisie manuelle disponible."));
  if (identity.isin !== i.isin || identity.currency !== i.currency) throw new Error("Identité ou devise différente : cours non appliqué.");
  const problem = quoteProblem(q, i.currency, { price: null, currency: i.currency }, new Date(now));
  if (problem) throw new Error(problem.reject ?? problem.review);
  const rate = q.currency === "EUR" ? 1 : fx?.rates[q.currency];
  if (!rate || rate <= 0) throw new Error("Taux BCE indisponible : dernier montant conservé.");
  return valuationSchema.parse({ id, instrumentId: i.id, accountId: i.accountId, date: q.timestamp.slice(0, 10), value: Math.round(i.quantity * q.price / rate * 100) / 100,
    at: now, comment: "Cours vérifié", supersedes: null, origin: "quote", externalFlow: null,
    quote: { price: q.price, currency: q.currency, symbol: result.resolution.symbol ?? "", exchange: identity.exchange, fxRate: 1 / rate, fxDate: fx?.date ?? q.timestamp.slice(0, 10) } });
}