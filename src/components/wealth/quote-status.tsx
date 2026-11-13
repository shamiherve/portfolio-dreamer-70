import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Portfolio } from "@/lib/portfolio";
import type { Wealth } from "@/lib/wealth";
import { marketOf } from "@/lib/market-merge";

const ts = (s: string | null | undefined) => s ? new Date(s).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) : "—";
export function quoteCounts(portfolio: Portfolio, w: Wealth) {
  const ms = w.holdings.filter(h => h.kind === "quantity").map(marketOf);
  const etfOk = portfolio.positions.filter(p => p.priceSource === "euronext").length;
  return {
    auto: etfOk + ms.filter(m => m.quoteStatus === "ok").length,
    stale: ms.filter(m => m.quoteStatus === "stale").length,
    manual: ms.filter(m => m.status === "manual" || m.quoteStatus === "review").length,
    none: ms.filter(m => m.status === "none" || (m.quoteStatus === "error" && !m.quote)).length,
    manualPrice: ms.filter(m => m.priceMode === "manual").length + w.holdings.filter(h => h.kind === "value").length,
  };
}
export function QuoteStatusPanel({ portfolio, wealth, onRefresh, busy, message }: { portfolio: Portfolio; wealth: Wealth; onRefresh: () => void; busy: boolean; message: string }) {
  const c = quoteCounts(portfolio, wealth); const m = wealth.marketMeta;
  return <section className="rounded-lg border border-border bg-surface p-4 text-sm" aria-label="État des cours">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h2 className="font-semibold">État des cours</h2>
        <p className="text-muted-foreground">Dernière mise à jour réussie (actions, or) : {ts(m?.lastSuccess)} · Cours ETF Euronext vérifiés : {ts(portfolio.quotesCheckedAt)}</p>
        {m?.lastFailure && <p className="text-warning">Dernier échec : {ts(m.lastFailure)}{m.lastError ? ` — ${m.lastError}` : ""}</p>}
      </div>
      <Button size="sm" variant="outline" onClick={onRefresh} disabled={busy}><RefreshCw className={busy ? "animate-spin" : ""} />Actualiser tous les cours</Button>
    </div>
    <dl className="mt-3 grid gap-2 sm:grid-cols-5">
      {[["Mis à jour automatiquement", c.auto], ["Cours anciens", c.stale], ["Vérification manuelle requise", c.manual], ["Sans cotation disponible", c.none], ["Cours / valorisation manuels", c.manualPrice]].map(([l, v]) => <div key={l} className="rounded-md bg-surface-muted/60 p-2"><dt className="text-xs text-muted-foreground">{l}</dt><dd className="font-mono text-lg">{v}</dd></div>)}
    </dl>
    <p className="mt-2 text-xs text-muted-foreground">Sources : Euronext (fichier officiel des transactions différées, ETF) · Yahoo Finance (actions et or, cours différés non garantis) · BCE (taux de change de référence, {m?.fxDate ? new Date(m.fxDate).toLocaleDateString("fr-FR") : "—"}). <Link to="/instruments" className="underline">Contrôle des instruments</Link></p>
    {message && <p role="status" className="mt-1 text-xs">{message}</p>}
  </section>;
}
