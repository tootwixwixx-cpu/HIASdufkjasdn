/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, PATCH, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, X-Requested-With" },
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
