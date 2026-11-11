import { describe, expect, it } from "vitest";
import { initialPortfolio, exportBackup, parseBackup, asCategories, purchaseProposal } from "./portfolio";
import { mergeQuotes, validateQuotes, type EuronextQuote } from "./euronext-quotes";
import { computeRebalance } from "./rebalance";

const now = new Date("2026-11-11T00:02:00Z");
const prices = [34.1197, 21.74, 38.285, 33.73];
const quotes: EuronextQuote[] = initialPortfolio().positions.map((p, i) => ({ isin: p.isin, ticker: ["ESE", "ETZ", "PTPXE", "PAEEM"][i] ?? "", price: prices[i] ?? 1, currency: "EUR", trade_timestamp: "2026-11-10T16:35:16Z", update_timestamp: "2026-11-10T22:26:54Z" }));
const portfolio = () => ({ ...initialPortfolio(), budget: 200, positions: initialPortfolio().positions.map(p => ({ ...p, quantity: 10, target: 25 })) });
describe("Public Euronext quote integration", () => {
  it("matches all four existing ISINs and only changes quote fields", () => {
    const p = portfolio(); const merged = mergeQuotes(p, validateQuotes(quotes, now).quotes, now.toISOString());
    expect(merged.matched).toEqual(["FR0011550185", "FR0011550193", "FR0013411980", "FR0013412020"]);
    expect(merged.portfolio.positions.map(p => p.price)).toEqual(prices);
    expect(merged.portfolio.positions.map(p => p.quantity)).toEqual([10, 10, 10, 10]);
    expect(merged.portfolio.positions.map(p => p.target)).toEqual([25, 25, 25, 25]);
    expect(merged.portfolio.budget).toBe(200); expect(merged.portfolio.transactions).toEqual(p.transactions); expect(merged.portfolio.targets).toEqual(p.targets); expect(merged.portfolio.updatedAt).toBe(p.updatedAt);
  });
  it("rejects non-EUR records without replacing valid local prices", () => {
    const p = portfolio(); p.positions = p.positions.map((pos, i) => i === 0 ? { ...pos, price: 30, priceDate: "2026-11-09" } : pos);
    const checked = validateQuotes([{ ...quotes[0], currency: "USD" }, ...quotes.slice(1)], now);
    expect(checked.rejected).toEqual(["FR0011550185"]);
    expect(mergeQuotes(p, checked.quotes, now.toISOString()).portfolio.positions[0]?.price).toBe(30);
  });
  it("rejects zero, negative, nonfinite prices, invalid/future timestamps and duplicate ISINs", () => {
    for (const price of [0, -1, Infinity, NaN]) expect(validateQuotes([{ ...quotes[0], price }], now).quotes).toHaveLength(0);
    expect(validateQuotes([{ ...quotes[0], trade_timestamp: "bad" }], now).quotes).toHaveLength(0);
    expect(validateQuotes([{ ...quotes[0], update_timestamp: "2027-01-01T00:00:00Z" }], now).quotes).toHaveLength(0);
    expect(validateQuotes([{ ...quotes[0], trade_timestamp: "2026-11-10T23:00:00Z" }], now).quotes).toHaveLength(0);
    expect(validateQuotes([quotes[0], quotes[0]], now).quotes).toHaveLength(0);
    expect(() => validateQuotes({}, now)).toThrow();
  });
  it("preserves all prices and timestamps when no usable quote is returned", () => {
    const p = mergeQuotes(portfolio(), quotes, now.toISOString()).portfolio;
    expect(mergeQuotes(p, [], "2026-11-11T00:03:00Z").portfolio).toBe(p);
  });
  it("does not roll back newer manual dates or previously received trades", () => {
    const p = mergeQuotes(portfolio(), quotes, now.toISOString()).portfolio;
    p.positions = p.positions.map((pos, i) => i === 0 ? { ...pos, price: 40, priceDate: "2026-11-11", priceSource: "manual" } : pos);
    expect(mergeQuotes(p, quotes, now.toISOString()).portfolio.positions[0]?.price).toBe(40);
    expect(mergeQuotes(p, quotes.map(q => ({ ...q, trade_timestamp: "2026-11-09T16:00:00Z" })), now.toISOString()).portfolio).toBe(p);
  });
  it("keeps a same-day manual override until a newer trade is available", () => {
    const p = mergeQuotes(portfolio(), quotes, now.toISOString()).portfolio;
    p.positions = p.positions.map((pos, i) => i === 0 ? { ...pos, price: 40, priceSource: "manual", quoteUpdatedAt: null } : pos);
    expect(mergeQuotes(p, quotes, now.toISOString()).portfolio.positions[0]?.price).toBe(40);
    const next = quotes.map(q => ({ ...q, trade_timestamp: "2026-11-10T17:00:00Z" }));
    expect(mergeQuotes(p, next, now.toISOString()).portfolio.positions[0]?.price).toBe(34.1197);
  });
  it("separates publication and check timestamps and deduplicates history in backups", () => {
    const p = mergeQuotes(portfolio(), quotes, now.toISOString()).portfolio;
    const again = mergeQuotes(p, quotes, "2026-11-11T00:03:00Z").portfolio;
    expect(again.feedUpdatedAt).toBe("2026-11-10T22:26:54Z"); expect(again.quotesCheckedAt).toBe("2026-11-11T00:03:00Z");
    expect(again.quoteHistory).toHaveLength(4); expect(parseBackup(exportBackup(again, [])).portfolio).toEqual(again);
    expect(parseBackup(exportBackup(initialPortfolio(), [])).portfolio.positions).toHaveLength(4);
  });
  it("recalculates values and actual weights and keeps purchases whole, buy-only and under budget", () => {
    const p = mergeQuotes(portfolio(), quotes, now.toISOString()).portfolio;
    const r = computeRebalance(asCategories(p.positions), p.budget);
    expect(r.total).toBeCloseTo(1278.747); expect(r.lines[0]?.value).toBeCloseTo(341.197);
    expect(r.lines[0]?.currentWeight).toBeCloseTo(341.197 / 1278.747 * 100);
    const proposal = purchaseProposal(p.positions, 200);
    expect(proposal.spent).toBeLessThanOrEqual(200); expect(proposal.lines.every(l => Number.isInteger(l.shares) && (l.shares ?? -1) >= 0)).toBe(true);
    expect(proposal.spent + proposal.cash).toBeCloseTo(200);
  });
});