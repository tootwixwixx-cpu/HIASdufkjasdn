// components/WorldMapTelemetry.tsx
"use client";

import React, { useState, useMemo } from "react";
import {
  Globe,
  Radio,
  Users,
  Compass,
  MapPin,
  ExternalLink,
  Shield,
  Zap,
  Activity,
  Layers,
  Crosshair,
  Maximize2,
  RefreshCw,
  Sparkles,
  Info,
} from "lucide-react";
import type { ExecutionLog } from "@/lib/store";
import { geoNaturalEarth1, geoPath, geoGraticule10, geoCentroid } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import isoCountries from "i18n-iso-countries";
import worldTopo from "world-atlas/countries-110m.json";

export interface ActivePlayerSession {
  id: string;
  ip_address: string;
  roblox_username?: string | null;
  roblox_user_id?: string | null;
  avatar_url?: string | null;
  place_name?: string | null;
  place_id?: string | null;
  status: string;
  is_online?: boolean;
  duration_seconds?: number;
  last_ping_sec?: number;
  executor?: string | null;
  os?: string | null;
  country?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

interface GeoPoint {
  lat: number;
  lng: number;
  city: string;
  country: string;
  code: string;
  flag: string;
  /** ISO 3166-1 numeric id (matches the world-atlas country features), if known */
  numericId: string | null;
  /** true = real coordinates from the edge network; false = country centre (only the country is known) */
  precise: boolean;
}

// ---------------------------------------------------------------------------------------------
// Real world geography: Natural Earth 1:110m country boundaries (world-atlas), projected with the
// Natural Earth projection. Computed once at module load.
// ---------------------------------------------------------------------------------------------
const MAP_W = 1000;
const MAP_H = 500;
const projection = geoNaturalEarth1().fitExtent(
  [
    [6, 6],
    [MAP_W - 6, MAP_H - 6],
  ],
  { type: "Sphere" }
);
const pathGen = geoPath(projection);

type CountryFeature = Feature<Geometry, { name?: string }>;
const COUNTRY_FEATURES: CountryFeature[] = (
  feature(worldTopo as any, (worldTopo as any).objects.countries) as unknown as FeatureCollection<Geometry, { name?: string }>
).features;

const normalizeNumericId = (id: unknown): string | null => {
  const n = Number(id);
  return Number.isFinite(n) ? String(n) : null;
};

const COUNTRY_PATHS = COUNTRY_FEATURES.map((f, i) => ({
  key: `${normalizeNumericId(f.id) ?? "x"}-${i}`,
  id: normalizeNumericId(f.id),
  name: f.properties?.name || "",
  d: pathGen(f) || "",
}));
const SPHERE_PATH = pathGen({ type: "Sphere" }) || "";
const GRATICULE_PATH = pathGen(geoGraticule10()) || "";
const COUNTRY_CENTROIDS = new Map<string, [number, number]>();
for (const f of COUNTRY_FEATURES) {
  const id = normalizeNumericId(f.id);
  if (id) COUNTRY_CENTROIDS.set(id, geoCentroid(f) as [number, number]);
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

function countryNameFor(code: string): string {
  try {
    return regionNames?.of(code) || code;
  } catch {
    return code;
  }
}

// Viewport for a lon/lat box, computed by projecting points along its edges.
function regionBox(lonMin: number, lonMax: number, latMin: number, latMax: number) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i <= 24; i++) {
    const lo = lonMin + ((lonMax - lonMin) * i) / 24;
    const la = latMin + ((latMax - latMin) * i) / 24;
    for (const pt of [[lo, latMin], [lo, latMax], [lonMin, la], [lonMax, la]] as [number, number][]) {
      const p = projection(pt);
      if (!p) continue;
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
  }
  const pad = 10;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

const REGION_BOXES = {
  global: { x: 0, y: 0, w: MAP_W, h: MAP_H },
  na: regionBox(-170, -30, -58, 75), // the Americas
  sa: regionBox(-92, -30, -58, 15),
  eu: regionBox(-25, 45, 34, 71),
  asia: regionBox(25, 150, -12, 60),
} as const;

function getCountryFlag(code?: string | null): string {
  if (!code || code.length !== 2) return "🌐";
  const codePoints = code
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

function resolvePlayerGeo(
  session?: {
    country?: string | null;
    city?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    ip_address?: string;
    roblox_user_id?: string | null;
    roblox_username?: string | null;
    id?: string;
  }
): GeoPoint | null {
  // Only real data is plotted. The old version invented a location by hashing the player's IP onto
  // one of 20 hard-coded "gaming hubs" with random jitter — that's gone.
  const rawCode = (session?.country || "").trim().toUpperCase();
  const code = /^[A-Z]{2}$/.test(rawCode) ? rawCode : "";
  const numericRaw = code ? isoCountries.alpha2ToNumeric(code) : undefined;
  const numericId = numericRaw ? normalizeNumericId(numericRaw) : null;
  const country = code ? countryNameFor(code) : "Unknown country";
  const flag = getCountryFlag(code || null);

  const lat = session?.latitude;
  const lng = session?.longitude;
  // 1. Real coordinates from the edge network (Vercel / Cloudflare geo headers)
  if (
    typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  ) {
    return { lat, lng, city: session?.city || "Unknown city", country, code, flag, numericId, precise: true };
  }

  // 2. Only the country is known: use that country's geographic centre
  if (numericId && COUNTRY_CENTROIDS.has(numericId)) {
    const [cLng, cLat] = COUNTRY_CENTROIDS.get(numericId)!;
    return { lat: cLat, lng: cLng, city: session?.city || "City unavailable", country, code, flag, numericId, precise: false };
  }

  // 3. No location data at all: don't make one up
  return null;
}

function projectToSvg(lat: number, lng: number): { x: number; y: number } | null {
  const p = projection([lng, lat]);
  return p ? { x: p[0], y: p[1] } : null;
}

export default function WorldMapTelemetry({
  sessions = [],
  logs = [],
}: {
  sessions?: ActivePlayerSession[];
  logs?: ExecutionLog[];
}) {
  const [selectedPlayer, setSelectedPlayer] = useState<{
    id: string;
    username: string;
    userId?: string | null;
    avatarUrl?: string | null;
    ip: string;
    city: string;
    country: string;
    flag: string;
    placeName?: string | null;
    placeId?: string | null;
    executor?: string | null;
    os?: string | null;
    duration?: string;
    isOnline: boolean;
    pingSec?: number;
    coords: { x: number; y: number };
    precise?: boolean;
    numericId?: string | null;
  } | null>(null);

  const [filterMode, setFilterMode] = useState<"active" | "all">("active");
  const [regionZoom, setRegionZoom] = useState<"global" | "na" | "eu" | "asia" | "sa">("global");

  // Derive plotted players
  const { list: plottedPlayers, unlocated: unlocatedCount } = useMemo(() => {
    const list: typeof selectedPlayer[] = [];
    let unlocated = 0;

    // 1. First add all currently online/active sessions
    sessions.forEach((s) => {
      const isOnline = s.is_online ?? (s.status === "active");
      if (filterMode === "active" && !isOnline) return;

      const geo = resolvePlayerGeo(s);
      const coords = geo ? projectToSvg(geo.lat, geo.lng) : null;
      if (!geo || !coords) {
        unlocated += 1;
        return;
      }

      const m = Math.floor((s.duration_seconds || 0) / 60);
      const sec = (s.duration_seconds || 0) % 60;
      const durationStr = `${m}m ${sec}s`;

      list.push({
        id: s.id,
        username: s.roblox_username || `Player_${s.id.substring(0, 5)}`,
        userId: s.roblox_user_id,
        avatarUrl: s.avatar_url || (s.roblox_user_id ? `/api/roblox/avatar?userId=${s.roblox_user_id}` : null),
        ip: s.ip_address,
        city: geo.city,
        country: geo.country,
        flag: geo.flag,
        placeName: s.place_name || (s.place_id ? `Place #${s.place_id}` : "Universal Runtime"),
        placeId: s.place_id,
        executor: s.executor || "Luau Client",
        os: s.os || "Windows",
        duration: durationStr,
        isOnline: Boolean(isOnline),
        pingSec: s.last_ping_sec ?? 1,
        coords,
        precise: geo.precise,
        numericId: geo.numericId,
      });
    });

    // 2. If list has few active sessions or user selected "all", supplement with unique recent execution logs
    if (list.length < 5 || filterMode === "all") {
      const seenIps = new Set(list.map((p) => p?.ip));
      logs.slice(0, 30).forEach((log) => {
        if (!log.ip_address || seenIps.has(log.ip_address)) return;
        seenIps.add(log.ip_address);

        const geo = resolvePlayerGeo(log);
        const coords = geo ? projectToSvg(geo.lat, geo.lng) : null;
        if (!geo || !coords) {
          unlocated += 1;
          return;
        }

        list.push({
          id: log.id,
          username: log.roblox_username || "Verified Player",
          userId: log.roblox_user_id,
          avatarUrl: log.avatar_url || (log.roblox_user_id ? `/api/roblox/avatar?userId=${log.roblox_user_id}` : null),
          ip: log.ip_address,
          city: geo.city,
          country: geo.country,
          flag: geo.flag,
          placeName: log.place_name || (log.place_id ? `Place #${log.place_id}` : "Script Executed"),
          placeId: log.place_id,
          executor: log.executor || "Luau Client",
          os: log.os || "Windows",
          duration: "Recent Execution",
          isOnline: false,
          pingSec: 0,
          coords,
          precise: geo.precise,
          numericId: geo.numericId,
        });
      });
    }

    return { list: list.filter(Boolean) as NonNullable<typeof selectedPlayer>[], unlocated };
  }, [sessions, logs, filterMode]);

  // Countries that currently have plotted players get highlighted on the map.
  const activeCountryIds = useMemo(
    () => new Set(plottedPlayers.map((p) => p.numericId).filter(Boolean) as string[]),
    [plottedPlayers]
  );

  // Aggregate country statistics
  const countryStats = useMemo(() => {
    const counts: Record<string, { country: string; flag: string; count: number }> = {};
    plottedPlayers.forEach((p) => {
      if (!counts[p.country]) {
        counts[p.country] = { country: p.country, flag: p.flag, count: 0 };
      }
      counts[p.country].count += 1;
    });
    return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 6);
  }, [plottedPlayers]);

  const activeCount = sessions.filter((s) => s.is_online ?? (s.status === "active")).length;

  // ViewBox dynamic calculation based on region zoom
  // Viewports are computed from real lon/lat boxes projected onto the map.
  const box = REGION_BOXES[regionZoom] || REGION_BOXES.global;
  const viewBox = `${box.x} ${box.y} ${box.w} ${box.h}`;
  // Keep markers and strokes the same on-screen size when zoomed in.
  const k = box.w / MAP_W;

  return (
    <div className="bg-surface border border-line rounded-lg overflow-hidden relative">
      {/* Fitted Header Bar */}
      <div className="p-4 sm:p-4 border-b border-line flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center text-accent-text shrink-0">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-body-sm sm:text-base font-bold text-fg tracking-wide font-data">
                Real-Time Global Player Telemetry
              </h2>
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-micro font-bold font-data bg-success/15 text-success-text border border-success/30">
                <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
                <span>{activeCount} ONLINE NOW</span>
              </span>
            </div>
            <p className="text-caption text-fg-muted font-data mt-0.5">
              Live geographic execution radar tracking Roblox players across global continents & edge nodes.
            </p>
          </div>
        </div>

        {/* Region & Filter Controls */}
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto font-data text-caption">
          {/* Zoom Presets */}
          <div className="flex items-center bg-canvas border border-line rounded-lg p-0.5">
            {[
              { id: "global", label: "World" },
              { id: "na", label: "Americas" },
              { id: "eu", label: "Europe" },
              { id: "asia", label: "Asia" },
            ].map((reg) => (
              <button
                key={reg.id}
                type="button"
                onClick={() => setRegionZoom(reg.id as any)}
                className={`px-2 py-1 rounded-lg text-micro font-medium transition-all ${
                  regionZoom === reg.id
                    ? "bg-accent/20 text-accent-text font-bold border border-accent/30"
                    : "text-fg-muted hover:text-fg"
                }`}
              >
                {reg.label}
              </button>
            ))}
          </div>

          {/* Active / All Toggle */}
          <div className="flex items-center bg-canvas border border-line rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setFilterMode("active")}
              className={`px-2.5 py-1 rounded-lg text-micro font-semibold transition-all ${
                filterMode === "active"
                  ? "bg-accent text-accent-fg font-bold"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              Active ({activeCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("all")}
              className={`px-2.5 py-1 rounded-lg text-micro font-semibold transition-all ${
                filterMode === "all"
                  ? "bg-surface-hover text-fg font-bold"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              All Runs
            </button>
          </div>
        </div>
      </div>

      {/* Top Country Distribution Bar */}
      {countryStats.length > 0 && (
        <div className="px-4 py-2.5 bg-canvas border-b border-line flex items-center gap-2 overflow-x-auto text-caption font-data scrollbar-none">
          <span className="text-micro font-bold text-fg-subtle flex items-center gap-1 shrink-0">
            <Crosshair className="w-3 h-3 text-accent-text" />
            Top Locations:
          </span>
          {countryStats.map((c) => (
            <div
              key={c.country}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface border border-line text-fg shrink-0 text-micro"
            >
              <span>{c.flag}</span>
              <span className="font-semibold text-fg">{c.country}</span>
              <span className="text-accent-text font-bold bg-accent/10 px-1.5 py-0.2 rounded text-micro">
                {c.count}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* REAL Vector World Map Canvas */}
      <div className="relative w-full aspect-[2/1] min-h-[340px] max-h-[560px] bg-[#07080D] overflow-hidden select-none">
        {/* World map: Natural Earth 1:110m country boundaries, Natural Earth projection */}
        <svg
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          className="w-full h-full"
          role="img"
          aria-label="World map of player locations"
        >
          {/* DEFINITIONS FOR GLOW EFFECTS */}
          <defs>
            <radialGradient id="playerPingGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#00f0ff" stopOpacity="1" />
              <stop offset="60%" stopColor="#00a2ff" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#0055ff" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="playerOnlineGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#10b981" stopOpacity="1" />
              <stop offset="60%" stopColor="#059669" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#047857" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Globe outline + 10° graticule */}
          <path d={SPHERE_PATH} fill="#0A0D16" stroke="#1E2638" strokeWidth={0.8 * k} />
          <path d={GRATICULE_PATH} fill="none" stroke="#38bdf8" strokeOpacity={0.08} strokeWidth={0.5 * k} />

          {/* Countries (highlighted when they have plotted players) */}
          <g strokeLinejoin="round">
            {COUNTRY_PATHS.map((c) => (
              <path
                key={c.key}
                d={c.d}
                fill={c.id && activeCountryIds.has(c.id) ? "#1C2B47" : "#141A29"}
                stroke={c.id && activeCountryIds.has(c.id) ? "#2E4A78" : "#232C42"}
                strokeWidth={0.5 * k}
              >
                <title>{c.name}</title>
              </path>
            ))}
          </g>

          {/* ACTIVE TELEMETRY PINGS (Live Players Radar Coordinates) */}
          {plottedPlayers.map((player) => {
            const isSelected = selectedPlayer?.id === player.id;
            const { x, y } = player.coords;

            return (
              <g
                key={player.id}
                className="cursor-pointer transition-transform duration-300"
                onClick={() => setSelectedPlayer(isSelected ? null : player)}
              >
                <title>
                  {`${player.username} — ${player.city}, ${player.country}${player.precise ? "" : " (country-level location)"}`}
                </title>

                {/* Expanding radar ripples. transform-box/origin make the CSS scale animation grow from the
                    dot itself (SVG's default origin is the map's top-left corner, which made ripples drift). */}
                {player.isOnline && (
                  <>
                    <circle
                      cx={x}
                      cy={y}
                      r={10 * k}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth={1 * k}
                      className="animate-ping opacity-60"
                      style={{ animationDuration: "2.5s", transformBox: "fill-box", transformOrigin: "center" }}
                    />
                    <circle
                      cx={x}
                      cy={y}
                      r={16 * k}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth={0.5 * k}
                      className="animate-ping opacity-30"
                      style={{ animationDuration: "3.5s", transformBox: "fill-box", transformOrigin: "center" }}
                    />
                  </>
                )}

                {/* Approximate (country-centre) locations get a dashed ring so they aren't mistaken for exact ones */}
                {!player.precise && (
                  <circle
                    cx={x}
                    cy={y}
                    r={9 * k}
                    fill="none"
                    stroke={player.isOnline ? "#34d399" : "#38bdf8"}
                    strokeOpacity={0.7}
                    strokeWidth={0.8 * k}
                    strokeDasharray={`${2 * k} ${2 * k}`}
                  />
                )}

                {/* Outer Glow Halo */}
                <circle
                  cx={x}
                  cy={y}
                  r={(isSelected ? 9 : 6) * k}
                  fill={player.isOnline ? "url(#playerOnlineGlow)" : "url(#playerPingGlow)"}
                />

                {/* Solid Core Dot */}
                <circle
                  cx={x}
                  cy={y}
                  r={(isSelected ? 4.5 : 3) * k}
                  fill={player.isOnline ? "#34d399" : "#38bdf8"}
                  stroke="#ffffff"
                  strokeWidth={1 * k}
                />
              </g>
            );
          })}
        </svg>

        {/* Selected Player Floating Glassmorphic Telemetry Card */}
        {selectedPlayer && (
          <div className="absolute bottom-4 left-4 right-4 md:right-auto md:w-80 bg-surface border border-accent/40 rounded-lg p-4 animate-fadeIn z-30 font-data text-caption">
            <div className="flex items-start justify-between pb-2.5 border-b border-line">
              <div className="flex items-center gap-2.5">
                {selectedPlayer.userId ? (
                  <img
                    src={`/api/roblox/avatar?userId=${selectedPlayer.userId}`}
                    alt={selectedPlayer.username}
                    className="w-9 h-9 rounded-lg border border-line-strong bg-surface object-cover"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center font-bold text-accent-text">
                    {selectedPlayer.username.substring(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-fg text-caption">{selectedPlayer.username}</span>
                    {selectedPlayer.isOnline && (
                      <span className="w-2 h-2 rounded-full bg-success" />
                    )}
                  </div>
                  <span className="text-micro text-fg-muted block">
                    ID: {selectedPlayer.userId || "Unknown"}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPlayer(null)}
                className="text-fg-subtle hover:text-fg p-1 rounded"
              >
                ✕
              </button>
            </div>

            <div className="mt-2.5 space-y-1.5 text-micro">
              <div className="flex items-center justify-between text-fg-muted">
                <span>Location:</span>
                <span className="text-fg font-medium flex items-center gap-1">
                  <span>{selectedPlayer.flag}</span>
                  <span>{selectedPlayer.city}, {selectedPlayer.country}</span>
                </span>
              </div>

              <div className="flex items-center justify-between text-fg-muted">
                <span>Game Name:</span>
                <span className="text-accent-text font-medium truncate max-w-[170px]">
                  {selectedPlayer.placeName}
                </span>
              </div>

              <div className="flex items-center justify-between text-fg-muted">
                <span>Executor:</span>
                <span className="px-1.5 py-0.2 rounded bg-accent/15 text-accent-text border border-accent/30 font-bold text-micro">
                  {selectedPlayer.executor}
                </span>
              </div>

              <div className="flex items-center justify-between text-fg-muted">
                <span>Device OS:</span>
                <span className="text-fg font-medium">{selectedPlayer.os}</span>
              </div>

              <div className="flex items-center justify-between text-fg-muted">
                <span>Client IP:</span>
                <span className="text-fg font-data text-micro">{selectedPlayer.ip}</span>
              </div>

              <div className="flex items-center justify-between text-fg-muted pt-1 border-t border-line">
                <span>Session Duration:</span>
                <span className="text-success-text font-semibold">{selectedPlayer.duration}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Radar Legend & Telemetry Pulse */}
      <div className="px-4 py-3 bg-surface border-t border-line flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-micro font-data text-fg-muted">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-success" />
            <span>Active Session (Online)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent" />
            <span>Authenticated Execution</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full border border-dashed border-fg-muted" />
            <span>Country-level location</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-fg-subtle">
          {unlocatedCount > 0 && (
            <span className="text-fg-muted">
              {unlocatedCount} {unlocatedCount === 1 ? "player has" : "players have"} no location data (not plotted) ·
            </span>
          )}
          <span>Click a point to inspect player telemetry</span>
        </div>
      </div>
    </div>
  );
}
