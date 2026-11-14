// lib/kv.ts
// Shared key/value state across every serverless instance, backed by Upstash Redis.
//
// Every function returns `null` when Redis isn't configured or the call fails, so callers can fall
// back to the Postgres implementations in lib/store.ts. Nothing here ever throws.
//
// Env: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, or the names Vercel's Upstash
// integration sets automatically (KV_REST_API_URL + KV_REST_API_TOKEN).
import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";

const redis: Redis | null = url && token ? new Redis({ url, token, retry: { retries: 1 } }) : null;
export const isRedisConfigured = Boolean(redis);

const P = "ap:"; // namespace so this app can share a Redis database safely

function warn(op: string, err: unknown) {
  console.error(`[kv] ${op} failed:`, err instanceof Error ? err.message : err);
}

/**
 * Fixed-window rate limit. true = allowed, false = over the limit, null = Redis unavailable.
 */
export async function kvRateLimit(bucket: string, key: string, limit: number, windowSeconds: number): Promise<boolean | null> {
  if (!redis) return null;
  const w = Math.max(1, Math.floor(windowSeconds));
  const k = `${P}rl:${bucket}:${key}:${Math.floor(Date.now() / 1000 / w)}`;
  try {
    const p = redis.pipeline();
    p.incr(k);
    p.expire(k, w + 5);
    const [count] = (await p.exec()) as [number, number];
    return Number(count) <= limit;
  } catch (err) {
    warn("rateLimit", err);
    return null;
  }
}

/** true the first time `key` is seen within ttl, false on repeat, null = unavailable. */
export async function kvConsumeOnce(key: string, ttlSeconds: number): Promise<boolean | null> {
  if (!redis) return null;
  try {
    const res = await redis.set(`${P}once:${key}`, "1", { nx: true, ex: Math.max(1, Math.floor(ttlSeconds)) });
    return res === "OK";
  } catch (err) {
    warn("consumeOnce", err);
    return null;
  }
}

/** Returns the value, `null` if absent, or `undefined` if Redis is unavailable. */
export async function kvGetJSON<T>(key: string): Promise<T | null | undefined> {
  if (!redis) return undefined;
  try {
    const v = await redis.get<T>(`${P}${key}`);
    return v === null || v === undefined ? null : v;
  } catch (err) {
    warn("get", err);
    return undefined;
  }
}

export async function kvSetJSON(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
  if (!redis) return false;
  try {
    await redis.set(`${P}${key}`, value, { ex: Math.max(1, Math.floor(ttlSeconds)) });
    return true;
  } catch (err) {
    warn("set", err);
    return false;
  }
}

/** Atomically read and delete (single-use values). `undefined` = unavailable. */
export async function kvGetDelJSON<T>(key: string): Promise<T | null | undefined> {
  if (!redis) return undefined;
  try {
    const v = await redis.getdel<T>(`${P}${key}`);
    return v === null || v === undefined ? null : v;
  } catch (err) {
    warn("getdel", err);
    return undefined;
  }
}

export async function kvDel(...keys: string[]): Promise<void> {
  if (!redis || keys.length === 0) return;
  try {
    await redis.del(...keys.map((k) => `${P}${k}`));
  } catch (err) {
    warn("del", err);
  }
}
