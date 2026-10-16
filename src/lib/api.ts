// Browser-side client for the LOOPGRAM application API (never calls TMDB directly).
import { getState } from "./store";

export async function api<T = any>(params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)] as [string, string]));
  const r = await fetch(`/api/content?${qs}`, signal ? { signal } : {});
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: `Error ${r.status}` }));
    throw new Error(e.error ?? `Error ${r.status}`);
  }
  return r.json();
}

export function track(type: string, id: number, title: string, poster: string | null) {
  fetch("/api/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: "track", type, id, title, poster }), keepalive: true }).catch(() => {});
}

/** Direct TMDB image CDN URL (no proxying through R2). Low-data mode uses smaller sizes. */
export function img(path: string | null | undefined, size: "w185" | "w342" | "w500" | "w780" = "w342") {
  if (!path || !/^\/[A-Za-z0-9_\-.]+$/.test(path)) return null;
  const low = typeof window !== "undefined" && getState().lowData;
  // Phones (< 640px) get one size step down: w342 -> w185, w780/w500 -> w342.
  const mobile = typeof window !== "undefined" && window.innerWidth < 640;
  const s = low ? (size === "w780" ? "w342" : "w185") : mobile ? (size === "w342" ? "w185" : size === "w185" ? "w185" : "w342") : size;
  return `https://image.tmdb.org/t/p/${s}${path}`;
}
