import { describe, expect, it, vi } from "vitest";
import { holdingExchange, tickerSymbol } from "./instrument-mapping";
import { resolveMarketItem } from "./market-service";
import { applyMarket } from "./market-merge";
import { initialWealth, type Holding } from "./wealth";
import type { ChartMeta, IdentityInput } from "./market";

const input: IdentityInput = { id: "existing-stellantis", name: "Stellantis N.V.", isin: "NL00150001Q9", ticker: "STLAP", exchange: "Euronext Paris", currency: "EUR", kind: "quantity", userSymbol: null };
const meta: ChartMeta = { symbol: "STLAP.PA", name: "Stellantis N.V.", currency: "EUR", exchange: "PAR", price: 3.513, timestamp: "2026-11-13T16:39:14.000Z" };
const sources = () => ({ search: vi.fn(async () => [{ symbol: "STLAM.MI", name: "Stellantis N.V.", exchange: "MIL" }]), chart: vi.fn(async () => meta), feed: vi.fn(async () => []) });
const holding: Holding = { id: input.id, name: input.name, isin: input.isin, ticker: input.ticker, exchange: input.exchange, currency: input.currency, kind: input.kind, accountId: "pea", classId: "stocks", quantity: 37, price: 3.5, fxRate: 1, fractional: false, value: 0, priceDate: "2026-11-12" };

describe("Security, listing and provider mapping", () => {
  it("uses STLAP.PA even when ISIN search omits Paris; never charts the raw ISIN", async () => {
    const s = sources(); const r = await resolveMarketItem(input, s);
    expect(s.chart.mock.calls).toEqual([["STLAP.PA"]]);
    expect(r.quote).toMatchObject({ price: 3.513, currency: "EUR", source: { symbol: "STLAP.PA", exchange: "Euronext Paris", fallback: false } });
    expect(r.resolution.verified?.isin).toBe("NL00150001Q9");
  });
  it("ignores a raw ISIN mistakenly saved as provider symbol", async () => {
    const s = sources(); await resolveMarketItem({ ...input, userSymbol: input.isin }, s);
    expect(s.chart.mock.calls).toEqual([["STLAP.PA"]]);
  });
  it("infers listing only from the known exchange ticker, not an ambiguous workaround", () => {
    expect(holdingExchange({ ...input, exchange: "" })).toBe("PAR");
    expect(holdingExchange({ ...input, exchange: "", ticker: "", userSymbol: "STLA.SG" })).toBeNull();
    expect(tickerSymbol({ ...input, isin: "FR0000120271", ticker: "TTE" })).toBe("TTE.PA");
    expect(tickerSymbol({ ...input, ticker: input.isin })).toBeNull();
  });
  it("does not guess a Stellantis listing without holding exchange or listing ticker", async () => {
    const s = sources(); const r = await resolveMarketItem({ ...input, exchange: "", ticker: "" }, s);
    expect(s.chart).not.toHaveBeenCalled(); expect(r.quote).toBeNull();
  });
  it("replaces the broken Stuttgart workaround only for a confirmed Paris holding", async () => {
    const s = sources(); const r = await resolveMarketItem({ ...input, userSymbol: "STLA.SG" }, s);
    expect(r.quote?.source?.symbol).toBe("STLAP.PA");
  });
  it("prefers a supported ISIN-matched Paris Euronext quote", async () => {
    const s = sources(); const r = await resolveMarketItem(input, { ...s, feed: async () => [{ isin: input.isin, ticker: "STLAP", price: 3.51, currency: "EUR", trade_timestamp: meta.timestamp, update_timestamp: "2026-11-13T17:17:18.115Z" }] });
    expect(r.quote?.source?.provider).toBe("euronext"); expect(s.chart).not.toHaveBeenCalled();
  });
  it("records Milan fallback without changing the Paris holding, quantity, ISIN or targets", async () => {
    const s = sources(); const r = await resolveMarketItem(input, { ...s, chart: async symbol => { if (symbol === "STLAP.PA") throw new Error("404"); return { ...meta, symbol: "STLAM.MI", exchange: "MIL", price: 3.518 }; } });
    const w = { ...initialWealth(), holdings: [holding] }; const next = applyMarket(w, [r], null, null, "2026-11-13T22:33:00.000Z");
    expect(next.holdings).toHaveLength(1);
    expect(next.holdings[0]).toMatchObject({ id: holding.id, isin: "NL00150001Q9", quantity: 37, ticker: "STLAP", exchange: "Euronext Paris", accountId: "pea", classId: "stocks", price: 3.518 });
    expect(next.holdings[0]?.market?.quote?.source).toMatchObject({ exchange: "Euronext Milan", symbol: "STLAM.MI", fallback: true });
    expect(next.accounts).toEqual(w.accounts); expect(next.classes).toEqual(w.classes); expect(next.mapping).toEqual(w.mapping);
  });
  it("rejects unverified Stuttgart and wrong currency/identity without overwriting price", async () => {
    const s = sources(); expect((await resolveMarketItem({ ...input, exchange: "Stuttgart", userSymbol: "STLA.SG" }, s)).quote).toBeNull();
    for (const bad of [{ ...meta, currency: "USD" }, { ...meta, name: "Unrelated company" }, { ...meta, symbol: "OTHER.PA" }, { ...meta, exchange: "NYQ" }]) {
      const r = await resolveMarketItem(input, { ...s, chart: async () => bad });
      expect(r.quote).toBeNull();
      expect(applyMarket({ ...initialWealth(), holdings: [holding] }, [r], null, null, "2026-11-13T22:33:00.000Z").holdings[0]?.price).toBe(3.5);
    }
  });
  it("keeps the last valid price and exact holding when every chart fails", async () => {
    const r = await resolveMarketItem(input, { ...sources(), chart: async () => { throw new Error("Provider down"); } });
    const h = applyMarket({ ...initialWealth(), holdings: [holding] }, [r], null, null, "2026-11-13T22:33:00.000Z").holdings[0];
    expect(h).toMatchObject(holding); expect(h?.market?.lastError).toContain("Provider down");
  });
  it("a repeated large move still requires explicit acceptance", async () => {
    const r = await resolveMarketItem(input, { ...sources(), chart: async () => ({ ...meta, price: 10 }) });
    const w = applyMarket({ ...initialWealth(), holdings: [holding] }, [r], null, null, "2026-11-13T22:33:00.000Z");
    expect(applyMarket(w, [r], null, null, "2026-11-13T22:34:00.000Z").holdings[0]?.price).toBe(3.5);
  });
});