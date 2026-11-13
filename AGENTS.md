<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Portfolio architecture
- Full-wealth backups use a separate read-only export/validation module with explicit rejection of unknown fields and declared historical orphan transaction references; legacy restoration and storage schemas remain unchanged to avoid migrations or silent data loss.
- Keep the original generic simulation workbench separate from the ETF dashboard; both reuse the unchanged rebalance engine to preserve existing behavior.
- Validate versioned portfolio backups before replacing any local data; persist only after hydration to prevent SSR overwrites.
- Fetch the public Euronext quote feed only in the hydrated ETF dashboard, validate EUR records and merge price-only fields against the latest local state; this preserves concurrent holdings edits and keeps portfolio data off external services. Reference weights remain manual.
- Keep quote metadata/history optional in the existing versioned portfolio schema and backups; this retains compatibility with existing local records while separating feed publication, browser check and trade timestamps.
- The separate shamiherve/euronext-etf-quotes repository owns Python ingestion and GitHub Actions/Pages publication; its public quotes.json exposes market records only and must remain independent of browser-held portfolio state, preventing personal data publication and app-server dependency.
- Keep whole-unit search and editable purchase evaluation in a separate planner module; dashboard summaries use current holdings so proposed purchases never change saved positions or the theoretical engine.
- Keep theme switching in the shared navigation, apply semantic CSS tokens through the root dark class, and restore only the separate browser theme preference after hydration so portfolio storage remains untouched.
- Global wealth (non-ETF holdings, account/class/mapping targets) lives in its own versioned local key via src/lib/wealth.ts; ETF holdings are read from the ETF portfolio and never copied, keeping one source of truth and counting each position once.
- Non-ETF quotes come from a createServerFn (src/lib/market.functions.ts: Yahoo search/chart + ECB FX, cached, retried) and are merged by pure src/lib/market-merge.ts into the optional `market` field of each wealth holding; only metadata (audited), price, priceDate and fxRate may change, so quantities and ETF data stay untouched and uncertain listings are flagged instead of priced.
- Resolve securities, holding listings and provider symbols separately through instrument-mapping and the dependency-injected market-service; validate chart identity/exchange, prefer supported public Paris quotes, and persist fallback quote sources separately so alternative listings never relabel a holding.
- Multi-currency ETC mappings require a saved venue or explicitly confirmed provider symbol plus listing currency; generic initial tickers and broker names are not venue evidence, avoiding accidental cross-listing valuation.
