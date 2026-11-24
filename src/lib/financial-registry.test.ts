import { describe, it, expect } from "vitest";
import { initialPortfolio, PORTFOLIO_KEY, exportBackup } from "./portfolio";
import { initialWealth, WEALTH_KEY, analyse, recommendations, simulateContribution } from "./wealth";
import { applyMarket } from "./market-merge";
import { readCompleteBackup, parseRestoration, restoreBackup } from "./backup-restoration";
import { snapshot, DATA_KEYS, SAFETY_KEY, recoverLocalTransaction, JOURNAL_KEY } from "./local-transaction";
import { emptyRegistry, REGISTRY_KEY, saveAccount, saveInstrument, appendValuation, latestValuation, effectiveValuations, registryTotal, registryHistory, validateRegistry, visibleAccounts, visibleInstruments, valuationFromQuote, type FinancialAccount, type FinancialInstrument, type Valuation } from "./financial-registry";
import { writeRegistry } from "./financial-storage";
import { buildMoves, reconstruct } from "./performance";
import { emptyLedger, LEDGER_KEY, eventSchema } from "./ledger";

const now = "2026-11-24T17:00:00.000Z";
const account: FinancialAccount = { id: "new-av", legacyId: null, name: "Linxea Spirit 2", type: "assurance", institution: "Linxea", currency: "EUR", openedAt: "2026-11-01", mode: "manual", active: true, targetAccountId: "av" };
const instrument: FinancialInstrument = { id: "new-fund", legacyRef: null, accountId: account.id, name: "Fonds euros renseigné", isin: "", ticker: "", exchange: "", currency: "EUR", type: "euro", mode: "manual", active: true, classId: "bonds", quantity: 0 };
const value = (id: string, date: string, amount: number, patch: Partial<Valuation> = {}): Valuation => ({ id, accountId: account.id, instrumentId: instrument.id, date, value: amount, at: now, comment: "Réel", supersedes: null, origin: "manual", externalFlow: null, quote: null, ...patch });
const configured = () => saveInstrument(saveAccount(emptyRegistry(), account), instrument);
const p = () => { const x = initialPortfolio(); x.positions = x.positions.map(i => ({ ...i, quantity: 2, price: 30, priceDate: "2026-11-23", target: 25 })); return x; };
function store() {
  const entries = new Map<string, string>([[PORTFOLIO_KEY, JSON.stringify(p())], [WEALTH_KEY, JSON.stringify(initialWealth())], [LEDGER_KEY, JSON.stringify(emptyLedger())]]);
  return { entries, getItem: (k: string) => entries.get(k) ?? null, setItem: (k: string, v: string) => { entries.set(k, v); }, removeItem: (k: string) => { entries.delete(k); } };
}
describe("Dynamic financial management without altering frozen portfolio", () => {
  it("creates no future insurance account or fictitious asset on initial read; keeps its 10% target", () => {
    const w = initialWealth(); expect(visibleAccounts(emptyRegistry(), w).map(a => a.id)).toEqual(["pea", "cto"]);
    expect(w.accounts.find(a => a.id === "av")?.target).toBe(10); expect(registryTotal(emptyRegistry(), w, "2026-11-24")).toBe(0);
  });
  it("creates an assurance-vie account and all six financial account types, without targets recalculating", () => {
    const w = initialWealth();
    for (const type of ["pea", "cto", "assurance", "per", "cash", "other"] as const) {
      const r = validateRegistry(saveAccount(emptyRegistry(), { ...account, type }), p(), w);
      expect(r.accounts[0]?.type).toBe(type); expect(registryTotal(r, w, "2026-11-24")).toBe(0);
    }
    expect(w.accounts.map(a => a.target)).toEqual([75, 15, 10]);
  });
  it("accepts an instrument with ISIN and ticker without inventing a price", () => {
    const i = { ...instrument, type: "stock" as const, isin: "FR0000120271", ticker: "TTE", exchange: "Euronext Paris", mode: "auto" as const, quantity: 2 };
    const r = validateRegistry(saveInstrument(saveAccount(emptyRegistry(), account), i), p(), initialWealth());
    expect(r.instruments[0]?.ticker).toBe("TTE"); expect(latestValuation(r, i.id, "2026-11-24")).toBeNull();
  });
  it("accepts an instrument without ticker/ISIN and a real manual value only at its effective date", () => {
    const r = appendValuation(configured(), value("v1", "2026-11-01", 100), now);
    expect(r.instruments[0]?.isin).toBe(""); expect(r.instruments[0]?.ticker).toBe("");
    expect(registryTotal(r, initialWealth(), "2026-10-31")).toBe(0); expect(registryTotal(r, initialWealth(), "2026-11-01")).toBe(100);
  });
  it("appends later values and corrections, keeping every old valuation", () => {
    let r = appendValuation(configured(), value("v1", "2026-11-01", 100), now);
    r = appendValuation(r, value("v2", "2026-11-10", 110), now);
    r = appendValuation(r, value("v3", "2026-11-10", 112, { supersedes: "v2" }), now);
    expect(r.valuations.map(v => v.value)).toEqual([100, 110, 112]); expect(effectiveValuations(r).map(v => v.id)).toEqual(["v1", "v3"]);
    expect(latestValuation(r, instrument.id, "2026-11-09")?.value).toBe(100); expect(latestValuation(r, instrument.id, "2026-11-10")?.value).toBe(112);
  });
  it("updates account metadata without changing any legacy account", () => {
    const w = initialWealth(); const before = JSON.stringify(w);
    const legacy = visibleAccounts(emptyRegistry(), w).find(a => a.id === "pea"); if (!legacy) throw new Error("fixture");
    const r = validateRegistry(saveAccount(emptyRegistry(), { ...legacy, institution: "Fortuneo" }), p(), w);
    expect(visibleAccounts(r, w).find(a => a.id === "pea")?.institution).toBe("Fortuneo"); expect(JSON.stringify(w)).toBe(before);
  });
  it("deactivates and reactivates an account without losing its history", () => {
    const r = appendValuation(configured(), value("v1", "2026-11-01", 100), now);
    const off = saveAccount(r, { ...account, active: false }); expect(off.valuations).toEqual(r.valuations); expect(off.instruments).toEqual(r.instruments);
    expect(registryTotal(off, initialWealth(), "2026-11-24")).toBe(0); expect(registryHistory(off, account.id)[0]?.value).toBe(100);
    expect(registryTotal(saveAccount(off, account), initialWealth(), "2026-11-24")).toBe(100);
  });
  it("deactivates an instrument without losing its historical values", () => {
    const r = appendValuation(configured(), value("v1", "2026-11-01", 100), now);
    const off = saveInstrument(r, { ...instrument, active: false }); expect(off.valuations).toEqual(r.valuations); expect(registryHistory(off, account.id)[0]?.value).toBe(100);
    expect(registryTotal(off, initialWealth(), "2026-11-24")).toBe(0);
  });
  it("keeps the financial gold ETC identity and prevents duplicate existing instruments", () => {
    const w = initialWealth(); const gold = visibleInstruments(emptyRegistry(), p(), w).find(i => i.isin === "IE00B4ND3602");
    expect(gold?.type).toBe("etc");
    expect(() => validateRegistry(saveInstrument(emptyRegistry(), { ...instrument, accountId: "cto", isin: "IE00B4ND3602" }), p(), w)).toThrow(/déjà présent/);
    const etf = visibleInstruments(emptyRegistry(), p(), w)[0]; if (!etf) throw new Error("fixture");
    expect(() => validateRegistry(saveInstrument(emptyRegistry(), { ...etf, quantity: 99 }), p(), w)).toThrow(/protégées/);
    expect(validateRegistry(saveInstrument(emptyRegistry(), { ...etf, active: false }), p(), w).instruments[0]?.active).toBe(false);
  });
  it("does not treat value changes as deposits; documented external deposits are neutralised", () => {
    const r = appendValuation(configured(), value("v1", "2026-11-01", 100), now);
    const unknown = appendValuation(r, value("v2", "2026-11-02", 110), now);
    expect(registryHistory(unknown, account.id)[1]?.flow).toBeNull(); expect(registryHistory(unknown, account.id)[1]?.performance).toBeNull();
    const gain = appendValuation(r, value("v2", "2026-11-02", 110, { externalFlow: 0 }), now);
    expect(registryHistory(gain, account.id)[1]?.performance).toBeCloseTo(10);
    const deposit = appendValuation(r, value("v2", "2026-11-02", 150, { externalFlow: 50 }), now);
    expect(registryHistory(deposit, account.id)[1]?.performance).toBe(0);
  });
  it("uses real verified automatic quotes and rejects unknown currency/identity", () => {
    const i = { ...instrument, mode: "auto" as const, quantity: 2, isin: "FR0000120271" };
    const result = { id: i.id, error: null, quote: { price: 60, currency: "EUR", timestamp: now }, resolution: { status: "verified" as const, provider: "yahoo" as const, symbol: "TTE.PA", verified: { name: "TotalEnergies", isin: i.isin, ticker: "TTE", exchange: "Euronext Paris", currency: "EUR" }, corrections: [], candidates: [], issues: [] } };
    const v = valuationFromQuote(i, result, null, now, "q1"); expect(v.value).toBe(120); expect(v.externalFlow).toBeNull();
    expect(() => valuationFromQuote(i, { ...result, quote: null }, null, now, "q2")).toThrow();
    expect(() => valuationFromQuote(i, { ...result, resolution: { ...result.resolution, verified: { ...result.resolution.verified, currency: "USD" } } }, null, now, "q2")).toThrow(/devise/);
  });
  it("round trips registry, revisions and inactive state through complete backup/restoration", () => {
    const s = store(); const r = saveAccount(appendValuation(configured(), value("v1", "2026-11-01", 100), now), { ...account, active: false });
    s.setItem(REGISTRY_KEY, JSON.stringify(r)); const exported = readCompleteBackup(s); expect(exported.backup.financialRegistry).toEqual(r);
    s.setItem(REGISTRY_KEY, JSON.stringify(emptyRegistry())); restoreBackup(s, parseRestoration(exported.content)); expect(JSON.parse(s.getItem(REGISTRY_KEY) ?? "")).toEqual(r);
  });
  it("preserves the registry when restoring old complete v2/v1 and ETF backups without its section", () => {
    const s = store(); const old = readCompleteBackup(s); s.setItem(REGISTRY_KEY, JSON.stringify(configured()));
    restoreBackup(s, parseRestoration(old.content)); expect(JSON.parse(s.getItem(REGISTRY_KEY) ?? "")).toEqual(configured());
    const { ledger, financialRegistry, snapshots, ...base } = old.backup;
    restoreBackup(s, parseRestoration(JSON.stringify({ ...base, version: 1 }))); expect(JSON.parse(s.getItem(REGISTRY_KEY) ?? "")).toEqual(configured());
    restoreBackup(s, parseRestoration(exportBackup(p(), []))); expect(JSON.parse(s.getItem(REGISTRY_KEY) ?? "")).toEqual(configured());
  });
  it("requires the downloaded backup before registry writes and preserves all old keys/calculations", () => {
    const s = store(); const before = snapshot(s); const portfolio = p(), wealth = initialWealth();
    const a = analyse(portfolio, wealth), rec = recommendations(a), sim = simulateContribution(portfolio, wealth, 500, "pea");
    const events = [eventSchema.parse({ id: "cash-test", accountId: "pea", type: "deposit", operationDate: "2026-11-23", settlementDate: null, timestamp: null, isin: null, instrumentId: null, instrumentName: "", quantity: null, executionPrice: null, amount: 100, fees: 0, taxes: 0, withholding: 0, currency: "EUR", fxRate: 1, splitRatio: null, transferId: null, source: { broker: "fortuneo", file: "test", sheet: "test", row: 1, reference: "test", importedAt: now } })];
    const curve = reconstruct(buildMoves(events, portfolio).moves, new Map(), "2026-11-24"); const quote = applyMarket(wealth, [], null, null, now);
    expect(curve.pea.at(-1)?.cash).toBe(100); expect(curve.cto.at(-1)?.value).toBe(0);
    let downloaded = false;
    writeRegistry(s, () => appendValuation(configured(), value("v1", "2026-11-01", 100), now), before, (content) => { expect(() => parseRestoration(content)).not.toThrow(); expect(s.getItem(REGISTRY_KEY)).toBeNull(); downloaded = true; });
    expect(downloaded).toBe(true); expect(s.getItem(SAFETY_KEY)).not.toBeNull();
    for (const key of DATA_KEYS.filter(k => k !== REGISTRY_KEY)) expect(s.getItem(key)).toBe(before[key]);
    expect(analyse(portfolio, wealth)).toEqual(a); expect(recommendations(analyse(portfolio, wealth))).toEqual(rec);
    expect(simulateContribution(portfolio, wealth, 500, "pea")).toEqual(sim); expect(reconstruct(buildMoves(events, portfolio).moves, new Map(), "2026-11-24")).toEqual(curve); expect(applyMarket(wealth, [], null, null, now)).toEqual(quote);
    expect(wealth.accounts.map(a => a.target)).toEqual([75, 15, 10]); expect(wealth.classes.map(c => c.target)).toEqual([70, 15, 10, 5]);
  });
  it("refuses stale changes, future dates, invalid identities and duplicate dates", () => {
    const s = store(); const before = snapshot(s); s.setItem("equilibre.theme.v1", "dark");
    expect(() => writeRegistry(s, () => configured(), before, () => {})).toThrow(/changé/);
    expect(() => appendValuation(configured(), value("v1", "2026-11-25", 10), now)).toThrow(/future/);
    const r = appendValuation(configured(), value("v1", "2026-11-01", 10), now);
    expect(() => appendValuation(r, value("v2", "2026-11-01", 11), now)).toThrow(/existe/);
    expect(() => validateRegistry({ ...configured(), instruments: [{ ...instrument, accountId: "absent" }] }, p(), initialWealth())).toThrow(/compte inconnu/);
  });
  it("recovers legacy journals without deleting newer independent keys", () => {
    const s = store(); const before = snapshot(s); delete before[REGISTRY_KEY]; delete before["equilibre.snapshots.v1"];
    s.setItem(REGISTRY_KEY, JSON.stringify(configured())); s.setItem(JOURNAL_KEY, JSON.stringify({ version: 1, phase: "prepared", before }));
    recoverLocalTransaction(s); expect(JSON.parse(s.getItem(REGISTRY_KEY) ?? "")).toEqual(configured());
  });
  it("blocks destructive valuation overwrites and account/instrument deletion at the write boundary", () => {
    const s = store(); const r = appendValuation(configured(), value("v1", "2026-11-01", 100), now); s.setItem(REGISTRY_KEY, JSON.stringify(r));
    const before = snapshot(s);
    expect(() => writeRegistry(s, current => ({ ...current, valuations: [] }), before, () => {})).toThrow(/écrasées/);
    expect(() => writeRegistry(s, current => ({ ...current, accounts: [] }), before, () => {})).toThrow();
    expect(() => writeRegistry(s, current => ({ ...current, instruments: [] }), before, () => {})).toThrow();
    expect(snapshot(s)).toEqual(before);
  });
});