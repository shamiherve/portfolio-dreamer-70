import { describe, expect, it } from "vitest";
import { reconstruct, twrIndex, windowPerformance, upsertSnapshot, toEur, type Move } from "./performance";
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
  it("cours Yahoo dé-ajustés du split : 1 → 4 le 16/11/2026 appliqué une seule fois (par le grand livre)", () => {
    const t1 = Date.parse("2026-11-13T15:00:00Z") / 1000, t2 = Date.parse("2026-11-17T15:00:00Z") / 1000, split = Date.parse("2026-11-16T14:30:00Z") / 1000;
    const h = parseHistory({ chart: { result: [{ meta: { symbol: "ERJ", currency: "USD", gmtoffset: 0 }, timestamp: [t1, t2], indicators: { quote: [{ close: [10, 10] }] }, events: { splits: { x: { date: split, numerator: 4, denominator: 1 } } } }] } });
    expect(h.points.map(p => p.close)).toEqual([40, 10]);
    const s = reconstruct([mv("2026-11-13", "cto", { isin: "E", dq: 1, cash: -40 }), mv("2026-11-16", "cto", { isin: "E", dq: 3 })], new Map([["E", [{ date: "2026-11-13", close: 40 }, { date: "2026-11-16", close: 10 }]]]), "2026-11-16");
    expect(s.cto.map(p => p.value)).toEqual([0, 0, 0, 0]);
  });
  it("un seul instantané par date", () => {
    const base = { version: 1 as const, enabledAt: "2026-11-24T10:00:00.000Z", backupAt: "2026-11-24T10:00:00.000Z", items: [] };
    const snap = { date: "2026-11-24", at: "2026-11-24T10:00:00.000Z", total: 1, pea: 1, cto: 0, perfPea: null, perfCto: null, perfGlobal: null };
    const twice = upsertSnapshot(upsertSnapshot(base, snap), { ...snap, total: 2, at: "2026-11-24T18:00:00.000Z" });
    expect(twice.items).toHaveLength(1);
    expect(twice.items[0]!.total).toBe(2);
  });
});
