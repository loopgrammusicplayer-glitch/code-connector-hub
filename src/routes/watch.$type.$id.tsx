import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { api, img, track } from "@/lib/api";
import { useStore } from "@/lib/store";
import { useInfiniteList } from "@/lib/infinite";
import { InfiniteFooter } from "@/components/InfiniteFooter";
import { YouTubePlayer } from "@/components/YouTubePlayer";
import { StreamPlayer } from "@/components/StreamPlayer";
import { ErrorBox, Page } from "@/components/lg";

export const Route = createFileRoute("/watch/$type/$id")({
  validateSearch: z.object({ v: z.string().regex(/^[\w-]{6,20}$/).optional().catch(undefined), s: z.coerce.number().int().min(0).max(500).optional().catch(undefined), e: z.coerce.number().int().min(1).max(5000).optional().catch(undefined), mode: z.enum(["full", "trailer"]).optional().catch(undefined) }),
  head: () => ({
    meta: [
      { title: "Watch trailers — LOOPGRAM" },
      { name: "description", content: "Watch official trailers and clips, then keep discovering related videos." },
      { property: "og:title", content: "Watch trailers — LOOPGRAM" },
      { property: "og:description", content: "Official trailers and clips with endless related videos." },
      { property: "og:type", content: "video.other" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WatchPage,
});

type Video = { key: string; name: string; type: string; official: boolean; status: string };
type ReelItem = { id: number; media_type: string; title: string; backdrop_path: string | null; poster_path: string | null; date: string | null; vote: number | null; video: Video };

function WatchPage() {
  const { type, id } = Route.useParams();
  const { v, s: season = 1, e: episode = 1, mode } = Route.useSearch();
  const t = type === "tv" ? "tv" : "movie";
  const q = useQuery({ queryKey: ["title", t, id], queryFn: () => api<any>({ a: "title", type: t, id }), staleTime: 30 * 60_000 });
  const sq = useQuery({ queryKey: ["stream", t, id, season, episode], queryFn: () => api<{ stream: { url: string; kind: "hls" | "mp4" } | null }>({ a: "stream", type: t, id, season: t === "tv" ? season : undefined, episode: t === "tv" ? episode : undefined }), staleTime: 10 * 60_000 });
  const [streamFailed, setStreamFailed] = useState(false);
  // A trailer key in the URL plays instantly; a full R2 stream hot-swaps in when it resolves (unless trailer mode).
  const stream = !streamFailed && mode !== "trailer" ? sq.data?.stream : null;
  const [failed, setFailed] = useState<string[]>([]);
  const d = q.data;
  // Try every video in the embedded player; the player's onFail skips any that truly can't play.
  const playable: Video[] = (d?.videos ?? []).filter((x: Video) => !failed.includes(x.key));
  const current = playable.find((x) => x.key === v) ?? playable.find((x) => x.type === "Trailer") ?? playable[0];
  const instantKey = v && !failed.includes(v) ? (d ? current?.key : v) : current?.key;

  useEffect(() => { if (d) { document.title = `${current?.name ?? "Trailer"} · ${d.title} — LOOPGRAM`; track(t, d.id, d.title, d.poster_path); } }, [d?.id, current?.key]);

  return (
    <Page>
      {/* Player keeps a fixed 16:9 box so the list below never resizes it. */}
      <div className="sticky top-14 z-20 bg-background md:static">
        {stream ? <StreamPlayer key={stream.url} url={stream.url} kind={stream.kind} title={d?.title ?? "Video"} poster={d ? img(d.backdrop_path, "w780") : null} onFail={() => setStreamFailed(true)} />
          : instantKey ? <YouTubePlayer key={instantKey} id={instantKey} title={current?.name ?? "Trailer"} onFail={() => setFailed((f) => [...f, instantKey])} />
          : q.isPending ? <div className="aspect-video w-full animate-pulse bg-muted" />
          : <div className="grid aspect-video w-full place-items-center bg-muted p-4 text-center text-sm text-muted-foreground">No playable official video for this title.</div>}
      </div>
      {q.isError ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : d && (
        <div className="px-4 pt-3">
          <h1 className="text-lg font-bold leading-snug">{stream ? (t === "tv" ? `${d.title} · S${season} E${episode}` : d.title) : current?.name ?? d.title}</h1>
          <p className="text-sm text-muted-foreground">
            {[stream ? (t === "tv" ? "Full episode" : "Full movie") : current && `Official ${current.type.toLowerCase()}`, d.title, d.date?.slice(0, 4), d.vote ? `★ ${d.vote.toFixed(1)}` : null].filter(Boolean).join(" · ")}
          </p>
          {sq.data?.stream && (
            <div className="mt-2 flex gap-2">
              <Link to="/watch/$type/$id" params={{ type: t, id }} search={{ s: season, e: episode }} replace className={`rounded-full px-4 py-1.5 text-sm ${stream ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>{t === "tv" ? "Full episode" : "Full movie"}</Link>
              <Link to="/watch/$type/$id" params={{ type: t, id }} search={{ s: season, e: episode, mode: "trailer" }} replace className={`rounded-full px-4 py-1.5 text-sm ${!stream ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>Trailer</Link>
            </div>
          )}
          {!sq.data?.stream && !sq.isPending && <p className="mt-1 text-xs text-muted-foreground">Only the trailer is available here. See “Where to watch” for the full {t === "tv" ? "show" : "movie"}.</p>}
          {t === "tv" && d.season_list?.length > 0 && <Episodes id={id} seasons={d.season_list} season={season} episode={episode} />}
          <Link to="/t/$type/$id" params={{ type: t, id: String(d.id) }} className="mt-2 inline-block rounded-full bg-secondary px-4 py-1.5 text-sm">Title details & where to watch →</Link>
          {playable.length > 1 && (
            <div className="scrollbar-none -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
              {playable.map((x) => (
                <Link key={x.key} to="/watch/$type/$id" params={{ type: t, id }} search={{ v: x.key }} replace aria-current={x.key === current?.key}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${x.key === current?.key ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>{x.type}: {x.name.slice(0, 40)}</Link>
              ))}
            </div>
          )}
        </div>
      )}
      <RelatedVideos key={`${t}:${id}`} type={t} id={id} />
    </Page>
  );
}

function RelatedVideos({ type, id }: { type: "movie" | "tv"; id: string }) {
  const lowData = useStore((s) => s.lowData);
  const { q, items, sentinel } = useInfiniteList<ReelItem>({
    key: ["reel", type, id], params: { a: "reel", type, id }, pageLimit: 20, maxPages: 8, staleTime: 30 * 60_000,
    itemKey: (i) => i.video.key,
  });
  return (
    <section className="pt-5">
      <h2 className="px-4 pb-2 text-base font-bold">Up next</h2>
      {q.isPending ? <div className="space-y-3 px-4">{[0, 1, 2].map((k) => <div key={k} className="aspect-video animate-pulse rounded-xl bg-muted sm:aspect-[4/1]" />)}</div>
        : q.isError && !items.length ? <ErrorBox error={q.error} retry={() => q.refetch()} />
        : items.length === 0 && !q.hasNextPage ? <p className="px-4 text-sm text-muted-foreground">No related videos found.</p>
        : (
          <ul className="grid grid-cols-1 gap-4 px-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((i) => {
              const thumb = img(i.backdrop_path ?? i.poster_path, "w780");
              if (!thumb) return null;
              return (
                <li key={i.video.key}>
                  <Link to="/watch/$type/$id" params={{ type: i.media_type === "tv" ? "tv" : "movie", id: String(i.id) }} search={{ v: i.video.key }} className="block">
                    <div className="aspect-video overflow-hidden rounded-xl bg-muted">
                      <img src={thumb} alt="" width={780} height={439} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(e) => { const li = e.currentTarget.closest("li"); if (li) li.style.display = "none"; }} className="h-full w-full object-cover" />
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug">{i.video.name}</p>
                    <p className="text-xs text-muted-foreground">{i.title} · {i.video.type}{i.date ? ` · ${i.date.slice(0, 4)}` : ""}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      <InfiniteFooter sentinel={sentinel} loading={q.isFetchingNextPage} error={q.isError} hasMore={!!q.hasNextPage} count={items.length} retry={() => q.fetchNextPage()} endText="No more related videos." />
    </section>
  );
}

function Episodes({ id, seasons, season, episode }: { id: string; seasons: { n: number; name: string }[]; season: number; episode: number }) {
  const q = useQuery({ queryKey: ["season", id, season], queryFn: () => api<{ episodes: { n: number; name: string; still: string | null }[] }>({ a: "season", id, season }), staleTime: 60 * 60_000 });
  const eps = q.data?.episodes ?? [];
  const has = (n: number) => eps.some((x) => x.n === n);
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <label className="text-sm font-semibold" htmlFor="season">Season</label>
        <select id="season" value={season} onChange={(ev) => { location.search = `?s=${ev.target.value}&e=1`; }} className="rounded border bg-background px-2 py-1 text-sm">
          {seasons.map((x) => <option key={x.n} value={x.n}>{x.name}</option>)}
        </select>
        <div className="ml-auto flex gap-1">
          {has(episode - 1) && <Link to="/watch/$type/$id" params={{ type: "tv", id }} search={{ s: season, e: episode - 1 }} className="rounded-full bg-secondary px-3 py-1 text-xs">← Prev</Link>}
          {has(episode + 1) && <Link to="/watch/$type/$id" params={{ type: "tv", id }} search={{ s: season, e: episode + 1 }} className="rounded-full bg-secondary px-3 py-1 text-xs">Next →</Link>}
        </div>
      </div>
      <div className="scrollbar-none -mx-4 mt-2 flex gap-2 overflow-x-auto px-4">
        {eps.map((x) => (
          <Link key={x.n} to="/watch/$type/$id" params={{ type: "tv", id }} search={{ s: season, e: x.n }} replace aria-current={x.n === episode}
            className={`w-40 shrink-0 rounded-lg p-1 text-xs ${x.n === episode ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
            {x.still && <img src={img(x.still, "w342")!} alt="" loading="lazy" className="aspect-video w-full rounded object-cover" />}
            <p className="mt-1 line-clamp-1">E{x.n} · {x.name}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
