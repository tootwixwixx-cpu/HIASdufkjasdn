// instrumentation-client.ts — browser error monitoring (dashboard, claim page).
// No-op unless NEXT_PUBLIC_SENTRY_DSN is set. All events pass through lib/sentry-scrub.ts.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_BASE_OPTIONS } from "@/lib/sentry-scrub";

try {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (dsn) {
    Sentry.init({
      dsn,
      ...SENTRY_BASE_OPTIONS,
      // No session replay: it would record the dashboard (keys, IPs) on screen.
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
    });
  }
} catch {
  // monitoring must never break the page
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
