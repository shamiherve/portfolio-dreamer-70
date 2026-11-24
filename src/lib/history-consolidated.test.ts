import { describe, expect, it } from "vitest";
import type { ImportCell, ImportSheet } from "./history-import";
import { consolidatedCash, isConsolidatedSource, normalizeConsolidated } from "./history-consolidated";

const c = (v: string | number | null): ImportCell => ({ value: v, text: v === null ? "" : String(v) });
const H = ["Libellé", "Opération", "Date", "Qté", "Prix d'exécution", "Montant brut", "Courtage/Prélèvement", "Montant net", "Devise"];
const sheet = (rows: (string | number | null)[][]): ImportSheet => ({ name: "CTO", grid: [H.map(c), ...rows.map(r => r.map(c))] });
describe("Consolidated workbook (net amounts)", () => {
  const s = sheet([
    [null, "Versement", "2026-07-29", null, null, 60, null, 60, "EUR"],
    ["Embraer (ADR)", "Achat Comptant", "2026-07-29", 1, 59, -59, -1, -60, "EUR"],
    ["Embraer (ADR)", "Split (division de titre)", "2026-11-16", 3, null, null, null, null, null],
  ]);
  it("uses the net column for cash without deducting the brokerage twice: 60 − 60 = 0 €", () => {
    expect(isConsolidatedSource(s)).toBe(true);
    const n = normalizeConsolidated(s);
    expect(consolidatedCash(n)?.balance).toBe(0);
    expect(n.grid[2]?.slice(7, 9).map(x => x.value)).toEqual([-59, 1]);
  });
  it("records the Embraer split of 16/11/2026 as +3 ADR with ratio 4 and no cash", () => {
    const row = normalizeConsolidated(s).grid[3];
    expect([row?.[5]?.value, row?.[7]?.value, row?.[10]?.value]).toEqual([3, 0, 4]);
  });
  it("blocks a row whose net amount disagrees with gross − brokerage instead of recomputing it", () => {
    const n = normalizeConsolidated(sheet([["Visa", "Achat Comptant", "2026-10-12", 0.151385, 350.15, -53.01, -1, -55, "EUR"]]));
    expect(n.grid[1]?.[7]?.value).toBeNull();
  });
  it("keeps coupon announcements out of cash so a 0,90 € dividend is counted once", () => {
    const n = normalizeConsolidated({ ...sheet([["TOTALENERGIES", "Encaissement coupons intérêt/dividende", "2026-10-02", 1, 0, 0.9, 0, 0.9, "EUR"], ["TOTALENERGIES", "OST de création de coupons - Détachement coupon optionnel", "2026-09-30", 1, 0, 0.9, 0, 0.9, "EUR"]]), name: "PEA" });
    expect(consolidatedCash(n)).toMatchObject({ balance: 0.9, informational: 1, movements: 2 });
  });
});
import { initialPortfolio } from "./portfolio";
import { initialWealth } from "./wealth";
import { emptyLedger } from "./ledger";
import { detectMapping, previewHistory } from "./history-import";
import { consolidatedOptions } from "./history-consolidated";
describe("Amundi CAC 40 historical round trip", () => {
  it("admits buy 79,62 € and sell 85,29 € under FR0007052782 and leaves 0 unit with no position created", () => {
    const n = normalizeConsolidated({ name: "PEA", grid: [H.map(c), ...[["Amundi CAC 40 UCITS ETF - EUR DIS", "Achat Comptant", "2026-02-02", 1, 79.62, -79.62, 0, -79.62, "EUR"], ["Amundi CAC 40 UCITS ETF - EUR DIS", "Vente comptant", "2026-07-30", 1, 85.59, 85.59, -0.3, 85.29, "EUR"]].map(r => r.map(c))] });
    const p = initialPortfolio(); const w = initialWealth();
    const r = previewHistory(n, { file: "x", headerRow: 1, mapping: detectMapping(n.grid[0] ?? []), importedAt: "2026-11-24T15:00:00Z", accountId: "pea", broker: "fortuneo", timezone: "Europe/Paris", decimal: "dot", currency: "EUR", amountBasis: "gross", overrides: {}, ...consolidatedOptions(n) }, p, w, emptyLedger());
    expect(r.accepted.map(e => [e.isin, e.type, e.quantity])).toEqual([["FR0007052782", "buy", 1], ["FR0007052782", "sell", 1]]);
    expect(r.cash[0]?.balance).toBeCloseTo(5.67, 2);
    expect(p.positions.some(x => x.isin === "FR0007052782") || w.holdings.some(x => x.isin === "FR0007052782")).toBe(false);
  });
});
