import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseChart, parseEcbXml, type Candidate, type ChartMeta, type FxSnapshot, type MarketResult } from "./market";
import { resolveMarketItem } from "./market-service";
import { QUOTES_URL, validateQuotes } from "./euronext-quotes";
import { ISIN_PATTERN } from "./instrument-mapping";

const UA = { "User-Agent": "Mozilla/5.0 (equilibre personal portfolio)", Accept: "application/json,text/xml" };
const cache = new Map<string, { at: number; value: unknown }>();
const TTL = { search: 24 * 3600e3, chart: 15 * 60e3, fx: 6 * 3600e3 };
async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load(); cache.set(key, { at: Date.now(), value }); return value;
}
/** Retries 429/5xx with backoff; never turns a failure into a price. */
async function get(url: string, attempts = 3): Promise<Response> {
  let last = "";
  for (let i = 0; i < attempts; i++) {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10000) });
    if (r.ok) return r;
    last = r.status === 429 ? "Limite de requêtes atteinte chez le fournisseur" : `Erreur fournisseur ${r.status}`;
    console.error(`market fetch ${url} -> ${r.status}`);
    if (r.status !== 429 && r.status < 500) break;
    await new Promise(res => setTimeout(res, 800 * 2 ** i));
  }
  throw new Error(last);
}
const search = (q: string) => cached(`s:${q}`, TTL.search, async (): Promise<Candidate[]> => {
  const j = await (await get(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`)).json() as { quotes?: { symbol?: string; exchange?: string; longname?: string; shortname?: string; quoteType?: string }[] };
  return (j.quotes ?? []).flatMap(x => x.symbol && ["EQUITY", "ETF", "MUTUALFUND"].includes(x.quoteType ?? "") ? [{ symbol: x.symbol, exchange: x.exchange ?? "", name: x.longname ?? x.shortname ?? "" }] : []);
});
const chart = (symbol: string) => {
  if (ISIN_PATTERN.test(symbol)) throw new Error("Un ISIN n’est pas un symbole fournisseur.");
  return cached(`c:${symbol}`, TTL.chart, async (): Promise<ChartMeta> => parseChart(await (await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`)).json()));
};
const feed = () => cached("euronext", TTL.chart, async () => validateQuotes(await (await get(QUOTES_URL)).json()).quotes);

const item = z.object({ id: z.string().min(1).max(80), name: z.string().max(200), isin: z.string().max(12), ticker: z.string().max(20), exchange: z.string().max(60), currency: z.string().regex(/^[A-Z]{3}$/), kind: z.enum(["quantity", "value"]), userSymbol: z.string().regex(/^[A-Za-z0-9.^=-]{1,20}$/).nullable() });

export const refreshMarket = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ items: z.array(item).max(60) }).parse(d))
  .handler(async ({ data }) => {
    const results: MarketResult[] = [];
    for (let i = 0; i < data.items.length; i += 3) {
      results.push(...await Promise.all(data.items.slice(i, i + 3).map(it => resolveMarketItem(it, { search, chart, feed }))));
    }
    let fx: FxSnapshot | null = null; let fxError: string | null = null;
    try { fx = await cached("fx", TTL.fx, async () => parseEcbXml(await (await get("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml")).text())); }
    catch (e) { fxError = e instanceof Error ? e.message : "Taux BCE indisponibles"; }
    return { results, fx, fxError, at: new Date().toISOString() };
  });
