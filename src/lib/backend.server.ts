// Server-only clients: Upstash Redis, TMDB, DynamoDB, R2. Env read per call (Workers).
import { AwsClient } from "aws4fetch";
import { resolveTmdb } from "./tmdb-allowlist";

const env = (k: string) => process.env[k] ?? "";

// ---------- Redis (Upstash REST) ----------
export async function redis(cmd: (string | number)[]): Promise<unknown> {
  const url = env("UPSTASH_REDIS_REST_URL"), token = env("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) return null;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmd),
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return null;
    return ((await r.json()) as { result: unknown }).result;
  } catch { return null; }
}

/** Several commands in one HTTP round trip (Upstash /pipeline). Fails open with nulls. */
export async function redisPipeline(cmds: (string | number)[][]): Promise<unknown[]> {
  const url = env("UPSTASH_REDIS_REST_URL"), token = env("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token || !cmds.length) return cmds.map(() => null);
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmds),
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return cmds.map(() => null);
    return ((await r.json()) as { result?: unknown }[]).map((x) => x?.result ?? null);
  } catch { return cmds.map(() => null); }
}

/** Fixed-window rate limit in one round trip; fails open if Redis is down. */
// Local tally per isolate: Redis is synced every SYNC_EVERY requests (batched INCRBY) instead of on
// every request, removing a Redis round trip from most API calls. Global count stays accurate within SYNC_EVERY.
const SYNC_EVERY = 10;
const rl = new Map<string, { pending: number; known: number }>();
export async function rateLimit(ip: string, limit = 120, windowSec = 60): Promise<boolean> {
  const key = `rl:${ip}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  let e = rl.get(key);
  if (!e) {
    if (rl.size > 5000) rl.clear();
    e = { pending: 0, known: 0 };
    rl.set(key, e);
  }
  e.pending++;
  if (e.known + e.pending > limit) return false;
  // Near the limit, sync every request so cross-instance overshoot shrinks to in-flight requests only.
  const nearLimit = e.known + e.pending > limit - SYNC_EVERY;
  if (!nearLimit && e.pending < SYNC_EVERY && e.known + e.pending > 1) return true;
  const inc = e.pending;
  e.pending = 0;
  const [n] = await redisPipeline([["INCRBY", key, inc], ["EXPIRE", key, windowSec, "NX"]]);
  if (typeof n === "number") e.known = n;
  else e.known += inc;
  return typeof n !== "number" || n <= limit;
}

// ---------- TMDB ----------
const inflight = new Map<string, Promise<TmdbResult>>();
// L1: per-isolate memory cache in front of Redis, so hot keys skip the Redis round trip.
// Same key as Redis (path + full query), so no cross-title/language contamination.
const L1_MAX = 400, L1_TTL_MS = 60_000;
const l1 = new Map<string, { body: string; exp: number }>();
function l1Get(key: string) {
  const e = l1.get(key);
  if (!e) return null;
  if (e.exp < Date.now()) { l1.delete(key); return null; }
  return e.body;
}
function l1Set(key: string, body: string, ttlSec: number) {
  if (l1.size >= L1_MAX) l1.delete(l1.keys().next().value as string);
  l1.set(key, { body, exp: Date.now() + Math.min(ttlSec * 1000, L1_TTL_MS) });
}
export type TmdbResult = { status: number; body: string; cache: "HIT" | "MISS" | "BYPASS" | "STALE"; ttl: number };

/** In-memory sliding-window limiter (per isolate). No network calls, so reads never depend on Redis. */
const sw = new Map<string, number[]>();
export function localRateLimit(key: string, limit = 120, windowMs = 60_000): boolean {
  const now = Date.now();
  if (sw.size > 10_000) sw.clear();
  const hits = (sw.get(key) ?? []).filter((t) => t > now - windowMs);
  if (hits.length >= limit) { sw.set(key, hits); return false; }
  hits.push(now);
  sw.set(key, hits);
  return true;
}

// Circuit breaker: after repeated 429/5xx/network failures, stop calling TMDB for a cool-down and serve stale copies.
const CB_THRESHOLD = 5, CB_COOLDOWN_MS = 30_000;
let cbFails = 0, cbOpenUntil = 0;
export const circuitOpen = () => Date.now() < cbOpenUntil;
function cbFail() { if (++cbFails >= CB_THRESHOLD) { cbOpenUntil = Date.now() + CB_COOLDOWN_MS; cbFails = 0; } }
function cbOk() { cbFails = 0; }
// Per-isolate last-good copies (survive Redis outages); bounded.
const memStale = new Map<string, string>();
function memStaleSet(key: string, body: string) {
  if (memStale.size >= 800) memStale.delete(memStale.keys().next().value as string);
  memStale.set(key, body);
}
const bg = (p: Promise<unknown>) => { p.catch(() => {}); };

export async function tmdb(path: string, params: Record<string, string | number | undefined> | URLSearchParams = {}): Promise<TmdbResult> {
  const input = params instanceof URLSearchParams ? params : new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)] as [string, string]));
  const res = resolveTmdb(path, input);
  if (!res.ok) return { status: res.status, body: JSON.stringify({ error: res.error }), cache: "BYPASS", ttl: 0 };
  const qs = res.query.toString();
  const key = `tmdb:v1:${res.path}?${qs}`;
  const hot = l1Get(key);
  if (hot !== null) return { status: 200, body: hot, cache: "HIT", ttl: res.ttl };
  const existing = inflight.get(key);
  if (existing) return existing;
  const staleOf = async (): Promise<TmdbResult | null> => {
    const m = memStale.get(key);
    if (m) return { status: 200, body: m, cache: "STALE", ttl: 60 };
    const s = await redis(["GET", `stale:${key}`]);
    return typeof s === "string" ? { status: 200, body: s, cache: "STALE", ttl: 60 } : null;
  };
  const p = (async (): Promise<TmdbResult> => {
    // Shared cache lookup (fails open to null in 2.5s if Redis is down).
    const [cached, neg] = await redisPipeline([["GET", key], ["GET", `neg:${key}`]]);
    if (typeof cached === "string") { l1Set(key, cached, res.ttl); memStaleSet(key, cached); return { status: 200, body: cached, cache: "HIT", ttl: res.ttl }; }
    if (typeof neg === "string") return { status: 404, body: neg, cache: "HIT", ttl: 0 };
    // Breaker open: don't touch TMDB at all.
    if (circuitOpen()) {
      const s = await staleOf();
      return s ?? { status: 503, body: JSON.stringify({ error: "TMDB temporarily unavailable" }), cache: "BYPASS", ttl: 0 };
    }
    const token = env("TMDB_READ_ACCESS_TOKEN");
    const url = new URL(`https://api.themoviedb.org/3/${res.path}`);
    res.query.forEach((v, k) => url.searchParams.set(k, v));
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    else url.searchParams.set("api_key", env("TMDB_API_KEY"));
    let r: Response | null = null;
    try { r = await fetch(url, { headers, signal: AbortSignal.timeout(6000) }); } catch { r = null; }
    if (!r || r.status === 429 || r.status >= 500) {
      // Fail fast (no retry storms): trip the breaker and serve the last good copy.
      cbFail();
      const s = await staleOf();
      if (s) return s;
      return { status: r ? 503 : 504, body: JSON.stringify({ error: "TMDB unavailable" }), cache: "BYPASS", ttl: 0 };
    }
    cbOk();
    const body = await r.text();
    if (r.ok) {
      l1Set(key, body, res.ttl);
      memStaleSet(key, body);
      bg(redisPipeline([["SET", key, body, "EX", res.ttl], ["SET", `stale:${key}`, body, "EX", 7 * 86400]]));
    } else if (r.status === 404) {
      bg(redisPipeline([["SET", `neg:${key}`, body.slice(0, 500), "EX", 300]]));
    }
    console.log(JSON.stringify({ flow: "tmdb", path: res.path, status: r.status, cache: "MISS" }));
    return { status: r.status, body, cache: "MISS", ttl: res.ttl };
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

export async function tmdbJson<T = any>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const r = await tmdb(path, params);
  if (r.status !== 200) throw new Error(`TMDB ${r.status}: ${r.body.slice(0, 200)}`);
  return JSON.parse(r.body) as T;
}

// ---------- AWS / DynamoDB ----------
function aws() {
  return new AwsClient({
    accessKeyId: env("AWS_ACCESS_KEY_ID"), secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
    region: env("AWS_REGION") || "eu-north-1", service: "dynamodb",
  });
}
export async function dynamo(op: string, body: unknown) {
  const region = env("AWS_REGION") || "eu-north-1";
  const r = await aws().fetch(`https://dynamodb.${region}.amazonaws.com/`, {
    method: "POST",
    headers: { "X-Amz-Target": `DynamoDB_20120810.${op}`, "Content-Type": "application/x-amz-json-1.0" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`DynamoDB ${op} ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
let tableKey: { pk: string; sk: string | undefined } | null = null;
export async function tableSchema() {
  if (tableKey) return tableKey as { pk: string; sk: string | undefined };
  const d = await dynamo("DescribeTable", { TableName: env("DYNAMODB_TABLE_NAME") });
  const ks = d.Table.KeySchema as { AttributeName: string; KeyType: string }[];
  tableKey = { pk: ks.find((k) => k.KeyType === "HASH")!.AttributeName, sk: ks.find((k) => k.KeyType === "RANGE")?.AttributeName };
  return tableKey as { pk: string; sk: string | undefined };
}
/** Write-sharded counter key: a hot title's writes spread over VIEW_SHARDS items/partitions.
 * Shard 0 keeps the original key (`TITLE#<type>#<id>`) so existing counts stay valid; total = sum of shards. */
export const VIEW_SHARDS = 10;
export function viewShardKey(type: string, id: number, shard = Math.floor(Math.random() * VIEW_SHARDS)) {
  return shard === 0 ? `TITLE#${type}#${id}` : `TITLE#${type}#${id}#S${shard}`;
}
// Derived Redis popularity is batched per isolate: increments accumulate locally and are flushed with one
// pipelined ZINCRBY per title at most every POP_FLUSH_MS, so lg:popular/lg:meta writes don't scale 1:1 with views.
// Losing an unflushed batch only under-counts derived data; DynamoDB (below) stays the per-view durable record.
const POP_FLUSH_MS = 5_000, META_TTL_MS = 10 * 60_000;
const popPending = new Map<string, number>();
const metaWritten = new Map<string, number>();
const metaPending = new Map<string, string>();
let popLastFlush = 0;
async function flushPopular(force = false) {
  const now = Date.now();
  if (!force && now - popLastFlush < POP_FLUSH_MS) return;
  if (!popPending.size && !metaPending.size) return;
  popLastFlush = now;
  const cmds: (string | number)[][] = [...popPending].map(([k, n]) => ["ZINCRBY", "lg:popular", n, k]);
  if (metaPending.size) cmds.push(["HSET", "lg:meta", ...[...metaPending].flat()]);
  popPending.clear(); metaPending.clear();
  if (metaWritten.size > 5000) metaWritten.clear();
  await redisPipeline(cmds);
}
/** Anonymous view counter: one atomic UpdateItem (ADD) per view on a random shard, no scans.
 * Returns whether the durable DynamoDB write succeeded; it never reports persistence that didn't happen. */
export async function countView(type: string, id: number, title: string, poster: string | null): Promise<{ durable: boolean }> {
  const member = `${type}:${id}`;
  popPending.set(member, (popPending.get(member) ?? 0) + 1);
  if ((metaWritten.get(member) ?? 0) < Date.now() - META_TTL_MS) {
    metaWritten.set(member, Date.now());
    metaPending.set(member, JSON.stringify({ title, poster }));
  }
  const pop = flushPopular();
  try {
  const k = await tableSchema();
  const Key: Record<string, { S: string }> = { [k.pk]: { S: viewShardKey(type, id) } };
  if (k.sk) Key[k.sk] = { S: "STATS" };
  await dynamo("UpdateItem", {
    TableName: env("DYNAMODB_TABLE_NAME"), Key,
    UpdateExpression: "ADD #v :one SET #t = :t, #p = :p, #m = :m, #i = :i, #u = :u",
    ExpressionAttributeNames: { "#v": "views", "#t": "title", "#p": "poster", "#m": "media", "#i": "tmdb_id", "#u": "updated_at" },
    ExpressionAttributeValues: {
      ":one": { N: "1" }, ":t": { S: title.slice(0, 200) }, ":p": poster ? { S: poster } : { NULL: true },
      ":m": { S: type }, ":i": { N: String(id) }, ":u": { S: new Date().toISOString() },
    },
  });
  await pop;
  return { durable: true };
  } catch (e) {
    console.error("dynamo countView", e instanceof Error ? e.message.slice(0, 200) : e);
    await pop;
    return { durable: false };
  }
}
/** Offline recovery: rebuild derived lg:popular/lg:meta from authoritative DynamoDB shards (sums every shard).
 * Uses a paginated Scan, so it must only run from an operator script, never on a request path. */
export async function rebuildPopularFromDynamo() {
  const totals = new Map<string, { n: number; title: string; poster: string | null }>();
  let start: unknown;
  do {
    const r = await dynamo("Scan", {
      TableName: env("DYNAMODB_TABLE_NAME"), ExclusiveStartKey: start,
      FilterExpression: "attribute_exists(#v) AND attribute_exists(#m) AND attribute_exists(#i)",
      ExpressionAttributeNames: { "#v": "views", "#m": "media", "#i": "tmdb_id" },
    });
    for (const it of r.Items ?? []) {
      const key = `${it.media.S}:${it.tmdb_id.N}`;
      const e = totals.get(key) ?? { n: 0, title: it.title?.S ?? "", poster: it.poster?.S ?? null };
      e.n += Number(it.views.N);
      totals.set(key, e);
    }
    start = r.LastEvaluatedKey;
  } while (start);
  const entries = [...totals];
  for (let i = 0; i < entries.length; i += 200) {
    const part = entries.slice(i, i + 200);
    await redisPipeline([
      ["ZADD", "lg:popular", ...part.flatMap(([k, e]) => [e.n, k])],
      ["HSET", "lg:meta", ...part.flatMap(([k, e]) => [k, JSON.stringify({ title: e.title, poster: e.poster })])],
    ]);
  }
  return entries.length;
}
let popCache: { data: { id: number; media_type: string | undefined; title: string; poster_path: string | null }[]; exp: number } | null = null;
export async function popularOnLoopgram(n = 20) {
  const now = Date.now();
  if (popCache && popCache.exp > now) return popCache.data;
  const ids = (await redis(["ZREVRANGE", "lg:popular", 0, n - 1])) as string[] | null;
  if (!ids?.length) return [];
  const metas = (await redis(["HMGET", "lg:meta", ...ids])) as (string | null)[] | null;
  const data = ids.map((k, i) => {
    const [media_type, id] = k.split(":");
    const m = metas?.[i] ? JSON.parse(metas[i]!) : {};
    return { id: Number(id), media_type, title: m.title, poster_path: m.poster };
  }).filter((x) => x.title);
  popCache = { data, exp: now + 30_000 };
  return data;
}

// ---------- R2 ----------
function r2() {
  return new AwsClient({
    accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    region: "auto", service: "s3",
  });
}
const SIZES = new Set(["w185", "w342", "w500", "w780"]);
/** Mirror a TMDB image into R2 once; returns public URL. */
export async function mirrorImage(size: string, file: string): Promise<string | null> {
  if (!SIZES.has(size) || !/^\/[A-Za-z0-9_-]{5,64}\.(jpg|png|webp)$/.test(file)) return null;
  const key = `tmdb/${size}${file}`;
  const pub = `${env("R2_PUBLIC_URL").replace(/\/$/, "")}/${key}`;
  const flag = `r2:${key}`;
  if ((await redis(["GET", flag])) === "1") return pub;
  const base = `${env("R2_ENDPOINT").replace(/\/$/, "")}/${env("R2_BUCKET_NAME")}/${key}`;
  const head = await r2().fetch(base, { method: "HEAD", signal: AbortSignal.timeout(4000) });
  if (head.ok) { await redis(["SET", flag, "1", "EX", 30 * 86400]); return pub; }
  const img = await fetch(`https://image.tmdb.org/t/p/${size}${file}`, { signal: AbortSignal.timeout(8000) });
  if (!img.ok) return null;
  const buf = await img.arrayBuffer();
  if (buf.byteLength > 2_000_000) return null;
  const put = await r2().fetch(base, {
    method: "PUT", body: buf,
    headers: { "Content-Type": img.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" },
  });
  if (!put.ok) throw new Error(`R2 PUT ${put.status}: ${(await put.text()).slice(0, 200)}`);
  await redis(["SET", flag, "1", "EX", 30 * 86400]);
  return pub;
}

export function clientIp(req: Request) {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
}
