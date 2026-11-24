import { describe, expect, it } from "vitest";
import { parseCsv, detectMapping, previewHistory } from "./history-import";
import { auditSourceSheet, bankDefaults } from "./history-source-audit";
import { initialPortfolio } from "./portfolio";
import { initialWealth } from "./wealth";
import { emptyLedger } from "./ledger";

describe("Bank-specific source audit, synthetic records only", () => {
  it("recognizes Fortuneo labels and debit/credit columns without inventing ISIN or execution price", () => {
    const sheet = parseCsv("Date opération;Date valeur;libellé;Débit;Crédit\n28/02/2026;27/02/2026;achat 2 bnpetf stoxx 600;-41,20;\n28/02/2026;27/02/2026;taxe transac finan;-0,27;\n29/01/2026;29/01/2026;versement;;100")[0]; if (!sheet) throw new Error("fixture");
    const audit = auditSourceSheet(sheet); expect(audit.types).toEqual({ buy: 1, tax: 1, deposit: 1 }); expect(audit.earlierValueDate).toBe(2); expect(audit.buy).toBe(41.2); expect(audit.balance).toBeCloseTo(58.53, 8);
    const preview = previewHistory(sheet, { accountId: "pea", broker: "fortuneo", file: "synthetic.csv", headerRow: 1, mapping: detectMapping(sheet.grid[0] ?? []), decimal: "comma", timezone: "Europe/Paris", currency: "EUR", amountBasis: "gross", importedAt: "2026-11-24T12:00:00Z", overrides: {}, missingCurrencyConfirmed: true }, initialPortfolio(), initialWealth(), emptyLedger());
    expect(preview.rows[0]?.facts).toMatchObject({ quantity: 2, executionPrice: null, isin: null, amount: 41.2, operationDate: "2026-02-28", settlementDate: "2026-02-27" }); expect(preview.rows[0]?.status).toBe("review");
  });
  it("preserves Trade Republic microsecond UTC text and requires explicit external-transfer qualification", () => {
    const sheet = parseCsv("datetime;date;account_type;category;type;name;symbol;shares;price;amount;fee;currency\n2026-08-15T12:34:56.123456Z;2026-08-15;DEFAULT;CASH;TRANSFER_INSTANT_INBOUND;;;;;60;;EUR")[0]; if (!sheet) throw new Error("fixture");
    expect(bankDefaults(sheet).timezone).toBe("UTC");
    const opts = { accountId: "cto" as const, broker: "trade-republic" as const, file: "test.csv", headerRow: 1, mapping: detectMapping(sheet.grid[0] ?? []), decimal: "comma" as const, timezone: "UTC" as const, currency: "EUR", amountBasis: "gross" as const, importedAt: "2026-11-24T12:00:00Z", overrides: {} };
    expect(previewHistory(sheet, opts, initialPortfolio(), initialWealth(), emptyLedger()).accepted).toHaveLength(0);
    const p = previewHistory(sheet, { ...opts, inboundExternalConfirmed: true }, initialPortfolio(), initialWealth(), emptyLedger());
    expect(p.accepted[0]?.timestamp).toBe("2026-08-15T12:34:56.123456Z"); expect(p.accepted[0]?.type).toBe("deposit"); expect(p.accepted[0]?.source.originalColumns?.[0]?.value).toBe("2026-08-15T12:34:56.123456Z");
  });
  it("keeps a split with missing ratio under review and never counts it as a purchase", () => {
    const sheet = parseCsv("datetime;date;account_type;type;symbol;shares;amount;fee;currency\n2026-11-16T08:30:00.123Z;2026-11-16;DEFAULT;SPLIT;US29082A1079;3;;;")[0]; if (!sheet) throw new Error("fixture");
    const audit = auditSourceSheet(sheet); expect(audit.types).toEqual({ split: 1 }); expect(audit.buy).toBe(0); expect(audit.deposit).toBe(0); expect(audit.balance).toBe(0);
  });
});