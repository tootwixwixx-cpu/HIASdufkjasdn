/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // CORS is handled per-request in proxy.ts (allowlist) — no blanket wildcard here.
  // Baseline security headers for the dashboard and public pages.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  webpack: (config, { isServer, dev }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        net: false,
        tls: false,
        child_process: false,
      };
    }
    // DEV ENVIRONMENT NOTE: webpack's persistent filesystem cache
    // (.next/cache/webpack/*.pack) can balloon to multiple GB per route
    // compile on this project and repeatedly filled a disk-space-constrained
    // dev machine (ENOSPC crashes during `next dev`/`next build`). Disabling
    // it trades some rebuild speed for not exhausting disk. If you're on a
    // machine with ample free disk, feel free to remove this override.
    if (dev) {
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
