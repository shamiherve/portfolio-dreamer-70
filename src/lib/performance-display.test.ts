import { describe, expect, it } from "vitest";
import { periodGain, periodMwr, totalGain, signedEur, signedPct, tone } from "./performance-display";
import type { DayPoint } from "./performance";
const p = (date: string, value: number | null, flow = 0): DayPoint => ({ date, value, flow, missing: [], carried: [], cash: 0 });
const pts = [p("2026-01-01", 100, 100), p("2026-07-02", 110), p("2026-07-02".replace("02", "03"), 210, 100), p("2027-01-01", 200)];
describe("performance display", () => {
  it("gain = end − start − later flows", () => expect(periodGain(pts, "2026-01-01")).toBeCloseTo(0));
  it("total gain = end − all deposits", () => expect(totalGain(pts)).toBeCloseTo(0));
  it("MWR with a single deposit equals simple return", () => expect(periodMwr([p("2026-01-01", 100, 100), p("2027-01-01", 110)], "2026-01-01")).toBeCloseTo(0.1, 4));
  it("unknown end value is unavailable", () => { expect(periodGain([p("2026-01-01", 100, 100), p("2026-02-01", null)], "2026-01-01")).toBeNull(); expect(periodMwr([p("2026-01-01", 100, 100), p("2026-02-01", null)], "2026-01-01")).toBeNull(); });
  it("explicit signs and French format", () => { expect(signedEur(-24.4)).toMatch(/^−24,40\s€$/); expect(signedEur(10.85)).toMatch(/^\+10,85\s€$/); expect(signedPct(0.0639)).toMatch(/^\+6,39\s%$/); expect(signedEur(0)).toMatch(/^0,00\s€$/); });
  it("colour by sign", () => { expect(tone(1)).toBe("text-success"); expect(tone(-1)).toBe("text-destructive"); expect(tone(0.001)).toBe("text-muted-foreground"); expect(tone(null)).toBe("text-muted-foreground"); });
});
