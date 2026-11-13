import { describe, expect, it } from "vitest";
import { initialPortfolio } from "./portfolio";
import { analyse, bestAccount, holdingError, initialWealth, recommendations, simulateContribution, targetIssues, unifiedLines, type Holding } from "./wealth";

const pf = () => { const p = initialPortfolio(); p.positions = p.positions.map(x => ({ ...x, quantity: 10, price: 50, priceDate: "2026-11-13" })); return p; }; // 2000 € ETF
const w = () => { const x = initialWealth(); x.holdings = x.holdings.map(h => h.id === "fonds-euro" ? { ...h, value: 1000, priceDate: "2026-11-01" } : { ...h, quantity: 10, price: 50, priceDate: "2026-11-13" }); return x; }; // AV 1000, gold 500
describe("Dashboard patrimonial", () => {
  it("initial targets are consistent: 75/15/10 accounts and 70/15/10/5 classes", () => {
    const x = initialWealth();
    expect(x.accounts.map(a => a.target)).toEqual([75, 15, 10]);
    expect(x.classes.map(c => c.target)).toEqual([70, 15, 10, 5]);
    expect(targetIssues(x)).toEqual([]);
  });
  it("equity parent is 85 % and never added to the total", () => {
    const a = analyse(pf(), w());
    expect(a.parents[0]?.target).toBe(85);
    expect(a.classRows.reduce((s, r) => s + r.target, 0)).toBe(100);
  });
  it("counts each position once and reconciles totals across views", () => {
    const a = analyse(pf(), w());
    expect(unifiedLines(pf(), w())).toHaveLength(6);
    expect(a.total).toBe(3500);
    expect(a.classRows.reduce((s, r) => s + r.value, 0)).toBe(3500);
    expect(a.accountRows.reduce((s, r) => s + r.value, 0)).toBe(3500);
    expect(a.accountRows.find(r => r.id === "pea")?.value).toBe(2000);
  });
  it("uses the deviation formulas", () => {
    const r = analyse(pf(), w()).classRows.find(r => r.id === "etf")!;
    expect(r.targetValue).toBeCloseTo(2450); expect(r.diffEur).toBeCloseTo(-450); expect(r.diffPp).toBeCloseTo(2000 / 3500 * 100 - 70);
  });
  it("flags inconsistent targets", () => {
    const x = initialWealth(); x.accounts[0]!.target = 80;
    expect(targetIssues(x).length).toBeGreaterThan(0);
  });
  it("enforces whole shares in PEA and ≤ 6 decimals in CTO", () => {
    const x = initialWealth();
    const base: Holding = { ...x.holdings[0]!, classId: "stocks", price: 10, priceDate: "2026-11-13" };
    expect(holdingError({ ...base, accountId: "pea", quantity: 1.5, fractional: true }, x)).toMatch(/entières/);
    expect(holdingError({ ...base, accountId: "cto", quantity: 1.123456, fractional: true }, x)).toBeNull();
    expect(holdingError({ ...base, accountId: "cto", quantity: 1.1234567, fractional: true }, x)).toMatch(/6 décimales/);
    expect(holdingError({ ...base, accountId: "cto", quantity: 1.5, fractional: false }, x)).toMatch(/entières/);
  });
  it("converts foreign currencies with the exchange rate", () => {
    const x = initialWealth(); x.holdings = [{ ...x.holdings[0]!, classId: "stocks", currency: "USD", quantity: 2, price: 100, fxRate: 0.9, priceDate: "2026-11-13" }];
    expect(analyse(initialPortfolio(), x).total).toBeCloseTo(180);
  });
  it("never recommends selling", () => {
    const text = recommendations(analyse(pf(), w())).join(" ").toLowerCase();
    expect(text).not.toMatch(/vend|réduire|liquid/);
  });
  it("simulated contribution only adds money, within the chosen account", () => {
    const s = simulateContribution(pf(), w(), 1000, "cto");
    expect(s.split.every(x => x.value >= 0)).toBe(true);
    expect(s.split.reduce((t, x) => t + x.value, 0)).toBeCloseTo(1000);
    expect(s.split.map(x => x.classId).sort()).toEqual(["gold", "stocks"]);
    expect(s.after.total).toBeCloseTo(4500);
    expect(bestAccount(pf(), w(), 1000)).not.toBeNull();
  });
  it("empty portfolio does not crash", () => {
    const a = analyse(initialPortfolio(), initialWealth());
    expect(a.total).toBe(0); expect(a.score).toBeNull();
  });
});
