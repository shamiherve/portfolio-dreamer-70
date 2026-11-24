import { describe, expect, it } from "vitest";
import { generateFullBackup } from "./full-backup";
import { initialPortfolio, PORTFOLIO_KEY, SIMULATIONS_KEY, exportBackup } from "./portfolio";
import { initialWealth, WEALTH_KEY } from "./wealth";
import { LEDGER_KEY, emptyLedger, eventSchema } from "./ledger";
import { appendLedger, generateCompleteBackup, parseRestoration, readCompleteBackup, restoreBackup, snapshot } from "./backup-restoration";
import { DATA_KEYS, JOURNAL_KEY, SAFETY_KEY, recoverLocalTransaction, type LocalStorageAccess } from "./local-transaction";

const at = "2026-11-24T12:00:00.000Z";
function fixture() {
  const portfolio = initialPortfolio(); portfolio.positions = portfolio.positions.map(p => ({ ...p, quantity: 2, price: 30, priceDate: "2026-11-23" })); portfolio.budget = 50;
  portfolio.quoteHistory = [{ isin: "FR0011550185", price: 30, currency: "EUR", tradeTimestamp: at, updateTimestamp: at }];
  const wealth = initialWealth(); wealth.holdings = wealth.holdings.map(h => h.kind === "quantity" ? { ...h, quantity: 1.5, price: 80, priceDate: "2026-11-23" } : { ...h, value: 100, priceDate: "2026-11-23" });
  const base = generateFullBackup({ portfolio, wealth, simulations: [], theme: "dark" }, at).backup;
  const ledger = emptyLedger(); ledger.events.push(eventSchema.parse({ id: "event-test", accountId: "pea", type: "deposit", operationDate: "2026-01-01", settlementDate: "2026-01-02", timestamp: null, isin: null, instrumentId: null, instrumentName: "", quantity: null, executionPrice: null, amount: 10, fees: 0, taxes: 0, withholding: 0, currency: "EUR", fxRate: 1, splitRatio: null, transferId: null, source: { broker: "fortuneo", file: "synthetic.csv", sheet: "CSV", row: 2, reference: "test", importedAt: at } }));
  return { base, ledger };
}
function store(): LocalStorageAccess & { entries: Map<string, string>; failAt: string | null; permanentFailure: boolean; writes: string[] } {
  const entries = new Map<string, string>(); const f = fixture();
  entries.set(PORTFOLIO_KEY, JSON.stringify(f.base.portfolio)); entries.set(WEALTH_KEY, JSON.stringify(f.base.wealth)); entries.set(SIMULATIONS_KEY, JSON.stringify(f.base.simulations)); entries.set("equilibre.theme.v1", "dark"); entries.set(LEDGER_KEY, JSON.stringify(f.ledger));
  return { entries, failAt: null, permanentFailure: false, writes: [], getItem(key) { return entries.get(key) ?? null; }, setItem(key, value) { this.writes.push(key); if (this.failAt === key) { if (!this.permanentFailure) this.failAt = null; throw new Error("simulated quota"); } entries.set(key, value); }, removeItem(key) { entries.delete(key); } };
}
describe("Full restoration with safety and rollback", () => {
  it("round trips v2 including every existing patrimonial ensemble and independent ledger", () => {
    const { base, ledger } = fixture(); const result = generateCompleteBackup(base, ledger);
    const parsed = parseRestoration(result.content); expect(parsed.kind).toBe("complete-v2"); expect(parsed.backup).toEqual({ ...base, version: 2, ledger });
  });
  it("replaces all five keys only after validation, retaining a readable pre-restore safety backup", () => {
    const s = store(); const before = snapshot(s); const { base } = fixture(); base.portfolio.budget = 999; base.theme = "light";
    const target = generateCompleteBackup(base, emptyLedger());
    restoreBackup(s, parseRestoration(target.content), before);
    expect(JSON.parse(s.getItem(PORTFOLIO_KEY) ?? "null").budget).toBe(999); expect(s.getItem("equilibre.theme.v1")).toBe("light"); expect(JSON.parse(s.getItem(LEDGER_KEY) ?? "null").events).toEqual([]);
    const safety = parseRestoration(s.getItem(SAFETY_KEY) ?? ""); expect(safety.backup.portfolio.budget).toBe(50); expect(s.getItem(JOURNAL_KEY)).toBeNull();
    expect(s.writes[0]).toBe(SAFETY_KEY); expect(s.writes[1]).toBe(JOURNAL_KEY);
  });
  it.each(DATA_KEYS)("fully rolls back after a write error on %s", failedKey => {
    const s = store(); const before = snapshot(s); const { base } = fixture(); base.portfolio.budget = 999; base.theme = null;
    const target = generateCompleteBackup(base, emptyLedger());
    if (failedKey === "equilibre.theme.v1") base.theme = "light";
    const actual = generateCompleteBackup(base, emptyLedger()); s.failAt = failedKey;
    expect(() => restoreBackup(s, parseRestoration(actual.content), before)).toThrow(/retour intégral/);
    expect(snapshot(s)).toEqual(before); expect(s.getItem(JOURNAL_KEY)).toBeNull(); expect(() => parseRestoration(s.getItem(SAFETY_KEY) ?? "")).not.toThrow();
  });
  it("does not change any data if writing the safety copy fails", () => {
    const s = store(); const before = snapshot(s); s.failAt = SAFETY_KEY;
    expect(() => restoreBackup(s, parseRestoration(readCompleteBackup(s).content))).toThrow(); expect(snapshot(s)).toEqual(before); expect(s.getItem(JOURNAL_KEY)).toBeNull();
  });
  it("rejects versions, incomplete files, unknown fields and invalid ledger/account references before writing", () => {
    const s = store(); const before = snapshot(s); const good = JSON.parse(readCompleteBackup(s).content);
    const badFiles = [{ ...good, version: 3 }, { ...good, ledger: undefined }, { ...good, secret: "not-allowed" }, { ...good, ledger: { ...good.ledger, events: [{ ...good.ledger.events[0], accountId: "missing" }] } }, { ...good, wealth: null }];
    for (const b of badFiles) expect(() => restoreBackup(s, parseRestoration(JSON.stringify(b)))).toThrow();
    expect(snapshot(s)).toEqual(before); expect(s.writes).toEqual([]);
  });
  it("keeps v1 complete and legacy ETF files compatible with explicit non-destructive missing-ledger scope", () => {
    const s = store(); const oldLedger = s.getItem(LEDGER_KEY); const { base } = fixture(); base.portfolio.budget = 321;
    restoreBackup(s, parseRestoration(JSON.stringify(base))); expect(s.getItem(LEDGER_KEY)).toBe(oldLedger);
    const wealth = s.getItem(WEALTH_KEY); const theme = s.getItem("equilibre.theme.v1");
    restoreBackup(s, parseRestoration(exportBackup(initialPortfolio(), [])));
    expect(s.getItem(WEALTH_KEY)).toBe(wealth); expect(s.getItem(LEDGER_KEY)).toBe(oldLedger); expect(s.getItem("equilibre.theme.v1")).toBe(theme);
  });
  it("rejects unknown fields in old ETF files, not silently dropping them", () => {
    const raw = JSON.parse(exportBackup(initialPortfolio(), [])); raw.portfolio.positions[0].futureField = 1;
    expect(() => parseRestoration(JSON.stringify(raw))).toThrow(/Champ inconnu/);
  });
  it("recovers an interrupted partial restoration before hydration, preserving exact raw strings and absent keys", () => {
    const s = store(); s.removeItem(LEDGER_KEY); const before = snapshot(s);
    s.setItem(JOURNAL_KEY, JSON.stringify({ version: 1, phase: "prepared", before })); s.setItem(PORTFOLIO_KEY, "partial"); s.setItem(LEDGER_KEY, "partial");
    recoverLocalTransaction(s); expect(snapshot(s)).toEqual(before); expect(s.getItem(JOURNAL_KEY)).toBeNull();
  });
  it("retains a rollback journal when storage stays unavailable, then recovers on retry", () => {
    const s = store(); const before = snapshot(s); s.setItem(JOURNAL_KEY, JSON.stringify({ version: 1, phase: "prepared", before })); s.setItem(PORTFOLIO_KEY, "partial"); s.failAt = PORTFOLIO_KEY; s.permanentFailure = true;
    expect(() => recoverLocalTransaction(s)).toThrow(/bloquées/); expect(s.getItem(JOURNAL_KEY)).not.toBeNull();
    s.failAt = null; recoverLocalTransaction(s); expect(snapshot(s)).toEqual(before);
  });
  it("does not revert a committed journal on next load", () => {
    const s = store(); const before = snapshot(s); s.setItem(PORTFOLIO_KEY, "committed"); s.setItem(JOURNAL_KEY, JSON.stringify({ version: 1, phase: "committed", before }));
    recoverLocalTransaction(s); expect(s.getItem(PORTFOLIO_KEY)).toBe("committed"); expect(s.getItem(JOURNAL_KEY)).toBeNull();
  });
  it("refuses stale previews instead of overwriting a later holdings edit", () => {
    const s = store(); const before = snapshot(s); const pending = parseRestoration(readCompleteBackup(s).content); s.setItem("equilibre.theme.v1", "light");
    expect(() => restoreBackup(s, pending, before)).toThrow(/ont changé/); expect(s.getItem("equilibre.theme.v1")).toBe("light");
  });
  it("writes only the ledger for a confirmed import, preserving all positions, quantities, allocations and quote metadata", () => {
    const s = store(); const before = snapshot(s); const ledger = readCompleteBackup(s).backup.ledger; const first = ledger.events[0]; if (!first) throw new Error("fixture");
    const next = { ...ledger, events: [...ledger.events, { ...first, id: "new-event", amount: 20, source: { ...first.source, reference: "other" } }], updatedAt: at };
    appendLedger(s, next, before);
    for (const key of DATA_KEYS.filter(k => k !== LEDGER_KEY)) expect(s.getItem(key)).toBe(before[key]);
    expect(JSON.parse(s.getItem(LEDGER_KEY) ?? "null").events).toHaveLength(2);
  });
  it("rejects duplicate or destructive appends", () => {
    const s = store(); const ledger = readCompleteBackup(s).backup.ledger; const first = ledger.events[0]; if (!first) throw new Error("fixture");
    expect(() => appendLedger(s, { ...ledger, events: [...ledger.events, { ...first, id: "duplicate" }] }, snapshot(s))).toThrow(/Doublons/);
    expect(() => appendLedger(s, emptyLedger(), snapshot(s))).toThrow(/supprimé/);
  });
  it("rechecks actual local ETF transactions immediately before any append, including an unavailable execution price", () => {
    const s = store(); const p = fixture().base.portfolio;
    p.transactions = [{ id: "local-etf", positionId: "sp500", name: "ETF", type: "buy", quantity: 2, price: 30, date: "2026-02-01" }];
    s.entries.set(PORTFOLIO_KEY, JSON.stringify(p)); const before = snapshot(s); const ledger = readCompleteBackup(s).backup.ledger; const first = ledger.events[0]; if (!first) throw new Error("fixture");
    const buy = { ...first, id: "new-buy", type: "buy" as const, operationDate: "2026-02-01", settlementDate: null, isin: "FR0011550185", instrumentId: "etf:sp500", quantity: 2, executionPrice: null, amount: 60, source: { ...first.source, reference: "" } };
    expect(() => appendLedger(s, { ...ledger, events: [...ledger.events, buy] }, before)).toThrow(/ETF déjà/); expect(snapshot(s)).toEqual(before); expect(s.writes).toEqual([]);
  });
  it("refuses a new unknown PEA instrument at the write boundary without altering any key", () => {
    const s = store(); const before = snapshot(s); const ledger = readCompleteBackup(s).backup.ledger; const first = ledger.events[0]; if (!first) throw new Error("fixture");
    const buy = { ...first, id: "unknown-buy", type: "buy" as const, isin: "FR0000120321", instrumentId: null, quantity: 1, executionPrice: null, amount: 20, source: { ...first.source, reference: "" } };
    expect(() => appendLedger(s, { ...ledger, events: [...ledger.events, buy] }, before)).toThrow(/référentiel/); expect(snapshot(s)).toEqual(before); expect(s.writes).toEqual([]);
  });
});