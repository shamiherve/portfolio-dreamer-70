import { describe, expect, it } from "vitest";
import { computeExactTarget, computeRebalance, type Category } from "./rebalance";

const cats: Category[] = [
  { id: "a", name: "A", value: 45200, target: 40 },
  { id: "b", name: "B", value: 32800, target: 35 },
  { id: "c", name: "C", value: 12500, target: 25 },
];

describe("computeRebalance", () => {
  it("n'alloue jamais de montant négatif", () => {
    for (const budget of [0, 1, 500, 15000, 1_000_000]) {
      const r = computeRebalance(cats, budget);
      for (const l of r.lines) expect(l.injected).toBeGreaterThanOrEqual(0);
    }
  });

  it("la somme des injections est égale au budget", () => {
    for (const budget of [0, 250, 15000, 987654]) {
      const r = computeRebalance(cats, budget);
      const sum = r.lines.reduce((a, l) => a + l.injected, 0);
      expect(sum).toBeCloseTo(budget, 6);
    }
  });

  it("valide que les poids cibles totalisent 100 %", () => {
    expect(computeRebalance(cats, 0).targetsValid).toBe(true);
    expect(
      computeRebalance([{ id: "x", name: "X", value: 10, target: 90 }], 0).targetsValid,
    ).toBe(false);
  });

  it("calcule correctement l'injection minimale", () => {
    // total final >= max(v_i / w_i) = 45200 / 0.40 = 113000 ; total actuel = 90500
    const r = computeRebalance(cats, 0);
    expect(r.minInjection).toBeCloseTo(113000 - 90500, 6);
  });

  it("atteint exactement les cibles avec l'injection minimale", () => {
    const r = computeExactTarget(cats);
    for (const l of r.lines) expect(l.finalWeight).toBeCloseTo(l.target, 6);
    expect(r.status).toBe("reached");
    expect(r.shortfall).toBe(0);
  });

  it("signale un budget insuffisant", () => {
    const exact = computeExactTarget(cats);
    const half = computeRebalance(cats, exact.budget / 2);
    expect(half.shortfall).toBeCloseTo(exact.budget / 2, 6);
    expect(half.status).toBe("partial");
    expect(half.maxGapPp).toBeGreaterThan(0);
  });

  it("détecte une cible 0 % avec une valeur > 0 comme impossible sans vente", () => {
    const c: Category[] = [
      { id: "a", name: "A", value: 1000, target: 0 },
      { id: "b", name: "B", value: 1000, target: 100 },
    ];
    const r = computeRebalance(c, 5000);
    expect(r.impossibleWithoutSale).toBe(true);
    expect(r.status).toBe("impossible");
    expect(r.minInjection).toBe(Infinity);
    expect(r.lines[0]!.injected).toBe(0);
  });
});
