import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { api, img } from "@/lib/api";
import { Page, type Item } from "@/components/lg";

const ref = z.string().regex(/^(movie|tv):\d+$/).optional().catch(undefined);
export const Route = createFileRoute("/compare")({
  validateSearch: z.object({ a: ref, b: ref }),
  head: () => ({
    meta: [
      { title: "Compare — LOOPGRAM" },
      { name: "description", content: "Compare two movies or TV shows side by side." },
      { property: "og:title", content: "Compare — LOOPGRAM" },
      { property: "og:description", content: "Side-by-side title comparison." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Compare,
});

function Picker({ onPick }: { onPick: (r: string) => void }) {
  const [q, setQ] = useState("");
  const res = useQuery({ queryKey: ["search", "pick", q], queryFn: ({ signal }) => api<{ results: Item[] }>({ a: "search", q }, signal), enabled: q.length > 1, staleTime: 15 * 60_000 });
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a title" aria-label="Search a title to compare" className="h-10 w-full rounded-full border bg-background px-4 text-sm" />
      <ul className="mt-1 max-h-60 overflow-auto">{res.data?.results.filter((r) => r.media_type !== "person").slice(0, 8).map((r) => (
        <li key={`${r.media_type}${r.id}`}><button className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => onPick(`${r.media_type ?? "movie"}:${r.id}`)}>{r.title} <span className="text-muted-foreground">{r.date?.slice(0, 4)}</span></button></li>
      ))}</ul>
    </div>
  );
}

function useTitle(r?: string) {
  const [type, id] = r?.split(":") ?? [];
  return useQuery({ queryKey: ["title", type, id], queryFn: () => api({ a: "title", type, id }), enabled: !!r, staleTime: 30 * 60_000 });
}

function Compare() {
  const { a, b } = Route.useSearch();
  const nav = useNavigate();
  const A = useTitle(a), B = useTitle(b);
  const set = (k: "a" | "b", v?: string) => nav({ to: "/compare", search: (s: any) => ({ ...s, [k]: v }) });
  const money = (n: number | null) => (n ? `$${(n / 1e6).toFixed(0)}M` : "—");
  const rows: [string, (d: any) => string][] = [
    ["Year", (d) => d.date?.slice(0, 4) ?? "—"], ["Rating", (d) => (d.vote ? `★ ${d.vote.toFixed(1)} (${d.votes})` : "—")],
    ["Runtime", (d) => (d.runtime ? `${d.runtime} min` : "—")], ["Genres", (d) => d.genres.map((g: any) => g.name).join(", ")],
    ["Director / Creator", (d) => [...d.creators, ...d.crew.filter((c: any) => c.job === "Director")].map((c: any) => c.name).join(", ") || "—"],
    ["Top cast", (d) => d.cast.slice(0, 4).map((c: any) => c.name).join(", ")], ["Budget", (d) => money(d.budget)], ["Revenue", (d) => money(d.revenue)],
    ["Status", (d) => d.status ?? "—"],
  ];
  return (
    <Page title="Compare">
      <div className="grid grid-cols-2 gap-3 px-4">
        {([["a", A, a], ["b", B, b]] as const).map(([k, q, r]) => (
          <div key={k}>
            {r && q.data ? (
              <div>
                <img src={img(q.data.poster_path, "w342") ?? ""} alt="" className="aspect-[2/3] w-full rounded-lg bg-muted object-cover" />
                <p className="mt-1 font-semibold">{q.data.title}</p>
                <button className="text-xs text-muted-foreground underline" onClick={() => set(k, undefined)}>Change</button>
              </div>
            ) : r && q.isPending ? <div className="aspect-[2/3] animate-pulse rounded-lg bg-muted" /> : <Picker onPick={(v) => set(k, v)} />}
          </div>
        ))}
      </div>
      {A.data && B.data && (
        <table className="mx-4 mt-4 w-[calc(100%-2rem)] text-sm">
          <tbody>{rows.map(([l, f]) => (
            <tr key={l} className="border-t align-top"><th className="w-24 py-2 pr-2 text-left font-normal text-muted-foreground">{l}</th><td className="py-2 pr-2">{f(A.data)}</td><td className="py-2">{f(B.data)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </Page>
  );
}
