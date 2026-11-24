import { describe, expect, it } from "vitest";
import { compareToBenchmarks } from "./benchmarks";
import type { DayPoint } from "./performance";

const dp = (date: string, value: number | null): DayPoint => ({ date, value, flow: 0, missing: [], carried: [], cash: 0 });
const pts = [dp("2026-01-05", 1000), dp("2026-01-06", 1100), dp("2026-01-07", 1210)];
const perf = [0, 0.1, 0.21];

describe("comparaison aux indices", () => {
  it("rebases portfolio TWR and index closes to 100 at the same start", () => {
    const { rows, summary } = compareToBenchmarks(pts, perf, "2026-01-05", { world: [{ date: "2026-01-05", close: 50 }, { date: "2026-01-06", close: 55 }, { date: "2026-01-07", close: 52.5 }] }, ["world"]);
    expect(rows[0]).toMatchObject({ portfolio: 100, world: 100 });
    expect(rows[2]!["world"]).toBeCloseTo(105);
    expect(summary[0]!.perf).toBeCloseTo(0.21);
    expect(summary[1]!.perf).toBeCloseTo(0.05);
    expect(summary[1]!.gapPts).toBeCloseTo(16);
  });
  it("never invents an index value when its history is missing", () => {
    const { rows, summary } = compareToBenchmarks(pts, perf, "2026-01-05", {}, ["sp500"]);
    expect(rows.every(r => r["sp500"] === null)).toBe(true);
    expect(summary[1]).toMatchObject({ perf: null, gapPts: null, complete: false });
  });
  it("flags a gap longer than the carry limit as incomplete", () => {
    const long = [dp("2026-01-05", 1000), dp("2026-01-20", 1000)];
    const { rows, summary } = compareToBenchmarks(long, [0, 0], "2026-01-05", { ndx: [{ date: "2026-01-05", close: 10 }] }, ["ndx"]);
    expect(rows[1]!["ndx"]).toBeNull();
    expect(summary[1]!.complete).toBe(false);
  });
  it("leaves the portfolio point empty when its TWR is unknown", () => {
    const { rows } = compareToBenchmarks(pts, [0, null, 0.21], "2026-01-05", { world: [{ date: "2026-01-05", close: 1 }, { date: "2026-01-06", close: 1 }, { date: "2026-01-07", close: 1 }] }, ["world"]);
    expect(rows[1]).toMatchObject({ portfolio: null, world: null });
  });
});

import { registryWindow } from "./benchmarks";
import { reconstruct, twrIndex, windowPerformance, type Move } from "./performance";

describe("comparaison par compte", () => {
  const world = [{ date: "2026-01-05", close: 10 }, { date: "2026-01-06", close: 11 }, { date: "2026-01-07", close: 12 }];
  const ndx = [{ date: "2026-01-05", close: 20 }, { date: "2026-01-06", close: 20 }, { date: "2026-01-07", close: 25 }];
  it("each account keeps its own reference index", () => {
    const a = compareToBenchmarks(pts, perf, "2026-01-05", { world, ndx }, ["world"]);
    const b = compareToBenchmarks(pts, perf, "2026-01-05", { world, ndx }, ["ndx"]);
    expect(a.summary[1]).toMatchObject({ id: "world" }); expect(a.summary[1]!.perf).toBeCloseTo(0.2);
    expect(b.summary[1]).toMatchObject({ id: "ndx" }); expect(b.summary[1]!.perf).toBeCloseTo(0.25);
  });
  it("rebases a newly created account at the last valuation before the window start", () => {
    const w = registryWindow([{ date: "2026-01-01", performance: 0 }, { date: "2026-01-05", performance: 10 }, { date: "2026-01-07", performance: 21 }], "2026-01-06")!;
    expect(w.baseDate).toBe("2026-01-05");
    expect(w.perf[0]).toBeCloseTo(0); expect(w.perf[1]).toBeCloseTo(0.1);
    const c = compareToBenchmarks(w.points, w.perf, w.baseDate, { world }, ["world"], w.baseDate);
    expect(c.rows[0]).toMatchObject({ portfolio: 100, world: 100 });
    expect(c.summary[1]!.perf).toBeCloseTo(12 / 10 - 1);
  });
  it("an account without valuations has no comparison", () => {
    expect(registryWindow([], "2026-01-05")).toBeNull();
  });
  it("an unknown external flow keeps the account performance unavailable", () => {
    const w = registryWindow([{ date: "2026-01-05", performance: 0 }, { date: "2026-01-06", performance: null }], "2026-01-05")!;
    expect(compareToBenchmarks(w.points, w.perf, w.baseDate, { world }, ["world"], w.baseDate).summary[0]!.perf).toBeNull();
  });
});

describe("versements et transferts internes", () => {
  const m = (date: string, account: "pea" | "cto", cash: number, external: number): Move => ({ date, account, isin: null, dq: 0, cash, external, label: "t" });
  it("neutralises deposits: a deposit is not performance", () => {
    const s = reconstruct([m("2026-01-05", "pea", 1000, 1000), m("2026-01-06", "pea", 500, 500)], new Map(), "2026-01-07");
    expect(twrIndex(s.pea).at(-1)).toBeCloseTo(1);
    expect(windowPerformance(s.global, "2026-01-05").at(-1)).toBeCloseTo(0);
  });
  it("an internal transfer is a flow per account but nets to zero globally", () => {
    const s = reconstruct([m("2026-01-05", "pea", 1000, 1000), m("2026-01-05", "cto", 1000, 1000), m("2026-01-06", "pea", -300, -300), m("2026-01-06", "cto", 300, 300)], new Map(), "2026-01-07");
    expect(s.global[1]!.flow).toBe(0);
    expect(s.pea[1]!.flow).toBe(-300); expect(s.cto[1]!.flow).toBe(300);
    expect(twrIndex(s.global).at(-1)).toBeCloseTo(1);
    expect(twrIndex(s.pea).at(-1)).toBeCloseTo(1); expect(twrIndex(s.cto).at(-1)).toBeCloseTo(1);
  });
});
