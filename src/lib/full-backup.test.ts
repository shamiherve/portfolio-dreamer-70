import { describe, expect, it } from "vitest";
import { exportBackup, initialPortfolio, parseBackup, PORTFOLIO_KEY, SIMULATIONS_KEY } from "./portfolio";
import { initialWealth, WEALTH_KEY } from "./wealth";
import { blankMarket } from "./market-merge";
import { generateFullBackup, parseFullBackup, readFullBackup, THEME_STORAGE_KEY } from "./full-backup";

const at = "2026-11-13T23:44:00.000Z";
function fixture() {
  const portfolio = initialPortfolio();
  portfolio.positions = portfolio.positions.map(p => ({ ...p, quantity: 2, price: 50, priceDate: "2026-11-13", target: 25, priceSource: "euronext" as const, tradeTimestamp: at, quoteUpdatedAt: at }));
  portfolio.targets = [{ id: "target-test", date: "2026-11-13", source: "Fictive", validatedAt: at, weights: portfolio.positions.map(p => ({ id: p.id, name: p.name, weight: 25 })) }];
  portfolio.activeTargetId = "target-test";
  portfolio.transactions = [{ id: "transaction-test", positionId: "sp500", name: "ETF fictif", type: "buy", quantity: 2, price: 40, date: "2026-11-13" }];
  portfolio.quoteHistory = [{ isin: "FR0011550185", price: 50, currency: "EUR", tradeTimestamp: at, updateTimestamp: at }];
  portfolio.feedUpdatedAt = at; portfolio.quotesCheckedAt = at; portfolio.updatedAt = at; portfolio.budget = 123;
  const wealth = initialWealth();
  wealth.accounts = wealth.accounts.map(a => ({ ...a, name: `Compte fictif ${a.id}` }));
  wealth.holdings = wealth.holdings.map(h => h.kind === "value" ? { ...h, value: 700, priceDate: "2026-11-13" } : { ...h, quantity: 1.5, price: 80, priceDate: "2026-11-13", exchange: "XETRA", ticker: "PPFB" });
  const gold = wealth.holdings[0];
  if (!gold) throw new Error("Fixture manquante");
  gold.market = { ...blankMarket(gold), status: "verified", provider: "yahoo", symbol: "PPFB.DE", userSymbol: "PPFB.DE", verified: { name: gold.name, isin: gold.isin, ticker: gold.ticker, exchange: gold.exchange, currency: gold.currency }, quote: { price: 80, currency: "EUR", timestamp: at, retrievedAt: at, source: { provider: "yahoo", symbol: "PPFB.DE", exchange: "XETRA", fallback: false } }, pending: { price: 110, currency: "EUR", timestamp: at, reason: "Variation fictive", source: { provider: "yahoo", symbol: "PPFB.DE", exchange: "XETRA", fallback: false } }, audit: [{ at, field: "ticker", from: "SGLN", to: "PPFB", reason: "Test" }], fx: { rate: 1, date: "2026-11-13", source: "EUR" }, lastSuccessAt: at, checkedAt: at, quoteStatus: "review" };
  wealth.holdings.push({ ...gold, id: "stock-test", name: "Action fictive", isin: "US0378331005", ticker: "AAPL", exchange: "NASDAQ", currency: "USD", fxRate: 0.9, classId: "stocks", market: undefined });
  wealth.marketMeta = { lastSuccess: at, lastAttempt: at, lastFailure: null, lastError: null, fxDate: "2026-11-13" }; wealth.updatedAt = at;
  const simulations = [{ id: "simulation-test", name: "Fictive", categories: [{ id: "c-test", name: "Fictive", value: 10, target: 100 }], budget: "20", savedAt: 123 }];
  return { portfolio, wealth, simulations, theme: "dark" as const };
}
describe("Read-only full-wealth export", () => {
  it("round-trips all four ensembles and every optional quote, identity and allocation field", () => {
    const input = fixture(); const original = JSON.stringify(input);
    const result = generateFullBackup(input, at); const b = parseFullBackup(result.content);
    expect(b).toEqual({ ...input, format: "equilibre-full-backup", version: 1, exportedAt: at, detachedTransactionPositionIds: [] });
    expect(b.wealth.holdings.map(h => h.kind)).toEqual(["quantity", "value", "quantity"]);
    expect(b.wealth.holdings[0]?.market?.pending?.price).toBe(110);
    expect(b.portfolio.transactions[0]?.positionId).toBe(b.portfolio.positions[0]?.id);
    expect(JSON.stringify(input)).toBe(original);
    expect(result.filename).toBe("equilibre-patrimoine-complet-v1-2026-11-13T23-44-00-000Z.json");
  });
  it("allows genuinely absent optional fields and a missing theme without inventing history or PRU", () => {
    const b = parseFullBackup(generateFullBackup({ portfolio: initialPortfolio(), wealth: initialWealth(), simulations: [], theme: null }, at).content);
    expect(b.theme).toBeNull(); expect(b.portfolio.quoteHistory).toBeUndefined(); expect(b.wealth.holdings[0]?.market).toBeUndefined();
    expect(b).not.toHaveProperty("pru"); expect(b.wealth.holdings[0]).not.toHaveProperty("transactions");
  });
  it("reads only app-owned keys and never accesses technical credentials or writes anything", () => {
    const f = fixture(); const keys: string[] = [];
    const entries = new Map([[PORTFOLIO_KEY, JSON.stringify(f.portfolio)], [WEALTH_KEY, JSON.stringify(f.wealth)], [SIMULATIONS_KEY, JSON.stringify(f.simulations)], [THEME_STORAGE_KEY, "dark"], ["auth-token", "private-test-token"]]);
    const result = readFullBackup({ getItem: key => { keys.push(key); return entries.get(key) ?? null; } }, at);
    expect(keys.sort()).toEqual([PORTFOLIO_KEY, WEALTH_KEY, SIMULATIONS_KEY, THEME_STORAGE_KEY].sort());
    expect(result.content).not.toContain("private-test-token"); expect(result.backup.theme).toBe("dark");
  });
  it("reports missing storage explicitly and refuses malformed or invalid saved data", () => {
    expect(readFullBackup({ getItem: () => null }, at).warnings).toHaveLength(3);
    expect(() => readFullBackup({ getItem: key => key === PORTFOLIO_KEY ? "bad-json" : null }, at)).toThrow(/illisibles/);
    expect(() => readFullBackup({ getItem: key => key === SIMULATIONS_KEY ? '[{"id":"bad"}]' : null }, at)).toThrow();
  });
  it.each(["access_token", "apiKey", "futureMetadata"])("explicitly rejects unknown %s fields, including nested secrets", field => {
    const f = fixture(); const bad = { ...f, wealth: { ...f.wealth, holdings: f.wealth.holdings.map((h, i) => i === 0 ? { ...h, [field]: "never-export-this" } : h) } };
    expect(() => generateFullBackup(bad, at)).toThrow(/champ inconnu/);
    const b = JSON.parse(generateFullBackup(f, at).content); b[field] = "never-export-this";
    expect(() => parseFullBackup(JSON.stringify(b))).toThrow(/champ inconnu/);
  });
  it("rejects unsupported format/version, missing required fields and invalid theme", () => {
    const b = JSON.parse(generateFullBackup(fixture(), at).content);
    for (const patch of [{ version: 2 }, { format: "other" }, { wealth: null }, { theme: "system" }, { exportedAt: "bad" }]) expect(() => parseFullBackup(JSON.stringify({ ...b, ...patch }))).toThrow();
    delete b.simulations; expect(() => parseFullBackup(JSON.stringify(b))).toThrow();
  });
  it("rejects duplicate identifiers, orphan accounts/classes and duplicate mappings", () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => { const a = f.wealth.accounts[0]; if (a) f.wealth.accounts.push({ ...a }); },
      (f: ReturnType<typeof fixture>) => { const c = f.wealth.classes[0]; if (c) f.wealth.classes.push({ ...c }); },
      (f: ReturnType<typeof fixture>) => { const h = f.wealth.holdings[0]; if (h) f.wealth.holdings.push({ ...h }); },
      (f: ReturnType<typeof fixture>) => { const h = f.wealth.holdings[0]; if (h) h.accountId = "unknown"; },
      (f: ReturnType<typeof fixture>) => { const h = f.wealth.holdings[0]; if (h) h.classId = "unknown"; },
      (f: ReturnType<typeof fixture>) => f.wealth.mapping.push({ accountId: "unknown", classId: "gold", target: 0 }),
      (f: ReturnType<typeof fixture>) => { const m = f.wealth.mapping[0]; if (m) f.wealth.mapping.push({ ...m }); },
    ]) { const f = fixture(); mutate(f); expect(() => generateFullBackup(f, at)).toThrow(); }
  });
  it("validates parent references and cycles without rejecting the existing virtual equity group", () => {
    expect(() => generateFullBackup(fixture(), at)).not.toThrow();
    const f = fixture(); const c = f.wealth.classes[0]; if (!c) throw new Error("Fixture");
    c.parent = "unknown"; expect(() => generateFullBackup(f, at)).toThrow();
    c.parent = c.id; expect(() => generateFullBackup(f, at)).toThrow(/cyclique/);
  });
  it("rejects incoherent global targets, quantity rules, dates, prices, currencies and exchange rates", () => {
    for (const patch of [{ quantity: -1 }, { quantity: 1.1234567 }, { price: -2 }, { currency: "EU" }, { fxRate: 0 }, { fxRate: 2 }, { priceDate: "2026-02-30" }]) {
      const f = fixture(); f.wealth.holdings = f.wealth.holdings.map((h, i) => i === 0 ? { ...h, ...patch } : h); expect(() => generateFullBackup(f, at)).toThrow();
    }
    const f = fixture(); const a = f.wealth.accounts[0]; if (a) a.target = 80;
    expect(() => generateFullBackup(f, at)).toThrow(/100/);
    const p = fixture(); p.portfolio.positions = p.portfolio.positions.map(x => ({ ...x, quantity: 1.5 })); expect(() => generateFullBackup(p, at)).toThrow(/entière/);
  });
  it("rejects invalid market currencies, identity references and date metadata", () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => { const m = f.wealth.holdings[0]?.market; if (m?.quote) m.quote.currency = "bad"; },
      (f: ReturnType<typeof fixture>) => { const m = f.wealth.holdings[0]?.market; if (m?.verified) m.verified.isin = "OTHER"; },
      (f: ReturnType<typeof fixture>) => { const m = f.wealth.holdings[0]?.market; if (m?.fx) m.fx.date = "2026-02-30"; },
    ]) { const f = fixture(); mutate(f); expect(() => generateFullBackup(f, at)).toThrow(); }
  });
  it("preserves unvalued held positions without fabricating prices", () => {
    const f = fixture(); f.wealth.holdings = f.wealth.holdings.map(h => ({ ...h, price: null }));
    const r = generateFullBackup(f, at); expect(r.warnings).toContain("Des positions sans cours sont conservées sans valorisation inventée."); expect(r.backup.wealth.holdings[0]?.quantity).toBe(1.5);
  });
  it("preserves historical transactions for deleted ETFs with explicit references and refuses undeclared ones", () => {
    const f = fixture(); f.portfolio.transactions.push({ id: "deleted-test", positionId: "removed", name: "Ancien fictif", type: "buy", quantity: 1, price: 30, date: "2026-11-12" });
    const r = generateFullBackup(f, at); expect(r.backup.detachedTransactionPositionIds).toEqual(["removed"]); expect(r.backup.portfolio.transactions).toEqual(f.portfolio.transactions);
    const bad = JSON.parse(r.content); bad.detachedTransactionPositionIds = []; expect(() => parseFullBackup(JSON.stringify(bad))).toThrow(/Références/);
  });
  it("leaves the legacy ETF format importable and distinct from the full export", () => {
    const f = fixture(); const legacy = exportBackup(f.portfolio, f.simulations);
    expect(parseBackup(legacy).portfolio).toEqual(f.portfolio);
    expect(() => parseFullBackup(legacy)).toThrow();
    expect(() => parseBackup(generateFullBackup(f, at).content)).toThrow();
  });
});