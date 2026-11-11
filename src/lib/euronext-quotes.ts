import { z } from "zod";
import { portfolioSchema, type Portfolio } from "./portfolio";

export const QUOTES_URL = "https://shamiherve.github.io/euronext-etf-quotes/quotes.json";
const quoteSchema = z.object({
  isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/), ticker: z.string().trim().min(1),
  price: z.number().finite().positive(), currency: z.literal("EUR"),
  trade_timestamp: z.string().datetime(), update_timestamp: z.string().datetime(),
});
export type EuronextQuote = z.infer<typeof quoteSchema>;

export function validateQuotes(raw: unknown, now = new Date()) {
  if (!Array.isArray(raw)) throw new Error("Format du flux Euronext invalide.");
  const quotes: EuronextQuote[] = [];
  const rejected: string[] = [];
  const duplicates = new Set<string>();
  const seen = new Set<string>();
  for (const row of raw) {
    const parsed = quoteSchema.safeParse(row);
    if (!parsed.success) { rejected.push(typeof row?.isin === "string" ? row.isin : "Enregistrement invalide"); continue; }
    const q = parsed.data;
    if (seen.has(q.isin)) duplicates.add(q.isin);
    seen.add(q.isin);
    if (Date.parse(q.trade_timestamp) > Date.parse(q.update_timestamp) || Date.parse(q.update_timestamp) > now.getTime()) { rejected.push(q.isin); continue; }
    quotes.push(q);
  }
  return { quotes: quotes.filter(q => !duplicates.has(q.isin)), rejected: [...rejected, ...duplicates] };
}

export async function fetchQuotes(signal: AbortSignal) {
  const response = await fetch(QUOTES_URL, { signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error(`Flux Euronext indisponible (${response.status}).`);
  return validateQuotes(await response.json());
}

export function mergeQuotes(portfolio: Portfolio, quotes: EuronextQuote[], checkedAt: string) {
  const history = [...(portfolio.quoteHistory ?? [])];
  const matched: string[] = [];
  const preserved: string[] = [];
  const updates: string[] = [];
  const positions = portfolio.positions.map(p => {
    const q = quotes.find(q => q.isin === p.isin);
    if (!q) { preserved.push(p.isin || p.name); return p; }
    // Never roll back a newer manual date or a newer already imported trade.
    const parisDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(q.trade_timestamp));
    if ((p.priceDate && p.priceDate > parisDate) || (p.tradeTimestamp && Date.parse(p.tradeTimestamp) > Date.parse(q.trade_timestamp))) { preserved.push(p.isin); return p; }
    // A manual override survives a stagnant feed until a newer trade arrives.
    if (p.priceSource === "manual" && p.tradeTimestamp && Date.parse(p.tradeTimestamp) >= Date.parse(q.trade_timestamp)) { preserved.push(p.isin); return p; }
    matched.push(p.isin); updates.push(q.update_timestamp);
    if (!history.some(h => h.isin === q.isin && h.price === q.price && h.tradeTimestamp === q.trade_timestamp && h.updateTimestamp === q.update_timestamp)) {
      history.push({ isin: q.isin, price: q.price, currency: "EUR", tradeTimestamp: q.trade_timestamp, updateTimestamp: q.update_timestamp });
    }
    return { ...p, price: q.price, priceDate: parisDate, tradeTimestamp: q.trade_timestamp, quoteUpdatedAt: q.update_timestamp, priceSource: "euronext" as const };
  });
  if (!matched.length) return { portfolio, matched, preserved };
  const feedUpdatedAt = [portfolio.feedUpdatedAt, ...updates].filter((s): s is string => Boolean(s)).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  return { portfolio: portfolioSchema.parse({ ...portfolio, positions, quoteHistory: history, feedUpdatedAt, quotesCheckedAt: checkedAt }), matched, preserved };
}