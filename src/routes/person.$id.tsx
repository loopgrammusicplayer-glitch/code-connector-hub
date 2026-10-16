import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, img } from "@/lib/api";
import { toggleFollow, useStore } from "@/lib/store";
import { ErrorBox, Grid, Page } from "@/components/lg";

export const Route = createFileRoute("/person/$id")({
  head: () => ({
    meta: [
      { title: "Person — LOOPGRAM" },
      { name: "description", content: "Biography and full filmography on LOOPGRAM." },
      { property: "og:title", content: "Person — LOOPGRAM" },
      { property: "og:description", content: "Biography and filmography." },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PersonPage,
});

function PersonPage() {
  const { id } = Route.useParams();
  const q = useQuery({ queryKey: ["person", id], queryFn: () => api({ a: "person", id }), staleTime: 60 * 60_000 });
  const following = useStore((s) => s.follows.some((f) => String(f.id) === id));
  if (q.isPending) return <Page><div className="m-4 h-40 animate-pulse rounded-xl bg-muted" /></Page>;
  if (q.isError) return <Page><ErrorBox error={q.error} retry={() => q.refetch()} /></Page>;
  const d = q.data;
  return (
    <Page>
      <div className="flex gap-4 p-4">
        <div className="h-28 w-28 shrink-0 overflow-hidden rounded-full bg-muted">{d.profile_path && <img src={img(d.profile_path, "w185")!} alt="" className="h-full w-full object-cover" />}</div>
        <div>
          <h1 className="text-2xl font-bold">{d.name}</h1>
          <p className="text-sm text-muted-foreground">{[d.known_for, d.birthday, d.place_of_birth].filter(Boolean).join(" · ")}</p>
          <button onClick={() => toggleFollow({ id: d.id, name: d.name, profile: d.profile_path })} className={`mt-2 rounded-full px-5 py-2 text-sm font-semibold ${following ? "bg-secondary" : "bg-primary text-primary-foreground"}`}>{following ? "Following" : "Follow"}</button>
        </div>
      </div>
      {d.biography && <p className="max-w-3xl whitespace-pre-line px-4 pb-4 text-sm leading-relaxed text-muted-foreground line-clamp-[12]">{d.biography}</p>}
      <h2 className="px-4 pb-2 text-lg font-bold">Known for</h2>
      <Grid items={d.credits} />
    </Page>
  );
}
