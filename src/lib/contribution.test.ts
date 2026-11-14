import { describe, expect, it } from "vitest";
import { initialPortfolio, type Portfolio } from "./portfolio";
import { bestAccount, initialWealth, simulateContribution, type Wealth } from "./wealth";
import { allocationCells, minimalToTargets, optimizeAllAccounts } from "./contribution";

// 4 ETF × 10 parts × 50 € = 2 000 € (PEA) ; AV 1 000 € ; or 500 € (CTO) → total 3 500 €.
const pf = (): Portfolio => { const p = initialPortfolio(); p.positions = p.positions.map(x => ({ ...x, quantity: 10, price: 50, priceDate: "2026-11-13", target: 25 })); return p; };
const w = (): Wealth => { const x = initialWealth(); x.holdings = x.holdings.map(h => h.id === "fonds-euro" ? { ...h, value: 1000, priceDate: "2026-11-01" } : { ...h, quantity: 10, price: 50, priceDate: "2026-11-13" }); return x; };

describe("Simulateur d’apport — optimisation globale", () => {
  it("joint cells cover 100 % of targets and count each position exactly once", () => {
    const { cells, unmapped } = allocationCells(pf(), w());
    expect(cells.reduce((s, c) => s + c.target, 0)).toBeCloseTo(100);
    expect(cells.reduce((s, c) => s + c.value, 0)).toBeCloseTo(3500);
    expect(unmapped).toEqual([]);
  });
  it("all-accounts split totals exactly the amount and is buy-only", () => {
    const r = optimizeAllAccounts(pf(), w(), 1000);
    expect(r.split.reduce((s, x) => s + x.value, 0)).toBeCloseTo(1000);
    expect(r.split.every(x => x.value >= 0)).toBe(true);
    expect(r.after.total).toBeCloseTo(4500);
    expect(r.unallocated).toBe(0);
  });
  it("only mapped account × class combinations receive money", () => {
    const x = w();
    const r = optimizeAllAccounts(pf(), x, 1000);
    for (const s of r.split.filter(s => s.value > 1e-9)) {
      expect(x.mapping.some(m => m.accountId === s.accountId && m.classId === s.classId && m.target > 0)).toBe(true);
    }
  });
  it("global optimisation is at least as good as the best single account", () => {
    const p = pf(); const x = w();
    const best = bestAccount(p, x, 1000)!;
    const single = simulateContribution(p, x, 1000, best.id).after.score!;
    expect(optimizeAllAccounts(p, x, 1000).after.score!).toBeGreaterThanOrEqual(single - 1e-9);
  });
  it("an insufficient budget still improves the score without reaching the targets", () => {
    const r = optimizeAllAccounts(pf(), w(), 500);
    expect(r.after.score!).toBeGreaterThan(r.before.score!);
    expect(r.after.total).toBeCloseTo(4000);
    expect(r.after.classRows.some(x => x.status === "under")).toBe(true);
  });
  it("holdings outside mapped cells are reported, never silently reallocated", () => {
    const x = w();
    x.holdings.push({ ...x.holdings[0]!, id: "hors-cible", name: "Position hors cible", accountId: "cto", classId: "bonds", value: 0, quantity: 2, price: 50, priceDate: "2026-11-13" });
    const { unmapped } = allocationCells(pf(), x);
    expect(unmapped).toEqual([{ name: "Position hors cible", value: 100 }]);
    expect(optimizeAllAccounts(pf(), x, 1000).unmapped).toHaveLength(1);
  });
});

describe("Simulateur d’apport — atteindre les cibles", () => {
  it("theoretical minimum is an exact optimisation, not a proportional estimate", () => {
    // requiredTotal = max(2000/.70, 0/.05, 0/.10, 500/.05, 1000/.10) = 10 000 → 6 500 € à injecter.
    const r = minimalToTargets(pf(), w());
    expect(r.possible).toBe(true);
    if (!r.possible) return;
    expect(r.theoretical).toBeCloseTo(6500);
    expect(r.after.total).toBeCloseTo(10000);
    for (const row of r.after.classRows) expect(Math.abs(row.diffPp)).toBeLessThan(0.01);
    for (const row of r.after.accountRows) expect(Math.abs(row.diffPp)).toBeLessThan(0.01);
  });
  it("an overweight class is diluted by the contributions, never sold", () => {
    const r = minimalToTargets(pf(), w());
    if (!r.possible) throw new Error("expected possible");
    expect(r.before.classRows.find(x => x.id === "gold")!.status).toBe("over");
    expect(r.split.find(s => s.classId === "gold")!.value).toBe(0);
    expect(r.split.every(s => s.value >= 0)).toBe(true);
  });
  it("investable minimum uses whole ETF units and shows the leftover", () => {
    const r = minimalToTargets(pf(), w());
    if (!r.possible) throw new Error("expected possible");
    expect(r.etfPlan).not.toBeNull();
    expect(r.investable).not.toBeNull();
    expect(r.etfPlan!.units.every(u => Number.isInteger(u) && u >= 0)).toBe(true);
    expect(r.etfPlan!.spent).toBeLessThanOrEqual(r.split.find(s => s.classId === "etf")!.value + 1e-9);
    expect(r.investable!.amount).toBeCloseTo(r.theoretical - r.investable!.leftover);
    expect(r.investable!.leftover).toBeGreaterThanOrEqual(0);
  });
  it("missing ETF prices keep the theoretical minimum but block the investable one", () => {
    const p = initialPortfolio(); // quantités et cours à 0/null
    const r = minimalToTargets(p, w());
    expect(r.possible).toBe(true);
    if (!r.possible) return;
    expect(r.theoretical).toBeCloseTo(8500); // max(500/.05, 1000/.10) − 1500
    expect(r.investable).toBeNull();
  });
  it("exact targets are impossible without sale when a holding sits outside the mapping", () => {
    const x = w();
    x.holdings.push({ ...x.holdings[0]!, id: "hors-cible", name: "Position hors cible", accountId: "cto", classId: "bonds", quantity: 2, price: 50, priceDate: "2026-11-13" });
    const r = minimalToTargets(pf(), x);
    expect(r.possible).toBe(false);
    expect(r.unmapped.map(u => u.name)).toEqual(["Position hors cible"]);
  });
  it("simulations never modify the saved portfolio or wealth data", () => {
    const p = pf(); const x = w();
    const beforeP = JSON.stringify(p); const beforeW = JSON.stringify(x);
    simulateContribution(p, x, 1000, "cto");
    bestAccount(p, x, 1000);
    optimizeAllAccounts(p, x, 1000);
    minimalToTargets(p, x);
    expect(JSON.stringify(p)).toBe(beforeP);
    expect(JSON.stringify(x)).toBe(beforeW);
  });
});
