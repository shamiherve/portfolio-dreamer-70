import { describe, expect, it } from "vitest";
import { alignSplits, ledgerSplits, type Move } from "./performance";
const mv = (date: string, dq: number, label: string): Move => ({ date, account: "cto", isin: "US29082A1079", dq, cash: 0, external: 0, label });
const pts = [{ date: "2026-11-14", close: 60 }, { date: "2026-11-17", close: 60 }];
describe("Embraer split 1 -> 4 (option A)", () => {
  const splits = ledgerSplits([mv("2026-01-10", 1, "buy"), mv("2026-11-16", 3, "split")]);
  it("derives ratio 4", () => expect(splits).toEqual([{ isin: "US29082A1079", date: "2026-11-16", ratio: 4 }]));
  it("divides closes from the split date when the provider shows no split", () => {
    const r = alignSplits(pts, "US29082A1079", splits, []);
    expect(r.points.map(p => p.close)).toEqual([60, 15]);
    expect(1 * r.points[0]!.close).toBe(4 * r.points[1]!.close);
  });
  it("does not divide twice when the provider reports the split", () => {
    expect(alignSplits(pts, "US29082A1079", splits, ["2026-11-17"]).points).toEqual(pts);
  });
});
