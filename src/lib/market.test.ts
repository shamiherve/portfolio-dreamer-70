import { describe, expect, it } from "vitest";
import { parseChart, parseEcbXml, quoteKind, resolveIdentity, toEurRate, type IdentityInput, type MarketResult } from "./market";
import { acceptPending, applyMarket, setMarketOption } from "./market-merge";
import { analyse, holdingValue, initialWealth, type Holding, type Wealth } from "./wealth";
import { initialPortfolio } from "./portfolio";

const NOW = "2026-11-13T21:30:00.000Z";
const chart = (o: Record<string, unknown>) => ({ chart: { result: [{ meta: { symbol: "X", regularMarketPrice: 100, currency: "EUR", regularMarketTime: Date.parse("2026-11-13T16:30:00Z") / 1000, exchangeName: "PAR", longName: "X SA", ...o } }] } });
const input = (o: Partial<IdentityInput> = {}): IdentityInput => ({ id: "s", name: "TotalEnergies", isin: "FR0000120271", ticker: "TTE", exchange: "Euronext Paris", currency: "EUR", kind: "quantity", userSymbol: null, ...o });
const stock = (o: Partial<Holding> = {}): Holding => ({ id: "s", name: "Apple", isin: "US0378331005", ticker: "AAPL", exchange: "NASDAQ", accountId: "cto", classId: "stocks", kind: "quantity", currency: "USD", quantity: 1.234567, price: 300, fxRate: 0.9, fractional: true, value: 0, priceDate: "2026-11-12", ...o });
const wealthWith = (...hs: Holding[]): Wealth => ({ ...initialWealth(), holdings: [...initialWealth().holdings, ...hs] });
const fx = { date: "2026-11-13", rates: { USD: 1.1052, GBP: 0.83559, CHF: 0.93 } };
const res = (id: string, inp: IdentityInput, sym: string, exch: string, price: number, currency: string): MarketResult => {
  const meta = parseChart(chart({ symbol: sym, regularMarketPrice: price, currency, exchangeName: exch, longName: inp.name }));
  const r = resolveIdentity(inp, [{ symbol: sym, exchange: exch, name: inp.name }], meta, true);
  return { id, resolution: r, quote: r.symbol ? { price: meta.price, currency: meta.currency, timestamp: meta.timestamp } : null, error: null };
};

describe("Identification des instruments", () => {
  it("Euronext Paris share resolves via ISIN", () => {
    const r = resolveIdentity(input(), [{ symbol: "TTE.PA", exchange: "PAR", name: "TotalEnergies SE" }], parseChart(chart({ longName: "TotalEnergies" })), true);
    expect(r.status).toBe("verified"); expect(r.symbol).toBe("TTE.PA");
  });
  it("NYSE and NASDAQ listings resolve to their own exchange", () => {
    const ko = resolveIdentity(input({ name: "Coca-Cola", isin: "US1912161007", ticker: "KO", exchange: "NYSE", currency: "USD" }), [{ symbol: "KO", exchange: "NYQ", name: "Coca-Cola" }], parseChart(chart({ currency: "USD", exchangeName: "NYQ", longName: "Coca-Cola" })), true);
    const ms = resolveIdentity(input({ name: "Microsoft", isin: "US5949181045", ticker: "MSFT", exchange: "NASDAQ", currency: "USD" }), [{ symbol: "MSFT", exchange: "NMS", name: "Microsoft" }], parseChart(chart({ currency: "USD", exchangeName: "NMS", longName: "Microsoft" })), true);
    expect([ko.verified?.exchange, ms.verified?.exchange]).toEqual(["NYSE", "NASDAQ"]);
  });
  it("ambiguous listings are flagged, never guessed", () => {
    const r = resolveIdentity(input({ exchange: "" }), [{ symbol: "TTE.PA", exchange: "PAR", name: "" }, { symbol: "TOTB.DE", exchange: "GER", name: "" }], null, true);
    expect(r.status).toBe("manual"); expect(r.symbol).toBeNull();
  });
  it("a single listing in another currency than the holding is not applied (gold ETC on London in USD vs EUR)", () => {
    const r = resolveIdentity(input({ name: "iShares Physical Gold ETC", isin: "IE00B4ND3602", ticker: "SGLN", exchange: "" }), [{ symbol: "IGLN.L", exchange: "LSE", name: "" }], parseChart(chart({ currency: "USD", exchangeName: "LSE" })), true);
    expect(r.status).toBe("manual");
  });
  it("missing ISIN with ticker match is never auto-associated", () => {
    expect(resolveIdentity(input({ isin: "" }), [{ symbol: "TTE.PA", exchange: "PAR", name: "" }], null, false).status).toBe("manual");
  });
  it("certain ISIN listing corrects wrong ticker/exchange metadata with audit, keeps ISIN", () => {
    const w = wealthWith(stock({ ticker: "APPL", exchange: "Nasdaq" }));
    const inp = { ...input({ name: "Apple", isin: "US0378331005", ticker: "APPL", exchange: "NASDAQ", currency: "USD" }), id: "s" };
    const next = applyMarket(w, [res("s", inp, "AAPL", "NMS", 310, "USD")], fx, null, NOW);
    const h = next.holdings.find(x => x.id === "s")!;
    expect(h.ticker).toBe("AAPL"); expect(h.isin).toBe("US0378331005");
    expect(h.market?.audit.some(a => a.field === "ticker" && a.from === "APPL" && a.to === "AAPL")).toBe(true);
  });
});

describe("Cours et taux de change", () => {
  it("ECB EUR/USD 1.1052 converts USD to EUR as 1/1.1052 (not the inverse)", () => {
    expect(parseEcbXml("<Cube time='2026-11-13'><Cube currency='USD' rate='1.1052'/></Cube>").rates["USD"]).toBe(1.1052);
    expect(toEurRate(1.1052)).toBeCloseTo(0.904814, 6);
  });
  it("USD stock value = quantity × price × fx; fractional quantity preserved", () => {
    const w = wealthWith(stock());
    const inp = input({ name: "Apple", isin: "US0378331005", ticker: "AAPL", exchange: "NASDAQ", currency: "USD" });
    const h = applyMarket(w, [res("s", inp, "AAPL", "NMS", 310, "USD")], fx, null, NOW).holdings.find(x => x.id === "s")!;
    expect(h.quantity).toBe(1.234567); expect(h.price).toBe(310);
    expect(holdingValue(h)).toBeCloseTo(1.234567 * 310 / 1.1052, 6);
  });
  it("GBp quotes are converted to GBP", () => { expect(parseChart(chart({ currency: "GBp", regularMarketPrice: 5000 }))).toMatchObject({ price: 50, currency: "GBP" }); });
  it("invalid or missing quotes are rejected, never zero", () => {
    expect(() => parseChart(chart({ regularMarketPrice: 0 }))).toThrow();
    expect(() => parseChart({ chart: { result: [] } })).toThrow();
  });
  it("provider failure / rate limit keeps last valid price", () => {
    const w = wealthWith(stock());
    const h = applyMarket(w, [{ id: "s", resolution: { status: "none", provider: "none", symbol: null, verified: null, corrections: [], issues: [], candidates: [] }, quote: null, error: "Limite de requêtes atteinte chez le fournisseur" }], fx, null, NOW).holdings.find(x => x.id === "s")!;
    expect(h.price).toBe(300); expect(h.market?.quoteStatus).toBe("error");
  });
  it("missing FX rate keeps previous price", () => {
    const inp = input({ name: "Apple", isin: "US0378331005", ticker: "AAPL", exchange: "NASDAQ", currency: "USD" });
    const h = applyMarket(wealthWith(stock()), [res("s", inp, "AAPL", "NMS", 310, "USD")], null, "BCE indisponible", NOW).holdings.find(x => x.id === "s")!;
    expect(h.price).toBe(300);
  });
  it("large variation (>20 %) waits for confirmation", () => {
    const inp = input({ name: "Apple", isin: "US0378331005", ticker: "AAPL", exchange: "NASDAQ", currency: "USD" });
    const w = applyMarket(wealthWith(stock()), [res("s", inp, "AAPL", "NMS", 600, "USD")], fx, null, NOW);
    expect(w.holdings.find(x => x.id === "s")!.price).toBe(300);
    expect(acceptPending(w, "s", NOW).holdings.find(x => x.id === "s")!.price).toBe(600);
  });
  it("stale quote older than 4 days is flagged", () => { expect(quoteKind("2026-11-05T16:00:00Z", new Date(NOW))).toBe("stale"); });
  it("manual price mode is never overwritten", () => {
    const inp = input({ name: "Apple", isin: "US0378331005", ticker: "AAPL", exchange: "NASDAQ", currency: "USD" });
    const w = setMarketOption(wealthWith(stock()), "s", { priceMode: "manual" });
    const h = applyMarket(w, [res("s", inp, "AAPL", "NMS", 310, "USD")], fx, null, NOW).holdings.find(x => x.id === "s")!;
    expect(h.price).toBe(300); expect(h.market?.quote?.price).toBe(310);
  });
  it("fonds euro keeps manual valuation; ETF portfolio and all holdings preserved; totals consistent", () => {
    const pf = initialPortfolio(); pf.positions = pf.positions.map(p => ({ ...p, quantity: 3, price: 40, priceDate: "2026-11-13" }));
    const w0 = wealthWith(stock()); w0.holdings = w0.holdings.map(h => h.id === "fonds-euro" ? { ...h, value: 1000, priceDate: "2026-11-01" } : h);
    const inp = input({ name: "Apple", isin: "US0378331005", ticker: "AAPL", exchange: "NASDAQ", currency: "USD" });
    const fe = { id: "fonds-euro", resolution: resolveIdentity({ ...inp, id: "fonds-euro", kind: "value" }, [], null, false), quote: null, error: null };
    const w = applyMarket(w0, [res("s", inp, "AAPL", "NMS", 310, "USD"), fe], fx, null, NOW);
    expect(w.holdings.map(h => [h.id, h.quantity, h.accountId, h.classId])).toEqual(w0.holdings.map(h => [h.id, h.quantity, h.accountId, h.classId]));
    expect(w.holdings.find(h => h.id === "fonds-euro")!.value).toBe(1000);
    const a = analyse(pf, w);
    expect(a.total).toBeCloseTo(a.lines.reduce((s, l) => s + l.value, 0), 8);
    expect(a.classRows.reduce((s, r) => s + r.value, 0)).toBeCloseTo(a.total, 8);
    expect(pf.positions.every(p => p.quantity === 3)).toBe(true);
  });
});
