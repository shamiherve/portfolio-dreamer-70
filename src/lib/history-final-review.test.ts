import { describe, expect, it } from "vitest";
import { initialPortfolio } from "./portfolio";
import { initialWealth } from "./wealth";
import { emptyLedger, eventSchema, type LedgerEvent } from "./ledger";
import { detectMapping, parseCsv, previewHistory, type ImportOptions } from "./history-import";
import { confirmedWorkbookOptions, finalHistoryReview } from "./history-final-review";

const at = "2026-11-24T13:17:00Z";
function setup(text: string) {
  const sheet = parseCsv(text)[0]; if (!sheet) throw new Error("fixture");
  const options: ImportOptions = { accountId: "pea", broker: "fortuneo", file: "fixture.csv", headerRow: 1, mapping: detectMapping(sheet.grid[0] ?? []), decimal: "comma", timezone: "UTC", currency: "EUR", amountBasis: "gross", missingCurrencyConfirmed: true, importedAt: at, overrides: {} };
  return { sheet, options };
}
const embraerWealth = () => { const w = initialWealth(); const gold = w.holdings[0]; if (!gold) throw new Error("fixture"); w.holdings.push({ ...gold, id: "emb", name: "Embraer", isin: "US29082A1079", quantity: 4 }); return w; };
describe("Final read-only historical preview", () => {
  it("applies the user's nine external-deposit confirmation only to the supplied workbook profile and confirms the Embraer ratio 4", () => {
    const { sheet } = setup("datetime;date;account_type;type;symbol;shares;price;amount;fee;currency\n" + Array.from({ length: 9 }, () => "2026-08-15T12:00:00Z;2026-08-15;DEFAULT;TRANSFER_INSTANT_INBOUND;;;;62;;EUR").join("\n") + "\n" + Array.from({ length: 8 }, () => "2026-08-16T12:00:00Z;2026-08-16;DEFAULT;BUY;US29082A1079;1;68,5375;-68,5375;-1;EUR").join("\n") + "\n2026-11-16T12:00:00Z;2026-11-16;DEFAULT;SPLIT;US29082A1079;3;;;;");
    const actual = confirmedWorkbookOptions(sheet, "transactions_clean_2.xlsx");
    expect(actual.inboundExternalConfirmed).toBe(true); expect(actual.overrides?.[19]?.splitRatio).toBe("4");
    expect(confirmedWorkbookOptions(sheet, "future-export.xlsx").inboundExternalConfirmed).toBe(false);
    const shorter = { ...sheet, grid: sheet.grid.filter((_, i) => i !== 1) };
    expect(confirmedWorkbookOptions(shorter, "transactions_clean_2.xlsx").inboundExternalConfirmed).toBe(false);
  });
  it("retains an unavailable exact execution price as null, documented quantity and amount unchanged", () => {
    const { sheet, options } = setup("Date;Opération;ISIN;Quantité;Prix;Montant;Devise\n2026-02-01;Achat;FR0011550185;2;;61,13;EUR");
    const p = previewHistory(sheet, options, initialPortfolio(), initialWealth(), emptyLedger());
    expect(p.accepted[0]).toMatchObject({ quantity: 2, executionPrice: null, amount: 61.13 });
    expect(p.rows[0]?.notes).toHaveLength(1);
    expect(eventSchema.parse(p.accepted[0]).executionPrice).toBeNull();
  });
  it("never admits an unknown PEA ISIN even when the historical-instrument checkbox is forced", () => {
    const { sheet, options } = setup("Date;Opération;ISIN;Quantité;Prix;Montant;Devise\n2026-02-01;Achat;FR0000120321;2;;61,13;EUR");
    const p = previewHistory(sheet, { ...options, overrides: { 2: { verifyInstrument: true } } }, initialPortfolio(), initialWealth(), emptyLedger());
    expect(p.accepted).toHaveLength(0); expect(p.rows[0]?.event?.instrumentId).toBeNull();
  });
  it("checks existing local ETF trades without a source execution price and excludes the duplicate", () => {
    const { sheet, options } = setup("Date;Opération;ISIN;Quantité;Prix;Montant;Devise\n2026-02-01;Achat;FR0011550185;2;;60;EUR");
    const p = initialPortfolio(); p.transactions = [{ id: "local", positionId: "sp500", name: "ETF", type: "buy", date: "2026-02-01", quantity: 2, price: 30 }];
    const r = finalHistoryReview([sheet], [options], p, initialWealth(), emptyLedger(), true);
    expect(r.rows[0]?.status).toBe("existing-etf"); expect(r.quantities[0]?.reconstructedQuantity).toBe(2);
  });
  it("does not certify isolated data as ambiguity-free", () => {
    const { sheet, options } = setup("Date;Opération;Montant;Devise\n2026-02-01;Versement;50;EUR");
    const p = initialPortfolio(); const w = initialWealth(); const l = emptyLedger();
    expect(finalHistoryReview([sheet], [options], p, w, l, false).counts).toEqual({ ready: 0, confirmation: 1, blocked: 0 });
    expect(finalHistoryReview([sheet], [options], p, w, l, true).counts.ready).toBe(1);
  });
  it("reconstructs Embraer 1 + 3 = 4 exactly once without adding a split to the current four ADR", () => {
    const { sheet, options } = setup("Date;Opération;ISIN;Quantité;Prix;Montant;Devise;Ratio\n2026-07-29;BUY;US29082A1079;1;59;59;EUR;\n2026-11-16;SPLIT;US29082A1079;3;;0;EUR;4");
    const o = { ...options, accountId: "cto" as const, broker: "trade-republic" as const }; const w = embraerWealth(); const p = initialPortfolio(); const before = JSON.stringify({ w, p });
    const first = finalHistoryReview([sheet], [o], p, w, emptyLedger(), true);
    expect(first.quantities[0]).toMatchObject({ sourceQuantity: 4, reconstructedQuantity: 4, currentQuantity: 4 });
    const events = first.previews[0]?.preview.accepted ?? [];
    const again = finalHistoryReview([sheet], [o], p, w, { version: 1, events, updatedAt: at }, true);
    expect(again.quantities[0]?.reconstructedQuantity).toBe(4); expect(again.counts.ready).toBe(0);
    expect(JSON.stringify({ w, p })).toBe(before);
  });
  it("blocks a more complete repeat record rather than duplicate an existing null-price ledger event", () => {
    const { sheet, options } = setup("Date;Opération;ISIN;Quantité;Prix;Montant;Devise\n2026-02-01;Achat;FR0011550185;2;;60;EUR");
    const p = initialPortfolio(); const w = initialWealth(); const event = previewHistory(sheet, options, p, w, emptyLedger()).accepted[0]; if (!event) throw new Error("fixture");
    const existing: LedgerEvent = { ...event, executionPrice: 30 };
    const r = finalHistoryReview([sheet], [options], p, w, { version: 1, events: [existing], updatedAt: at }, true);
    expect(r.counts.blocked).toBe(1); expect(r.previews[0]?.preview.accepted).toHaveLength(0);
  });
  it("requires review when current Embraer holdings differ from four ADR and never changes them", () => {
    const { sheet, options } = setup("Date;Opération;ISIN;Quantité;Prix;Montant;Devise;Ratio\n2026-07-29;BUY;US29082A1079;1;59;59;EUR;\n2026-11-16;SPLIT;US29082A1079;3;;0;EUR;4");
    const w = embraerWealth(); const h = w.holdings.find(h => h.isin === "US29082A1079"); if (!h) throw new Error("fixture"); h.quantity = 7;
    const r = previewHistory(sheet, { ...options, accountId: "cto", broker: "trade-republic" }, initialPortfolio(), w, emptyLedger());
    expect(r.rows[1]?.status).toBe("review"); expect(r.rows[1]?.issues.join(" ")).toContain("n’est pas de 4 ADR"); expect(h.quantity).toBe(7);
  });
});import { REFERENCE_QUANTITIES } from "./history-final-review";
describe("Confirmed reference quantities", () => {
  it("records 10 STOXX Europe 600 units and 4 Embraer ADR as controls", () => {
    expect(REFERENCE_QUANTITIES.find(r => r.isin === "FR0011550193")?.quantity).toBe(10);
    expect(REFERENCE_QUANTITIES.find(r => r.isin === "US29082A1079")?.quantity).toBe(4);
  });
});
import { peaReconstructedCash, RECONCILIATION } from "./ledger";
describe("PEA CAC 40 omitted round trip", () => {
  it("reconstructs +0,09 € from −5,58 € with buy 79,62 € and sell 85,29 €, no residual gap or position", () => {
    expect(peaReconstructedCash(RECONCILIATION.pea.balance)).toEqual({ reconstructed: 0.09, gap: 0, netQuantity: 0 });
  });
});
