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
