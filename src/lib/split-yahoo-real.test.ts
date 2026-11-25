import { describe, expect, it } from "vitest";
import { alignSplits, dayBreakdown, ledgerSplits, reconstruct, toEur, type Move } from "./performance";
import { parseHistory } from "./history-prices.functions";

// Valeurs réelles reçues de Yahoo le 25/11/2026 (aucune requête dans les tests).
const ts = (d: string, h = "15:30") => Date.parse(`${d}T${h}:00Z`) / 1000;
const chart = (symbol: string, currency: string, rows: [string, number][], split: { date: string; n: number; d: number }) => ({ chart: { result: [{ meta: { symbol, currency, gmtoffset: 0 }, timestamp: rows.map(([d]) => ts(d)), indicators: { quote: [{ close: rows.map(([, c]) => c) }] }, events: { splits: { x: { date: ts(split.date, "07:00"), numerator: split.n, denominator: split.d } } } }] } });

const AI = "FR0000120073";
const aiRows: [string, number][] = [["2026-06-03", 163.5455], ["2026-06-04", 165.1636], ["2026-06-05", 166.7273], ["2026-06-08", 165.38], ["2026-06-09", 168.42], ["2026-06-10", 167.72], ["2026-07-27", 177.18], ["2026-07-29", 171.48]];
const aiMoves: Move[] = [{ date: "2026-07-27", account: "pea", isin: AI, dq: 1, cash: -176.36, external: 0, label: "buy" }];

const EMB = "US29082A1079";
const embRows: [string, number][] = [["2026-07-29", 67.66], ["2026-11-11", 82.43], ["2026-11-12", 79.48], ["2026-11-13", 78.73], ["2026-11-17", 18.9], ["2026-11-18", 18.68]];
const embMoves: Move[] = [{ date: "2026-07-29", account: "cto", isin: EMB, dq: 1, cash: -60, external: 0, label: "buy" }, { date: "2026-11-16", account: "cto", isin: EMB, dq: 3, cash: 0, external: 0, label: "split" }];

describe("Air Liquide AI.PA : split Yahoo 11:10 du 08/06 antérieur à l'achat du 27/07", () => {
  const h = parseHistory(chart("AI.PA", "EUR", aiRows, { date: "2026-06-08", n: 11, d: 10 }));
  it("événement lu au 08/06, ratio 11/10", () => expect(h.splitEvents).toEqual([{ date: "2026-06-08", numerator: 11, denominator: 10 }]));
  it("série acceptée, cours après l'événement inchangés, cours antérieurs écartés", () => {
    const r = alignSplits(h.points, AI, ledgerSplits(aiMoves), h.splitEvents, "unknown", "2026-07-27");
    expect(r.available).toBe(true);
    expect(r.points).toEqual(aiRows.filter(([d]) => d >= "2026-06-08").map(([date, close]) => ({ date, close })));
  });
  it("valorisée dès l'achat, sans ajustement du cours", () => {
    const r = alignSplits(h.points, AI, ledgerSplits(aiMoves), h.splitEvents, "unknown", "2026-07-27");
    const s = reconstruct(aiMoves, new Map([[AI, r.points]]), "2026-07-29");
    expect(s.pea.map(p => p.value)).toEqual([0.82, 0.82, -4.88]);
  });
  it("sans date de première détention, reste indisponible", () => expect(alignSplits(h.points, AI, [], h.splitEvents, "unknown").available).toBe(false));
  it("un split Yahoo pendant la détention absent du grand livre reste bloquant", () => expect(alignSplits(h.points, AI, [], h.splitEvents, "unknown", "2026-06-01").available).toBe(false));
});

describe("Embraer EMBJ : split 4:1 du 16/11 concordant avec le grand livre", () => {
  const h = parseHistory(chart("EMBJ", "USD", embRows, { date: "2026-11-16", n: 4, d: 1 }));
  const splits = ledgerSplits(embMoves);
  const r = alignSplits(h.points, EMB, splits, h.splitEvents, "unknown", "2026-07-29");
  const prices = new Map([[EMB, r.points]]);
  const s = reconstruct(embMoves, prices, "2026-11-18");
  const at = (d: string) => s.cto.find(p => p.date === d);
  it("série acceptée et cours bruts préservés, sans double ajustement", () => {
    expect(r.available).toBe(true);
    expect(r.points).toEqual(embRows.map(([date, close]) => ({ date, close })));
  });
  it("quantité 1 avant le split, 4 après", () => expect(["2026-11-13", "2026-11-16", "2026-11-17"].map(d => dayBreakdown(embMoves, prices, d, splits).lines[0]?.quantity)).toEqual([1, 4, 4]));
  it("aucun cours le 16/11 : jour indisponible, aucun report du 13/11 à travers le split", () => {
    expect(at("2026-11-15")?.value).toBe(18.73);
    expect(at("2026-11-16")?.value).toBeNull();
    expect(at("2026-11-17")?.value).toBe(15.6);
    expect(at("2026-11-18")?.value).toBe(14.72);
  });
  it("cours déjà ajustés avant le split : refusés, jamais redivisés", () => {
    const adj = embRows.map(([d, c]): [string, number] => [d, d < "2026-11-16" ? c / 4 : c]);
    expect(alignSplits(parseHistory(chart("EMBJ", "USD", adj, { date: "2026-11-16", n: 4, d: 1 })).points, EMB, splits, h.splitEvents, "unknown", "2026-07-29").available).toBe(false);
  });
  it("ratio Yahoo différent du grand livre : refusé", () => expect(alignSplits(h.points, EMB, splits, [{ date: "2026-11-16", numerator: 2, denominator: 1 }], "unknown", "2026-07-29").available).toBe(false));
  it("conversion BCE inchangée", () => expect(toEur([{ date: "2026-11-17", close: 18.9 }], "USD", [{ date: "2026-11-17", close: 1.08 }])[0]?.close).toBeCloseTo(17.5, 6));
});

describe("Autres instruments", () => {
  it("série sans split inchangée, avec ou sans date de détention", () => {
    const pts = [{ date: "2026-11-16", close: 64 }];
    expect(alignSplits(pts, "FR0011550193", [], [], "unknown", "2026-01-29")).toEqual({ points: pts, applied: [], available: true, reason: null });
  });
});
