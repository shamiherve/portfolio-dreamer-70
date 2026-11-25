import { describe, expect, it } from "vitest";
import { alignSplits, dayBreakdown, finalQuantities, ledgerSplits, reconstruct, twrIndex, type Move, type PriceConvention } from "./performance";
import { parseHistory } from "./history-prices.functions";
const isin = "US29082A1079";
const mv = (date: string, dq: number, label: string): Move => ({ date, account: "cto", isin, dq, cash: 0, external: 0, label });
const moves = [mv("2026-07-29", 1, "buy"), mv("2026-11-16", 3, "split")];
const dates = ["2026-07-29", "2026-11-13", "2026-11-16", "2026-11-17"];
const splits = ledgerSplits(moves);

describe("Embraer 1 → 4 : aucune échelle supposée", () => {
  it("dérive exactement le ratio 4 de la variation +3", () => expect(splits).toEqual([{ isin, date: "2026-11-16", ratio: 4 }]));
  for (const convention of ["raw", "split-adjusted"] as const) {
    for (const providerDate of ["2026-11-16", "2026-11-17", null]) {
      for (const close16 of [true, false]) {
        const title = `${convention}, événement ${providerDate ?? "absent"}, clôture 16/11 ${close16 ? "présente" : "absente"}`;
        const present = dates.filter(d => close16 || d !== "2026-11-16");
        const closes = present.map(d => convention === "split-adjusted" ? 16 : d < "2026-11-16" ? 64 : 16);
        const fixture = { chart: { result: [{ meta: { symbol: "EMBJ", currency: "USD", gmtoffset: 0 }, timestamp: present.map(d => Date.parse(`${d}T21:00:00Z`) / 1000), indicators: { quote: [{ close: closes }] }, events: { splits: providerDate ? { fixture: { date: Date.parse(`${providerDate}T14:30:00Z`) / 1000, numerator: 4, denominator: 1 } } : {} } }] } };
        const calculate = (evidence: PriceConvention) => {
          const h = parseHistory(fixture);
          const aligned = alignSplits(h.points, isin, splits, h.splitEvents, evidence);
          const prices = new Map([[isin, aligned.points]]);
          const s = reconstruct(moves, prices, "2026-11-17");
          return { h, aligned, prices, selected: dates.map(d => s.cto.find(p => p.date === d)) };
        };
        it(`${title} : convention non déclarée, acceptée seulement si événement concordant et saut brut cohérent`, () => {
          const r = calculate("unknown");
          expect(r.h.priceConvention).toBe("unknown");
          expect(r.h.points.map(p => p.close)).toEqual(closes);
          const ok = providerDate === "2026-11-16" && convention === "raw";
          expect(r.aligned.available).toBe(ok);
          expect(r.selected.map(p => p?.value)).toEqual(ok ? [64, 64, close16 ? 64 : null, 64] : [null, null, null, null]);
        });
        it(`${title} : avec convention prouvée, valeur constante ou indisponible`, () => {
          const r = calculate(convention);
          const established = providerDate === "2026-11-16" || (providerDate === null && convention === "raw");
          const expected = established ? [64, 64, close16 ? 64 : null, 64] : [null, null, null, null];
          expect(r.selected.map(p => p?.value)).toEqual(expected);
          expect(dates.map(d => dayBreakdown(moves, r.prices, d).lines.find(l => l.isin === isin)?.value)).toEqual(expected);
          if (established && close16) expect(twrIndex(r.selected.map(p => { if (!p) throw new Error("Jour absent"); return p; }))).toEqual([1, 1, 1, 1]);
        });
        it(`${title} : les quantités restent 1, 1, 4, 4`, () => {
          const r = calculate(convention);
          expect(dates.map(d => dayBreakdown(moves, r.prices, d).lines.find(l => l.isin === isin)?.quantity)).toEqual([1, 1, 4, 4]);
          expect(finalQuantities(moves).get(`cto|${isin}`)).toBe(4);
        });
      }
    }
  }
  it("refuse un ratio Yahoo 2 contre le ratio 4 du grand livre", () => {
    const r = alignSplits([{ date: "2026-11-16", close: 16 }], isin, splits, [{ date: "2026-11-16", numerator: 2, denominator: 1 }], "raw");
    expect(r.available).toBe(false); expect(r.points).toEqual([]);
  });
  it("refuse les anciennes dates de split seules, même avec une convention annoncée", () => {
    expect(alignSplits([{ date: "2026-11-16", close: 16 }], isin, splits, ["2026-11-16"], "raw").available).toBe(false);
  });
  it("ne transforme pas une série sans split", () => {
    const points = [{ date: "2026-11-16", close: 64 }];
    expect(alignSplits(points, isin, [], []).points).toEqual(points);
    expect(alignSplits(points, isin, [], []).available).toBe(true);
  });
});
