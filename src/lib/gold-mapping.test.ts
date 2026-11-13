import { describe, expect, it, vi } from "vitest";
import { GOLD_ETC_ISIN, holdingExchange } from "./instrument-mapping";
import { resolveMarketItem } from "./market-service";
import { acceptPending, applyMarket, setMarketOption } from "./market-merge";
import { initialWealth } from "./wealth";
import type { ChartMeta, IdentityInput } from "./market";

const now = "2026-11-13T22:45:00.000Z";
const input: IdentityInput = { id: "gold-ishares", name: "iShares Physical Gold ETC", isin: "IE00B4ND3602", ticker: "SGLN", exchange: "", currency: "EUR", kind: "quantity", userSymbol: null };
const meta: ChartMeta = { symbol: "PPFB.DE", name: "iShares Physical Gold ETC", exchange: "GER", currency: "EUR", price: 68.275, timestamp: "2026-11-13T16:35:47.000Z" };
const sources = () => ({ search: vi.fn(async () => [{ symbol: "IGLN.L", exchange: "LSE", name: input.name }]), chart: vi.fn(async () => meta), feed: vi.fn(async () => []) });
const wealth = () => { const w = initialWealth(); return { ...w, holdings: w.holdings.map(h => h.id === input.id ? { ...h, quantity: 2.345678, price: 68, priceDate: "2026-11-12" } : h) }; };

describe("iShares Physical Gold ETC canonical identity and listing", () => {
  it("does not infer the Trade Republic venue from the initial SGLN ticker or USD reference currency", async () => {
    const s = sources(); const r = await resolveMarketItem(input, s);
    expect(holdingExchange(input)).toBeNull(); expect(r.resolution.status).toBe("manual"); expect(r.quote).toBeNull(); expect(s.chart).not.toHaveBeenCalled();
    const w = wealth(); const next = applyMarket(w, [r], null, null, now);
    expect(next.holdings[0]).toMatchObject({ id: "gold-ishares", isin: GOLD_ETC_ISIN, quantity: 2.345678, price: 68, accountId: "cto", exchange: "" });
    expect(next.holdings[0]?.market?.issues.join(" ")).toContain("Place Trade Republic non déterminée");
  });
  it.each([
    ["Euronext Paris", "SLGN", "SLGN.PA", "PAR", "EUR", 68.21],
    ["XETRA", "PPFB", "PPFB.DE", "GER", "EUR", 68.275],
    ["Stuttgart", "PPFB", "PPFB.SG", "STU", "EUR", 68.15],
    ["Bourse de Londres", "IGLN", "IGLN.L", "LSE", "USD", 75.3475],
    ["Bourse de Londres", "EGLN", "EGLN.L", "LSE", "EUR", 68.22],
    ["Borsa Italiana", "SGLN", "SGLN.MI", "MIL", "EUR", 68.22],
  ])("resolves the saved %s listing in its actual currency", async (exchange, ticker, symbol, code, currency, price) => {
    const s = sources(); const chart = vi.fn(async () => ({ ...meta, symbol, exchange: code, currency, price }));
    const r = await resolveMarketItem({ ...input, exchange, ticker, currency }, { ...s, chart });
    expect(chart.mock.calls).toEqual([[symbol]]); expect(r.quote).toMatchObject({ price, currency, source: { symbol, fallback: false } });
    expect(r.resolution.verified?.isin).toBe("IE00B4ND3602");
  });
  it("uses a manually confirmed PPFB.DE separately from ISIN and preserves the account and quantity", async () => {
    const r = await resolveMarketItem({ ...input, userSymbol: "PPFB.DE" }, sources()); const w = wealth(); const next = applyMarket(w, [r], null, null, now);
    expect(next.holdings).toHaveLength(w.holdings.length);
    expect(next.holdings[0]).toMatchObject({ id: input.id, isin: input.isin, quantity: 2.345678, accountId: "cto", price: 68.275, market: { symbol: "PPFB.DE" } });
    expect(next.accounts).toEqual(w.accounts); expect(next.mapping).toEqual(w.mapping); expect(next.holdings[1]).toEqual(w.holdings[1]);
  });
  it("prefers a supported Paris ETC quote in the public Euronext feed", async () => {
    const s = sources(); const r = await resolveMarketItem({ ...input, exchange: "Euronext Paris", ticker: "SLGN" }, { ...s, feed: async () => [{ isin: input.isin, ticker: "SLGN", currency: "EUR", price: 68.21, trade_timestamp: meta.timestamp, update_timestamp: now }] });
    expect(s.chart).not.toHaveBeenCalled(); expect(r.quote?.source?.provider).toBe("euronext");
  });
  it("never uses spot gold or unverified symbols", async () => {
    for (const userSymbol of ["GC=F", "XAUUSD=X", "SGLN.L", "OTHER.DE"]) {
      const s = sources(); const r = await resolveMarketItem({ ...input, userSymbol }, s);
      expect(s.chart).not.toHaveBeenCalled(); expect(r.quote).toBeNull();
    }
  });
  it("rejects wrong identity, exchange, symbol and currency, keeping the last valid price", async () => {
    for (const patch of [{ name: "Gold Futures" }, { exchange: "STU" }, { symbol: "OTHER.DE" }, { currency: "USD" }]) {
      const r = await resolveMarketItem({ ...input, exchange: "XETRA", ticker: "PPFB" }, { ...sources(), chart: async () => ({ ...meta, ...patch }) });
      expect(r.quote).toBeNull(); expect(applyMarket(wealth(), [r], null, null, now).holdings[0]?.price).toBe(68);
    }
  });
  it("does not switch a failed Xetra listing to another venue", async () => {
    const chart = vi.fn(async () => { throw new Error("404"); }); const r = await resolveMarketItem({ ...input, exchange: "XETRA", ticker: "PPFB" }, { ...sources(), chart });
    expect(chart.mock.calls).toEqual([["PPFB.DE"]]); expect(r.quote).toBeNull(); expect(applyMarket(wealth(), [r], null, null, now).holdings[0]?.price).toBe(68);
  });
  it("retains manual prices and requires acceptance of implausible large price changes", async () => {
    const r = await resolveMarketItem({ ...input, exchange: "XETRA", ticker: "PPFB" }, sources());
    expect(applyMarket(setMarketOption(wealth(), input.id, { priceMode: "manual" }), [r], null, null, now).holdings[0]?.price).toBe(68);
    const large = { ...r, quote: r.quote ? { ...r.quote, price: 6800 } : null }; const w = applyMarket(wealth(), [large], null, null, now);
    expect(w.holdings[0]?.price).toBe(68); expect(w.holdings[0]?.market?.quoteStatus).toBe("review");
    expect(acceptPending(w, input.id, now).holdings[0]?.quantity).toBe(2.345678);
  });
});