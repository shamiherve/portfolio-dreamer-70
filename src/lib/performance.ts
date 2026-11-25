import { z } from "zod";
import type { Portfolio } from "./portfolio";
import type { LedgerEvent } from "./ledger";
import { existingEtf } from "./ledger";

/** Read-only reconstruction of PEA/CTO valuations; never writes holdings, ledger or quotes. */
export const ACCOUNTS = ["pea", "cto"] as const;
export type AccountId = typeof ACCOUNTS[number];
export interface Move { date: string; account: AccountId; isin: string | null; dq: number; cash: number; external: number; label: string }
export interface PricePoint { date: string; close: number }
/** Max calendar days a close can be carried (weekends/holidays) before the date counts as missing. */
export const MAX_CARRY_DAYS = 6;

const day = (s: string) => Date.parse(`${s}T00:00:00Z`);
export const addDays = (s: string, n: number) => new Date(day(s) + n * 864e5).toISOString().slice(0, 10);
const isAccount = (a: string): a is AccountId => (ACCOUNTS as readonly string[]).includes(a);

/** Builds dated movements; ledger buys already recorded as ETF transactions are counted once (from the ETF record). */
export function buildMoves(events: LedgerEvent[], portfolio: Portfolio) {
  const moves: Move[] = []; const issues: string[] = [];
  for (const e of events) {
    if (!isAccount(e.accountId)) continue;
    if (existingEtf(e, portfolio)) continue;
    if (e.currency !== "EUR") { issues.push(`Mouvement en ${e.currency} du ${e.operationDate} non converti : espèces de ${e.accountId.toUpperCase()} incomplètes.`); continue; }
    const costs = e.fees + e.taxes + e.withholding;
    const m: Move = { date: e.operationDate, account: e.accountId, isin: e.isin, dq: 0, cash: 0, external: 0, label: e.type };
    switch (e.type) {
      case "deposit": case "transfer_in": m.cash = e.amount - costs; m.external = e.amount; break;
      case "withdrawal": case "transfer_out": m.cash = -e.amount - costs; m.external = -e.amount; break;
      case "buy": m.dq = e.quantity ?? 0; m.cash = -e.amount - costs; break;
      case "sell": m.dq = -(e.quantity ?? 0); m.cash = e.amount - costs; break;
      case "dividend": m.cash = e.amount - costs; break;
      case "fee": case "tax": m.cash = -e.amount - costs; break;
      case "split": m.dq = e.quantity ?? 0; break;
      case "corporate_action": if ((e.quantity ?? 0) !== 0 || e.amount !== 0) issues.push(`Opération sur titres du ${e.operationDate} (${e.instrumentName}) non interprétée.`); continue;
    }
    moves.push(m);
  }
  for (const t of portfolio.transactions) {
    const isin = portfolio.positions.find(p => p.id === t.positionId)?.isin ?? null;
    if (!isin) { issues.push(`Transaction ETF du ${t.date} sans instrument : ignorée.`); continue; }
    const v = t.price * t.quantity;
    moves.push({ date: t.date, account: "pea", isin, dq: t.type === "buy" ? t.quantity : -t.quantity, cash: t.type === "buy" ? -v : v, external: 0, label: `etf-${t.type}` });
  }
  moves.sort((a, b) => a.date.localeCompare(b.date));
  return { moves, issues };
}

export interface LedgerSplit { isin: string; date: string; ratio: number }
/** Ledger splits with their ratio (quantity after / before), derived from the reconstructed quantities. */
export function ledgerSplits(moves: Move[]): LedgerSplit[] {
  const q = new Map<string, number>(); const out: LedgerSplit[] = [];
  for (const m of moves) {
    if (!m.isin || !m.dq) continue;
    const k = `${m.account}|${m.isin}`; const before = q.get(k) ?? 0;
    if (m.label === "split" && before > 0) out.push({ isin: m.isin, date: m.date, ratio: (before + m.dq) / before });
    q.set(k, before + m.dq);
  }
  return out;
}
export type PriceConvention = "raw" | "split-adjusted" | "unknown";
export interface ProviderSplit { date: string; numerator: number; denominator: number }
/** Never infer an adjustment convention or event identity from price levels or nearby dates.
 * Unknown split series are unavailable; trusted adjusted series are normalised once to ledger units. */
export function alignSplits(points: PricePoint[], isin: string, splits: LedgerSplit[], providerSplits: readonly (ProviderSplit | string)[], convention: PriceConvention = "unknown") {
  const relevant = splits.filter(s => s.isin === isin && Math.abs(s.ratio - 1) > 1e-9);
  const unavailable = (reason: string) => ({ points: [] as PricePoint[], applied: [] as LedgerSplit[], available: false, reason });
  if (!relevant.length && !providerSplits.length) return { points, applied: [] as LedgerSplit[], available: true, reason: null };
  if (convention === "unknown") return unavailable("Convention des cours autour du split non établie : valorisation indisponible.");
  if (relevant.some(s => !Number.isFinite(s.ratio) || s.ratio <= 0) || new Set(relevant.map(s => s.date)).size !== relevant.length) return unavailable("Splits du grand livre ambigus : valorisation indisponible.");
  const events: ProviderSplit[] = [];
  for (const event of providerSplits) {
    if (typeof event === "string" || !Number.isFinite(event.numerator) || !Number.isFinite(event.denominator) || event.numerator <= 0 || event.denominator <= 0) return unavailable("Ratio du split fournisseur indisponible : valorisation indisponible.");
    if (!relevant.some(s => s.date === event.date && Math.abs(s.ratio - event.numerator / event.denominator) < 1e-9)) return unavailable("Date ou ratio du split fournisseur incompatible avec le grand livre : valorisation indisponible.");
    events.push(event);
  }
  if (convention === "raw") return { points, applied: [] as LedgerSplit[], available: true, reason: null };
  if (events.length !== relevant.length || relevant.some(s => !events.some(e => e.date === s.date && Math.abs(s.ratio - e.numerator / e.denominator) < 1e-9))) return unavailable("Correspondance des splits ajustés non établie : valorisation indisponible.");
  return { available: true, reason: null, applied: relevant, points: points.map(p => ({ date: p.date, close: p.close * relevant.filter(s => p.date < s.date).reduce((f, s) => f * s.ratio, 1) })) };
}

export interface DayPoint { date: string; value: number | null; flow: number; missing: string[]; carried: string[]; cash: number }
export type Series = Record<AccountId | "global", DayPoint[]>;

function priceAt(points: PricePoint[] | undefined, date: string, splitDates: readonly string[] = []) {
  if (!points) return null;
  let lo = 0, hi = points.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; const candidate = points[mid]; if (!candidate) return null; if (candidate.date <= date) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  const p = best >= 0 ? points[best] : undefined;
  if (!p || (day(date) - day(p.date)) / 864e5 > MAX_CARRY_DAYS) return null;
  if (splitDates.some(s => p.date < s && s <= date)) return null;
  return { close: p.close, carried: p.date !== date };
}

/** Daily value = Σ quantity × EUR close + cash. Missing prices make the day null — never interpolated. */
export function reconstruct(moves: Move[], prices: Map<string, PricePoint[]>, to: string, names: Map<string, string> = new Map(), splits: LedgerSplit[] = ledgerSplits(moves)): Series {
  const out: Series = { pea: [], cto: [], global: [] };
  if (!moves.length) return out;
  const from = moves[0]!.date;
  const qty = new Map<string, number>(); const cash = { pea: 0, cto: 0 }; const opened = { pea: false, cto: false };
  let i = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const flows = { pea: 0, cto: 0 };
    while (i < moves.length && moves[i]!.date <= d) {
      const m = moves[i++]!; opened[m.account] = true; cash[m.account] += m.cash; flows[m.account] += m.external;
      if (m.isin && m.dq) { const k = `${m.account}|${m.isin}`; qty.set(k, Math.round(((qty.get(k) ?? 0) + m.dq) * 1e8) / 1e8); }
    }
    for (const a of ACCOUNTS) {
      if (!opened[a]) { out[a].push({ date: d, value: 0, flow: 0, missing: [], carried: [], cash: 0 }); continue; }
      let v = cash[a]; const missing: string[] = []; const carried: string[] = [];
      for (const [k, q] of qty) {
        const [acc, isin] = k.split("|") as [string, string];
        if (acc !== a || Math.abs(q) < 1e-9) continue;
        const p = priceAt(prices.get(isin), d, splits.filter(s => s.isin === isin).map(s => s.date));
        if (!p) { missing.push(names.get(isin) ?? isin); continue; }
        if (p.carried) carried.push(names.get(isin) ?? isin);
        v += q * p.close;
      }
      out[a].push({ date: d, value: missing.length ? null : Math.round(v * 100) / 100, flow: flows[a], missing, carried, cash: Math.round(cash[a] * 100) / 100 });
    }
    const p = out.pea.at(-1)!, c = out.cto.at(-1)!;
    out.global.push({ date: d, value: p.value === null || c.value === null ? null : Math.round((p.value + c.value) * 100) / 100, flow: p.flow + c.flow, missing: [...p.missing, ...c.missing], carried: [...p.carried, ...c.carried], cash: p.cash + c.cash });
  }
  return out;
}

/** Time-weighted index: external flows neutralised (treated end of day); unknown days bridged by one sub-period, never interpolated. */
export function twrIndex(points: DayPoint[]): (number | null)[] {
  let index = 1, last: number | null = null, flowSince = 0;
  return points.map(p => {
    if (p.value === null) { flowSince += p.flow; return null; }
    const flow = flowSince + p.flow; flowSince = 0;
    if (last !== null && last > 0) index *= (p.value - flow) / last;
    last = p.value; return index;
  });
}

export const PERIODS = [
  { id: "1d", label: "1 jour" }, { id: "1w", label: "1 semaine" }, { id: "1m", label: "1 mois" }, { id: "3m", label: "3 mois" },
  { id: "6m", label: "6 mois" }, { id: "1y", label: "1 an" }, { id: "all", label: "Tout" },
] as const;
export type PeriodId = typeof PERIODS[number]["id"];

/** Start of window. 1 jour = previous day carrying a fresh close (not a carried one). */
export function windowStart(period: PeriodId, points: DayPoint[]): string | null {
  if (!points.length) return null;
  const last = points.at(-1)!.date, first = points[0]!.date;
  const clamp = (d: string) => d < first ? first : d;
  switch (period) {
    case "1d": { const fresh = points.filter(p => p.value !== null && p.carried.length === 0 && p.date < last); return fresh.at(-1)?.date ?? first; }
    case "1w": return clamp(addDays(last, -7));
    case "1m": return clamp(new Date(Date.UTC(+last.slice(0, 4), +last.slice(5, 7) - 2, +last.slice(8, 10))).toISOString().slice(0, 10));
    case "3m": return clamp(new Date(Date.UTC(+last.slice(0, 4), +last.slice(5, 7) - 4, +last.slice(8, 10))).toISOString().slice(0, 10));
    case "6m": return clamp(new Date(Date.UTC(+last.slice(0, 4), +last.slice(5, 7) - 7, +last.slice(8, 10))).toISOString().slice(0, 10));
    case "1y": return clamp(addDays(last, -365));
    case "all": return first;
  }
}

/** Performance over the window, rebased to 0 % at its start; null when no known start value. */
export function windowPerformance(points: DayPoint[], start: string) {
  const idx = twrIndex(points);
  let base: number | null = null;
  for (let i = 0; i < points.length && points[i]!.date <= start; i++) if (idx[i] !== null) base = idx[i]!;
  return points.map((p, i) => p.date < start ? null : (base === null || idx[i] === null ? null : idx[i]! / base - 1));
}

/** Converts closes to EUR with the last ECB rate on/before the date (≤ MAX_CARRY_DAYS old); otherwise the point is dropped. */
export function toEur(points: PricePoint[], currency: string, fx: PricePoint[] | undefined): PricePoint[] {
  if (currency === "EUR") return points;
  return points.flatMap(p => { const r = priceAt(fx, p.date); return r ? [{ date: p.date, close: p.close / r.close }] : []; });
}

/** Current quantities implied by the movements, for consistency checks against saved positions (never applied). */
export function finalQuantities(moves: Move[]) {
  const q = new Map<string, number>();
  for (const m of moves) if (m.isin && m.dq) { const k = `${m.account}|${m.isin}`; q.set(k, Math.round(((q.get(k) ?? 0) + m.dq) * 1e8) / 1e8); }
  return q;
}

export const SNAPSHOTS_KEY = "equilibre.snapshots.v1";
const snapshotSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), at: z.string().datetime(), total: z.number().finite(), pea: z.number().finite(), cto: z.number().finite(), perfPea: z.number().finite().nullable(), perfCto: z.number().finite().nullable(), perfGlobal: z.number().finite().nullable() }).strict();
export const snapshotsSchema = z.object({ version: z.literal(1), enabledAt: z.string().datetime(), backupAt: z.string().datetime(), items: z.array(snapshotSchema) }).strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Snapshots = z.infer<typeof snapshotsSchema>;
/** One snapshot per date: a later one the same day replaces the earlier. */
export function upsertSnapshot(s: Snapshots, snap: Snapshot): Snapshots {
  return snapshotsSchema.parse({ ...s, items: [...s.items.filter(x => x.date !== snap.date), snap].sort((a, b) => a.date.localeCompare(b.date)) });
}
/** User-confirmed (24/11/2026) listings for ISINs the provider search cannot resolve; history only, never quotes or positions. */
export const CONFIRMED_HISTORY_SYMBOLS: Record<string, string> = { FR0011550193: "ETZ.PA" };

export interface BreakdownLine { account: AccountId; isin: string; quantity: number; close: number | null; priceDate: string | null; value: number | null }
/** Read-only detail of one day: reconstructed quantities × EUR close, plus net cash per account. */
export function dayBreakdown(moves: Move[], prices: Map<string, PricePoint[]>, date: string, splits: LedgerSplit[] = ledgerSplits(moves)) {
  const qty = new Map<string, number>(); const cash = { pea: 0, cto: 0 };
  for (const m of moves) {
    if (m.date > date) break;
    cash[m.account] += m.cash;
    if (m.isin && m.dq) { const k = `${m.account}|${m.isin}`; qty.set(k, Math.round(((qty.get(k) ?? 0) + m.dq) * 1e8) / 1e8); }
  }
  const lines: BreakdownLine[] = [];
  for (const [k, q] of qty) {
    if (Math.abs(q) < 1e-9) continue;
    const [account, isin] = k.split("|") as [AccountId, string];
    const pts = prices.get(isin); const p = priceAt(pts, date, splits.filter(s => s.isin === isin).map(s => s.date));
    let priceDate: string | null = null;
    if (p && pts) priceDate = [...pts].reverse().find(x => x.date <= date)?.date ?? null;
    lines.push({ account, isin, quantity: q, close: p?.close ?? null, priceDate, value: p ? Math.round(q * p.close * 100) / 100 : null });
  }
  return { lines, cash: { pea: Math.round(cash.pea * 100) / 100, cto: Math.round(cash.cto * 100) / 100 } };
}
