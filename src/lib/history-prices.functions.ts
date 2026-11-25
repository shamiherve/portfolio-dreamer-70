import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PriceConvention, ProviderSplit } from "./performance";

/** Read-only historical closes (Yahoo) and ECB FX. Never substitutes another listing. */
const UA = { "User-Agent": "Mozilla/5.0 (equilibre personal portfolio)", Accept: "application/json,text/csv" };
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key); if (hit && Date.now() - hit.at < 3600e3) return hit.value as T;
  const value = await load(); cache.set(key, { at: Date.now(), value }); return value;
}
async function get(url: string) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) });
    if (r.ok) return r;
    if (r.status !== 429 && r.status < 500) throw new Error(`Erreur fournisseur ${r.status}`);
    await new Promise(res => setTimeout(res, 800 * 2 ** i));
  }
  throw new Error("Fournisseur indisponible");
}
export interface HistoryCheck { key: string; isin: string; symbol: string | null; exchange: string | null; currency: string | null; points: { date: string; close: number }[]; first: string | null; issues: string[]; providerSplits?: string[]; splitEvents?: ProviderSplit[]; priceConvention?: PriceConvention }

type ChartJson = { chart?: { result?: { meta?: { symbol?: string; currency?: string; exchangeName?: string; gmtoffset?: number }; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] }; events?: { splits?: Record<string, { date: number; numerator: number; denominator: number }> } }[] } };

/** Preserve Yahoo closes verbatim. A split event does not establish their adjustment convention. */
export function parseHistory(j: ChartJson) {
  const r = j.chart?.result?.[0]; const meta = r?.meta;
  if (!r || !meta) throw new Error("Historique introuvable");
  const off = meta.gmtoffset ?? 0; const closes = r.indicators?.quote?.[0]?.close ?? [];
  const splits = Object.values(r.events?.splits ?? {});
  const points = (r.timestamp ?? []).flatMap((t, i) => {
    const c = closes[i]; if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) return [];
    return [{ date: new Date((t + off) * 1000).toISOString().slice(0, 10), close: c }];
  });
  const dedup = new Map(points.map(p => [p.date, p]));
  const splitEvents = splits.map(sp => ({ date: new Date((sp.date + off) * 1000).toISOString().slice(0, 10), numerator: sp.numerator, denominator: sp.denominator })).sort((a, b) => a.date.localeCompare(b.date));
  const providerSplits = splitEvents.map(sp => sp.date);
  return { providerSplits, splitEvents, priceConvention: "unknown" as const, symbol: meta.symbol ?? "", currency: meta.currency ?? "", exchange: meta.exchangeName ?? "", points: [...dedup.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

const item = z.object({ key: z.string().max(80), isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/), symbol: z.string().regex(/^[A-Za-z0-9.^=-]{1,20}$/).nullable(), currency: z.string().regex(/^[A-Z]{3}$/) });
export const fetchHistory = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ items: z.array(item).max(30), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data }) => {
    const p1 = Math.floor(Date.parse(`${data.from}T00:00:00Z`) / 1000) - 14 * 86400; const p2 = Math.floor(Date.now() / 1000) + 86400;
    const checks: HistoryCheck[] = [];
    for (const it of data.items) {
      const c: HistoryCheck = { key: it.key, isin: it.isin, symbol: it.symbol, exchange: null, currency: null, points: [], first: null, issues: [] };
      try {
        if (!c.symbol) {
          // ISIN-only instruments (PEA): accept only a single Euronext Paris EUR listing.
          const s = await cached(`s:${it.isin}`, async () => (await (await get(`https://query2.finance.yahoo.com/v1/finance/search?q=${it.isin}&quotesCount=10&newsCount=0`)).json()) as { quotes?: { symbol?: string; exchange?: string }[] });
          const paris = (s.quotes ?? []).filter(q => q.exchange === "PAR" && q.symbol);
          if (paris.length !== 1) { c.issues.push(paris.length ? `Plusieurs cotations Paris (${paris.map(q => q.symbol).join(", ")}) : aucune retenue.` : "Aucune cotation Euronext Paris trouvée pour cet ISIN."); checks.push(c); continue; }
          c.symbol = paris[0]!.symbol!;
        }
        const h = await cached(`h:${c.symbol}:${p1}`, async () => parseHistory(await (await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(c.symbol!)}?period1=${p1}&period2=${p2}&interval=1d&events=split`)).json() as ChartJson));
        c.exchange = h.exchange; c.currency = h.currency;
        if (h.symbol.toUpperCase() !== c.symbol.toUpperCase()) c.issues.push("Le symbole renvoyé ne correspond pas au symbole demandé.");
        else if (h.currency !== it.currency) c.issues.push(`Devise de cotation ${h.currency} différente de la devise attendue ${it.currency}.`);
        else { c.points = h.points; c.providerSplits = h.providerSplits ?? []; c.splitEvents = h.splitEvents; c.priceConvention = h.priceConvention; c.first = h.points[0]?.date ?? null; if (!h.points.length) c.issues.push("Aucun cours historique disponible."); }
      } catch (e) { c.issues.push(e instanceof Error ? e.message : "Historique indisponible"); }
      checks.push(c);
    }
    const currencies = [...new Set(data.items.map(i => i.currency).filter(c => c !== "EUR"))];
    const fx: Record<string, { date: string; close: number }[]> = {}; const fxIssues: string[] = [];
    for (const cur of currencies) {
      try {
        const csv = await cached(`fx:${cur}:${data.from}`, async () => (await get(`https://data-api.ecb.europa.eu/service/data/EXR/D.${cur}.EUR.SP00.A?startPeriod=${addDaysIso(data.from, -14)}&format=csvdata`)).text());
        const [head, ...rows] = csv.trim().split(/\r?\n/); const cols = (head ?? "").split(",");
        const ti = cols.indexOf("TIME_PERIOD"), vi = cols.indexOf("OBS_VALUE");
        fx[cur] = rows.flatMap(r => { const f = r.split(","); const v = Number(f[vi]); return f[ti] && v > 0 ? [{ date: f[ti]!, close: v }] : []; }).sort((a, b) => a.date.localeCompare(b.date));
        if (!fx[cur]!.length) fxIssues.push(`Taux BCE ${cur} indisponibles.`);
      } catch (e) { fxIssues.push(`Taux BCE ${cur} : ${e instanceof Error ? e.message : "indisponibles"}`); }
    }
    return { checks, fx, fxIssues, at: new Date().toISOString() };
  });
function addDaysIso(s: string, n: number) { return new Date(Date.parse(`${s}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10); }
