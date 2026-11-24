import { describe, expect, it } from "vitest";
import { planConsolidatedImport } from "./history-commit";
import { emptyLedger } from "./ledger";
describe("Consolidated import gate", () => {
  it("blocks the write when the usual browser is not confirmed or the file is not the consolidated workbook", () => {
    const review = { rows: [], references: [], quantities: [] } as never;
    const plan = planConsolidatedImport(review, [], emptyLedger(), false);
    expect(plan.ok).toBe(false);
    expect(plan.checks.find(c => c.label === "Navigateur habituel confirmé")?.ok).toBe(false);
  });
});
