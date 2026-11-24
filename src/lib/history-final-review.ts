import { auditSourceSheet, bankDefaults } from "./history-source-audit";
import { detectMapping, previewHistory, type ImportOptions, type ImportSheet, type PreviewRow } from "./history-import";
import { eventKey, existingEtf, instruments, type Ledger, type LedgerEvent } from "./ledger";
import type { Portfolio } from "./portfolio";
import type { Wealth } from "./wealth";

/** Consent applies only to the supplied dated workbook, not all future inbound transfers. */
export function confirmedWorkbookOptions(sheet: ImportSheet, file: string): Partial<ImportOptions> {
  const defaults = bankDefaults(sheet);
  if (file !== "transactions_clean_2.xlsx") return defaults;
  const audit = auditSourceSheet(sheet);
  if (defaults.accountId === "cto" && audit.types["transfer_in"] === 9 && audit.types["buy"] === 8 && audit.types["split"] === 1 && Math.abs(audit.deposit - 558) < 0.005 && Math.abs(audit.buy - 548.3) < 0.005 && audit.fees === 8) {
    const mapping = detectMapping(sheet.grid[0] ?? []);
    const overrides: ImportOptions["overrides"] = {};
    sheet.grid.forEach((row, i) => {
      const value = (field: keyof typeof mapping) => { const index = mapping[field]; return index === undefined ? "" : row[index]?.text ?? ""; };
      if (value("type") === "SPLIT" && value("isin") === "US29082A1079" && value("operationDate") === "2026-11-16" && value("quantity") === "3") overrides[i + 1] = { splitRatio: "4" };
    });
    return { ...defaults, inboundExternalConfirmed: true, overrides };
  }
  return defaults;
}

/** User-confirmed control quantities (24/11/2026): compared only, never written to positions. */
export const REFERENCE_QUANTITIES: { accountId: "pea" | "cto"; isin: string; name: string; quantity: number }[] = [
  { accountId: "pea", isin: "FR0011550185", name: "BNP Paribas Easy S&P 500", quantity: 24 },
  { accountId: "pea", isin: "FR0011550193", name: "BNP Paribas Easy STOXX Europe 600", quantity: 10 },
  { accountId: "pea", isin: "FR0013412020", name: "Amundi PEA Émergents", quantity: 3 },
  { accountId: "pea", isin: "FR0013411980", name: "Amundi PEA Japon TOPIX", quantity: 2 },
  { accountId: "pea", isin: "NL00150001Q9", name: "Stellantis", quantity: 5 },
  { accountId: "pea", isin: "FR0000120073", name: "Air Liquide", quantity: 1 },
  { accountId: "pea", isin: "FR0000120271", name: "TotalEnergies", quantity: 1 },
  { accountId: "pea", isin: "FR0000124141", name: "Veolia", quantity: 1 },
  { accountId: "cto", isin: "US29082A1079", name: "Embraer ADR", quantity: 4 },
  { accountId: "cto", isin: "US0846707026", name: "Berkshire Hathaway B", quantity: 0.292877 },
  { accountId: "cto", isin: "US5949181045", name: "Microsoft", quantity: 0.305488 },
  { accountId: "cto", isin: "US92826C8394", name: "Visa", quantity: 0.151385 },
  { accountId: "cto", isin: "US98419M1009", name: "Xylem", quantity: 1.014878 },
  { accountId: "cto", isin: "IE00B4ND3602", name: "iShares Physical Gold ETC", quantity: 1 },
];
export type MovementStatus = "present" | "new" | "confirm" | "blocked";
export function movementStatus(row: PreviewRow, category: ReviewCategory): MovementStatus {
  if (row.status === "duplicate" || row.status === "existing-etf") return "present";
  return category === "ready" ? "new" : category === "confirmation" ? "confirm" : "blocked";
}

export type ReviewCategory = "ready" | "confirmation" | "blocked";
export function reviewCategory(row: PreviewRow, usualBrowserConfirmed: boolean): ReviewCategory {
  if (["duplicate", "existing-etf", "ignored"].includes(row.status)) return "blocked";
  if (!row.event || (row.event.accountId === "pea" && ["buy", "sell", "dividend", "split"].includes(row.event.type) && !row.event.instrumentId) || row.issues.some(i => /doublon potentiel|incohérente/.test(i))) return "blocked";
  if (row.status !== "valid" || !usualBrowserConfirmed) return "confirmation";
  return "ready";
}

export function finalHistoryReview(sheets: ImportSheet[], options: ImportOptions[], portfolio: Portfolio, wealth: Wealth, ledger: Ledger, usualBrowserConfirmed: boolean) {
  const known = instruments(portfolio, wealth);
  const previews = sheets.flatMap((sheet, i) => {
    const option = options[i];
    return option ? [{ sheet, options: option, preview: previewHistory(sheet, option, portfolio, wealth, ledger) }] : [];
  });
  const rows = previews.flatMap(p => p.preview.rows.map(row => ({ ...row, sheet: p.sheet.name, accountId: p.options.accountId, category: reviewCategory(row, usualBrowserConfirmed) })));
  const groups = new Map<string, { accountId: string; isin: string | null; name: string; sourceQuantity: number; reconstructedQuantity: number | null; currentQuantity: number | null; issues: string[] }>();
  for (const row of rows) {
    const e = row.event ?? row.facts;
    if (!["buy", "sell", "split"].includes(e.type ?? "") || e.quantity === null || e.quantity === undefined) continue;
    const identity = known.filter(k => k.accountId === row.accountId && k.isin === e.isin);
    const key = `${row.accountId}\u0000${e.isin ?? e.instrumentName ?? row.row}`;
    const heldEtf = portfolio.positions.find(p => row.accountId === "pea" && p.isin === e.isin);
    const held = wealth.holdings.find(h => h.accountId === row.accountId && h.isin === e.isin);
    const g = groups.get(key) ?? { accountId: row.accountId, isin: e.isin ?? null, name: identity[0]?.name ?? e.instrumentName ?? "Identité à confirmer", sourceQuantity: 0, reconstructedQuantity: null, currentQuantity: heldEtf?.quantity ?? held?.quantity ?? null, issues: [] };
    g.sourceQuantity += (e.type === "sell" ? -1 : 1) * e.quantity;
    if (identity.length !== 1) g.issues.push("Identité absente ou ambiguë dans le référentiel : quantité du fichier seulement, pas de position créée.");
    if (row.category !== "ready" && row.status !== "existing-etf" && row.status !== "duplicate") g.issues.push("Lignes non approuvées ou bloquées ; reconstruction provisoire.");
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    if (!g.isin || known.filter(k => k.accountId === g.accountId && k.isin === g.isin).length !== 1) continue;
    const base = ledger.events.filter(e => e.accountId === g.accountId && e.isin === g.isin && !existingEtf(e, portfolio));
    const extra = rows.filter(r => r.accountId === g.accountId && r.event?.isin === g.isin && r.status === "valid").flatMap(r => r.event ? [r.event] : []);
    const unique = new Map<string, LedgerEvent>();
    for (const e of [...base, ...extra]) unique.set(eventKey(e), e);
    const etf = portfolio.transactions.filter(t => g.accountId === "pea" && portfolio.positions.find(p => p.id === t.positionId)?.isin === g.isin);
    g.reconstructedQuantity = etf.reduce((sum, t) => sum + (t.type === "buy" ? 1 : -1) * t.quantity, 0) + [...unique.values()].reduce((sum, e) => sum + (e.type === "sell" ? -(e.quantity ?? 0) : ["buy", "split"].includes(e.type) ? e.quantity ?? 0 : 0), 0);
    if (g.currentQuantity !== null && Math.abs(g.currentQuantity - g.reconstructedQuantity) > 1e-6) g.issues.push("Écart avec la position enregistrée : aucune correction automatique.");
    if (g.isin === "US29082A1079" && g.accountId === "cto") {
      if (Math.abs(g.sourceQuantity - 4) > 1e-6) g.issues.push("Contrôle du fichier Embraer : attendu 4 ADR.");
      if (Math.abs(g.reconstructedQuantity - 4) > 1e-6) g.issues.push("Historique dédoublonné Embraer : 4 ADR non confirmés ; contrôle requis, split non appliqué à la position.");
    }
    g.issues = [...new Set(g.issues)];
  }
  const references = REFERENCE_QUANTITIES.map(r => {
    const g = groups.get(`${r.accountId}\u0000${r.isin}`);
    const reconstructed = g?.reconstructedQuantity ?? null;
    return { ...r, sourceQuantity: g?.sourceQuantity ?? null, reconstructedQuantity: reconstructed, matches: reconstructed !== null && Math.abs(reconstructed - r.quantity) < 1e-6 };
  });
  const statuses = rows.map(r => movementStatus(r, r.category));
  const tally = (s: MovementStatus) => statuses.filter(x => x === s).length;
  return { rows, previews, references, movementCounts: { present: tally("present"), new: tally("new"), confirm: tally("confirm"), blocked: tally("blocked"), duplicatesExcluded: rows.filter(r => r.status === "duplicate" || r.status === "existing-etf").length }, quantities: [...groups.values()], counts: { ready: rows.filter(r => r.category === "ready").length, confirmation: rows.filter(r => r.category === "confirmation").length, blocked: rows.filter(r => r.category === "blocked").length } };
}