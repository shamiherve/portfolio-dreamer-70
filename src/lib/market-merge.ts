import { quoteKind, quoteProblem, toEurRate, type FxSnapshot, type IdentityInput, type MarketResult } from "./market";
import { wealthSchema, type Holding, type MarketInfo, type Wealth } from "./wealth";

const parisDate = (iso: string) => new Date(iso).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
export function blankMarket(h: Holding): MarketInfo {
  return { status: h.kind === "value" ? "none" : "manual", provider: h.kind === "value" ? "none" : "manual", symbol: null, userSymbol: null, priceMode: "auto",
    original: { name: h.name, isin: h.isin, ticker: h.ticker, exchange: h.exchange, currency: h.currency }, verified: null, issues: [], candidates: [], audit: [],
    quote: null, pending: null, fx: null, quoteStatus: h.kind === "value" ? "none" : "none", lastError: null, lastSuccessAt: null, checkedAt: null };
}
export const marketOf = (h: Holding) => h.market ?? blankMarket(h);
export const toInput = (h: Holding): IdentityInput => ({ id: h.id, name: h.name, isin: h.isin, ticker: h.ticker, exchange: h.exchange, currency: h.currency, kind: h.kind, userSymbol: h.market?.userSymbol ?? null });

/** Applies provider results. Only name/ticker/exchange/currency (logged), price, priceDate, fxRate and market fields may change. */
export function applyMarket(w: Wealth, results: MarketResult[], fx: FxSnapshot | null, fxError: string | null, nowIso: string): Wealth {
  const now = new Date(nowIso);
  let anyOk = false; let anyFail = false; let lastError: string | null = null;
  const holdings = w.holdings.map(h => {
    const r = results.find(x => x.id === h.id); if (!r) return h;
    const prev = marketOf(h); let next: Holding = { ...h };
    let m: MarketInfo = { ...prev, checkedAt: nowIso };
    if (r.error) { anyFail = true; lastError = r.error; return { ...h, market: { ...m, quoteStatus: "error" as const, lastError: `${r.error} — dernier cours valide conservé.` } }; }
    const res = r.resolution;
    m = { ...m, status: res.status, provider: res.provider, symbol: res.symbol, verified: res.verified, issues: res.issues, candidates: res.candidates, lastError: null };
    if (h.kind === "value") return { ...h, market: { ...m, quoteStatus: "none" } };
    if (res.status === "corrected") {
      for (const c of res.corrections) {
        m.audit = [...m.audit, { at: nowIso, field: c.field, from: c.from, to: c.to, reason: c.reason }];
        next = { ...next, [c.field]: c.to };
      }
    }
    if (res.status === "manual" || res.status === "none" || !r.quote || !res.verified) return { ...next, market: { ...m, quoteStatus: "none" } };
    const q = r.quote;
    let fxRate = 1; let fxInfo: MarketInfo["fx"] = null;
    if (q.currency !== "EUR") {
      const ecb = fx?.rates[q.currency];
      if (!ecb) { anyFail = true; lastError = fxError ?? `Taux ${q.currency}/EUR indisponible`; return { ...next, market: { ...m, quoteStatus: "error", lastError: `Taux de change ${q.currency} → EUR indisponible : dernier cours conservé.` } }; }
      fxRate = toEurRate(ecb); fxInfo = { rate: fxRate, date: fx!.date, source: "BCE" };
    } else fxInfo = { rate: 1, date: parisDate(nowIso), source: "EUR" };
    const problem = quoteProblem(q, res.verified.currency, { price: h.price, currency: h.currency }, now);
    if (problem?.reject) { anyFail = true; lastError = problem.reject; return { ...next, market: { ...m, quoteStatus: "error", lastError: `${problem.reject} Dernier cours valide conservé.` } }; }
    const stored = { price: q.price, currency: q.currency, timestamp: q.timestamp, retrievedAt: nowIso };
    if (problem?.review && !(prev.pending && prev.pending.price === q.price)) return { ...next, market: { ...m, fx: fxInfo, pending: { ...stored, reason: problem.review }, quoteStatus: "review" } };
    anyOk = true;
    if (m.priceMode === "manual") return { ...next, market: { ...m, quote: stored, fx: fxInfo, pending: null, quoteStatus: "manual", lastSuccessAt: nowIso } };
    const kind = quoteKind(q.timestamp, now);
    return { ...next, price: q.price, priceDate: parisDate(q.timestamp), fxRate, market: { ...m, quote: stored, fx: fxInfo, pending: null, quoteStatus: kind === "stale" ? "stale" : "ok", lastSuccessAt: nowIso } };
  });
  const meta = w.marketMeta ?? { lastSuccess: null, lastFailure: null, lastError: null, lastAttempt: null, fxDate: null };
  return wealthSchema.parse({ ...w, holdings, marketMeta: { lastAttempt: nowIso, lastSuccess: anyOk ? nowIso : meta.lastSuccess, lastFailure: anyFail || fxError ? nowIso : meta.lastFailure, lastError: anyFail || fxError ? (lastError ?? fxError) : meta.lastError, fxDate: fx?.date ?? meta.fxDate } });
}

/** User confirms a large variation: the pending quote becomes the price. */
export function acceptPending(w: Wealth, id: string, nowIso: string): Wealth {
  return wealthSchema.parse({ ...w, holdings: w.holdings.map(h => {
    const m = h.market; if (h.id !== id || !m?.pending) return h;
    const p = m.pending; const quote = { price: p.price, currency: p.currency, timestamp: p.timestamp, retrievedAt: nowIso };
    if (m.priceMode === "manual") return { ...h, market: { ...m, quote, pending: null, quoteStatus: "manual" } };
    return { ...h, price: p.price, priceDate: parisDate(p.timestamp), fxRate: p.currency === "EUR" ? 1 : m.fx?.rate ?? h.fxRate, market: { ...m, quote, pending: null, quoteStatus: quoteKind(p.timestamp, new Date(nowIso)) === "stale" ? "stale" : "ok", lastSuccessAt: nowIso } };
  }) });
}
export function setMarketOption(w: Wealth, id: string, patch: Partial<Pick<MarketInfo, "userSymbol" | "priceMode">>): Wealth {
  return wealthSchema.parse({ ...w, holdings: w.holdings.map(h => h.id === id ? { ...h, market: { ...marketOf(h), ...patch, ...(patch.priceMode === "manual" ? { quoteStatus: "manual" as const } : {}) } } : h) });
}
export const REFRESH_EVERY_MS = 6 * 3600e3;
export const needsRefresh = (w: Wealth, now: number) => w.holdings.some(h => h.kind === "quantity") && (!w.marketMeta?.lastAttempt || now - new Date(w.marketMeta.lastAttempt).getTime() > REFRESH_EVERY_MS);
