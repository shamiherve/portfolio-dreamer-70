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
- Keep full-backup v1 validation intact and wrap it with v2 ledger-aware backup/restoration; validate again before writes, keep legacy restore scopes explicit, and journal multi-key local writes with a verified safety copy and recovery before hydration to prevent partial restoration.
- Keep historical financial events in a separate versioned local ledger; imports parse CSV/Excel locally, retain source rows and separate execution/settlement dates, require reviewed confirmation, recheck the current browser's ETF trades and ledger at the write boundary, and never mutate holdings or market providers. Keep final-review logic separate, preserve unavailable execution prices as null, and reconstruct quantities from deduplicated events rather than adding them to current holdings.
- Reject oversized spreadsheet archives before workbook parsing, preserve positional column mapping and raw numeric/date cells, and flag ambiguous operations/identities/FX rather than inferring financial events; keep source-sheet totals separate from accepted-ledger reconciliation so incomplete rows remain visible without being imported.
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
- Wealth evolution (src/lib/performance.ts + history-prices.functions.ts) is read-only: reconstructs PEA/CTO daily values from ledger + ETF transactions (ledger buys matching ETF transactions counted once), un-adjusts Yahoo split closes, ECB FX, TWR; missing closes yield null days, never interpolation; snapshots live only in their own key after a downloaded complete backup.
- Manual events use the existing ledger and shared import duplicate checks; only newly confirmed events carry source.positionApplied and atomically apply/reverse their incremental quantity effect together with ledger and snapshot invalidation. Imported history and older unmarked manual events never replay into saved holdings, preventing historical double application.
- Dynamic financial management uses an independent versioned registry with legacy references and append-only valuation revisions, included as optional v2 backup sections; new actual values/history stay outside the unchanged allocation engine to preserve denominators. Unknown external flows yield unavailable performance, never invented returns.

- Use key-filtered local-data subscriptions for verified same-tab writes, cross-tab storage and focus; hydrate without persisting defaults or label normalisations, and re-read authoritative records at every write boundary to prevent stale updates.
- Registry legacy entries own optional shared labels only; resolve current quantities/listings from portfolio and wealth references, permitting stale reference metadata in backups but validating changed metadata against current sources at writes.
- Enforce frozen allocation/ETF targets at ordinary write boundaries and show them read-only; full restoration retains its explicit validated scope. Use the shared financial summary for current positions plus documented cash and separate new-support valuations, never changing the allocation denominator.
- Index comparison (src/lib/benchmarks.ts) is display-only: accumulating EUR ETF closes rebased to 100 against the existing windowed TWR of Global, each PEA/CTO series or a registry account (its valuation index), one independent reference per account; settings/cache in their own local key, never valued, backed up or fed into allocation.
