import type { DayPoint, PricePoint } from "./performance";
import { MAX_CARRY_DAYS } from "./performance";

/** Comparison-only market references; never valued, never part of holdings or allocation. Accumulating EUR listings = dividends reinvested. */
export const BENCHMARKS = [
  { id: "world", label: "MSCI World", isin: "IE00B4L5Y983", symbol: "EUNL.DE", product: "iShares Core MSCI World UCITS ETF (Acc)", place: "Xetra", color: "var(--chart-2)" },
  { id: "sp500", label: "S&P 500", isin: "IE00B5BMR087", symbol: "SXR8.DE", product: "iShares Core S&P 500 UCITS ETF (Acc)", place: "Xetra", color: "var(--chart-5)" },
  { id: "ndx", label: "NASDAQ-100", isin: "IE00B53SZB19", symbol: "SXRV.DE", product: "iShares NASDAQ 100 UCITS ETF (Acc)", place: "Xetra", color: "var(--chart-3)" },
  { id: "stoxx600", label: "STOXX Europe 600", isin: "LU0908500753", symbol: "MEUD.PA", product: "Amundi Core Stoxx Europe 600 UCITS ETF Acc", place: "Euronext Paris", color: "var(--chart-4)" },
] as const;
export type BenchmarkId = typeof BENCHMARKS[number]["id"];
export const BENCHMARK_KEY = "equilibre.benchmarks.v1";
export const BENCHMARK_CACHE_HOURS = 12;

const day = (s: string) => Date.parse(`${s}T00:00:00Z`);
function closeAt(points: PricePoint[], date: string): number | null {
  let lo = 0, hi = points.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (points[m]!.date <= date) { best = m; lo = m + 1; } else hi = m - 1; }
  const p = best >= 0 ? points[best]! : null;
  return p && (day(date) - day(p.date)) / 864e5 <= MAX_CARRY_DAYS ? p.close : null;
}

export interface ComparisonRow { date: string; portfolio: number | null; [id: string]: number | string | null }
export interface ComparisonSummary { id: BenchmarkId | "portfolio"; perf: number | null; gapPts: number | null; complete: boolean; lastDate: string | null }

/**
 * Base 100 at the window start: portfolio from the existing windowed TWR, each index from its EUR close.
 * A date counts only when both sides are known; missing data stays null, never interpolated.
 */
export function compareToBenchmarks(points: Pick<DayPoint, "date">[], perf: (number | null)[], start: string, histories: Partial<Record<BenchmarkId, PricePoint[]>>, ids: readonly BenchmarkId[], baseDate: string = start) {
  const rows: ComparisonRow[] = [];
  const base: Partial<Record<BenchmarkId, number | null>> = {};
  for (const id of ids) { const h = histories[id]; base[id] = h ? closeAt(h, baseDate) : null; }
  points.forEach((p, i) => {
    if (p.date < start) return;
    const pv = perf[i] ?? null;
    const row: ComparisonRow = { date: p.date, portfolio: pv === null ? null : 100 * (1 + pv) };
    for (const id of ids) {
      const h = histories[id]; const b = base[id]; const c = h ? closeAt(h, p.date) : null;
      row[id] = pv === null || !b || c === null ? null : 100 * c / b;
    }
    rows.push(row);
  });
  // Summary on the last date common to the portfolio and every displayed index.
  const found = [...rows].reverse().find(r => r.portfolio !== null && ids.every(id => r[id] !== null)) ?? null;
  // Only the base date in common = no measured period: unavailable, not 0 %.
  const common = found && (found !== rows[0] || rows.length === 1) ? found : null;
  const pPerf = common ? (common.portfolio as number) / 100 - 1 : null;
  const summary: ComparisonSummary[] = [{ id: "portfolio", perf: pPerf, gapPts: null, complete: rows.every(r => r.portfolio !== null), lastDate: common?.date ?? null }];
  for (const id of ids) {
    const v = common ? (common[id] as number) / 100 - 1 : null;
    summary.push({ id, perf: v, gapPts: v === null || pPerf === null ? null : (pPerf - v) * 100, complete: base[id] != null && rows.every(r => r.portfolio === null || r[id] !== null), lastDate: common?.date ?? null });
  }
  return { rows, summary };
}

/**
 * Account valued only on observed dates (financial registry): reuses its existing performance index,
 * rebased at the last observation on/before the window start (or the first after it). Null index stays null.
 */
export function registryWindow(history: { date: string; performance: number | null }[], start: string) {
  const before = history.filter(h => h.date <= start).at(-1);
  const baseRow = before ?? history.find(h => h.date >= start) ?? null;
  if (!baseRow) return null;
  const pts = history.filter(h => h.date >= baseRow.date);
  const b = baseRow.performance === null ? null : 1 + baseRow.performance / 100;
  return { baseDate: baseRow.date, points: pts.map(h => ({ date: h.date })), perf: pts.map(h => b === null || h.performance === null ? null : (1 + h.performance / 100) / b - 1) };
}
