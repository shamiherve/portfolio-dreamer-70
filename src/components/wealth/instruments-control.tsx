import { useMemo, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePortfolio } from "@/lib/use-portfolio";
import { useWealth } from "@/lib/use-wealth";
import { useMarket } from "@/lib/use-market";
import { acceptPending, marketOf, setMarketOption } from "@/lib/market-merge";
import { kindLabel, quoteKind } from "@/lib/market";
import { holdingValue, type Holding } from "@/lib/wealth";
import { eur } from "@/lib/rebalance";
import { field } from "./shared";
import { QuoteStatusPanel } from "./quote-status";

const ts = (s: string | null | undefined) => s ? new Date(s).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) : "—";
const META = { verified: "Vérifié", corrected: "Corrigé automatiquement", manual: "Vérification manuelle requise", none: "Aucune donnée de marché" } as const;
const QS = { ok: "À jour", stale: "Cours ancien", review: "Variation à confirmer", error: "Erreur — dernier cours conservé", manual: "Cours manuel", none: "—" } as const;
const PROV = { yahoo: "Yahoo Finance", manual: "Saisie manuelle", none: "Aucune", euronext: "Euronext" } as const;
const tone = (s: string) => s === "verified" || s === "ok" ? "text-success" : s === "corrected" || s === "stale" || s === "review" || s === "manual" ? "text-warning" : s === "error" ? "text-destructive" : "text-muted-foreground";

interface Row { id: string; name: string; isin: string; ticker: string; exchange: string; account: string; currency: string; price: number | null; value: number; provider: string; updated: string | null; meta: keyof typeof META; quote: keyof typeof QS; h?: Holding }

export function InstrumentsControl() {
  const { portfolio, hydrated } = usePortfolio();
  const { wealth, hydrated: wh, error, commit } = useWealth();
  const market = useMarket(wealth, wh && !error, commit);
  const [filters, setFilters] = useState({ account: "", exchange: "", provider: "", status: "" });
  const [sort, setSort] = useState<keyof Row>("name");
  const [symbolDraft, setSymbolDraft] = useState<Record<string, string>>({});
  const accName = (id: string) => wealth.accounts.find(a => a.id === id)?.name ?? id;
  const rows: Row[] = useMemo(() => [
    ...portfolio.positions.map(p => ({ id: `etf:${p.id}`, name: p.name, isin: p.isin, ticker: "", exchange: "Euronext Paris", account: accName("pea"), currency: "EUR", price: p.price, value: p.quantity * (p.price ?? 0), provider: p.priceSource === "euronext" ? PROV.euronext : PROV.manual, updated: p.quoteUpdatedAt ?? p.priceDate, meta: "verified" as const, quote: (p.priceSource === "euronext" ? "ok" : "manual") as Row["quote"] })),
    ...wealth.holdings.map(h => { const m = marketOf(h); return { id: h.id, name: h.name, isin: h.isin, ticker: h.ticker, exchange: h.exchange, account: accName(h.accountId), currency: h.currency, price: h.kind === "value" ? null : h.price, value: holdingValue(h), provider: h.kind === "value" ? PROV.manual : m.priceMode === "manual" ? PROV.manual : PROV[m.provider], updated: m.quote?.timestamp ?? h.priceDate, meta: m.status, quote: m.quoteStatus, h }; }),
  ], [portfolio, wealth]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!hydrated || !wh) return <p className="p-8">Chargement des données locales…</p>;
  const shown = rows.filter(r => (!filters.account || r.account === filters.account) && (!filters.exchange || r.exchange === filters.exchange) && (!filters.provider || r.provider === filters.provider) && (!filters.status || META[r.meta] === filters.status || QS[r.quote] === filters.status))
    .sort((a, b) => String(a[sort] ?? "").localeCompare(String(b[sort] ?? ""), "fr", { numeric: true }));
  const opts = (k: keyof Row) => [...new Set(rows.map(r => String(r[k])).filter(Boolean))];
  const save = (f: Parameters<typeof commit>[0]) => { try { commit(f); } catch { /* read-only */ } };
  const head: [keyof Row, string][] = [["name", "Instrument"], ["isin", "ISIN"], ["ticker", "Ticker"], ["exchange", "Place"], ["account", "Compte"], ["currency", "Devise"], ["price", "Dernier cours"], ["value", "Valeur €"], ["provider", "Source"], ["updated", "Mise à jour"], ["quote", "Statut cours"]];
  return <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
    <header><p className="text-xs uppercase tracking-wide text-muted-foreground">Données de marché</p><h1 className="text-2xl font-semibold">Contrôle des instruments</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">L’ISIN est l’identifiant principal. Une correction n’est appliquée que si la cotation est certaine ; sinon la ligne est signalée et aucun cours n’est appliqué. Les quantités et l’historique ne sont jamais modifiés.</p></header>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <QuoteStatusPanel portfolio={portfolio} wealth={wealth} onRefresh={() => void market.refresh()} busy={market.busy !== null} message={market.message} />

    <section className="space-y-3"><h2 className="text-lg font-semibold">Instruments et cours</h2>
      <div className="grid gap-2 sm:grid-cols-4">
        {([["account", "Compte", opts("account")], ["exchange", "Place", opts("exchange")], ["provider", "Source", opts("provider")], ["status", "Statut", [...Object.values(META), ...Object.values(QS).filter(x => x !== "—")]]] as const).map(([k, l, o]) =>
          <label key={k} className="text-xs text-muted-foreground">{l}<select aria-label={`Filtrer par ${l}`} className={field} value={filters[k]} onChange={e => setFilters(f => ({ ...f, [k]: e.target.value }))}><option value="">Tous</option>{o.map(x => <option key={x}>{x}</option>)}</select></label>)}
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm">
        <thead className="text-left text-xs text-muted-foreground"><tr className="border-b border-border">{head.map(([k, l]) => <th key={k} className="px-2 py-2 font-medium"><button className="hover:underline" onClick={() => setSort(k)}>{l}{sort === k ? " ↓" : ""}</button></th>)}<th /></tr></thead>
        <tbody>{shown.map(r => <tr key={r.id} className="border-b border-border/60">
          <td className="px-2 py-2">{r.name}</td><td className="px-2 py-2 font-mono text-xs">{r.isin || "—"}</td><td className="px-2 py-2 font-mono text-xs">{r.ticker || "—"}</td>
          <td className="px-2 py-2">{r.exchange || "—"}</td><td className="px-2 py-2">{r.account}</td><td className="px-2 py-2">{r.h?.kind === "value" ? "EUR" : r.currency}</td>
          <td className="px-2 py-2 font-mono">{r.price !== null ? `${r.price.toLocaleString("fr-FR", { maximumFractionDigits: 4 })} ${r.currency}` : "—"}</td>
          <td className="px-2 py-2 font-mono">{eur(r.value)}</td><td className="px-2 py-2">{r.provider}</td><td className="px-2 py-2 text-xs">{ts(r.updated)}</td>
          <td className={`px-2 py-2 text-xs ${tone(r.quote)}`}>{QS[r.quote]}</td>
          <td className="px-2 py-2">{r.h && r.h.kind === "quantity" && <Button size="icon" variant="ghost" aria-label={`Actualiser ${r.name}`} disabled={market.busy !== null} onClick={() => void market.refresh([r.h!.id])}><RefreshCw className={market.busy === r.h.id ? "animate-spin" : ""} /></Button>}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="text-xs text-muted-foreground">Valeur en euros = quantité × cours en devise locale × taux de change vers l’euro (BCE ; 1 pour l’euro). Les ETF restent gérés par le flux Euronext du Portefeuille ETF.</p>
    </section>

    <section className="space-y-3"><h2 className="text-lg font-semibold">Rapport de contrôle</h2>
      {wealth.holdings.map(h => { const m = marketOf(h); const v = m.verified; const k = m.quote ? quoteKind(m.quote.timestamp, new Date()) : null; return <article key={h.id} className="space-y-2 rounded-lg border border-border bg-surface p-4 text-sm" aria-label={`Contrôle ${h.name}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{h.name}</h3><span className={`text-xs font-medium ${tone(m.status)}`}>{META[m.status]}</span></div>
        <div className="grid gap-3 md:grid-cols-2">
          <div><p className="text-xs text-muted-foreground">Données saisies à l’origine</p><p className="font-mono text-xs">{m.original.name} · {m.original.isin || "ISIN —"} · {m.original.ticker || "ticker —"} · {m.original.exchange || "place —"} · {m.original.currency}</p></div>
          <div><p className="text-xs text-muted-foreground">Données vérifiées</p><p className="font-mono text-xs">{v ? `${v.name} · ${v.isin || "ISIN —"} · ${v.ticker} · ${v.exchange} · ${v.currency}` : "—"}</p></div>
          <div><p className="text-xs text-muted-foreground">Source et symbole</p><p>{h.kind === "value" ? "Valorisation manuelle (fonds en euros)" : `${PROV[m.provider]}${m.symbol ? ` · ${m.symbol}` : ""}`}</p></div>
          <div><p className="text-xs text-muted-foreground">Dernière cotation valide</p><p>{m.quote ? `${m.quote.price.toLocaleString("fr-FR", { maximumFractionDigits: 4 })} ${m.quote.currency} · ${ts(m.quote.timestamp)} (${kindLabel[k!]}) · récupéré ${ts(m.quote.retrievedAt)}` : "—"}{m.fx && m.fx.source === "BCE" && ` · taux ${m.fx.rate.toFixed(6)} €/${m.quote?.currency} du ${new Date(m.fx.date).toLocaleDateString("fr-FR")}`}</p></div>
        </div>
        {m.audit.length > 0 && <div><p className="text-xs text-muted-foreground">Corrections</p><ul className="list-disc pl-5 text-xs">{m.audit.map((c, i) => <li key={i}>{ts(c.at)} — {c.field} : « {c.from || "vide"} » → « {c.to} » ({c.reason})</li>)}</ul></div>}
        {m.issues.length > 0 && <ul className="list-disc pl-5 text-xs text-warning">{m.issues.map(i => <li key={i}>{i}</li>)}</ul>}
        {m.lastError && <p className="text-xs text-destructive">{m.lastError}</p>}
        {m.pending && <div className="flex flex-wrap items-center gap-2 rounded-md bg-warning/10 p-2 text-xs"><span>Nouveau cours en attente : {m.pending.price} {m.pending.currency} — {m.pending.reason}</span><Button size="sm" variant="outline" onClick={() => save(w => acceptPending(w, h.id, new Date().toISOString()))}><Check />Accepter ce cours</Button></div>}
        {h.kind === "quantity" && <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted-foreground">Symbole fournisseur (Yahoo)<input aria-label={`Symbole ${h.name}`} className={`${field} w-40 font-mono`} placeholder={m.symbol ?? "ex. PPFB.DE"} value={symbolDraft[h.id] ?? m.userSymbol ?? ""} onChange={e => setSymbolDraft(s => ({ ...s, [h.id]: e.target.value.trim() }))} list={`cand-${h.id}`} /></label>
          <datalist id={`cand-${h.id}`}>{m.candidates.map(c => <option key={c.symbol} value={c.symbol}>{c.exchange} {c.name}</option>)}</datalist>
          <Button size="sm" variant="outline" onClick={() => { const s = symbolDraft[h.id] ? symbolDraft[h.id]!.toUpperCase() : null; save(w => setMarketOption(w, h.id, { userSymbol: s })); void market.refresh([h.id], { [h.id]: s }); }}>Confirmer le symbole</Button>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={m.priceMode === "manual"} onChange={e => save(w => setMarketOption(w, h.id, { priceMode: e.target.checked ? "manual" : "auto" }))} />Cours manuel (les cours automatiques sont affichés mais jamais appliqués)</label>
        </div>}
      </article>; })}
      <p className="text-xs text-muted-foreground">Pour corriger la place de cotation, l’ISIN ou la devise d’une ligne, utilisez « Modifier » dans Positions individuelles puis actualisez.</p>
    </section>
  </main>;
}
