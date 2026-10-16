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

## Architecture rules
- Keep the four data flows separate (see docs/ARCHITECTURE.md): ordinary page reads must not touch DynamoDB or R2, so one failing service can't take down pages.
- All TMDB calls go through `tmdb()` in backend.server.ts, which handles the allowlist, caching, request merging and the refresh lock; never fetch TMDB directly.
- YouTube trailers must pass the `resolveVideos()` playability check before they're shown; LOOPGRAM never presents trailers as full movies.
- Paged lists use `useInfiniteList` (src/lib/infinite.ts) + `InfiniteFooter`; one engine keeps dedupe, end detection and retry consistent.
- Full-length playback comes only from the owner's R2 bucket via `findStream()` (playback.server.ts); never embed third-party piracy/"embed provider" sites — titles without an uploaded file fall back to the trailer.
