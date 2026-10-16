import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Chip, DiscoverGrid, PlayableChip, prefetchDiscover, useGenres } from "@/components/Browse";
import { isSlowNetwork } from "@/lib/speed";
import { Page } from "@/components/lg";

export const Route = createFileRoute("/explore")({
  head: () => ({
    meta: [
      { title: "Explore — LOOPGRAM" },
      { name: "description", content: "Explore movies and TV by genre, popularity, rating and release date." },
      { property: "og:title", content: "Explore — LOOPGRAM" },
      { property: "og:description", content: "Browse movies and TV by genre." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Explore,
});

function Explore() {
  const [type, setType] = useState<"movie" | "tv">("movie");
  const [genre, setGenre] = useState<number | null>(null);
  const [sort, setSort] = useState("popularity.desc");
  const g = useGenres();
  const qc = useQueryClient();
  // Warm the first few categories in the background (skipped on slow networks) so taps feel instant.
  useEffect(() => {
    if (isSlowNetwork()) return;
    const list = g.data?.[type] ?? [];
    const t = setTimeout(() => list.slice(0, 6).forEach((x) => prefetchDiscover(qc, type, sort, String(x.id))), 800);
    return () => clearTimeout(t);
  }, [g.data, type, sort, qc]);
  const sorts = [["popularity.desc", "Popular"], ["vote_average.desc", "Top rated"], [type === "movie" ? "primary_release_date.desc" : "first_air_date.desc", "Newest"]];
  return (
    <Page title="Explore">
      <div className="flex gap-2 px-4"><Chip active={type === "movie"} onClick={() => { setType("movie"); setGenre(null); setSort("popularity.desc"); }}>Movies</Chip><Chip active={type === "tv"} onClick={() => { setType("tv"); setGenre(null); setSort("popularity.desc"); }}>TV</Chip>
        <span className="mx-1 w-px bg-border" />{sorts.map(([k, l]) => <Chip key={k} active={sort === k} onClick={() => setSort(k!)}>{l}</Chip>)}</div>
      <div className="px-4 pt-3"><PlayableChip /></div>
      <div className="scrollbar-none flex gap-2 overflow-x-auto px-4 py-3">
        <Chip active={genre === null} onClick={() => setGenre(null)}>All</Chip>
        {g.data?.[type].map((x) => <span key={x.id} onPointerEnter={() => prefetchDiscover(qc, type, sort, String(x.id))} onTouchStart={() => prefetchDiscover(qc, type, sort, String(x.id))}><Chip active={genre === x.id} onClick={() => setGenre(x.id)}>{x.name}</Chip></span>)}
      </div>
      <DiscoverGrid type={type} sort={sort} genre={genre ? String(genre) : undefined} />
    </Page>
  );
}
