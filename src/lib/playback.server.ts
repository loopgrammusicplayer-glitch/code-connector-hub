// Playback resolver: decides which TMDB video records are actually embeddable.
// A TMDB title ID is never a video ID — only TMDB `videos[].key` with site=YouTube is used.
import { redis } from "./backend.server";

export type VideoStatus = "ok" | "embed_disabled" | "removed" | "unknown";
export type Video = { key: string; name: string; type: string; official: boolean; status: VideoStatus };

const KEY_RE = /^[A-Za-z0-9_-]{11}$/;
const TYPE_RANK: Record<string, number> = { Trailer: 0, Teaser: 1, Clip: 2, Featurette: 3, "Behind the Scenes": 4 };

/** YouTube oEmbed: 200 = embeddable, 401/403 = embedding disabled, 404/400 = removed, private or invalid. */
// In-memory L1 in front of Redis/oEmbed: repeat lookups return instantly without network.
const L1_TTL = 3600_000;
const ytL1 = new Map<string, { status: VideoStatus; exp: number }>();
function l1Put(key: string, status: VideoStatus) {
  ytL1.set(key, { status, exp: Date.now() + (status === "unknown" ? 60_000 : L1_TTL) });
  if (ytL1.size > 5000) ytL1.delete(ytL1.keys().next().value!);
}
async function checkYouTube(key: string): Promise<VideoStatus> {
  if (!KEY_RE.test(key)) return "removed";
  const hot = ytL1.get(key);
  if (hot && hot.exp > Date.now()) return hot.status;
  const s = await checkYouTubeRemote(key);
  l1Put(key, s);
  return s;
}
async function checkYouTubeRemote(key: string): Promise<VideoStatus> {
  const ck = `yt:v1:${key}`;
  try { const c = await redis(["GET", ck]); if (typeof c === "string") return c as VideoStatus; } catch { /* cache optional */ }
  let s: VideoStatus = "unknown";
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${key}`)}`, { signal: AbortSignal.timeout(2500) });
    s = r.ok ? "ok" : r.status === 401 || r.status === 403 ? "embed_disabled" : r.status === 404 || r.status === 400 ? "removed" : "unknown";
  } catch { s = "unknown"; }
  // Availability is cached separately from metadata and expires quickly; unknown results are retried sooner.
  try { await redis(["SET", ck, s, "EX", s === "unknown" ? 300 : s === "ok" ? 21600 : 86400]); } catch { /* */ }
  return s;
}

export async function resolveVideos(raw: any[]): Promise<Video[]> {
  const seen = new Set<string>();
  const vids = (raw ?? [])
    .filter((v) => v?.site === "YouTube" && typeof v.key === "string" && !seen.has(v.key) && seen.add(v.key))
    .sort((a, b) => (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9) || Number(!!b.official) - Number(!!a.official))
    .slice(0, 10);
  const st = await Promise.all(vids.map((v) => checkYouTube(v.key)));
  return vids
    .map((v, i) => ({ key: v.key, name: v.name ?? "Video", type: v.type ?? "Video", official: !!v.official, status: st[i] ?? "unknown" }))
    .filter((v) => v.status !== "removed");
}

/**
 * Full-length streams come ONLY from the owner's own R2 bucket (files they uploaded and have rights to).
 * Key layout: media/movie/<id>/index.m3u8 | media/movie/<id>.mp4
 *             media/tv/<id>/s<S>e<E>/index.m3u8 | media/tv/<id>/s<S>e<E>.mp4
 */
export async function findStream(type: "movie" | "tv", id: number, season?: number, episode?: number): Promise<{ url: string; kind: "hls" | "mp4" } | null> {
  const base = (process.env["R2_PUBLIC_URL"] ?? "").replace(/\/$/, "");
  if (!base) return null;
  const stem = type === "movie" ? `media/movie/${id}` : `media/tv/${id}/s${season ?? 1}e${episode ?? 1}`;
  const ck = `stream:v1:${stem}`;
  try { const c = await redis(["GET", ck]); if (typeof c === "string") return c === "none" ? null : JSON.parse(c); } catch { /* */ }
  let found: { url: string; kind: "hls" | "mp4" } | null = null;
  for (const [path, kind] of [[`${stem}/index.m3u8`, "hls"], [`${stem}.mp4`, "mp4"]] as const) {
    try {
      const r = await fetch(`${base}/${path}`, { method: "HEAD", signal: AbortSignal.timeout(2500) });
      if (r.ok) { found = { url: `${base}/${path}`, kind }; break; }
    } catch { /* */ }
  }
  try { await redis(["SET", ck, found ? JSON.stringify(found) : "none", "EX", found ? 3600 : 600]); } catch { /* */ }
  return found;
}
