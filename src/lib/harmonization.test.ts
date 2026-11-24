import { describe, expect, it, vi } from "vitest";
import { initialPortfolio, PORTFOLIO_KEY, portfolioSchema, recordTransaction } from "./portfolio";
import { initialWealth, WEALTH_KEY, analyse, recommendations, simulateContribution } from "./wealth";
import { emptyLedger, LEDGER_KEY, readLedger, eventSchema, instruments } from "./ledger";
import { emptyRegistry, REGISTRY_KEY, visibleInstruments, visibleAccounts, saveInstrument, saveAccount, appendValuation, registrySchema, type FinancialAccount, type FinancialInstrument } from "./financial-registry";
import { readCompleteBackup, parseRestoration, restoreBackup, appendLedger, snapshot } from "./backup-restoration";
import { writeRegistry } from "./financial-storage";
import { buildDraft, emptyInput, writeManualChange } from "./manual-entry";
import { financialSummary } from "./financial-summary";
import { assertNoNewIdentityIssues, assertPortfolioChange, assertWealthChange, identityIssues } from "./business-guards";
import { portfolioLabels, wealthLabels } from "./canonical-labels";
import { buildMoves, SNAPSHOTS_KEY } from "./performance";
import { JOURNAL_KEY, SAFETY_KEY } from "./local-transaction";
import { notifyLocalData, subscribeLocalData } from "./local-data-events";

const now = "2026-11-24T17:14:00.000Z";
function fixture() {
  const p = initialPortfolio(); p.positions = p.positions.map(i => ({ ...i, quantity: 2, price: 50, priceDate: "2026-11-23", target: 25 }));
  const w = initialWealth(), r = emptyRegistry();
  const entries = new Map<string, string>([[PORTFOLIO_KEY, JSON.stringify(p)], [WEALTH_KEY, JSON.stringify(w)], [LEDGER_KEY, JSON.stringify(emptyLedger())]]);
  const s = { getItem: (k: string) => entries.get(k) ?? null, setItem: (k: string, v: string) => { entries.set(k, v); }, removeItem: (k: string) => { entries.delete(k); } };
  return { p, w, r, s };
}
const account: FinancialAccount = { id: "account-new", legacyId: null, name: "Compte financier réel", type: "cto", institution: "Établissement réel", currency: "EUR", openedAt: null, mode: "manual", active: true, targetAccountId: null };
const instrument: FinancialInstrument = { id: "security-new", legacyRef: null, accountId: account.id, name: "TotalEnergies", isin: "FR0000120271", ticker: "TTE", exchange: "Euronext Paris", currency: "EUR", type: "stock", mode: "manual", active: true, classId: "stocks", quantity: 0 };
function manual(id: string, accountId = "pea", instrumentId = "etf:sp500", type: "buy" | "deposit" = "buy") {
  const { p, w } = fixture();
  const d = buildDraft({ ...emptyInput(), accountId, instrumentId, type, date: "2026-11-24", quantity: "1", gross: "50", net: "50" }, { portfolio: p, wealth: w, registry: saveInstrument(saveAccount(emptyRegistry(), account), instrument), events: [], now, id });
  if (!d.event) throw new Error(d.errors.join(" "));
  return d.event;
}

describe("Harmonisation des neuf pages sans réécriture historique", () => {
  it("le chargement et les vues canoniques ne modifient aucun nombre ni donnée sauvegardée", () => {
    const { p, w, s } = fixture(); const before = snapshot(s);
    let r = saveAccount(emptyRegistry(), { ...visibleAccounts(emptyRegistry(), w)[0], ...account, id: "pea", legacyId: "pea", name: "Mon PEA", type: "pea", targetAccountId: "pea" });
    const etf = visibleInstruments(emptyRegistry(), p, w)[0]; if (!etf) throw new Error("Fixture");
    r = saveInstrument(r, { ...etf, name: "ETF renommé" });
    const pv = portfolioLabels(p, r), wv = wealthLabels(w, r);
    expect(pv.positions[0]?.name).toBe("ETF renommé"); expect(wv.accounts[0]?.name).toBe("Mon PEA");
    expect(instruments(p, w, r).find(i => i.id === etf.id)?.name).toBe("ETF renommé");
    expect(analyse(pv, wv).total).toBe(analyse(p, w).total); expect(pv.positions.map(i => i.quantity)).toEqual([2, 2, 2, 2]);
    expect(snapshot(s)).toEqual(before);
  });
  it("un ISIN existant PEA ne peut pas être dupliqué entre ETF, Positions et Gestion", () => {
    const { p, w, r } = fixture(); const isin = p.positions[0]?.isin; if (!isin) throw new Error("Fixture");
    const extra = { ...instrument, accountId: "pea", isin };
    expect(() => assertNoNewIdentityIssues({ p, w, r }, { p, w, r: saveInstrument(r, extra) })).toThrow(/déjà présent/);
    expect(identityIssues(p, w, r)).toEqual([]);
  });
  it("ne fusionne jamais les supports sans ISIN sur la ressemblance du nom", () => {
    const { p, w, r } = fixture(); const next = saveInstrument(saveInstrument(saveAccount(r, account), { ...instrument, isin: "" }), { ...instrument, id: "other", isin: "" });
    expect(() => assertNoNewIdentityIssues({ p, w, r }, { p, w, r: next })).not.toThrow();
    expect(next.instruments).toHaveLength(2);
  });
  it("refuse un second compte identique sans supprimer le premier", () => {
    const { s } = fixture(); writeRegistry(s, r => saveAccount(r, account), snapshot(s), () => {});
    const before = snapshot(s);
    expect(() => writeRegistry(s, r => saveAccount(r, { ...account, id: "second" }), before, () => {})).toThrow(/déjà présent/);
    expect(snapshot(s)).toEqual(before);
  });
  it("une nouvelle saisie ajuste les parts une fois sans changer cours, cibles ou transactions ETF", () => {
    const { p, s } = fixture(); const e = manual("manual-1");
    writeManualChange(s, { add: e }, snapshot(s)); const saved = portfolioSchema.parse(JSON.parse(s.getItem(PORTFOLIO_KEY) ?? ""));
    expect(saved.positions[0]?.quantity).toBe(3); expect(saved.positions[0]?.price).toBe(50); expect(saved.positions.map(i => i.target)).toEqual([25, 25, 25, 25]);
    expect(saved.transactions).toEqual(p.transactions); expect(readLedger(s).events).toHaveLength(1);
    expect(readLedger(s).events[0]?.source.positionApplied).toBe(true);
    const beforeRetry = snapshot(s); expect(() => writeManualChange(s, { add: e }, beforeRetry)).toThrow(); expect(snapshot(s)).toEqual(beforeRetry);
    expect(s.getItem(SAFETY_KEY)).not.toBeNull();
  });
  it("une correction puis suppression annule seulement l’effet de la nouvelle saisie", () => {
    const { s } = fixture(); const e = manual("manual-1"); writeManualChange(s, { add: e }, snapshot(s));
    writeManualChange(s, { remove: e.id, add: { ...e, quantity: 2, amount: 100 } }, snapshot(s));
    expect(JSON.parse(s.getItem(PORTFOLIO_KEY) ?? "").positions[0].quantity).toBe(4);
    writeManualChange(s, { remove: e.id }, snapshot(s)); expect(JSON.parse(s.getItem(PORTFOLIO_KEY) ?? "").positions[0].quantity).toBe(2);
  });
  it("une ancienne saisie sans provenance d’application ne réécrit jamais les positions", () => {
    const { s } = fixture(); const e = manual("legacy"); s.setItem(LEDGER_KEY, JSON.stringify({ ...emptyLedger(), events: [e] }));
    const pBefore = s.getItem(PORTFOLIO_KEY);
    writeManualChange(s, { remove: e.id, add: { ...e, amount: 60 } }, snapshot(s)); expect(s.getItem(PORTFOLIO_KEY)).toBe(pBefore);
    expect(readLedger(s).events[0]?.source.positionApplied).toBeUndefined();
  });
  it("un import identique à une saisie et une saisie identique à une transaction ETF sont bloqués", () => {
    const { s, p } = fixture(); const e = manual("manual-1"); writeManualChange(s, { add: e }, snapshot(s));
    expect(() => appendLedger(s, { ...readLedger(s), events: [...readLedger(s).events, { ...e, id: "import-1", source: { ...e.source, origin: "import" } }] }, snapshot(s))).toThrow(/Doublon/);
    const t = { id: "etf-old", positionId: "sp500", name: "ETF", type: "buy" as const, date: e.operationDate, quantity: 1, price: 50 };
    expect(() => assertPortfolioChange(p, recordTransaction(p, t), readLedger(s).events)).toThrow(/déjà présente/);
  });
  it("le nouvel instrument et son compte restent uniques et disponibles dans Historique", () => {
    const { p, w, s } = fixture(); writeRegistry(s, r => saveInstrument(saveAccount(r, account), instrument), snapshot(s), () => {});
    writeManualChange(s, { add: manual("deposit", account.id, "", "deposit") }, snapshot(s));
    writeManualChange(s, { add: manual("buy", account.id, instrument.id) }, snapshot(s));
    const b = readCompleteBackup(s).backup; const r = b.financialRegistry ?? emptyRegistry();
    expect(visibleAccounts(r, w).filter(a => a.id === account.id)).toHaveLength(1);
    expect(visibleInstruments(r, p, w).filter(i => i.id === instrument.id)).toHaveLength(1);
    expect(instruments(p, w, r).find(i => i.id === instrument.id)?.accountId).toBe(account.id);
    expect(r.instruments[0]?.quantity).toBe(1); expect(financialSummary(p, w, r, b.ledger, "2026-11-24").accounts.find(a => a.account.id === account.id)?.cash).toBe(0);
    expect(() => parseRestoration(readCompleteBackup(s).content)).not.toThrow();
  });
  it("une valorisation active par support et date, avec anciennes révisions conservées", () => {
    const r = saveInstrument(saveAccount(emptyRegistry(), account), instrument);
    const v = { id: "v1", accountId: account.id, instrumentId: instrument.id, date: "2026-11-24", value: 120, at: now, comment: "", supersedes: null, origin: "manual" as const, externalFlow: null, quote: null };
    const next = appendValuation(r, v, now);
    expect(() => registrySchema.parse({ ...next, valuations: [v, { ...v, id: "v2" }] })).toThrow(/valorisations actives/);
    expect(appendValuation(next, { ...v, id: "v2", value: 125, supersedes: "v1" }, now).valuations.map(x => x.value)).toEqual([120, 125]);
  });
  it("les références legacy ne rendent pas les sauvegardes invalides après une modification de quantité", () => {
    const { p, w, s } = fixture(); const i = visibleInstruments(emptyRegistry(), p, w)[0]; if (!i) throw new Error("Fixture");
    writeRegistry(s, r => saveInstrument(r, { ...i, name: "Nom commun" }), snapshot(s), () => {});
    writeManualChange(s, { add: manual("manual-1") }, snapshot(s));
    const backup = readCompleteBackup(s); restoreBackup(s, parseRestoration(backup.content), snapshot(s));
    const restored = readCompleteBackup(s).backup;
    expect(restored.portfolio.positions[0]?.quantity).toBe(3);
    expect(visibleInstruments(restored.financialRegistry ?? emptyRegistry(), restored.portfolio, restored.wealth)[0]?.quantity).toBe(3);
  });
  it("un échec d’écriture annule ensemble transaction, quantité et invalidation des instantanés", () => {
    const { s } = fixture(); s.setItem(SNAPSHOTS_KEY, JSON.stringify({ version: 1, enabledAt: now, backupAt: now, items: [{ date: "2026-11-24", at: now, total: 400, pea: 400, cto: 0, perfGlobal: null, perfPea: null, perfCto: null }] }));
    const before = snapshot(s); let failed = false;
    const broken = { ...s, setItem: (k: string, v: string) => { if (k === PORTFOLIO_KEY && !failed) { failed = true; throw new Error("Quota"); } s.setItem(k, v); } };
    expect(() => writeManualChange(broken, { add: manual("manual-1") }, before)).toThrow(/retour intégral/);
    expect(snapshot(s)).toEqual(before); expect(s.getItem(JOURNAL_KEY)).toBeNull();
  });
  it("les allocations, pondérations, scores et recommandations sont figés ; simulations sans écriture", () => {
    const { p, w, s } = fixture(); const before = snapshot(s), a = analyse(p, w), rec = recommendations(a);
    expect(w.accounts.map(a => a.target)).toEqual([75, 15, 10]); expect(w.classes.map(c => c.target)).toEqual([70, 15, 10, 5]);
    expect(() => assertWealthChange(w, { ...w, accounts: w.accounts.map(a => ({ ...a, target: 0 })) }, [])).toThrow(/figées/);
    expect(() => assertPortfolioChange(p, { ...p, positions: p.positions.map(i => ({ ...i, target: 0 })) }, [])).toThrow(/figées/);
    simulateContribution(p, w, 1000, "pea"); expect(snapshot(s)).toEqual(before); expect(analyse(p, w)).toEqual(a); expect(recommendations(analyse(p, w))).toEqual(rec);
  });
  it("les espèces issues des anciennes transactions ETF et du grand livre concordent sans double comptage", () => {
    const { p, w, r } = fixture(); const e = manual("buy"); p.transactions.push({ id: "old", positionId: "sp500", name: "ETF", type: "buy", date: "2026-11-24", price: 50, quantity: 1 });
    const deposit = eventSchema.parse({ ...manual("deposit", "pea", "", "deposit"), amount: 100 });
    const l = { ...emptyLedger(), events: [deposit, e] };
    expect(buildMoves(l.events, p).moves.filter(m => m.dq)).toHaveLength(1);
    const summary = financialSummary(p, w, r, l, "2026-11-24");
    expect(summary.accounts.find(a => a.account.id === "pea")?.cash).toBe(50); expect(summary.total).toBe(450);
  });
  it("une écriture notifie toutes les vues abonnées, pas les sources non concernées", () => {
    vi.stubGlobal("window", new EventTarget());
    const p = vi.fn(), w = vi.fn(); const offP = subscribeLocalData([PORTFOLIO_KEY], p), offW = subscribeLocalData([WEALTH_KEY], w);
    notifyLocalData([PORTFOLIO_KEY]); expect(p).toHaveBeenCalledOnce(); expect(w).not.toHaveBeenCalled();
    offP(); offW(); vi.unstubAllGlobals();
  });
});