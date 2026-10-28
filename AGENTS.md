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
- Keep the original generic simulation workbench separate from the ETF dashboard; both reuse the unchanged rebalance engine to preserve existing behavior.
- Validate versioned portfolio backups before replacing any local data; persist only after hydration to prevent SSR overwrites.
- External quote/reference adapters are browser-safe interfaces with no configured provider; manual records are the only active data source.
