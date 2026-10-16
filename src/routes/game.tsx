import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, img } from "@/lib/api";
import { setState, useStore } from "@/lib/store";
import { ErrorBox, Page, type Item } from "@/components/lg";

export const Route = createFileRoute("/game")({
  head: () => ({
    meta: [
      { title: "Daily Discovery Game — LOOPGRAM" },
      { name: "description", content: "Guess today's trending movie from its cast and release year." },
      { property: "og:title", content: "Daily Discovery Game — LOOPGRAM" },
      { property: "og:description", content: "One new movie puzzle every day." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Game,
});

function Game() {
  const q = useQuery({ queryKey: ["game"], queryFn: () => api<{ date: string; answer_id: number; year: string; clues: string[]; options: Item[] }>({ a: "game" }), staleTime: 30 * 60_000 });
  const results = useStore((s) => s.game);
  if (q.isPending) return <Page title="Daily Discovery"><p className="px-4 text-sm text-muted-foreground">Loading today's puzzle…</p></Page>;
  if (q.isError) return <Page title="Daily Discovery"><ErrorBox error={q.error} retry={() => q.refetch()} /></Page>;
  const g = q.data;
  const done = results[g.date];
  const streak = (() => { let n = 0; const d = new Date(g.date); while (results[d.toISOString().slice(0, 10)]?.correct) { n++; d.setDate(d.getDate() - 1); } return n; })();
  const pick = (id: number) => { if (!done) setState((s) => ({ ...s, game: { ...s.game, [g.date]: { picked: id, correct: id === g.answer_id } } })); };
  const answer = g.options.find((o) => o.id === g.answer_id)!;
  return (
    <Page title="Daily Discovery">
      <div className="px-4">
        <p className="text-sm text-muted-foreground">{g.date} · Streak: {streak}</p>
        <div className="mt-3 rounded-xl border p-4">
          <p className="font-semibold">Which trending movie stars…</p>
          <p className="mt-1 text-lg">{g.clues.join(", ")}</p>
          {g.year && <p className="mt-1 text-sm text-muted-foreground">Released {g.year}</p>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {g.options.map((o) => {
            const state = done ? (o.id === g.answer_id ? "border-primary ring-2 ring-primary" : o.id === done.picked ? "opacity-40" : "opacity-60") : "";
            return (
              <button key={o.id} onClick={() => pick(o.id)} disabled={!!done} className={`overflow-hidden rounded-xl border text-left ${state}`}>
                <div className="aspect-[2/3] bg-muted">{o.poster_path && done && <img src={img(o.poster_path, "w342")!} alt="" className="h-full w-full object-cover" />}{!done && <div className="flex h-full items-center justify-center p-3 text-center font-semibold">{o.title}</div>}</div>
                {done && <p className="p-2 text-sm">{o.title}</p>}
              </button>
            );
          })}
        </div>
        {done && (
          <div className="mt-4 rounded-xl bg-secondary p-4">
            <p className="font-bold">{done.correct ? "Correct!" : "Not this time."} The answer is {answer.title}.</p>
            <Link to="/t/$type/$id" params={{ type: "movie", id: String(answer.id) }} className="mt-2 inline-block rounded-full bg-primary px-4 py-1.5 text-sm text-primary-foreground">View title</Link>
            <button className="ml-2 rounded-full border px-4 py-1.5 text-sm" onClick={() => { const t = `LOOPGRAM Daily ${g.date}: ${done.correct ? "✅" : "❌"} streak ${streak}`; navigator.share ? navigator.share({ text: t, url: location.origin + "/game" }).catch(() => {}) : navigator.clipboard?.writeText(t); }}>Share</button>
            <p className="mt-2 text-xs text-muted-foreground">A new puzzle arrives tomorrow.</p>
          </div>
        )}
      </div>
    </Page>
  );
}
