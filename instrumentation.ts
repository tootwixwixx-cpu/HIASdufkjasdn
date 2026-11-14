// instrumentation.ts — server-side error monitoring (Next.js 16 instrumentation convention).
// Sentry is a no-op unless SENTRY_DSN is set. All events pass through lib/sentry-scrub.ts.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_BASE_OPTIONS } from "@/lib/sentry-scrub";

export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    ...SENTRY_BASE_OPTIONS,
  });
}

// Captures errors thrown in route handlers, server components and the proxy.
export const onRequestError = Sentry.captureRequestError;
