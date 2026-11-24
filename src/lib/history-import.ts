import Papa from "papaparse";
import { unzip } from "unzipit";
import { cashSummary, eventKey, eventSchema, existingEtf, instruments, referenceKey, RECONCILIATION, splitCheck, type Ledger, type LedgerEvent, type OperationType } from "./ledger";
import type { Portfolio } from "./portfolio";
import type { Wealth } from "./wealth";

export type ImportCell = { value: string | number | Date | null; text: string; formula?: boolean };
export type ImportSheet = { name: string; grid: ImportCell[][] };
export type Field = "type" | "operationDate" | "settlementDate" | "timestamp" | "isin" | "name" | "reference" | "quantity" | "executionPrice" | "amount" | "debit" | "credit" | "fees" | "taxes" | "withholding" | "currency" | "fxRate" | "splitRatio" | "transferId";
export const fieldLabels: Record<Field, string> = { type: "Opération", operationDate: "Date d’opération", settlementDate: "Date de valeur / règlement", timestamp: "Date et heure exactes", isin: "ISIN", name: "Instrument", reference: "Référence bancaire", quantity: "Quantité / variation du split", executionPrice: "Prix d’exécution", amount: "Montant", debit: "Débit", credit: "Crédit", fees: "Frais", taxes: "Taxes", withholding: "Retenue", currency: "Devise", fxRate: "Taux de change vers EUR", splitRatio: "Ratio du split", transferId: "Référence du transfert" };
export type Mapping = Partial<Record<Field, number>>;
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const aliases: Record<Field, string[]> = {
  type: ["operation", "type", "typeoperation", "transactiontype", "type de transaction", "libelle operation", "libelle"],
  operationDate: ["date", "dateoperation", "date de transaction", "transactiondate", "bookingdate", "date execution"],
  settlementDate: ["datevaleur", "date de valeur", "valuedate", "settlementdate", "date reglement"], timestamp: ["timestamp", "datetime", "dateheure", "executiontime"],
  isin: ["isin", "codeisin", "instrumentisin", "symbol"], name: ["nom", "instrument", "security", "titre", "name"], reference: ["reference", "transactionid", "id", "numerooperation"],
  quantity: ["quantite", "quantity", "shares", "nombre", "nombre de titres"], executionPrice: ["prix", "cours", "price", "prixexecution", "unitprice"],
  amount: ["montant", "amount", "montantbrut", "montantnet", "total", "valeur"], debit: ["debit"], credit: ["credit"], fees: ["frais", "fee", "fees", "commission", "commissions"], taxes: ["taxe", "taxes", "ttf"],
  withholding: ["retenue", "withholdingtax", "retenuealasource"], currency: ["devise", "currency"], fxRate: ["tauxchange", "fxrate", "exchangerate"], splitRatio: ["ratio", "splitratio", "ratiosplit"], transferId: ["transferid", "referencetransfert"],
};
export function detectMapping(header: ImportCell[]): Mapping {
  const mapping: Mapping = {};
  for (const field of Object.keys(aliases) as Field[]) {
    const matches = header.flatMap((cell, i) => aliases[field].some(a => normalize(a) === normalize(cell.text)) ? [i] : []);
    const match = matches[0];
    if (matches.length === 1 && match !== undefined) mapping[field] = match; // repeated headings stay unassigned, selectable by position
  }
  return mapping;
}
const MAX_ROWS = 20000; const MAX_COLS = 100; const MAX_FILE = 5 * 1024 * 1024;
export function parseCsv(text: string): ImportSheet[] {
  if (new TextEncoder().encode(text).length > MAX_FILE) throw new Error("CSV trop volumineux : maximum 5 Mo.");
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), { dynamicTyping: false, skipEmptyLines: "greedy" });
  const error = result.errors.find(e => e.code !== "UndetectableDelimiter");
  if (error) throw new Error(`CSV invalide : ${error.message}`);
  if (result.data.length > MAX_ROWS + 1 || result.data.some(r => r.length > MAX_COLS)) throw new Error("Maximum 20 000 lignes et 100 colonnes ; découpez le fichier.");
  return [{ name: "CSV", grid: result.data.map(row => row.map(value => ({ value, text: value }))) }];
}
export async function parseExcel(buffer: ArrayBuffer): Promise<ImportSheet[]> {
  if (buffer.byteLength > MAX_FILE) throw new Error("Excel trop volumineux : maximum 5 Mo.");
  const archive = await unzip(buffer);
  if (Object.keys(archive.entries).length > 1000 || Object.values(archive.entries).reduce((n, e) => n + e.size, 0) > 30 * 1024 * 1024) throw new Error("Excel décompressé trop volumineux : maximum 30 Mo.");
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  let totalRows = 0;
  return workbook.worksheets.map(sheet => {
    totalRows += sheet.rowCount;
    if (totalRows > MAX_ROWS + workbook.worksheets.length || sheet.columnCount > MAX_COLS || workbook.worksheets.length > 20) throw new Error("Excel : maximum 20 000 lignes, 100 colonnes et 20 feuilles.");
    const grid: ImportCell[][] = [];
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row: ImportCell[] = [];
      for (let c = 1; c <= sheet.columnCount; c++) {
        const cell = sheet.getCell(r, c);
        const v = cell.value;
        const formula = v !== null && typeof v === "object" && ("formula" in v || "sharedFormula" in v);
        row.push({ value: typeof v === "number" || typeof v === "string" || v instanceof Date ? v : null, text: cell.text, ...(formula ? { formula: true } : {}) });
      }
      grid.push(row);
    }
    return { name: sheet.name, grid };
  });
}
export async function readHistoryFile(file: File) {
  if (file.size > MAX_FILE) throw new Error("Maximum 5 Mo par fichier.");
  if (/\.xlsx$/i.test(file.name)) return parseExcel(await file.arrayBuffer());
  if (/\.(csv|tsv)$/i.test(file.name)) return parseCsv(await file.text());
  throw new Error("Format non pris en charge : CSV, TSV ou Excel .xlsx uniquement. Convertissez les anciens .xls en .xlsx.");
}
export function parseNumber(value: string | number | Date | null, decimal: "comma" | "dot"): number | null {
  if (value === null || value === "") return null;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("Nombre non fini."); return value; }
  if (typeof value !== "string") throw new Error("Nombre attendu.");
  let s = value.trim().replace(/[\s\u00a0\u202f]/g, "").replace(/(?:EUR|USD|GBP|€|\$|£)/gi, "");
  if (/^\(.*\)$/.test(s)) s = `-${s.slice(1, -1)}`;
  if (decimal === "comma") { if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(s)) throw new Error("Nombre invalide (virgule décimale)."); s = s.replace(/\./g, "").replace(",", "."); }
  else { if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s)) throw new Error("Nombre invalide (point décimal)."); s = s.replace(/,/g, ""); }
  const n = Number(s); if (!Number.isFinite(n)) throw new Error("Nombre invalide."); return n;
}
function parisParts(d: Date) {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${p["year"]}-${p["month"]}-${p["day"]}T${p["hour"]}:${p["minute"]}:${p["second"]}`;
}
export function parseDate(value: ImportCell["value"], timezone: "Europe/Paris" | "UTC"): { date: string; timestamp: string | null } {
  if (value instanceof Date) return { date: value.toISOString().slice(0, 10), timestamp: null }; // Excel calendar dates, not UTC instants
  if (typeof value === "number") {
    if (value < 20000 || value > 80000) throw new Error("Date Excel hors limites.");
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return { date: d.toISOString().slice(0, 10), timestamp: null };
  }
  if (typeof value !== "string" || !value.trim()) throw new Error("Date manquante.");
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s)) {
    const result = zTimestamp(s);
    return { date: timezone === "UTC" ? result.toISOString().slice(0, 10) : parisParts(result).slice(0, 10), timestamp: s };
  }
  const match = /^(?:(\d{2})[/.\-](\d{2})[/.\-](\d{4})|(\d{4})-(\d{2})-(\d{2}))(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!match) throw new Error("Date ambiguë : utilisez JJ/MM/AAAA ou AAAA-MM-JJ.");
  const date = match[4] ? `${match[4]}-${match[5]}-${match[6]}` : `${match[3]}-${match[2]}-${match[1]}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(new Date(`${date}T00:00:00Z`).getTime()) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Date invalide.");
  if (!match[7]) return { date, timestamp: null };
  const local = `${date}T${match[7]}:${match[8]}:${match[9] ?? "00"}`;
  const utc = new Date(`${local}Z`);
  if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 19) !== local) throw new Error("Heure invalide.");
  if (timezone === "UTC") return { date, timestamp: utc.toISOString() };
  const candidates = [1, 2].map(offset => new Date(utc.getTime() - offset * 3600000)).filter(d => parisParts(d) === local);
  const candidate = candidates[0];
  if (candidates.length !== 1 || !candidate) throw new Error("Heure locale absente ou ambiguë au changement d’heure : indiquez un horodatage avec décalage UTC.");
  return { date, timestamp: candidate.toISOString() };
}
function zTimestamp(s: string) {
  const d = new Date(s);
  // reject rolled-over dates and impossible times before trusting Date's permissive parser
  const date = s.slice(0, 10);
  const real = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || !Number.isFinite(real.getTime()) || real.toISOString().slice(0, 10) !== date || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(s)) throw new Error("Horodatage invalide.");
  return d;
}
const operationAliases: Record<OperationType, string[]> = { deposit: ["versement", "versementexterne", "deposit", "cashdeposit", "viremententrant", "cashin"], withdrawal: ["retrait", "withdrawal", "virementsortant"], buy: ["achat", "buy", "purchase", "achatdetitres"], sell: ["vente", "sell", "sale"], dividend: ["dividende", "dividend", "dividendes"], fee: ["frais", "fee", "fees", "commission"], tax: ["taxe", "tax", "taxes", "ttf"], split: ["split", "stocksplit", "division", "divisiondetitres"], transfer_in: ["transfertentrant", "transferin"], transfer_out: ["transfertsortant", "transferout"], corporate_action: ["operationsurtitres", "corporateaction", "fusion", "spin off"] };
export function recognizeOperation(s: string): OperationType | null {
  if (/^achat\s+\d+(?:[,.]\d+)?\s+/i.test(s.trim())) return "buy";
  if (/^vente\s+\d+(?:[,.]\d+)?\s+/i.test(s.trim())) return "sell";
  if (/^dividende\s+\d+(?:[,.]\d+)?\s+/i.test(s.trim())) return "dividend";
  if (/^taxe transac finan$/i.test(s.trim())) return "tax";
  if (s.trim() === "TRANSFER_INSTANT_INBOUND") return "transfer_in";
  const key = normalize(s);
  return (Object.keys(operationAliases) as OperationType[]).find(type => operationAliases[type].some(a => normalize(a) === key)) ?? null;
}
export type RowOverride = { type?: OperationType; isin?: string; quantity?: string; executionPrice?: string; splitRatio?: string; ignore?: boolean; verifyInstrument?: boolean };
export type ImportOptions = { accountId: "pea" | "cto"; broker: "fortuneo" | "trade-republic"; file: string; headerRow: number; mapping: Mapping; decimal: "comma" | "dot"; timezone: "Europe/Paris" | "UTC"; currency: string; amountBasis: "unknown" | "gross" | "net"; importedAt: string; overrides: Record<number, RowOverride>; inboundExternalConfirmed?: boolean; missingCurrencyConfirmed?: boolean };
export type PreviewRow = { row: number; cells: ImportCell[]; facts: Partial<LedgerEvent>; recognizedType: OperationType | null; event: LedgerEvent | null; status: "valid" | "duplicate" | "existing-etf" | "review" | "ignored"; issues: string[] };
export function previewHistory(sheet: ImportSheet, options: ImportOptions, portfolio: Portfolio, wealth: Wealth, ledger: Ledger) {
  const header = sheet.grid[options.headerRow - 1];
  if (!header?.some(c => c.text.trim())) throw new Error("Choisissez une ligne d’en-tête non vide.");
  for (const index of Object.values(options.mapping)) if (index !== undefined && (!Number.isInteger(index) || index < 0 || index >= header.length)) throw new Error("Colonne non valide.");
  const known = instruments(portfolio, wealth);
  const keys = new Set(ledger.events.map(eventKey));
  const refs = new Map(ledger.events.flatMap(e => { const k = referenceKey(e); return k ? [[k, eventKey(e)] as const] : []; }));
  const rows: PreviewRow[] = [];
  for (let i = options.headerRow; i < sheet.grid.length; i++) {
    const cells = sheet.grid[i] ?? []; const row = i + 1;
    if (cells.every(c => !c.text.trim())) continue;
    const override = options.overrides[row];
    const result: PreviewRow = { row, cells, facts: {}, recognizedType: null, event: null, status: "review", issues: [] };
    rows.push(result);
    if (override?.ignore) { result.status = "ignored"; result.issues.push("Exclusion explicite."); continue; }
    const cell = (field: Field) => { const index = options.mapping[field]; return index === undefined ? null : cells[index] ?? null; };
    const text = (field: Field) => cell(field)?.text.trim() ?? "";
    const number = (field: Field) => parseNumber(cell(field)?.value ?? null, options.decimal);
    try {
      if (cells.length !== header.length) throw new Error(`Ligne à ${cells.length} colonnes, en-tête à ${header.length}.`);
      if (Object.values(options.mapping).some(index => index !== undefined && cells[index]?.formula)) throw new Error("Cellule calculée : remplacez la formule par sa valeur vérifiée.");
      let type = override?.type ?? recognizeOperation(text("type"));
      if (text("type") === "TRANSFER_INSTANT_INBOUND" && !override?.type && options.inboundExternalConfirmed) type = "deposit";
      result.recognizedType = type;
      if (text("type") === "TRANSFER_INSTANT_INBOUND" && !options.inboundExternalConfirmed && !override?.type) result.issues.push("Virement entrant : confirmer apport extérieur ou transfert entre comptes ; le code bancaire ne suffit pas.");
      if (!type) throw new Error(`Opération non reconnue ou ambiguë : ${text("type") || "colonne manquante"}.`);
      if (type === "corporate_action") throw new Error("Opération sur titres complexe : traitement manuel nécessaire ; aucun flux déduit.");
      const date = parseDate(cell("operationDate")?.value ?? null, options.timezone);
      const settlement = text("settlementDate") ? parseDate(cell("settlementDate")?.value ?? null, options.timezone) : null;
      const exact = text("timestamp") ? parseDate(cell("timestamp")?.value ?? null, options.timezone) : null;
      if (exact && (exact.date !== date.date || !exact.timestamp)) throw new Error("L’heure exacte et la date d’opération ne correspondent pas, ou l’heure manque.");
      const currency = (text("currency") || options.currency).toUpperCase();
      if ((options.mapping.debit !== undefined || options.mapping.credit !== undefined) && !text("currency") && !options.missingCurrencyConfirmed) result.issues.push("Devise absente de l’export Fortuneo : confirmer EUR avant enregistrement.");
      const isin = (override?.isin ?? text("isin")).toUpperCase().replace(/\s/g, "") || null;
      const match = known.filter(p => p.accountId === options.accountId && p.isin === isin);
      if (["buy", "sell", "split", "dividend"].includes(type) && (!isin || (match.length !== 1 && !override?.verifyInstrument))) result.issues.push("ISIN absent, inconnu dans ce compte ou présent plusieurs fois : vérification de l’instrument nécessaire.");
      const labelled = /^(?:achat|vente|dividende)\s+(\d+(?:[,.]\d+)?)\s+(.+)$/i.exec(text("type"));
      const instrumentName = match[0]?.name ?? (text("name") || labelled?.[2] || "");
      if (override?.verifyInstrument && match.length !== 1 && !instrumentName) result.issues.push("Instrument historique : nom et ISIN documentés requis pour une vérification explicite.");
      const quantity = override?.quantity !== undefined ? parseNumber(override.quantity, options.decimal) : number("quantity") ?? (labelled?.[1] ? parseNumber(labelled[1], "comma") : null);
      const executionPrice = override?.executionPrice !== undefined ? parseNumber(override.executionPrice, options.decimal) : number("executionPrice");
      const fees = Math.abs(number("fees") ?? 0); const taxes = Math.abs(number("taxes") ?? 0); const withholding = Math.abs(number("withholding") ?? 0);
      const debit = number("debit"); const credit = number("credit");
      if (debit && credit) result.issues.push("Débit et crédit tous deux renseignés : mouvement ambigu.");
      const rawAmount = number("amount") ?? (debit !== null ? -Math.abs(debit) : credit);
      if (rawAmount === null && type !== "split") throw new Error("Montant absent : aucune valeur inventée.");
      if (quantity !== null && quantity < 0) throw new Error("Quantité signée : vérifier la variation et utiliser une quantité positive pour achats/ventes.");
      let amount = Math.abs(rawAmount ?? 0);
      if (["buy", "sell", "dividend"].includes(type) && options.amountBasis === "unknown") result.issues.push("Confirmez si le montant bancaire est brut ou net des frais/taxes/retenues.");
      if (options.amountBasis === "net") {
        if (type === "buy") amount -= fees + taxes + withholding;
        if (type === "sell" || type === "dividend") amount += fees + taxes + withholding;
      }
      if (["deposit", "transfer_in", "dividend", "sell"].includes(type) && rawAmount !== null && rawAmount < 0) result.issues.push("Signe du montant incompatible avec une entrée d’espèces.");
      if ((type === "fee" && fees > 0) || (type === "tax" && taxes > 0)) result.issues.push("Frais/taxe présents à la fois dans le montant et une colonne séparée : double comptage possible.");
      if (type === "split" && rawAmount !== null && rawAmount !== 0) result.issues.push("Split avec montant financier non nul : vérifier l’opération.");
      if (type === "buy" || type === "sell") {
        if (quantity === null || executionPrice === null || Math.abs(quantity * executionPrice - amount) > Math.max(0.02, amount * 0.001)) result.issues.push("Montant brut différent de quantité × prix ; arrondi, devise ou montant net à vérifier.");
        if (options.accountId === "pea" && quantity !== null && !Number.isInteger(quantity)) result.issues.push("PEA : quantité non entière.");
        if (options.accountId === "cto" && quantity !== null && Math.abs(quantity * 1e6 - Math.round(quantity * 1e6)) > 1e-7) result.issues.push("CTO : fraction supérieure à 6 décimales.");
      }
      const fxRate = currency === "EUR" ? (number("fxRate") ?? 1) : number("fxRate");
      if (currency !== "EUR" && fxRate === null) result.issues.push("Devise étrangère : taux d’exécution vers EUR manquant ; aucun taux actuel substitué.");
      result.facts = { accountId: options.accountId, type, operationDate: date.date, settlementDate: settlement?.date ?? null, timestamp: exact?.timestamp ?? date.timestamp, isin, instrumentId: match[0]?.id ?? null, instrumentName, quantity, executionPrice, amount, fees, taxes, withholding, currency, fxRate, splitRatio: override?.splitRatio ? parseNumber(override.splitRatio, options.decimal) : number("splitRatio"), transferId: text("transferId") || null };
      const event = eventSchema.parse({ ...result.facts, id: crypto.randomUUID(), source: { broker: options.broker, file: options.file, sheet: sheet.name, row, reference: text("reference"), importedAt: options.importedAt, originalColumns: header.map((h, i) => ({ heading: h.text, value: cells[i]?.value instanceof Date ? cells[i]?.value.toISOString() ?? "" : cells[i]?.text ?? "" })) } });
      result.event = event;
      const key = eventKey(event); const ref = referenceKey(event);
      if (ref && refs.has(ref) && refs.get(ref) !== key) { result.issues.push("Même référence bancaire, mais données différentes : conflit à vérifier."); continue; }
      if (keys.has(key) || (ref && refs.has(ref))) { result.status = "duplicate"; result.issues.push("Déjà présent dans le grand livre ou ce fichier."); continue; }
      keys.add(key); if (ref) refs.set(ref, key);
      if (existingEtf(event, portfolio)) { result.status = "existing-etf"; result.issues.push("Transaction ETF déjà enregistrée : exclue, aucune seconde transaction créée."); continue; }
      if (date.date < RECONCILIATION[options.accountId].since) result.issues.push(`Date antérieure au début déclaré (${RECONCILIATION[options.accountId].since}) : vérifier le périmètre.`);
      if (event.type === "split" && event.isin === "US29082A1079" && event.operationDate === "2026-11-16" && (event.splitRatio !== 4 || event.quantity !== 3)) result.issues.push("Embraer : le 16/11/2026, contrôle attendu ratio 4 et +3 ADR.");
      result.status = result.issues.length ? "review" : "valid";
    } catch (e) { result.issues.push(e instanceof Error ? e.message : "Ligne invalide."); }
  }
  const valid = rows.filter(r => r.status === "valid" && r.event !== null).map(r => r.event).filter((e): e is LedgerEvent => e !== null);
  const all = [...ledger.events, ...valid];
  const split = splitCheck(all);
  // Reject inconsistent splits against the available independent historical ledger.
  if (split.issues.length) for (const row of rows) if (row.status === "valid" && row.event?.type === "split" && row.event.isin === "US29082A1079") { row.status = "review"; row.issues.push(...split.issues); }
  const accepted = rows.filter(r => r.status === "valid").flatMap(r => r.event ? [r.event] : []);
  return { rows, accepted, counts: { recognized: rows.filter(r => r.recognizedType !== null).length, valid: accepted.length, ignored: rows.filter(r => r.status === "ignored").length, duplicates: rows.filter(r => r.status === "duplicate" || r.status === "existing-etf").length, review: rows.filter(r => r.status === "review").length }, cash: cashSummary([...ledger.events, ...accepted], options.accountId), split, existingEtfCount: rows.filter(r => r.status === "existing-etf").length };
}