import type { ImportCell, ImportOptions, ImportSheet } from "./history-import";

/** User-supplied consolidated workbook (24/11/2026): replaces earlier exports; net amounts are the cash flows. */
export const EXPECTED_CASH = { pea: 0.09, cto: 1.7 } as const;
const SOURCE = "Source · ";
const REQUIRED = ["Libellé", "Opération", "Montant brut", "Courtage/Prélèvement", "Montant net"];
/** File labels → ISINs confirmed by the user's reference list; the ISIN must still exist in the local referential. */
export const LABEL_ISIN: Record<"pea" | "cto", Record<string, string>> = {
  pea: { "BNP PARIBAS EASY S&P 500 UCITS ETF - C EUR ACC": "FR0011550185", "BNP PARIBAS EASY STOXX EUROPE 600 UCITS ETF - C ACC": "FR0011550193", "Amundi PEA Emergent (MSCI Emerging) ESG Transition UCITS ETF - EUR DIS": "FR0013412020", "Amundi PEA Japon (TOPIX) UCITS ETF - EUR DIS": "FR0013411980", "STELLANTIS NV": "NL00150001Q9", "AIR LIQUIDE": "FR0000120073", "TOTALENERGIES": "FR0000120271", "VEOLIA ENVIRON.": "FR0000124141", "Amundi CAC 40 UCITS ETF - EUR DIS": "FR0007052782" },
  cto: { "Physical Gold USD (Acc)": "IE00B4ND3602", "Berkshire Hathaway (B)": "US0846707026", "Embraer (ADR)": "US29082A1079", "Xylem": "US98419M1009", "Visa": "US92826C8394", "Microsoft": "US5949181045" },
};
const headings = (s: ImportSheet) => s.grid[0]?.map(c => c.text.trim()) ?? [];
export function isConsolidatedSource(s: ImportSheet) { const h = headings(s); return REQUIRED.every(r => h.includes(r)) && accountOf(s) !== null; }
export function isConsolidatedNormalized(s: ImportSheet) { return headings(s).includes(`${SOURCE}Montant net`); }
function accountOf(s: ImportSheet): "pea" | "cto" | null { const n = s.name.trim().toLowerCase(); return n === "pea" ? "pea" : n === "cto" ? "cto" : null; }
const num = (c: ImportCell | undefined) => { if (!c) return null; if (typeof c.value === "number") return c.value; const t = c.text.trim(); if (!t) return null; const n = Number(t.replace(",", ".")); return Number.isFinite(n) ? n : null; };
/** Informational rows: coupon announcements (cash counted on the "Encaissement" line) and paired form conversions (no quantity change). */
export function nonCashReason(op: string) {
  if (/^OST de création de coupons/i.test(op)) return "Annonce du coupon : l’encaissement est compté sur la ligne « Encaissement », pas deux fois.";
  if (/^Conversion forme de titre$/i.test(op)) return "Conversion de forme (lignes appariées) : aucune variation de quantité ni d’espèces.";
  return null;
}
const OPS: Record<string, string> = { "achat comptant": "Achat", "vente comptant": "Vente", "versement": "Versement", "encaissement coupons intérêt/dividende": "Dividende", "taxe transac finan": "Taxe", "split (division de titre)": "Split" };
const cell = (v: string | number | Date | null): ImportCell => ({ value: v, text: v === null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v) });

export function normalizeConsolidated(src: ImportSheet): ImportSheet {
  const account = accountOf(src); if (!account) return src;
  const h = headings(src); const at = (row: ImportCell[], name: string) => { const i = h.indexOf(name); return i < 0 ? undefined : row[i]; };
  const header = ["Opération", "Date", "Date de valeur", "ISIN", "Instrument", "Quantité", "Prix", "Montant", "Frais", "Devise", "Ratio", ...h.map(x => SOURCE + x)].map(cell);
  const informational: NonNullable<ImportSheet["informational"]> = [];
  const grid = [header, ...src.grid.slice(1).map((row, k) => {
    const original = h.map((_, i) => { const c = row[i]; return { value: c?.formula ? null : c?.value ?? null, text: c?.text ?? "" }; });
    const blank = () => [...Array<ImportCell>(11).fill(cell(null)), ...original].map(() => cell(null));
    const op = at(row, "Opération")?.text.trim() ?? ""; const label = at(row, "Libellé")?.text.trim() ?? "";
    const reason = nonCashReason(op);
    if (reason) informational.push({ row: k + 2, label, operation: op, reason });
    if (!op || reason) return blank();
    const type = OPS[op.toLowerCase()] ?? op;
    const gross = num(at(row, "Montant brut")); const fee = Math.abs(num(at(row, "Courtage/Prélèvement")) ?? 0); const net = num(at(row, "Montant net"));
    const qty = num(at(row, "Qté"));
    // Net = gross − brokerage for buys/sells, = gross otherwise; any mismatch blanks the amount so the row is blocked, never recomputed.
    const expectedNet = gross === null ? null : type === "Achat" ? gross - fee : type === "Vente" ? gross - fee : gross;
    const consistent = type === "Split" || (net !== null && expectedNet !== null && Math.abs(expectedNet - net) < 0.005);
    const split = type === "Split";
    const ratio = split && account === "cto" && label === "Embraer (ADR)" && qty === 3 && cell(at(row, "Date")?.value ?? null).text === "2026-11-16" ? 4 : null;
    const execDate = at(row, "Date")?.value ?? null; const value = at(row, "Date valeur")?.value ?? null;
    return [cell(type), cell(execDate), cell(value), cell(LABEL_ISIN[account][label] ?? null), cell(label || null), cell(qty), cell(num(at(row, "Prix d'exécution"))), cell(split ? 0 : consistent ? gross : null), cell(split ? null : fee || null), cell(at(row, "Devise")?.text.trim() || "EUR"), cell(ratio), ...original];
  })];
  return { name: src.name, grid, informational };
}
export function consolidatedOptions(s: ImportSheet): Partial<ImportOptions> | null {
  if (!isConsolidatedNormalized(s)) return null; const account = accountOf(s); if (!account) return null;
  return { accountId: account, broker: account === "pea" ? "fortuneo" : "trade-republic", timezone: "Europe/Paris", decimal: "dot", currency: "EUR", amountBasis: "gross", missingCurrencyConfirmed: true, inboundExternalConfirmed: true, overrides: {} };
}
/** File-level cash check from the "Montant net" column only; informational rows excluded. */
export function consolidatedCash(s: ImportSheet) {
  if (!isConsolidatedNormalized(s)) return null; const account = accountOf(s); if (!account) return null;
  const h = headings(s); const iOp = h.indexOf(`${SOURCE}Opération`); const iNet = h.indexOf(`${SOURCE}Montant net`);
  const informational = s.informational?.length ?? 0; let balance = 0; let movements = informational;
  for (const row of s.grid.slice(1)) {
    const op = row[iOp]?.text.trim() ?? ""; if (!op) continue; movements++;
    balance += num(row[iNet]) ?? 0;
  }
  balance = Math.round(balance * 100) / 100;
  return { account, movements, informational, balance, expected: EXPECTED_CASH[account], gap: Math.round((balance - EXPECTED_CASH[account]) * 100) / 100 };
}
