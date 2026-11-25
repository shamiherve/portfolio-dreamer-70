import { describe, expect, it } from "vitest";
import { alignSplits, dayBreakdown, finalQuantities, ledgerSplits, reconstruct, twrIndex, windowPerformance, upsertSnapshot, toEur, type Move } from "./performance";
import { parseHistory } from "./history-prices.functions";

const mv = (date: string, account: "pea" | "cto", o: Partial<Move>): Move => ({ date, account, isin: null, dq: 0, cash: 0, external: 0, label: "", ...o });

describe("évolution du patrimoine", () => {
  it("valeur = quantités × cours + espèces nettes", () => {
    const moves = [mv("2026-01-05", "pea", { cash: 100, external: 100 }), mv("2026-01-05", "pea", { isin: "X", dq: 2, cash: -80 })];
    const s = reconstruct(moves, new Map([["X", [{ date: "2026-01-05", close: 40 }, { date: "2026-01-06", close: 50 }]]]), "2026-01-06");
    expect(s.pea.map(p => p.value)).toEqual([100, 120]);
  });
  it("un cours manquant rend la journée incomplète, sans interpolation ni cours actuel", () => {
    const moves = [mv("2026-01-05", "cto", { isin: "Y", dq: 1, cash: -10 })];
    const s = reconstruct(moves, new Map([["Y", [{ date: "2026-01-20", close: 12 }]]]), "2026-01-20");
    expect(s.cto[0]!.value).toBeNull();
    expect(s.cto[0]!.missing).toEqual(["Y"]);
    expect(s.global[0]!.value).toBeNull();
  });
  it("week-end : dernière clôture reportée et signalée", () => {
    const s = reconstruct([mv("2026-01-09", "pea", { isin: "X", dq: 1, cash: -10 })], new Map([["X", [{ date: "2026-01-09", close: 10 }]]]), "2026-01-11");
    expect(s.pea[2]!.value).toBe(0);
    expect(s.pea[2]!.carried).toEqual(["X"]);
  });
  it("TWR neutralise un versement : +10 % puis versement de 1 000 € reste +10 %", () => {
    const idx = twrIndex([{ date: "a", value: 1000, flow: 1000, missing: [], carried: [], cash: 0 }, { date: "b", value: 1100, flow: 0, missing: [], carried: [], cash: 0 }, { date: "c", value: 2100, flow: 1000, missing: [], carried: [], cash: 0 }]);
    expect(idx.at(-1)).toBeCloseTo(1.1, 10);
  });
  it("performance globale calculée sur le cumul, pas la moyenne des enveloppes", () => {
    const moves = [mv("2026-01-01", "pea", { cash: 1000, external: 1000, isin: null }), mv("2026-01-01", "pea", { isin: "A", dq: 10, cash: -1000 }), mv("2026-01-01", "cto", { cash: 100, external: 100 }), mv("2026-01-01", "cto", { isin: "B", dq: 1, cash: -100 })];
    const s = reconstruct(moves, new Map([["A", [{ date: "2026-01-01", close: 100 }, { date: "2026-01-02", close: 110 }]], ["B", [{ date: "2026-01-01", close: 100 }, { date: "2026-01-02", close: 50 }]]]), "2026-01-02");
    const g = windowPerformance(s.global, "2026-01-01").at(-1)!;
    expect(g).toBeCloseTo(50 / 1100, 10); // +100 PEA −50 CTO sur 1 100 €, et non (10 % − 50 %) / 2
  });
  it("conversion USD → EUR avec le taux BCE du jour", () => {
    expect(toEur([{ date: "2026-01-05", close: 110 }], "USD", [{ date: "2026-01-05", close: 1.1 }])[0]!.close).toBeCloseTo(100, 10);
    expect(toEur([{ date: "2026-01-05", close: 110 }], "USD", [])).toEqual([]);
  });
  it("préserve les closes Yahoo et les ratios sans deviner la convention du split", () => {
    const t1 = Date.parse("2026-11-13T15:00:00Z") / 1000, t2 = Date.parse("2026-11-17T15:00:00Z") / 1000, split = Date.parse("2026-11-16T14:30:00Z") / 1000;
    const h = parseHistory({ chart: { result: [{ meta: { symbol: "ERJ", currency: "USD", gmtoffset: 0 }, timestamp: [t1, t2], indicators: { quote: [{ close: [10, 10] }] }, events: { splits: { x: { date: split, numerator: 4, denominator: 1 } } } }] } });
    expect(h.points.map(p => p.close)).toEqual([10, 10]);
    expect(h.priceConvention).toBe("unknown");
    expect(h.splitEvents).toEqual([{ date: "2026-11-16", numerator: 4, denominator: 1 }]);
  });
  it("un seul instantané par date", () => {
    const base = { version: 1 as const, enabledAt: "2026-11-24T10:00:00.000Z", backupAt: "2026-11-24T10:00:00.000Z", items: [] };
    const snap = { date: "2026-11-24", at: "2026-11-24T10:00:00.000Z", total: 1, pea: 1, cto: 0, perfPea: null, perfCto: null, perfGlobal: null };
    const twice = upsertSnapshot(upsertSnapshot(base, snap), { ...snap, total: 2, at: "2026-11-24T18:00:00.000Z" });
    expect(twice.items).toHaveLength(1);
    expect(twice.items[0]!.total).toBe(2);
  });
});

describe("garde-fous historiques du split Embraer", () => {
  const isin = "US29082A1079";
  const moves = [mv("2026-07-29", "cto", { isin, dq: 1, cash: 2, label: "buy" }), mv("2026-11-16", "cto", { isin, dq: 3, label: "split" })];
  const points = [{ date: "2026-11-13", close: 64 }, { date: "2026-11-17", close: 16 }];
  it("interdit le report du 13/11 sur quatre ADR le 16/11 dans le total et le détail", () => {
    const prices = new Map([[isin, points]]);
    const s = reconstruct(moves, prices, "2026-11-17");
    expect(s.cto.find(p => p.date === "2026-11-13")?.value).toBe(66);
    expect(s.cto.find(p => p.date === "2026-11-16")?.value).toBeNull();
    expect(s.cto.find(p => p.date === "2026-11-17")?.value).toBe(66);
    const b = dayBreakdown(moves, prices, "2026-11-16");
    expect(b.lines.find(l => l.isin === isin)).toMatchObject({ quantity: 4, close: null, value: null, priceDate: null });
    expect(b.cash.cto).toBe(2);
    expect(finalQuantities(moves).get(`cto|${isin}`)).toBe(4);
  });
  it("garde le report après split si la clôture appartient au régime post-split", () => {
    const s = reconstruct(moves, new Map([[isin, [{ date: "2026-11-16", close: 16 }]]]), "2026-11-17");
    expect(s.cto.find(p => p.date === "2026-11-17")?.value).toBe(66);
    expect(s.cto.find(p => p.date === "2026-11-17")?.carried).toEqual([isin]);
  });
  it("ne change ni les mouvements, ni les espèces, ni les objectifs des données d’entrée", () => {
    const before = structuredClone(moves);
    const prices = new Map([[isin, points]]);
    const beforePoints = structuredClone(points);
    reconstruct(moves, prices, "2026-11-17"); dayBreakdown(moves, prices, "2026-11-16");
    alignSplits(points, isin, ledgerSplits(moves), [], "unknown");
    expect(moves).toEqual(before); expect(points).toEqual(beforePoints);
    expect(dayBreakdown(moves, prices, "2026-11-17").cash.cto).toBe(2);
  });
  it("la conversion BCE conserve son report habituel et ne fabrique pas un cours après split", () => {
    const eur = toEur(points, "USD", [{ date: "2026-11-12", close: 1.25 }, { date: "2026-11-16", close: 1.25 }]);
    expect(eur.map(p => p.close)).toEqual([51.2, 12.8]);
    const s = reconstruct(moves, new Map([[isin, eur]]), "2026-11-17");
    expect(s.cto.find(p => p.date === "2026-11-16")?.value).toBeNull();
    expect(s.cto.find(p => p.date === "2026-11-17")?.value).toBe(53.2);
  });
});
