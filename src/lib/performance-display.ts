import type { DayPoint } from "./performance";

/** Display-only summaries built from the existing reconstructed series; never alters valuation or TWR. */
const DAY = 864e5;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Gain over the window: end value − start value − external flows after the start day. Null when either value is unknown. */
export function periodGain(points: DayPoint[], start: string): number | null {
  const i0 = points.findIndex(p => p.date >= start); const end = points.at(-1);
  if (i0 < 0 || !end || end.value === null) return null;
  const v0 = points[i0]!.value; if (v0 === null) return null;
  const flows = points.slice(i0 + 1).reduce((s, p) => s + p.flow, 0);
  return end.value - v0 - flows;
}

/** Total gain since the first documented movement: final value − all net external flows. */
export function totalGain(points: DayPoint[]): number | null {
  const end = points.at(-1); if (!end || end.value === null) return null;
  return end.value - points.reduce((s, p) => s + p.flow, 0);
}

/** Money-weighted return (XIRR), cumulated over the window. Start value counts as a deposit, end value as a withdrawal. */
export function periodMwr(points: DayPoint[], start: string): number | null {
  const i0 = points.findIndex(p => p.date >= start); const end = points.at(-1);
  if (i0 < 0 || !end || end.value === null || points[i0]!.value === null) return null;
  const cf: [number, number][] = [[t(points[i0]!.date), -points[i0]!.value!]];
  for (const p of points.slice(i0 + 1)) if (p.flow) cf.push([t(p.date), -p.flow]);
  cf.push([t(end.date), end.value]);
  const t0 = cf[0]![0]; const years = (t(end.date) - t0) / DAY / 365;
  if (years <= 0 || !cf.some(([, v]) => v < 0)) return null;
  const npv = (r: number) => cf.reduce((s, [d, v]) => s + v / (1 + r) ** ((d - t0) / DAY / 365), 0);
  let lo = -0.9999, hi = 100; let flo = npv(lo), fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; const f = npv(mid); if (f * flo > 0) { lo = mid; flo = f; } else hi = mid; }
  return (1 + (lo + hi) / 2) ** years - 1;
}

const MINUS = "\u2212";
export const signedEur = (v: number) => { const r = Math.round(v * 100) / 100; const s = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Math.abs(r)); return r > 0 ? `+${s}` : r < 0 ? `${MINUS}${s}` : s; };
export const signedPct = (v: number) => { const r = Math.round(v * 10000) / 100; const s = `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(r))} %`; return r > 0 ? `+${s}` : r < 0 ? `${MINUS}${s}` : s; };
/** Semantic tone for a signed value rounded to display precision. */
export const tone = (v: number | null, digits = 2) => v === null || Math.round(v * 10 ** digits) === 0 ? "text-muted-foreground" : v > 0 ? "text-success" : "text-destructive";
