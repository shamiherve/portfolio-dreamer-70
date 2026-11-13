import { z } from "zod";

/** Pure market-data logic shared by the server function and the browser. Never touches quantities. */
export const EXCHANGES: Record<string, { label: string; euronext?: boolean; aliases: string[] }> = {
  PAR: { label: "Euronext Paris", euronext: true, aliases: ["PAR", "PARIS", "EURONEXT PARIS", "XPAR", "EPA"] },
  AMS: { label: "Euronext Amsterdam", euronext: true, aliases: ["AMS", "AMSTERDAM", "EURONEXT AMSTERDAM", "XAMS"] },
  BRU: { label: "Euronext Bruxelles", euronext: true, aliases: ["BRU", "BRUSSELS", "BRUXELLES", "EURONEXT BRUSSELS", "EURONEXT BRUXELLES", "XBRU"] },
  LIS: { label: "Euronext Lisbonne", euronext: true, aliases: ["LIS", "LISBON", "LISBONNE", "EURONEXT LISBON", "XLIS"] },
  MIL: { label: "Euronext Milan", euronext: true, aliases: ["MIL", "MILAN", "EURONEXT MILAN", "BORSA ITALIANA", "XMIL"] },
  OSL: { label: "Euronext Oslo", euronext: true, aliases: ["OSL", "OSLO", "EURONEXT OSLO", "XOSL"] },
  ISE: { label: "Euronext Dublin", euronext: true, aliases: ["ISE", "DUBLIN", "EURONEXT DUBLIN", "XMSM"] },
  NMS: { label: "NASDAQ", aliases: ["NMS", "NGM", "NCM", "NASDAQ", "NASDAQGS", "NASDAQGM", "NASDAQCM", "XNAS"] },
  NYQ: { label: "NYSE", aliases: ["NYQ", "NYSE", "XNYS"] },
  ASE: { label: "NYSE American", aliases: ["ASE", "NYSE AMERICAN", "XASE"] },
  PCX: { label: "NYSE Arca", aliases: ["PCX", "NYSE ARCA", "ARCX"] },
  GER: { label: "XETRA", aliases: ["GER", "XETRA", "XETR"] },
  FRA: { label: "Francfort", aliases: ["FRA", "FRANKFURT", "FRANCFORT", "XFRA"] },
  LSE: { label: "Bourse de Londres", aliases: ["LSE", "LONDON", "LONDRES", "XLON"] },
  EBS: { label: "SIX Swiss Exchange", aliases: ["EBS", "SIX", "XSWX"] },
  STU: { label: "Stuttgart", aliases: ["STU", "STUTTGART", "XSTU"] },
};
export function normExchange(s: string | null | undefined): string | null {
  const v = (s ?? "").trim().toUpperCase();
  if (!v) return null;
  for (const [code, e] of Object.entries(EXCHANGES)) if (e.aliases.includes(v)) return code;
  return null;
}
export const exchangeLabel = (code: string | null) => code ? EXCHANGES[code]?.label ?? code : "";

export interface Candidate { symbol: string; exchange: string; name: string }
export interface ChartMeta { symbol: string; price: number; currency: string; timestamp: string; exchange: string; name: string }
export interface IdentityInput { id: string; name: string; isin: string; ticker: string; exchange: string; currency: string; kind: "quantity" | "value"; userSymbol: string | null }
export type MetaStatus = "verified" | "corrected" | "manual" | "none";
export interface Correction { field: "name" | "ticker" | "exchange" | "currency"; from: string; to: string; reason: string }
export interface Resolution { status: MetaStatus; provider: "yahoo" | "euronext" | "manual" | "none"; symbol: string | null; verified: { name: string; isin: string; ticker: string; exchange: string; currency: string } | null; corrections: Correction[]; issues: string[]; candidates: Candidate[] }
export interface QuoteSource { provider: "yahoo" | "euronext"; symbol: string; exchange: string; fallback: boolean }

/** Yahoo chart payload → validated quote meta. A 200 response without a usable price is rejected. */
export function parseChart(json: unknown): ChartMeta {
  const m = (json as { chart?: { result?: { meta?: { regularMarketPrice?: unknown; currency?: unknown; regularMarketTime?: unknown; symbol?: unknown; exchangeName?: unknown; longName?: unknown; shortName?: unknown } }[] } })?.chart?.result?.[0]?.meta;
  if (!m) throw new Error("Réponse sans cotation exploitable.");
  let price = Number(m.regularMarketPrice); let currency = String(m.currency ?? "");
  const t = Number(m.regularMarketTime);
  if (currency === "GBp" || currency === "GBX") { price = price / 100; currency = "GBP"; }
  if (!Number.isFinite(price) || price <= 0) throw new Error("Cours nul, négatif ou absent.");
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Devise de cotation absente.");
  if (!Number.isFinite(t) || t <= 0) throw new Error("Horodatage de cotation invalide.");
  return { symbol: String(m.symbol ?? ""), price, currency, timestamp: new Date(t * 1000).toISOString(), exchange: String(m.exchangeName ?? ""), name: String(m.longName ?? m.shortName ?? "") };
}
const base = (symbol: string) => symbol.split(".")[0] ?? symbol;

/** Decides whether a listing is certain. Never guesses between several listings, never changes an ISIN. */
export function resolveIdentity(input: IdentityInput, candidates: Candidate[], meta: ChartMeta | null, viaIsin: boolean): Resolution {
  const none = (issues: string[], status: MetaStatus = "none"): Resolution => ({ status, provider: status === "none" ? "none" : "manual", symbol: null, verified: null, corrections: [], issues, candidates });
  if (input.kind === "value") return none(["Fonds en euros / valorisation : aucune cotation de marché, valorisation manuelle conservée."]);
  const wanted = normExchange(input.exchange);
  if (input.exchange.trim() && !wanted) return none([`Place de cotation « ${input.exchange} » non reconnue : précisez-la (ex. Euronext Paris, NYSE, NASDAQ, XETRA).`], "manual");
  let pick: Candidate | null = null;
  if (input.userSymbol) pick = candidates.find(c => c.symbol === input.userSymbol) ?? { symbol: input.userSymbol, exchange: meta?.exchange ?? "", name: meta?.name ?? "" };
  else {
    if (!candidates.length) return none([viaIsin ? "Aucune cotation trouvée pour cet ISIN chez les sources gratuites." : "ISIN manquant et aucune cotation trouvée."]);
    if (!viaIsin) return none([`ISIN manquant : ${candidates.length} cotation(s) possible(s) pour « ${input.ticker || input.name} ». Renseignez l’ISIN ou choisissez le symbole.`], "manual");
    const matches = wanted ? candidates.filter(c => normExchange(c.exchange) === wanted) : candidates;
    if (wanted && !matches.length) return none([`Aucune cotation de cet ISIN sur ${exchangeLabel(wanted)} parmi : ${candidates.map(c => `${c.symbol} (${exchangeLabel(normExchange(c.exchange)) || c.exchange})`).join(", ")}.`], "manual");
    if (matches.length > 1) return none([`Plusieurs cotations possibles : ${matches.map(c => c.symbol).join(", ")}. Indiquez la place de cotation ou le symbole.`], "manual");
    pick = matches[0] ?? null;
  }
  if (!pick) return none(["Aucune cotation identifiée."]);
  if (!meta) return none(["Cotation introuvable pour le symbole retenu."]);
  if (meta.symbol && meta.symbol.toUpperCase() !== pick.symbol.toUpperCase()) return none(["Le symbole retourné ne correspond pas au symbole demandé."], "manual");
  const exch = normExchange(meta.exchange) ?? normExchange(pick.exchange);
  if (wanted && exch !== wanted) return none([`La cotation retournée provient de ${exchangeLabel(exch) || meta.exchange}, pas de ${exchangeLabel(wanted)}.`], "manual");
  if (normExchange(pick.exchange) && exch !== normExchange(pick.exchange)) return none(["Place de cotation incohérente entre recherche et cours."], "manual");
  const exchangeConfirmed = Boolean(input.userSymbol) || (wanted !== null && exch === wanted);
  if (meta.currency !== input.currency && !exchangeConfirmed) return { ...none([`Devise saisie ${input.currency} mais la seule cotation trouvée (${pick.symbol}, ${exchangeLabel(exch) || meta.exchange}) est en ${meta.currency}. Indiquez la place où vous détenez le titre ou choisissez le symbole.`], "manual"), candidates };
  const verified = { name: meta.name || input.name, isin: input.isin, ticker: base(pick.symbol), exchange: exchangeLabel(exch) || meta.exchange, currency: meta.currency };
  const why = input.userSymbol ? "Symbole confirmé par vous" : "Cotation unique identifiée par l’ISIN";
  const corrections: Correction[] = [];
  if (input.ticker.toUpperCase() !== verified.ticker.toUpperCase()) corrections.push({ field: "ticker", from: input.ticker, to: verified.ticker, reason: why });
  if (normExchange(input.exchange) !== exch && verified.exchange) corrections.push({ field: "exchange", from: input.exchange, to: verified.exchange, reason: why });
  if (input.currency !== verified.currency) corrections.push({ field: "currency", from: input.currency, to: verified.currency, reason: `${why} : devise de cotation` });
  if (verified.name && input.name.trim().toLowerCase() !== verified.name.toLowerCase()) corrections.push({ field: "name", from: input.name, to: verified.name, reason: why });
  return { status: corrections.length ? "corrected" : "verified", provider: "yahoo", symbol: pick.symbol, verified, corrections, issues: [], candidates };
}

/** ECB publishes 1 EUR = r units of currency. EUR value of one unit = 1 / r. */
export const toEurRate = (ecbRate: number) => 1 / ecbRate;
export function parseEcbXml(xml: string) {
  const date = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  if (!date) throw new Error("Taux BCE illisibles.");
  const rates: Record<string, number> = {};
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) { const r = Number(m[2]); const currency = m[1]; if (currency && r > 0 && Number.isFinite(r)) rates[currency] = r; }
  if (!Object.keys(rates).length) throw new Error("Aucun taux BCE.");
  return { date, rates };
}

export const STALE_DAYS = 4; export const MAX_VARIATION = 0.2;
export type QuoteKind = "delayed" | "close" | "stale";
export function quoteKind(timestamp: string, now: Date): QuoteKind {
  const age = now.getTime() - new Date(timestamp).getTime();
  if (age > STALE_DAYS * 86400000) return "stale";
  const day = (d: Date) => d.toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
  return day(new Date(timestamp)) === day(now) ? "delayed" : "close";
}
export const kindLabel: Record<QuoteKind, string> = { delayed: "Différé (jour même)", close: "Dernier cours de clôture", stale: "Cours ancien" };
/** Returns null when the quote may be applied, otherwise the reason it must not be. */
export function quoteProblem(q: { price: number; currency: string; timestamp: string }, expectedCurrency: string, previous: { price: number | null; currency: string }, now: Date): { reject?: string; review?: string } | null {
  if (!Number.isFinite(q.price) || q.price <= 0) return { reject: "Cours nul, négatif ou invalide." };
  if (q.currency !== expectedCurrency) return { reject: `Devise ${q.currency} différente de la devise vérifiée ${expectedCurrency}.` };
  const t = new Date(q.timestamp).getTime();
  if (!Number.isFinite(t) || t > now.getTime() + 300000) return { reject: "Horodatage invalide ou dans le futur." };
  if (previous.price && previous.currency === q.currency && Math.abs(q.price / previous.price - 1) > MAX_VARIATION) return { review: `Variation de ${((q.price / previous.price - 1) * 100).toFixed(1)} % par rapport au dernier cours : à confirmer.` };
  return null;
}

export const resultSchema = z.object({
  id: z.string(), resolution: z.custom<Resolution>(), quote: z.object({ price: z.number(), currency: z.string(), timestamp: z.string(), source: z.custom<QuoteSource>().optional() }).nullable(), error: z.string().nullable(),
});
export type MarketResult = z.infer<typeof resultSchema>;
export interface FxSnapshot { date: string; rates: Record<string, number> }
