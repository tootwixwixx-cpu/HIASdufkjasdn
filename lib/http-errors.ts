// lib/http-errors.ts
// Public (unauthenticated) endpoints must not echo internal error text (DB errors, stack hints, file
// paths) back to callers. Log the real error server-side, return a fixed message to the client.
export function publicError(err: unknown, fallback: string): string {
  console.error(`[api] ${fallback}:`, err);
  return fallback;
}
