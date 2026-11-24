import type { Portfolio } from "./portfolio";
import type { Wealth } from "./wealth";
import type { FinancialRegistry } from "./financial-registry";
import { existingEtf, type LedgerEvent } from "./ledger";

export function identityIssues(p: Portfolio, w: Wealth, r: FinancialRegistry) {
  const issues: string[] = [];
  const rows = [
    ...p.positions.map(i => ({ id: `etf:${i.id}`, account: "pea", isin: i.isin })),
    ...w.holdings.map(i => ({ id: `w:${i.id}`, account: i.accountId, isin: i.isin })),
    ...r.instruments.filter(i => !i.legacyRef).map(i => ({ id: i.id, account: i.accountId, isin: i.isin })),
  ];
  for (const row of rows) {
    if (!row.isin) continue;
    const matches = rows.filter(i => i.account === row.account && i.isin === row.isin);
    if (matches.length > 1) { const label = `${row.account} · ${row.isin} : ${matches.map(i => i.id).sort().join(", ")}`; if (!issues.includes(label)) issues.push(label); }
  }
  return issues;
}
/** Existing uncertain duplicates remain visible, not merged; only introducing/changing one is blocked. */
export function assertNoNewIdentityIssues(before: { p: Portfolio; w: Wealth; r: FinancialRegistry }, after: { p: Portfolio; w: Wealth; r: FinancialRegistry }) {
  const known = new Set(identityIssues(before.p, before.w, before.r));
  const added = identityIssues(after.p, after.w, after.r).filter(i => !known.has(i));
  if (added.length) throw new Error(`Instrument déjà présent dans ce compte : ${added.join(" ; ")}. Utilisez la fiche existante.`);
}
export function assertPortfolioChange(before: Portfolio, next: Portfolio, ledger: LedgerEvent[]) {
  if (JSON.stringify(before.positions.map(i => [i.id, i.target])) !== JSON.stringify(next.positions.map(i => [i.id, i.target])) || before.activeTargetId !== next.activeTargetId || JSON.stringify(before.targets) !== JSON.stringify(next.targets)) throw new Error("Pondérations ETF figées : modification refusée.");
  for (const old of before.positions) {
    if (ledger.some(e => e.instrumentId === `etf:${old.id}`) || before.transactions.some(t => t.positionId === old.id)) {
      if (next.positions.find(i => i.id === old.id)?.isin !== old.isin) throw new Error("Instrument référencé par l’historique : identité et suppression protégées.");
    }
  }
  const incoming = next.transactions.filter(t => !before.transactions.some(old => old.id === t.id));
  for (const t of incoming) {
    if (ledger.some(e => existingEtf(e, next)?.id === t.id) || before.transactions.some(old => old.positionId === t.positionId && old.type === t.type && old.date === t.date && old.quantity === t.quantity && Math.abs(old.price * old.quantity - t.price * t.quantity) <= 0.02)) throw new Error("Transaction déjà présente dans le grand livre ou les transactions ETF.");
  }
}
export function assertWealthChange(before: Wealth, next: Wealth, ledger: LedgerEvent[]) {
  const targets = (w: Wealth) => [w.accounts.map(a => [a.id, a.target, a.fractionalAllowed]), w.classes.map(c => [c.id, c.target, c.parent]), w.mapping];
  if (JSON.stringify(targets(before)) !== JSON.stringify(targets(next))) throw new Error("Allocations et hiérarchie figées : modification refusée.");
  for (const old of before.holdings) if (ledger.some(e => e.instrumentId === `w:${old.id}` || (e.accountId === old.accountId && e.isin && e.isin === old.isin))) {
    const n = next.holdings.find(i => i.id === old.id);
    if (!n || n.isin !== old.isin || n.accountId !== old.accountId) throw new Error("Position référencée par l’historique : identité, compte et suppression protégés.");
  }
  for (const list of [next.accounts, next.classes, next.holdings]) if (new Set(list.map(i => i.id)).size !== list.length) throw new Error("Identifiants dupliqués.");
  if (new Set(next.mapping.map(i => `${i.accountId}|${i.classId}`)).size !== next.mapping.length) throw new Error("Objectif compte × classe dupliqué.");
}