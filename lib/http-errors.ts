// lib/http-errors.ts
// Public (unauthenticated) endpoints must not echo internal error text (DB errors, stack hints, file
// paths) back to callers. Log the real error server-side (and to Sentry, scrubbed), return a fixed
// message to the client.
import * as Sentry from "@sentry/nextjs";

export function publicError(err: unknown, fallback: string): string {
  console.error(`[api] ${fallback}:`, err);
  try {
    Sentry.captureException(err, { tags: { area: "public-api" }, extra: { context: fallback } });
  } catch {
    // monitoring must never break a response
  }
  return fallback;
}
