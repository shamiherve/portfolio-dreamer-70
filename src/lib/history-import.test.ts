import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { initialPortfolio } from "./portfolio";
import { initialWealth } from "./wealth";
import { cashSummary, emptyLedger, eventSchema, eventKey, RECONCILIATION, splitCheck, type LedgerEvent } from "./ledger";
import { detectMapping, parseCsv, parseDate, parseExcel, parseNumber, previewHistory, type ImportOptions, type ImportSheet } from "./history-import";

const at = "2026-11-24T12:00:00.000Z";
const portfolio = initialPortfolio();
const wealth = initialWealth();
const stock = { ...wealth.holdings[0], id: "embraer-test", name: "Embraer test", isin: "US29082A1079", ticker: "ERJ", exchange: "NYSE", accountId: "cto", classId: "stocks", kind: "quantity" as const, currency: "USD", quantity: 4, price: 20, fxRate: 0.9, fractional: true, value: 0, priceDate: "2026-11-24" };
wealth.holdings.push(stock);
const header = "Date;Date valeur;Opération;ISIN;Quantité;Prix;Montant;Frais;Taxes;Retenue;Devise;Taux change;Ratio;Référence";
function preview(text: string, patch: Partial<ImportOptions> = {}, ledger = emptyLedger(), p = portfolio) {
  const sheet = parseCsv(`${header}\n${text}`)[0]; if (!sheet) throw new Error("fixture");
  const options: ImportOptions = { accountId: "pea", broker: "fortuneo", file: "synthetic.csv", headerRow: 1, mapping: detectMapping(sheet.grid[0] ?? []), decimal: "comma", timezone: "Europe/Paris", currency: "EUR", amountBasis: "gross", importedAt: at, overrides: {}, ...patch };
  return previewHistory(sheet, options, p, wealth, ledger);
}
function event(patch: Partial<LedgerEvent>): LedgerEvent {
  return eventSchema.parse({ id: crypto.randomUUID(), accountId: "pea", type: "deposit", operationDate: "2026-01-01", settlementDate: null, timestamp: null, isin: null, instrumentId: null, instrumentName: "", quantity: null, executionPrice: null, amount: 1, fees: 0, taxes: 0, withholding: 0, currency: "EUR", fxRate: 1, splitRatio: null, transferId: null, source: { broker: "fortuneo", file: "test", sheet: "CSV", row: 2, reference: "", importedAt: at }, ...patch });
}
describe("Local CSV/Excel history import", () => {
  it("parses quoted delimiters and embedded newlines, refusing malformed CSV", () => {
    const sheet = parseCsv('Opération;Montant;Nom\nVersement;10;"A;B\nC"')[0];
    expect(sheet?.grid[1]?.[2]?.text).toBe("A;B\nC");
    expect(() => parseCsv('a,b\n"unterminated')).toThrow();
  });
  it("retains duplicate headers by position, without guessing a mapping", () => {
    const sheet = parseCsv("Montant;Montant;Date valeur;Date opération\n1;2;01/01/2026;02/01/2026")[0];
    expect(detectMapping(sheet?.grid[0] ?? [])).toEqual({ settlementDate: 2, operationDate: 3 });
  });
  it("reads actual Excel worksheets, numeric amounts, Excel dates, missing cells and source rows", async () => {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("PEA");
    sheet.addRow(["Opération", "Date", "Montant", "Référence"]);
    sheet.addRow(["Versement", new Date("2026-01-12T00:00:00Z"), 12.5, "00123"]);
    const buffer = await workbook.xlsx.writeBuffer(); const array = new Uint8Array(buffer).slice().buffer;
    const loaded = await parseExcel(array); const first = loaded[0]; if (!first) throw new Error("fixture");
    expect(first.name).toBe("PEA"); expect(first.grid[1]?.[2]?.value).toBe(12.5); expect(first.grid[1]?.[3]?.text).toBe("00123");
    const result = previewHistory(first, { accountId: "pea", broker: "fortuneo", file: "test.xlsx", headerRow: 1, mapping: detectMapping(first.grid[0] ?? []), decimal: "comma", timezone: "Europe/Paris", currency: "EUR", amountBasis: "gross", importedAt: at, overrides: {} }, portfolio, wealth, emptyLedger());
    expect(result.accepted[0]?.amount).toBe(12.5); expect(result.accepted[0]?.source.row).toBe(2); expect(result.accepted[0]?.operationDate).toBe("2026-01-12");
  });
  it("detects both same-file and already-imported duplicates", () => {
    const row = "12/01/2026;;Versement;;;;10;;;;EUR;;;ref-1";
    const result = preview(`${row}\n${row}`); expect(result.counts.valid).toBe(1); expect(result.counts.duplicates).toBe(1);
    expect(preview(row, {}, { version: 1, events: result.accepted, updatedAt: at }).counts.duplicates).toBe(1);
  });
  it("excludes ETF trades already stored without modifying positions or the original transaction", () => {
    const p = initialPortfolio(); p.transactions = [{ id: "existing", positionId: "sp500", name: "Existing", type: "buy", quantity: 2, price: 30, date: "2026-01-12" }];
    const before = JSON.stringify(p);
    const r = preview("12/01/2026;14/01/2026;Achat;FR0011550185;2;30;60;;;;EUR;;;", {}, emptyLedger(), p);
    expect(r.rows[0]?.status).toBe("existing-etf"); expect(r.accepted).toHaveLength(0); expect(JSON.stringify(p)).toBe(before);
  });
  it("accepts CTO fractions, preserving distinct amounts, fees, taxes, FX and value dates", () => {
    const r = preview("29/07/2026;31/07/2026;Achat;US29082A1079;0,125;20;2,50;1;0,10;;USD;0,9;;", { accountId: "cto", broker: "trade-republic" });
    expect(r.counts.valid).toBe(1); expect(r.accepted[0]).toMatchObject({ quantity: 0.125, executionPrice: 20, amount: 2.5, fees: 1, taxes: 0.1, currency: "USD", fxRate: 0.9, operationDate: "2026-07-29", settlementDate: "2026-07-31" });
  });
  it("does not confuse dividends, fees or taxes with external contributions", () => {
    const r = preview("12/01/2026;;Dividende;FR0011550185;;;4,10;;;;EUR;;;\n12/01/2026;;Frais;;;;1;;;;EUR;;;\n12/01/2026;;Taxe;;;;1,12;;;;EUR;;;");
    expect(r.cash[0]).toMatchObject({ deposit: 0, dividend: 4.1, fees: 1, taxes: 1.12, balance: 1.9799999999999995 });
  });
  it("records the Embraer 1→4 split as +3 shares on 16/11/2026 with zero financial contribution", () => {
    const r = preview("29/07/2026;;Achat;US29082A1079;1;20;20;;;;EUR;;;\n16/11/2026;;Split;US29082A1079;3;;0;;;;EUR;;4;", { accountId: "cto", broker: "trade-republic" });
    expect(r.counts.valid).toBe(2); expect(splitCheck(r.accepted)).toEqual({ quantity: 4, issues: [] });
    expect(r.accepted[1]).toMatchObject({ type: "split", amount: 0, quantity: 3, splitRatio: 4 });
    expect(r.cash[0]?.deposit).toBe(0); expect(r.cash[0]?.buy).toBe(20);
    expect(wealth.holdings.at(-1)?.quantity).toBe(4);
  });
  it("flags an inconsistent Embraer split and never invents its missing purchase", () => {
    const r = preview("16/11/2026;;Split;US29082A1079;3;;0;;;;EUR;;4;", { accountId: "cto", broker: "trade-republic" });
    expect(r.accepted).toHaveLength(0); expect(r.counts.review).toBe(1);
  });
  it("keeps UTC instants, Paris calendar dates and Excel dates distinct, rejecting DST ambiguity", () => {
    expect(parseDate("2026-07-29T23:30:00Z", "Europe/Paris")).toEqual({ date: "2026-07-30", timestamp: "2026-07-29T23:30:00Z" });
    expect(parseDate("29/07/2026 12:30:00", "Europe/Paris").timestamp).toBe("2026-07-29T10:30:00.000Z");
    expect(parseDate("29/07/2026 12:30:00", "UTC").timestamp).toBe("2026-07-29T12:30:00.000Z");
    expect(() => parseDate("25/10/2026 02:30:00", "Europe/Paris")).toThrow(/ambigu/);
    expect(() => parseDate("29/03/2026 02:30:00", "Europe/Paris")).toThrow();
    expect(() => parseDate("2026-02-30T12:00:00Z", "UTC")).toThrow();
  });
  it("reconciles the exact declared PEA controls without forcing the -5.58 EUR balance to zero", () => {
    const events = [event({ type: "deposit", amount: 1515 }), event({ type: "dividend", amount: 4.10 }), event({ type: "buy", isin: "FR0011550185", quantity: 1, executionPrice: 1523.56, amount: 1523.56 }), event({ type: "tax", amount: 1.12 })];
    const summary = cashSummary(events, "pea")[0]; expect(summary?.balance).toBeCloseTo(-5.58, 8);
    expect(summary?.deposit).toBe(RECONCILIATION.pea.deposit); expect(summary?.dividend).toBe(4.1); expect(summary?.buy).toBe(1523.56); expect(summary?.taxes).toBe(1.12);
  });
  it("reconciles the exact declared CTO controls: 558 - 548.30 - 8 = 1.70 EUR", () => {
    const events = [event({ accountId: "cto", type: "deposit", amount: 558 }), event({ accountId: "cto", type: "buy", isin: "US29082A1079", quantity: 1, executionPrice: 548.30, amount: 548.30 }), event({ accountId: "cto", type: "fee", amount: 8 })];
    const summary = cashSummary(events, "cto")[0]; expect(summary?.balance).toBeCloseTo(1.70, 8); expect(summary?.deposit).toBe(558); expect(summary?.buy).toBe(548.30); expect(summary?.fees).toBe(8);
  });
  it("tracks transfers without counting them as external deposits and separates foreign cash currencies", () => {
    const events = [event({ type: "transfer_out", transferId: "t", amount: 10 }), event({ accountId: "cto", type: "transfer_in", transferId: "t", amount: 10 }), event({ accountId: "cto", type: "deposit", currency: "USD", fxRate: 0.9, amount: 5 })];
    expect(cashSummary(events, "pea")[0]?.deposit).toBe(0); expect(cashSummary(events, "cto")).toHaveLength(2);
    expect(cashSummary(events, "pea")[0]?.balance).toBe(-10); expect(cashSummary(events, "cto")[0]?.balance).toBe(10);
  });
  it("rejects unknown operations, missing amounts/FX, and flags net/gross ambiguity", () => {
    expect(preview("12/01/2026;;Virement;;;;10;;;;EUR;;;").counts.review).toBe(1);
    expect(preview("12/01/2026;;Versement;;;;;;;;EUR;;;").accepted).toHaveLength(0);
    expect(preview("29/07/2026;;Achat;US29082A1079;1;20;20;;;;USD;;;", { accountId: "cto", broker: "trade-republic" }).counts.review).toBe(1);
    expect(preview("12/01/2026;;Achat;FR0011550185;1;20;20;;;;EUR;;;", { amountBasis: "unknown" }).counts.review).toBe(1);
  });
  it("supports net amounts without double subtracting the separate charges", () => {
    const r = preview("12/01/2026;;Achat;FR0011550185;1;20;21;1;;;EUR;;;", { amountBasis: "net" });
    expect(r.accepted[0]?.amount).toBe(20); expect(r.cash[0]?.balance).toBe(-21);
  });
  it("preserves all input portfolio/wealth/ledger state while recomputing a preview", () => {
    const before = JSON.stringify({ portfolio, wealth }); preview("12/01/2026;;Versement;;;;10;;;;EUR;;;");
    expect(JSON.stringify({ portfolio, wealth })).toBe(before);
  });
  it("rejects oversize CSV and formula cells", () => {
    expect(() => parseCsv("a".repeat(5 * 1024 * 1024 + 1))).toThrow(/volumineux/);
    const sheet: ImportSheet = { name: "Formula", grid: [[{ value: "Date", text: "Date" }, { value: "Opération", text: "Opération" }, { value: "Montant", text: "Montant" }], [{ value: "12/01/2026", text: "12/01/2026" }, { value: "Versement", text: "Versement" }, { value: 10, text: "10", formula: true }]] };
    const r = previewHistory(sheet, { accountId: "pea", broker: "fortuneo", file: "test", headerRow: 1, mapping: detectMapping(sheet.grid[0] ?? []), decimal: "comma", timezone: "Europe/Paris", currency: "EUR", amountBasis: "gross", importedAt: at, overrides: {} }, portfolio, wealth, emptyLedger()); expect(r.counts.review).toBe(1);
  });
  it("normalizes numeric conventions strictly and keeps economic duplicate keys independent of file names", () => {
    expect(parseNumber("1.234,56 €", "comma")).toBe(1234.56); expect(parseNumber("1,234.56", "dot")).toBe(1234.56); expect(() => parseNumber("abc", "comma")).toThrow();
    const e = event({ amount: 10 }); expect(eventKey({ ...e, source: { ...e.source, file: "other.csv", row: 50 } })).toBe(eventKey(e));
  });
});