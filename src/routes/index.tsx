import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { scoreItem, topGenres } from "@/lib/taste";
import { ErrorBox, FeedCard, Page, Row, Skel, type Item } from "@/components/lg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LOOPGRAM — Endless movie & TV discovery" },
      { name: "description", content: "Scroll an endless feed of trending movies and TV shows, track releases and build your watchlist." },
      { property: "og:title", content: "LOOPGRAM — Endless movie & TV discovery" },
      { property: "og:description", content: "Trending movies and TV, release calendar, watchlist and daily games." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

type ListRes = { page: number; total_pages: number; results: Item[] };

function ForYou() {
  const signals = useStore((s) => s.signals);
  const genres = topGenres(signals, 2);
  const q = useQuery({
    queryKey: ["foryou", genres.join(",")],
    queryFn: () => api<ListRes>({ a: "discover", type: "movie", genre: genres.join("|") }),
    enabled: genres.length > 0, staleTime: 10 * 60_000,
  });
  if (!q.data) return null;
  const ranked = q.data.results.map((i) => ({ i, s: scoreItem(signals, { genre_ids: i.genre_ids ?? [], vote: i.vote ?? null }) })).sort((a, b) => b.s.score - a.s.score);
  return <Row title="Recommended for you" reason={ranked[0]?.s.reason ?? "Based on what you open and save, on this device only"} items={ranked.map((r) => r.i)} />;
}

function Home() {
  const rows = useQuery({ queryKey: ["rows"], queryFn: () => api<{ rows: { key: string; title: string; items: Item[] }[] }>({ a: "rows" }), staleTime: 5 * 60_000 });
  const feed = useInfiniteQuery({
    queryKey: ["feed"],
    queryFn: ({ pageParam, signal }) => api<ListRes>({ a: "feed", page: pageParam }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.total_pages ? last.page + 1 : undefined),
    maxPages: 8, // memory cap: older pages are dropped as you scroll
    staleTime: 10 * 60_000,
    enabled: !rows.isPending, // start the feed only after the top rows arrive
  });
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting && feed.hasNextPage && !feed.isFetchingNextPage && !feed.isError) feed.fetchNextPage();
    }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [feed.hasNextPage, feed.isFetchingNextPage, feed.isError, feed.fetchNextPage]);

  const seen = new Set<string>();
  const items = (feed.data?.pages ?? []).flatMap((p) => p.results).filter((i) => { const k = `${i.media_type}${i.id}`; if (seen.has(k)) return false; seen.add(k); return true; });

  return (
    <Page>
      <h1 className="sr-only">LOOPGRAM home</h1>
      <ForYou />
      {rows.data?.rows.slice(0, 2).map((r) => <Row key={r.key} title={r.title} items={r.items} />)}
      <h2 className="px-4 pb-2 pt-4 text-lg font-bold">Trending this week</h2>
      {feed.isPending || feed.isLoading ? <Skel /> : feed.isError && !items.length ? <ErrorBox error={feed.error} retry={() => feed.refetch()} /> : (
        <div className="grid grid-cols-1 gap-x-4 gap-y-8 px-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((i, idx) => (
            <div key={`${i.media_type}${i.id}`} className={idx === 12 ? "contents" : undefined}>
              <FeedCard item={i} index={idx} />
            </div>
          ))}
        </div>
      )}
      {rows.data?.rows.slice(2).map((r) => <Row key={r.key} title={r.title} items={r.items} />)}
      <div ref={sentinel} className="h-10" />
      {feed.isFetchingNextPage && <Skel n={3} />}
      {feed.isError && items.length > 0 && <ErrorBox error={feed.error} retry={() => feed.fetchNextPage()} />}
      {!feed.hasNextPage && items.length > 0 && <p className="py-6 text-center text-sm text-muted-foreground">You reached the end of trending.</p>}
    </Page>
  );
}
