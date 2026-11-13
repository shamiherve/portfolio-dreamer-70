import { exchangeLabel, normExchange, resolveIdentity, type Candidate, type ChartMeta, type IdentityInput, type MarketResult } from "./market";
import { fallbackListings, GOLD_ETC_ISIN, goldListingCurrency, holdingExchange, ISIN_PATTERN, knownListings, listingCandidates, STELLANTIS_ISIN, tickerSymbol } from "./instrument-mapping";
import type { EuronextQuote } from "./euronext-quotes";

interface Sources { search: (query: string) => Promise<Candidate[]>; chart: (symbol: string) => Promise<ChartMeta>; feed: () => Promise<EuronextQuote[]> }
const failure = (input: IdentityInput, error: string, candidates: Candidate[] = []): MarketResult => ({ id: input.id, resolution: { status: "manual", provider: "none", symbol: null, verified: null, corrections: [], issues: [error], candidates }, quote: null, error });

/** Reads market data only: the input contains no quantity, history, targets or account data. */
export async function resolveMarketItem(input: IdentityInput, sources: Sources): Promise<MarketResult> {
  if (input.kind === "value") return { id: input.id, resolution: resolveIdentity(input, [], null, false), quote: null, error: null };
  const viaIsin = ISIN_PATTERN.test(input.isin);
  const wanted = holdingExchange(input);
  const effective = { ...input, exchange: wanted ? exchangeLabel(wanted) : input.exchange };
  let searched: Candidate[] = [];
  try { searched = await sources.search(viaIsin ? input.isin : input.ticker || input.name); }
  catch (e) { if (!knownListings(input.isin).length && !input.userSymbol) return failure(input, e instanceof Error ? e.message : "Recherche indisponible"); }
  const candidates = listingCandidates(input, searched);
  let manual = input.userSymbol?.trim().toUpperCase() ?? null;
  if (manual && ISIN_PATTERN.test(manual)) manual = null;
  // A confirmed holding exchange takes precedence over the old, broken Stuttgart workaround.
  if (input.isin === STELLANTIS_ISIN && wanted === "PAR" && manual === "STLA.SG") manual = null;
  if (input.isin === STELLANTIS_ISIN && manual && !knownListings(input.isin).some(c => c.symbol === manual)) return failure(input, "Symbole Stellantis non vérifié : aucun cours appliqué.", candidates);
  if (input.isin === GOLD_ETC_ISIN) {
    const issue = !wanted && !manual
      ? "Place Trade Republic non déterminée : vérification manuelle requise. Le ticker et la devise de référence USD ne suffisent pas à identifier votre cotation."
      : manual && (!knownListings(input.isin).some(c => c.symbol === manual) || goldListingCurrency(manual) !== input.currency)
        ? "Symbole ou devise de cotation non vérifié pour cet ETC : dernier cours conservé. Aucun cours spot de l’or n’est utilisé."
        : null;
    if (issue) return { id: input.id, resolution: { status: "manual", provider: "manual", symbol: null, verified: null, corrections: [], issues: [issue], candidates }, quote: null, error: null };
  }
  const matching = (wanted ? candidates.filter(c => normExchange(c.exchange) === wanted) : candidates)
    .filter(c => input.isin !== GOLD_ETC_ISIN || goldListingCurrency(c.symbol) === input.currency);
  const selected = manual ? candidates.find(c => c.symbol === manual) ?? { symbol: manual, exchange: effective.exchange, name: input.name } : matching.length === 1 ? matching[0] : undefined;
  if (!selected) {
    // Ticker-derived symbols are discovery queries, not proof that a listing belongs to an ISIN.
    const guess = tickerSymbol(effective);
    if (guess && viaIsin && !knownListings(input.isin).length) {
      try { candidates.push(...(await sources.search(guess)).filter(c => !candidates.some(k => k.symbol === c.symbol))); } catch { /* Preserve last price. */ }
    }
    return { id: input.id, resolution: resolveIdentity({ ...effective, userSymbol: null }, candidates, null, viaIsin), quote: null, error: null };
  }
  if (!viaIsin && !manual) return { id: input.id, resolution: resolveIdentity(effective, candidates, null, false), quote: null, error: null };
  if (wanted === "PAR" && input.currency === "EUR") {
    try {
      const q = (await sources.feed()).find(q => q.isin === input.isin && q.ticker === selected.symbol.split(".")[0]);
      if (q) {
        const meta = { symbol: selected.symbol, price: q.price, currency: q.currency, timestamp: q.trade_timestamp, exchange: "PAR", name: selected.name || input.name };
        const resolution = resolveIdentity({ ...effective, userSymbol: selected.symbol }, candidates, meta, viaIsin);
        if (resolution.verified) return { id: input.id, resolution: { ...resolution, provider: "euronext", symbol: q.ticker }, quote: { price: q.price, currency: q.currency, timestamp: q.trade_timestamp, source: { provider: "euronext", symbol: q.ticker, exchange: exchangeLabel("PAR"), fallback: false } }, error: null };
      }
    } catch { /* Missing/failed ETF-only feed must not prevent verified Yahoo quotes. */ }
  }
  let last = "Cotation indisponible";
  for (const listing of [selected, ...fallbackListings(effective).filter(c => c.symbol !== selected.symbol)]) {
    try {
      const meta = await sources.chart(listing.symbol);
      const fallback = listing.symbol !== selected.symbol;
      if (input.isin === STELLANTIS_ISIN && (!/stellantis/i.test(meta.name) || meta.currency !== (listing.exchange === "NYQ" ? "USD" : "EUR"))) throw new Error("Identité ou devise Stellantis incohérente.");
      if (input.isin === GOLD_ETC_ISIN && (!/^ishares\s+physical\s+gold\s+etc$/i.test(meta.name.trim()) || meta.currency !== goldListingCurrency(listing.symbol) || meta.currency !== input.currency)) throw new Error("Identité ou devise de l’ETC incohérente : aucun cours spot ou d’une autre cotation appliqué.");
      const resolution = resolveIdentity({ ...effective, exchange: fallback ? exchangeLabel(normExchange(listing.exchange)) : effective.exchange, userSymbol: manual || fallback ? listing.symbol : null }, input.isin === GOLD_ETC_ISIN ? matching : candidates, meta, viaIsin);
      if (!resolution.verified) { last = resolution.issues.join(" "); continue; }
      if (fallback) {
        resolution.corrections = resolution.corrections.filter(c => c.field !== "exchange" && c.field !== "ticker");
        resolution.verified = { ...resolution.verified, exchange: effective.exchange, ticker: input.ticker };
        resolution.issues = [`Cours de secours : ${exchangeLabel(normExchange(listing.exchange))} (${listing.symbol}). Position conservée sur ${effective.exchange}.`];
      }
      return { id: input.id, resolution, quote: { price: meta.price, currency: meta.currency, timestamp: meta.timestamp, source: { provider: "yahoo", symbol: listing.symbol, exchange: exchangeLabel(normExchange(meta.exchange)), fallback } }, error: null };
    } catch (e) { last = e instanceof Error ? e.message : "Fournisseur indisponible"; }
  }
  return failure(input, last, candidates);
}