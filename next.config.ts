import type { NextConfig } from "next";

/**
 * Every room URL resolves to one statically generated room shell.
 *
 * The visible URL stays /room/CODE so old invite links keep working, but the
 * destination is a CDN asset rather than a per-room serverless render. That
 * takes function cold starts off the critical open/join path, and the cache
 * headers below let the edge keep serving the app even while an origin or a
 * fresh build is unavailable.
 */
const ROOM = "/room/:code([A-Za-z0-9]{4,8})";
const SHELL = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=604800";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: ROOM, destination: "/room?code=:code" }];
  },

  async headers() {
    return [
      { source: "/", headers: [{ key: "Cache-Control", value: SHELL }] },
      { source: "/room", headers: [{ key: "Cache-Control", value: SHELL }] },
      { source: ROOM, headers: [{ key: "Cache-Control", value: SHELL }] },
      {
        source: "/icon.svg",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
    ];
  },
};

export default nextConfig;
