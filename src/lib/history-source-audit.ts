import { detectMapping, parseDate, parseNumber, recognizeOperation, type ImportOptions, type ImportSheet } from "./history-import";

export function bankDefaults(sheet: ImportSheet): Partial<ImportOptions> {
  const h = sheet.grid[0]?.map(c => c.text.toLowerCase()) ?? [];
  if (h.includes("account_type") && h.includes("datetime") && h.includes("symbol")) return { accountId: "cto", broker: "trade-republic", timezone: "UTC", amountBasis: "unknown", inboundExternalConfirmed: false, missingCurrencyConfirmed: false };
  if (h.includes("débit") && h.includes("crédit")) return { accountId: "pea", broker: "fortuneo", timezone: "Europe/Paris", amountBasis: "unknown", inboundExternalConfirmed: false, missingCurrencyConfirmed: false };
  return {};
}
/** Descriptive report includes incomplete rows, without manufacturing valid ledger events. */
export function auditSourceSheet(sheet: ImportSheet) {
  const header = sheet.grid[0] ?? []; const mapping = detectMapping(header);
  const defaults = bankDefaults(sheet);
  const types: Record<string, number> = {}; const duplicates: number[][] = [];
  const seen = new Map<string, number[]>(); let earlierValueDate = 0; let fractionalBuys = 0; let blank = 0;
  let deposit = 0; let buy = 0; let dividend = 0; let fees = 0; let taxes = 0; let credit = 0; let debit = 0;
  const warnings: string[] = []; const currencies = new Set<string>();
  for (let i = 1; i < sheet.grid.length; i++) {
    const row = sheet.grid[i] ?? [];
    if (row.every(c => !c.text.trim())) { blank++; continue; }
    const value = (f: keyof typeof mapping) => { const index = mapping[f]; return index !== undefined ? row[index]?.value ?? null : null; };
    const text = (f: keyof typeof mapping) => { const index = mapping[f]; return index !== undefined ? row[index]?.text.trim() ?? "" : ""; };
    const num = (f: keyof typeof mapping) => { try { return parseNumber(value(f), "comma") ?? 0; } catch { warnings.push(`Ligne ${i + 1} : nombre à vérifier (${f}).`); return 0; } };
    const rawType = text("type"); const type = recognizeOperation(rawType);
    const key = type ?? (rawType || "Non identifié");
    types[key] = (types[key] ?? 0) + 1;
    const amount = mapping.amount !== undefined ? num("amount") : num("debit") ? -Math.abs(num("debit")) : num("credit");
    if (amount > 0) credit += amount; if (amount < 0) debit += -amount;
    if (type === "deposit" || rawType === "TRANSFER_INSTANT_INBOUND") deposit += Math.abs(amount);
    if (type === "buy") { buy += Math.abs(amount); const q = num("quantity"); if (q && !Number.isInteger(q)) fractionalBuys++; }
    if (type === "dividend") dividend += Math.abs(amount);
    fees += Math.abs(num("fees")) + (type === "fee" ? Math.abs(amount) : 0);
    taxes += Math.abs(num("taxes")) + (type === "tax" ? Math.abs(amount) : 0);
    if (text("currency")) currencies.add(text("currency"));
    const fingerprint = JSON.stringify(row.map(c => c.value instanceof Date ? c.value.toISOString() : c.value));
    seen.set(fingerprint, [...(seen.get(fingerprint) ?? []), i + 1]);
    try { if (value("settlementDate") !== null && parseDate(value("settlementDate"), "UTC").date < parseDate(value("operationDate"), "UTC").date) earlierValueDate++; } catch { warnings.push(`Ligne ${i + 1} : date source à vérifier.`); }
  }
  for (const lines of seen.values()) if (lines.length > 1) duplicates.push(lines);
  const nativePea = defaults.accountId === "pea"; const nativeCto = defaults.accountId === "cto";
  const missing = nativePea ? ["ISIN absents", "Prix d’exécution explicites absents", "Quantités présentes dans les libellés, pas dans une colonne dédiée", "Heures absentes", "Devise non indiquée", "Références bancaires absentes", "Frais et retenues non documentés"] : nativeCto ? ["Dates de valeur / règlement absentes", "Références uniques absentes", "Taxes et retenues non documentées", "Ratio du split absent ; +3 titres seulement", "Devise et montant du split absents (aucun flux espèces)", "Taux de change absents ; tous les mouvements monétaires indiquent EUR"] : [];
  return { name: sheet.name, accountId: defaults.accountId ?? null, rows: sheet.grid.length - 1 - blank, blank, types, duplicates, earlierValueDate, fractionalBuys, deposit, buy, dividend, fees, taxes, balance: credit - debit - (mapping.amount !== undefined ? fees + taxes : 0), currencies: [...currencies], missing, warnings, inboundUnclassified: nativeCto };
}