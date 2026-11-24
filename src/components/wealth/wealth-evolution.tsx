import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchHistory, type HistoryCheck } from "@/lib/history-prices.functions";
import { DATA_KEYS } from "@/lib/local-transaction";
import { notifyLocalData, subscribeLocalData } from "@/lib/local-data-events";
import { readLedger, HISTORICAL_INSTRUMENTS } from "@/lib/ledger";
import { readCompleteBackup } from "@/lib/backup-restoration";
import { downloadJson } from "@/components/portfolio/target-editor";
import { eur } from "@/lib/rebalance";
import type { Portfolio } from "@/lib/portfolio";
import type { Wealth } from "@/lib/wealth";
import { ISIN_PATTERN, knownListings } from "@/lib/instrument-mapping";
import { CONFIRMED_HISTORY_SYMBOLS, buildMoves, finalQuantities, dayBreakdown, PERIODS, reconstruct, SNAPSHOTS_KEY, snapshotsSchema, toEur, upsertSnapshot, windowPerformance, windowStart, type PeriodId, type PricePoint, type Snapshots } from "@/lib/performance";

type Key = "global" | "pea" | "cto";
const SERIES: { id: Key; label: string; color: string }[] = [
  { id: "global", label: "Global (PEA + CTO)", color: "var(--chart-1)" },
  { id: "pea", label: "PEA", color: "var(--chart-4)" },
  { id: "cto", label: "CTO", color: "var(--chart-3)" },
];
const today = () => new Date().toISOString().slice(0, 10);
const fr = (d: string | null) => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "—";
const pct = (n: number | null) => n === null ? "—" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)} %`;

export function WealthEvolution({ portfolio, wealth }: { portfolio: Portfolio; wealth: Wealth }) {
  const [shown, setShown] = useState<Key[]>(["global"]);
  const [mode, setMode] = useState<"value" | "perf">("value");
  const [period, setPeriod] = useState<PeriodId>("all");
  const [data, setData] = useState<{ checks: HistoryCheck[]; fx: Record<string, PricePoint[]>; fxIssues: string[]; at: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [events, setEvents] = useState<ReturnType<typeof readLedger>["events"] | null>(null);
  const [snaps, setSnaps] = useState<Snapshots | null>(null);

  useEffect(() => {
    let ledgerRaw: string | null | undefined, snapshotsRaw: string | null | undefined;
    const read = () => {
      try { const raw = localStorage.getItem("equilibre.ledger.v1"); if (raw !== ledgerRaw) { setEvents(readLedger(localStorage).events); ledgerRaw = raw; } setLedgerError(null); } catch { setLedgerError("Grand livre illisible : aucune reconstitution possible."); setEvents([]); }
      try { const raw = localStorage.getItem(SNAPSHOTS_KEY); if (raw !== snapshotsRaw) { setSnaps(raw ? snapshotsSchema.parse(JSON.parse(raw)) : null); snapshotsRaw = raw; } } catch { setErr("Instantanés locaux illisibles : ils n’ont pas été modifiés."); }
    };
    read(); return subscribeLocalData(DATA_KEYS, read);
  }, []);

  const { moves, issues } = useMemo(() => events ? buildMoves(events, portfolio) : { moves: [], issues: [] }, [events, portfolio]);
  const instruments = useMemo(() => {
    const seen = new Map<string, { key: string; isin: string; symbol: string | null; currency: string; name: string; account: string }>();
    for (const m of moves) {
      if (!m.isin || seen.has(m.isin)) continue;
      const etf = portfolio.positions.find(p => p.isin === m.isin);
      const h = wealth.holdings.find(x => x.isin === m.isin && x.accountId === m.account);
      const hist = HISTORICAL_INSTRUMENTS.find(x => x.isin === m.isin);
      const verifiedYahoo = h?.market && ["verified", "corrected"].includes(h.market.status) && h.market.provider === "yahoo" ? (h.market.userSymbol ?? h.market.symbol) : null;
      // Never send a bare ISIN as a chart symbol; reuse the instrument mapping's Euronext Paris listing when one exists.
      const yahoo = verifiedYahoo && !ISIN_PATTERN.test(verifiedYahoo) ? verifiedYahoo : null;
      const mappedParis = knownListings(m.isin).find(c => c.exchange === "PAR")?.symbol ?? null;
      seen.set(m.isin, { key: m.isin, isin: m.isin, symbol: CONFIRMED_HISTORY_SYMBOLS[m.isin] ?? (etf ? null : m.account === "pea" ? (mappedParis ?? yahoo) : (yahoo ?? mappedParis)), currency: etf || hist ? "EUR" : (h?.market?.verified?.currency ?? h?.currency ?? "EUR"), name: etf?.name ?? h?.name ?? hist?.name ?? m.isin, account: m.account });
    }
    return [...seen.values()];
  }, [moves, portfolio.positions, wealth.holdings]);

  async function load() {
    const firstMove = moves[0];
    if (!firstMove) return;
    setLoading(true); setErr(null);
    try { setData(await fetchHistory({ data: { items: instruments.map(({ key, isin, symbol, currency }) => ({ key, isin, symbol, currency })), from: firstMove.date } })); }
    catch (e) { setErr(e instanceof Error ? e.message : "Cours historiques indisponibles"); }
    finally { setLoading(false); }
  }
  const requestKey = JSON.stringify([moves[0]?.date, instruments.map(i => [i.key, i.symbol, i.currency])]);
  useEffect(() => { if (events && moves.length) void load(); }, [requestKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const prices = useMemo(() => {
    const map = new Map<string, PricePoint[]>();
    if (!data) return map;
    for (const c of data.checks) {
      const inst = instruments.find(i => i.key === c.key);
      if (!inst || !c.points.length) continue;
      let pts = toEur(c.points, inst.currency, data.fx[inst.currency]);
      // Euronext closes already recorded in the browser complete days Yahoo lacks; never override Yahoo.
      if (inst.currency === "EUR") {
        const extra = (portfolio.quoteHistory ?? []).filter(q => q.isin === inst.isin).map(q => ({ date: q.tradeTimestamp.slice(0, 10), close: q.price })).filter(q => !pts.some(p => p.date === q.date));
        pts = [...pts, ...extra].sort((a, b) => a.date.localeCompare(b.date));
      }
      map.set(inst.isin, pts);
    }
    return map;
  }, [data, instruments, portfolio.quoteHistory]);
  const names = useMemo(() => new Map(instruments.map(i => [i.isin, i.name])), [instruments]);
  const series = useMemo(() => data ? reconstruct(moves, prices, today(), names) : null, [data, moves, prices, names]);
  const start = series ? windowStart(period, series.global) : null;
  const perf = useMemo(() => series && start ? { global: windowPerformance(series.global, start), pea: windowPerformance(series.pea, start), cto: windowPerformance(series.cto, start) } : null, [series, start]);
  const allPerf = useMemo(() => series ? { global: windowPerformance(series.global, series.global[0]!.date), pea: windowPerformance(series.pea, series.pea[0]!.date), cto: windowPerformance(series.cto, series.cto[0]!.date) } : null, [series]);

  // Daily snapshot of today's reconstructed values, only once enabled and only when complete.
  useEffect(() => {
    if (!snaps || !series || !allPerf) return;
    const g = series.global.at(-1), p = series.pea.at(-1), c = series.cto.at(-1);
    if (!g || !p || !c || g.date !== today() || g.value === null || p.value === null || c.value === null) return;
    try {
      const next = upsertSnapshot(snaps, { date: g.date, at: new Date().toISOString(), total: g.value, pea: p.value, cto: c.value, perfGlobal: allPerf.global.at(-1) ?? null, perfPea: allPerf.pea.at(-1) ?? null, perfCto: allPerf.cto.at(-1) ?? null });
      const prev = snaps.items.find(i => i.date === g.date);
      if (prev && prev.total === g.value && prev.pea === p.value && prev.cto === c.value) return;
      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(next)); notifyLocalData([SNAPSHOTS_KEY]);
    } catch { setErr("Instantané du jour non enregistré."); }
  }, [snaps, series, allPerf]);

  function enableSnapshots() {
    try {
      const b = readCompleteBackup(localStorage); downloadJson(b.content, b.filename);
      const now = new Date().toISOString();
      const s = snapshotsSchema.parse({ version: 1, enabledAt: now, backupAt: now, items: [] });
      if (localStorage.getItem(SNAPSHOTS_KEY) !== null) return;
      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(s)); notifyLocalData([SNAPSHOTS_KEY]);
    } catch (e) { setErr(e instanceof Error ? `Sauvegarde impossible : ${e.message}` : "Sauvegarde impossible : instantanés non activés."); }
  }

  const rows = useMemo(() => {
    if (!series || !start || !perf) return [];
    const snapBy = new Map((snaps?.items ?? []).map(s => [s.date, s]));
    return series.global.flatMap((g, i) => g.date < start ? [] : [{
      date: g.date,
      global: mode === "value" ? g.value : perf.global[i] === null ? null : perf.global[i]! * 100,
      pea: mode === "value" ? series.pea[i]!.value : perf.pea[i] === null ? null : perf.pea[i]! * 100,
      cto: mode === "value" ? series.cto[i]!.value : perf.cto[i] === null ? null : perf.cto[i]! * 100,
      snapGlobal: mode === "value" ? snapBy.get(g.date)?.total ?? null : null,
      snapPea: mode === "value" ? snapBy.get(g.date)?.pea ?? null : null,
      snapCto: mode === "value" ? snapBy.get(g.date)?.cto ?? null : null,
      carried: g.carried.length > 0,
    }]);
  }, [series, start, perf, mode, snaps]);

  const incomplete = series ? series.global.filter(p => p.value === null && (!start || p.date >= start)) : [];
  const missingNames = [...new Set(incomplete.flatMap(p => p.missing))];
  const qtyIssues = useMemo(() => {
    const q = finalQuantities(moves); const out: string[] = [];
    for (const [k, v] of q) {
      const [acc, isin] = k.split("|") as [string, string];
      const current = acc === "pea" ? portfolio.positions.find(p => p.isin === isin)?.quantity ?? wealth.holdings.find(h => h.isin === isin && h.accountId === acc)?.quantity : wealth.holdings.find(h => h.isin === isin && h.accountId === acc)?.quantity;
      if (current !== undefined && Math.abs(current - v) > 1e-6) out.push(`${names.get(isin) ?? isin} (${acc.toUpperCase()}) : ${v} reconstitué(s) contre ${current} enregistré(s).`);
    }
    return out;
  }, [moves, portfolio.positions, wealth.holdings, names]);

  const toggle = (k: Key) => setShown(s => s.includes(k) ? (s.length > 1 ? s.filter(x => x !== k) : s) : [...s, k]);
  const last = series?.global.at(-1);
  const lastFresh = series ? [...series.global].reverse().find(p => p.value !== null && p.carried.length === 0) : undefined;
  const summary = (k: Key) => {
    if (!series || !perf) return null;
    const pts = series[k]; const i0 = pts.findIndex(p => p.date >= (start ?? ""));
    return { value: pts.at(-1)?.value ?? null, perf: perf[k].at(-1) ?? null, startValue: i0 >= 0 ? pts[i0]!.value : null };
  };

  return <section className="space-y-4 rounded-lg border border-border bg-surface p-4" aria-labelledby="evolution-title">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 id="evolution-title" className="text-lg font-semibold">Évolution du patrimoine</h2>
        <p className="text-xs text-muted-foreground">PEA et CTO reconstitués à partir du grand livre, des transactions ETF et des cours de clôture historiques. Lecture seule.</p></div>
      <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading || !moves.length}><RefreshCw className={loading ? "animate-spin" : ""} />Actualiser l’historique</Button>
    </div>

    <div className="flex flex-wrap gap-4">
      <div role="group" aria-label="Enveloppes" className="flex flex-wrap gap-1">{SERIES.map(s => <Button key={s.id} size="sm" variant={shown.includes(s.id) ? "default" : "outline"} aria-pressed={shown.includes(s.id)} onClick={() => toggle(s.id)}><span className="size-2 rounded-full" style={{ background: s.color }} />{s.label}</Button>)}</div>
      <div role="group" aria-label="Mode" className="flex gap-1">{([["value", "Valeur (€)"], ["perf", "Performance (%)"]] as const).map(([id, l]) => <Button key={id} size="sm" variant={mode === id ? "default" : "outline"} aria-pressed={mode === id} onClick={() => setMode(id)}>{l}</Button>)}</div>
      <div role="group" aria-label="Période" className="flex flex-wrap gap-1">{PERIODS.map(p => <Button key={p.id} size="sm" variant={period === p.id ? "default" : "outline"} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>{p.label}</Button>)}</div>
    </div>

    {ledgerError && <p role="alert" className="text-sm text-destructive">{ledgerError}</p>}
    {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
    {events && !moves.length && <p className="text-sm text-muted-foreground">Aucun mouvement PEA ou CTO dans le grand livre de ce navigateur : rien à reconstituer.</p>}
    {loading && !data && <p className="text-sm text-muted-foreground">Récupération des cours historiques…</p>}

    {series && <>
      <div className="grid gap-3 text-sm sm:grid-cols-3">{SERIES.filter(s => shown.includes(s.id)).map(s => { const x = summary(s.id); return <div key={s.id} className="rounded-md border border-border p-3">
        <p className="text-xs text-muted-foreground">{s.label}</p>
        <p className="text-lg font-semibold tabular-nums">{x?.value === null || x?.value === undefined ? "Incomplet" : eur(x.value)}</p>
        <p className="tabular-nums text-muted-foreground">Performance période (TWR) : {pct(x?.perf ?? null)}</p></div>; })}</div>

      <p className="text-xs text-muted-foreground">Début : {fr(start)} · Dernière donnée : {fr(last?.date ?? null)} · Dernière clôture non reportée : {fr(lastFresh?.date ?? null)} · Cours récupérés le {data ? new Date(data.at).toLocaleString("fr-FR") : "—"}</p>

      <div className="h-72 w-full">
        <ResponsiveContainer><LineChart data={rows} margin={{ left: 8, right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" tickFormatter={d => fr(d).slice(0, 5)} fontSize={11} stroke="var(--muted-foreground)" minTickGap={24} />
          <YAxis fontSize={11} stroke="var(--muted-foreground)" width={64} tickFormatter={v => mode === "value" ? `${Math.round(v)} €` : `${Number(v).toFixed(1)} %`} />
          <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", color: "var(--popover-foreground)" }} labelFormatter={(d, p) => `${fr(String(d))}${p?.[0]?.payload?.carried ? " · cours reporté" : ""}`} formatter={(v, n) => [v === null || v === undefined ? "—" : mode === "value" ? eur(Number(v)) : `${Number(v).toFixed(2)} %`, String(n)]} />
          {SERIES.filter(s => shown.includes(s.id)).map(s => <Line key={s.id} type="linear" dataKey={s.id} name={`${s.label} — reconstitué`} stroke={s.color} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />)}
          {mode === "value" && SERIES.filter(s => shown.includes(s.id)).map(s => { const k = s.id === "global" ? "snapGlobal" : s.id === "pea" ? "snapPea" : "snapCto"; return <Line key={k} dataKey={k} name={`${s.label} — instantané enregistré`} stroke={s.color} strokeWidth={0} dot={{ r: 4, fill: s.color }} isAnimationActive={false} legendType="circle" />; })}
        </LineChart></ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">Trait plein : valeurs reconstituées. Points : instantanés réellement enregistrés à l’ouverture de l’application. Les trous correspondent à des jours sans cours suffisants, jamais interpolés. Week-ends et jours fériés : dernière clôture connue, signalée « cours reporté ».</p>
      <p className="text-xs text-muted-foreground">Méthode : valeur = quantités × clôtures converties en euros (taux BCE) + espèces nettes. Performance pondérée par le temps : versements et retraits neutralisés ; dividendes, frais et taxes inclus. Global calculé sur PEA + CTO cumulés, jamais par moyenne. Solde initial : débute au premier mouvement documenté ({fr(moves[0]?.date ?? null)}) ; avant cette date, aucune donnée.</p>
    </>}

    {(missingNames.length > 0 || issues.length > 0 || qtyIssues.length > 0 || (data?.fxIssues.length ?? 0) > 0) && <div role="alert" className="space-y-1 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" />Données insuffisantes ou à vérifier</p>
      {missingNames.length > 0 && <p>{incomplete.length} jour(s) incomplet(s) sur la période, du {fr(incomplete[0]!.date)} au {fr(incomplete.at(-1)!.date)} — cours manquants : {missingNames.join(", ")}.</p>}
      {data?.fxIssues.map(i => <p key={i}>{i}</p>)}
      {issues.map(i => <p key={i}>{i}</p>)}
      {qtyIssues.length > 0 && <p>Quantités reconstituées différentes des positions enregistrées (aucune correction appliquée) : {qtyIssues.join(" ; ")}</p>}
    </div>}

    {series && last && (() => { const b = dayBreakdown(moves, prices, last.date); return <details className="text-sm"><summary className="cursor-pointer font-medium">Détail du calcul au {fr(last.date)}</summary>
      <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-muted-foreground"><tr><th className="p-1">Compte</th><th className="p-1">Instrument</th><th className="p-1 text-right">Quantité reconstituée</th><th className="p-1 text-right">Clôture (€)</th><th className="p-1">Date du cours</th><th className="p-1 text-right">Valeur</th></tr></thead>
        <tbody>{(["pea", "cto"] as const).flatMap(a => [...b.lines.filter(l => l.account === a).map(l => <tr key={`${a}${l.isin}`} className="border-t border-border"><td className="p-1">{a.toUpperCase()}</td><td className="p-1">{names.get(l.isin) ?? l.isin}</td><td className="p-1 text-right tabular-nums">{l.quantity}</td><td className="p-1 text-right tabular-nums">{l.close === null ? "manquant" : l.close.toFixed(2)}</td><td className="p-1">{fr(l.priceDate)}</td><td className="p-1 text-right tabular-nums">{l.value === null ? "—" : eur(l.value)}</td></tr>),
          <tr key={`${a}cash`} className="border-t border-border"><td className="p-1">{a.toUpperCase()}</td><td className="p-1">Espèces nettes reconstituées</td><td /><td /><td /><td className="p-1 text-right tabular-nums">{eur(b.cash[a])}</td></tr>,
          (() => { const ls = b.lines.filter(l => l.account === a); const miss = ls.filter(l => l.value === null); const sum = Math.round((b.cash[a] + ls.reduce((t, l) => t + (l.value ?? 0), 0)) * 100) / 100; const pt = series[a].at(-1)?.value ?? null;
            return <tr key={`${a}total`} className="border-t border-border font-semibold"><td className="p-1">{a.toUpperCase()}</td><td className="p-1" colSpan={4}>{miss.length ? `Valeur partielle, incomplète — cours manquant : ${miss.map(l => names.get(l.isin) ?? l.isin).join(", ")}. Le dernier point de la courbe reste vide.` : `Total = dernier point de la courbe (${pt === null ? "—" : eur(pt)})`}</td><td className="p-1 text-right tabular-nums">{miss.length ? `${eur(sum)} (partiel)` : eur(sum)}</td></tr>; })()])}</tbody></table></div>
      <p className="mt-1 text-xs text-muted-foreground">Une ligne absente ici n’est pas dans le grand livre ni dans les transactions ETF de ce navigateur ; des espèces très négatives signalent des achats sans le versement correspondant.</p>
    </details>; })()}

    {data && <details className="text-sm"><summary className="cursor-pointer font-medium">Vérification des instruments ({data.checks.length})</summary>
      <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-muted-foreground"><tr><th className="p-1">Instrument</th><th className="p-1">ISIN</th><th className="p-1">Ticker</th><th className="p-1">Place</th><th className="p-1">Devise</th><th className="p-1">Historique depuis</th><th className="p-1">Points</th><th className="p-1">État</th></tr></thead>
        <tbody>{data.checks.map(c => { const i = instruments.find(x => x.key === c.key); return <tr key={c.key} className="border-t border-border"><td className="p-1">{i?.name}</td><td className="p-1 font-mono">{c.isin}</td><td className="p-1 font-mono">{c.symbol ?? "—"}</td><td className="p-1">{c.exchange ?? "—"}</td><td className="p-1">{c.currency ?? "—"}</td><td className="p-1">{fr(c.first)}</td><td className="p-1 tabular-nums">{c.points.length}</td><td className={`p-1 ${c.issues.length ? "text-warning" : ""}`}>{c.issues.length ? c.issues.join(" ") : "OK"}</td></tr>; })}</tbody></table></div>
    </details>}

    <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm">
      {snaps ? <p className="text-muted-foreground">Instantanés quotidiens actifs depuis le {new Date(snaps.enabledAt).toLocaleDateString("fr-FR")} · {snaps.items.length} enregistré(s), un par jour d’ouverture de l’application, jamais quand elle est fermée.</p>
        : <><Button size="sm" variant="outline" onClick={enableSnapshots}>Sauvegarder puis activer les instantanés quotidiens</Button><span className="text-xs text-muted-foreground">Télécharge d’abord une sauvegarde complète ; seuls les instantanés sont ensuite enregistrés, dans un emplacement séparé.</span></>}
    </div>
  </section>;
}
