import { describe, expect, it } from "vitest";
import { generateFullBackup } from "./full-backup";
import { initialPortfolio, PORTFOLIO_KEY, SIMULATIONS_KEY } from "./portfolio";
import { initialWealth, WEALTH_KEY } from "./wealth";
import { LEDGER_KEY, emptyLedger, eventSchema, readLedger, cashSummary } from "./ledger";
import { snapshot } from "./backup-restoration";
import { SAFETY_KEY, type LocalStorageAccess } from "./local-transaction";
import { buildMoves, SNAPSHOTS_KEY, finalQuantities } from "./performance";
import { buildDraft, emptyInput, writeManualChange, type ManualInput } from "./manual-entry";

const now = "2026-11-24T12:00:00.000Z";
const portfolio = initialPortfolio(); portfolio.transactions = [];
const wealth = initialWealth();
const etf = portfolio.positions[0]!;
const instrumentId = `etf:${etf.id}`;
const imported = eventSchema.parse({ id: "imp-1", accountId: "pea", type: "deposit", operationDate: "2026-01-05", settlementDate: null, timestamp: null, isin: null, instrumentId: null, instrumentName: "", quantity: null, executionPrice: null, amount: 1000, fees: 0, taxes: 0, withholding: 0, currency: "EUR", fxRate: 1, splitRatio: null, transferId: null, source: { broker: "fortuneo", file: "f.xlsx", sheet: "PEA", row: 2, reference: "r1", importedAt: now } });
function store() {
  const m = new Map<string, string>(); const base = generateFullBackup({ portfolio, wealth, simulations: [], theme: null }, now).backup;
  m.set(PORTFOLIO_KEY, JSON.stringify(base.portfolio)); m.set(WEALTH_KEY, JSON.stringify(base.wealth)); m.set(SIMULATIONS_KEY, "[]");
  const l = emptyLedger(); l.events.push(imported); m.set(LEDGER_KEY, JSON.stringify(l));
  const s: LocalStorageAccess = { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
  return s;
}
const input = (p: Partial<ManualInput>): ManualInput => ({ ...emptyInput(), ...p });
let n = 0;
function add(s: LocalStorageAccess, p: Partial<ManualInput>) {
  const d = buildDraft(input(p), { portfolio, wealth, events: readLedger(s).events, id: `m-${++n}`, now });
  if (!d.event) throw new Error(d.errors.join(" | "));
  writeManualChange(s, { add: d.event }, snapshot(s)); return d;
}
const pea = (s: LocalStorageAccess) => cashSummary(readLedger(s).events, "pea")[0]!.balance;
const qty = (s: LocalStorageAccess) => finalQuantities(buildMoves(readLedger(s).events, portfolio).moves).get(`pea|${etf.isin}`) ?? 0;

describe("Saisie manuelle dans le grand livre unique", () => {
  it("versement : +espèces, apport externe neutralisé, provenance manuelle", () => {
    const s = store(); add(s, { type: "deposit", date: "2026-02-01", gross: "200", net: "200" });
    expect(pea(s)).toBe(1200); const e = readLedger(s).events.at(-1)!; expect(e.source.origin).toBe("manual");
    expect(buildMoves(readLedger(s).events, portfolio).moves.at(-1)!.external).toBe(200);
    expect(s.getItem(SAFETY_KEY)).not.toBeNull();
  });
  it("achat : espèces → titres, frais déduits une seule fois", () => {
    const s = store(); add(s, { type: "buy", date: "2026-02-02", instrumentId, quantity: "2", price: "50", gross: "100", fees: "1", net: "101" });
    expect(pea(s)).toBe(899); expect(qty(s)).toBe(2);
  });
  it("brut/frais/net incohérents : bloqué", () => {
    const d = buildDraft(input({ type: "buy", date: "2026-02-02", instrumentId, quantity: "2", gross: "100", fees: "1", net: "100" }), { portfolio, wealth, events: [imported], id: "x", now });
    expect(d.event).toBeNull(); expect(d.errors.join()).toMatch(/Incohérence/);
  });
  it("vente : bloquée au-delà des parts détenues, acceptée sinon", () => {
    const s = store(); add(s, { type: "buy", date: "2026-02-02", instrumentId, quantity: "2", gross: "100", net: "100" });
    const over = buildDraft(input({ type: "sell", date: "2026-03-01", instrumentId, quantity: "3", gross: "150", net: "150" }), { portfolio, wealth, events: readLedger(s).events, id: "x", now });
    expect(over.event).toBeNull();
    add(s, { type: "sell", date: "2026-03-01", instrumentId, quantity: "1", gross: "60", fees: "0.5", net: "59.5" });
    expect(qty(s)).toBe(1); expect(pea(s)).toBe(959.5);
  });
  it("dividende et frais", () => {
    const s = store(); add(s, { type: "dividend", date: "2026-04-01", gross: "4.10", net: "4.10", instrumentId });
    add(s, { type: "fee", date: "2026-04-02", gross: "2", net: "2" }); expect(pea(s)).toBe(1002.1);
  });
  it("opération antidatée : supprime les instantanés devenus obsolètes à partir de sa date", () => {
    const s = store();
    s.setItem(SNAPSHOTS_KEY, JSON.stringify({ version: 1, enabledAt: now, backupAt: now, items: ["2026-01-10", "2026-03-10"].map(date => ({ date, at: now, total: 1, pea: 1, cto: 0, perfPea: null, perfCto: null, perfGlobal: null })) }));
    const d = buildDraft(input({ type: "deposit", date: "2026-02-01", gross: "10", net: "10" }), { portfolio, wealth, events: readLedger(s).events, id: "old", now });
    expect(writeManualChange(s, { add: d.event! }, snapshot(s)).pruned).toBe(1);
    expect(JSON.parse(s.getItem(SNAPSHOTS_KEY)!).items.map((i: { date: string }) => i.date)).toEqual(["2026-01-10"]);
  });
  it("modification puis suppression d'une saisie ; l'import reste intact", () => {
    const s = store(); const d = add(s, { type: "deposit", date: "2026-02-01", gross: "200", net: "200" });
    const edited = buildDraft(input({ type: "deposit", date: "2026-02-01", gross: "250", net: "250" }), { portfolio, wealth, events: readLedger(s).events, id: d.event!.id, now, replacing: d.event!.id });
    writeManualChange(s, { remove: d.event!.id, add: edited.event! }, snapshot(s)); expect(pea(s)).toBe(1250);
    writeManualChange(s, { remove: d.event!.id }, snapshot(s)); expect(pea(s)).toBe(1000);
    expect(readLedger(s).events).toEqual([imported]);
    expect(() => writeManualChange(s, { remove: "imp-1" }, snapshot(s))).toThrow(/importées sont protégées/);
  });
  it("doublon potentiel entre import et saisie : bloqué", () => {
    const d = buildDraft(input({ type: "deposit", date: "2026-01-05", gross: "1000", net: "1000" }), { portfolio, wealth, events: [imported], id: "x", now });
    expect(d.event).toBeNull(); expect(d.errors.join()).toMatch(/Doublon potentiel : opération importée/);
  });
});
