// lib/store.ts
import fs from "fs";
import path from "path";
import { supabase, isSupabaseConfigured } from "./supabase";
import { normalizeIp } from "./ip";
import { kvRateLimit, kvConsumeOnce, kvGetJSON, kvSetJSON, kvGetDelJSON, kvDel, isRedisConfigured } from "./kv";
import { adminAlert } from "./alerts";

export interface LoaderConfigRecord {
  id: string;
  name: string;
  brand_name: string;
  title: string;
  accent_color: string;
  background_color: string;
  card_color: string;
  text_color: string;
  subtext_color: string;
  corner_radius: number;
  frame_width: number;
  frame_height: number;
  font_face: string;
  custom_subtitle: string;
  key_placeholder?: string;
  verify_button_text?: string;
  claim_button_text?: string;
  show_discord_button?: boolean;
  discord_button_text?: string;
  discord_invite_url?: string;
  show_watermark?: boolean;
  watermark_text?: string;
  status_verifying?: string;
  status_verified?: string;
  status_expired?: string;
  status_error?: string;
  logo_url?: string;
  show_logo?: boolean;
  webhook_enabled?: boolean;
  webhook_url?: string;
  layout_positions?: Record<string, { x: number; y: number; w?: number; h?: number }>;
  created_at: string;
  updated_at: string;
}

export interface ScriptRecord {
  id: string;
  name: string;
  slug: string;
  entry_file: string;
  modules: Record<string, string>; // { "main.lua": "...", "combat.lua": "..." }
  loader_config_id?: string | null;
  watermark_text: string;
  show_watermark: boolean;
  is_active: boolean;
  use_auth?: boolean; // If true, requires auth loader and license key. If false, executes directly without key.
  is_maintenance?: boolean; // Maintenance Mode Kill-Switch
  maintenance_message?: string | null;
  github_repo?: string | null;
  github_branch?: string | null;
  github_directory?: string | null;
  github_token?: string | null;
  github_auto_pull?: boolean;
  github_last_commit?: string | null;
  github_last_pulled_at?: string | null;
  is_obfuscated?: boolean;
  obfuscated_at?: string | null;
  obfuscated_payload?: string | null;
  obfuscation_stats?: {
    inputSize?: number;
    outputSize?: number;
    time?: number;
    expansionRatio?: number;
    preset?: string;
    layers?: string[];
  } | null;
  vm_preset?: "balanced" | "maximum" | "ultra" | string;
  created_at: string;
  updated_at: string;
}

// Columns safe to fetch on hot paths. Excludes the multi-MB payload columns
// (modules, lua_code, obfuscated_payload) and github_token.
const SCRIPT_META_COLUMNS =
  "id,name,slug,entry_file,loader_config_id,watermark_text,show_watermark,is_active,use_auth," +
  "is_maintenance,maintenance_message,github_repo,github_branch,github_directory,github_auto_pull," +
  "github_last_commit,github_last_pulled_at,is_obfuscated,obfuscated_at,obfuscation_stats,vm_preset," +
  "created_at,updated_at";

// Short-lived in-process caches so repeated loader/auth requests don't each hit
// the database (a single full script row can be ~5 MB).
const SCRIPT_CACHE_TTL_MS = 5000;
const scriptBySlugCache = new Map<string, { at: number; value: ScriptRecord | null }>();
let scriptsLiteCache: { at: number; value: ScriptRecord[] } | null = null;
const scriptsLiteInflight: { p: Promise<ScriptRecord[]> | null } = { p: null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF_REVIEW_ID_RE = /^staff_review_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let onlineCountCache: { at: number; value: number } | null = null;
const adminSessionCache = new Map<string, { ok: boolean; at: number }>();
const playerSessionCache = new Map<string, { at: number; value: SessionRecord | null }>();
const memRateLimits = new Map<string, { count: number; resetAt: number }>();
const memNonces = new Map<string, number>();
const memProbeSessions = new Map<
  string,
  { session_id: string; slug: string; salt: string; expected: number; ip: string; ttlSeconds: number; expiresAt: number }
>();

function invalidateScriptCaches() {
  scriptBySlugCache.clear();
  scriptsLiteCache = null;
  void kvDel("scripts:lite"); // shared copy, so other instances see changes immediately
}

export interface KeyRecord {
  id: string;
  key_string: string;
  script_id: string;
  status: "unclaimed" | "claimed" | "active" | "banned";
  duration_hours: number | null;
  claimed_ip: string | null;
  claimed_discord_id: string | null;
  claimed_discord_tag: string | null;
  claimed_at: string | null;
  activated_at?: string | null;
  expires_at: string | null;
  created_at: string;
  is_staff_review?: boolean;
  notes?: string | null;
  ip_reset_at?: string | null;
  bound_hwid?: string | null;
  hwid_bound_at?: string | null;
  hwid_reset_at?: string | null;
  last_ip?: string | null;
  last_seen_at?: string | null;
}

export interface CheckpointReport {
  scope: { id: string; name: string } | null;
  range_days: number;
  summary: {
    visitors: number; // players = distinct IP + script
    sessions: number; // claim-page visits (a player who reloads or comes back has several)
    unique_visitors: number; // distinct IPs
    finished: number;
    in_progress: number;
    stopped: number;
    completion_rate: number;
    keys_claimed: number;
    bypass_attempts: number;
    median_minutes_to_finish: number | null;
    biggest_drop: { step: number; title: string; count: number } | null;
  };
  funnel: { step: number; title: string; is_workink: boolean; reached: number; completed: number; stopped_here: number; in_progress_here: number }[];
  daily: { day: string; started: number; finished: number }[];
  recent: {
    session: string;
    ip: string;
    script: string;
    started_at: string;
    last_at: string;
    steps_done: number;
    total: number;
    status: "finished" | "in_progress" | "stopped";
    step_title: string | null;
    attempts: number;
  }[];
}

export const SCRIPT_VERSIONS_KEPT = 10;
export interface ScriptVersion {
  id: string;
  script_id: string;
  version: number;
  entry_file: string | null;
  vm_preset: string | null;
  obfuscation_stats: Record<string, unknown> | null;
  size_bytes: number | null;
  note: string | null;
  created_at: string;
}

export interface AnalyticsInsights {
  unavailable: boolean;
  days: number;
  daily: { day: string; players: number; executions: number }[];
  retention: { new_players: number; eligible_d1: number; returned_d1: number; eligible_d7: number; returned_d7: number } | null;
  executors: { label: string; players: number }[];
  os: { label: string; players: number }[];
  countries: { label: string; players: number }[];
  funnel: { started: number; steps: { step: number; sessions: number }[]; completed: number; claimed: number } | null;
  keys: {
    total: number; unclaimed: number; claimed: number; active: number; banned: number;
    activated: number; used_7d: number; expired: number; hwid_bound: number;
  } | null;
}

export interface AuditRow {
  id: number;
  actor: string;
  action: string;
  target: string | null;
  ip_address: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export type ComponentStatus = "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance";
export interface StatusComponent {
  id: string;
  name: string;
  kind: "website" | "script" | "service";
  script_id: string | null;
  status: ComponentStatus;
  message: string | null;
  sort_order: number;
  updated_at: string;
  effective_status: ComponentStatus;
}
export interface StatusIncident {
  id: string;
  title: string;
  body: string | null;
  severity: "minor" | "major" | "critical" | "maintenance";
  state: "investigating" | "identified" | "monitoring" | "resolved";
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}
export interface StatusPageData {
  components: StatusComponent[];
  incidents: StatusIncident[];
  overall: string;
  unavailable: boolean;
}

/** In-game device fingerprint produced by the loader: 16 hex chars + "_" + up to 40 printable chars. */
export const HWID_RE = /^[a-f0-9]{16}_[!-~]{1,40}$/;

/**
 * Canonical form of the loader's fingerprint. The suffix is the first 10 chars of the executor's own
 * gethwid() (or the Roblox user id), which on some executors contains spaces / non-ASCII characters;
 * strip those instead of rejecting the player. Returns "" if there's no usable 16-hex hash part.
 */
export function normalizeHwid(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const m = raw.trim().match(/^([a-fA-F0-9]{16})_([\s\S]*)$/);
  if (!m) return "";
  const suffix = m[2].replace(/[^!-~]/g, "").slice(0, 40) || "x";
  return `${m[1].toLowerCase()}_${suffix}`;
}
export const HWID_RESET_COOLDOWN_HOURS = 12;

export function isStaffReviewKey(k: KeyRecord | null | undefined): boolean {
  if (!k) return false;
  return (
    k.is_staff_review === true ||
    k.claimed_discord_tag === "STAFF_REVIEW" ||
    k.claimed_discord_id === "STAFF_REVIEW" ||
    k.key_string.startsWith("STAFF-") ||
    k.key_string.startsWith("STAFF_")
  );
}

export interface SessionCommand {
  id: string;
  type: "kick" | "message" | "announcement" | "execute_code" | "teleport";
  reason?: string;
  message?: string;
  title?: string;
  code?: string;
  place_id?: number | string;
  server_hop?: boolean;
  duration_seconds?: number;
}

export interface GlobalAnnouncement {
  id: string;
  script_id: string; // "all" or specific script ID
  title: string;
  message: string;
  duration_seconds: number;
  created_at: string;
}

export interface SessionRecord {
  id: string;
  key_id: string;
  script_id: string;
  ip_address: string;
  hwid: string | null;
  roblox_username: string | null;
  roblox_user_id: string | null;
  avatar_url?: string | null;
  place_id?: string | null;
  place_name?: string | null;
  job_id?: string | null;
  /** "loading" = user is in the auth loader, not yet authenticated */
  status: "loading" | "active" | "kicked" | "tampered" | "expired" | "disconnected";
  /** Token generated by loader on startup — links loader session to verified session */
  loader_token?: string | null;
  executor?: string | null;
  tamper_flags: string[];
  pending_commands: SessionCommand[];
  country?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  session_started: string;
  last_heartbeat: string;
  created_at: string;
}

export interface ClientErrorLog {
  id: string;
  session_id?: string | null;
  script_id?: string | null;
  script_name?: string | null;
  roblox_username?: string | null;
  roblox_user_id?: string | null;
  executor?: string | null;
  os?: string | null;
  error_message: string;
  stack_trace?: string | null;
  created_at: string;
}

export interface ExecutionLog {
  id: string;
  script_id: string;
  script_name: string;
  roblox_username: string | null;
  roblox_user_id: string | null;
  avatar_url?: string | null;
  ip_address: string;
  isp: string | null;
  os: string | null;
  executor: string | null;
  place_id?: string | null;
  place_name?: string | null;
  job_id?: string | null;
  key_last4: string | null;
  status: "success" | "failed";
  failure_reason: string | null;
  country?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  created_at: string;
}

export interface CheckpointLog {
  id: string;
  script_id?: string;
  ip_address: string;
  stage: "started" | "completed" | "step_started" | "step_completed";
  step_index?: number;
  checkpoint_title?: string;
  session_id?: string;
  created_at: string;
}

export interface CheckpointItem {
  id: string;
  script_id: string; // "all" or specific script ID
  title: string;
  url: string;
  duration_seconds: number;
  order: number;
  created_at: string;
}

export interface CreatorEmblem {
  id: string;
  label: string;
  icon: string; // "verified" | "crown" | "shield" | "flame" | "star" | "zap" | "skull"
  color?: string;
}

export interface CreatorProfile {
  display_name: string;
  bio: string;
  avatar_url: string;
  raw_avatar_url?: string;
  accent_color?: string;
  emblems: CreatorEmblem[];
  socials: {
    discord?: string;
    youtube?: string;
    x?: string;
    twitter?: string;
    github?: string;
    tiktok?: string;
    cashapp?: string;
    paypal?: string;
    spotify?: string;
    roblox?: string;
    telegram?: string;
  };
  social_toggles?: Record<string, boolean>;
  badge_toggles?: Record<string, boolean>;
}

export interface SystemSettings {
  claim_method: "checkpoints" | "discord_oauth";
  checkpoint_delay_seconds: number;
  discord_guild_id: string;
  discord_bot_token: string;
  discord_invite_url: string;
  vpn_detection_enabled: boolean;
  tos_content: string;
  chatroom_cooldown_seconds?: number;
}

export interface StaffReviewRecord {
  id: string;
  key_id: string;
  script_id: string;
  script_name: string;
  key_label: string;
  status: "reviewing" | "completed";
  review_started: string;
  last_heartbeat: string;
  duration_seconds: number;
  created_at: string;
}

export interface ChatroomMessage {
  id: string;
  user_id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  message: string;
  is_dev: boolean;
  created_at: string;
}

export interface ChatroomBlacklistWord {
  id: string;
  word: string;
  created_at: string;
}

export interface DevMessage {
  id: string;
  user_id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  sender_type: "user" | "dev";
  message: string;
  read: boolean;
  created_at: string;
}

export interface BypassAttemptRecord {
  id: string;
  ip_address: string;
  hwid?: string | null;
  script_id?: string | null;
  step_index?: number;
  reason: string;
  metadata?: Record<string, any>;
  created_at: string;
}

interface LocalDatabase {
  loader_configs: LoaderConfigRecord[];
  scripts: ScriptRecord[];
  keys: KeyRecord[];
  sessions: SessionRecord[];
  execution_logs: ExecutionLog[];
  checkpoint_logs: CheckpointLog[];
  checkpoints: CheckpointItem[];
  creator_profile: CreatorProfile;
  banned_ips: Record<string, { reason: string; banned_at: string }>;
  banned_hwids?: Record<string, { reason: string; banned_at: string; ip_address?: string }>;
  bypass_attempts?: BypassAttemptRecord[];
  settings: SystemSettings;
  staff_reviews: StaffReviewRecord[];
  global_announcements: GlobalAnnouncement[];
  client_errors: ClientErrorLog[];
  chatroom_messages?: ChatroomMessage[];
  chatroom_blacklist?: ChatroomBlacklistWord[];
  dev_messages?: DevMessage[];
}

const DB_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DB_DIR, "db.json");
const PROTECTED_DIR = path.join(DB_DIR, "protected");
if (!fs.existsSync(PROTECTED_DIR)) {
  try { fs.mkdirSync(PROTECTED_DIR, { recursive: true }); } catch (_) {}
}

// SECURITY: resolves a script slug to its cached-payload path under PROTECTED_DIR,
// whitelist-sanitizing the slug and verifying the resolved path actually stays inside
// PROTECTED_DIR (defense-in-depth against path traversal even if a caller passes an
// unsanitized slug directly). Returns null if the slug can't be resolved safely.
function protectedPayloadPath(rawSlug: string): string | null {
  const safeSlug = (rawSlug || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  if (!safeSlug) return null;
  const resolved = path.resolve(PROTECTED_DIR, `${safeSlug}.lua`);
  const resolvedDir = path.resolve(PROTECTED_DIR);
  if (!resolved.startsWith(resolvedDir + path.sep) && resolved !== resolvedDir) {
    return null;
  }
  return resolved;
}

const defaultLoaderConfig: LoaderConfigRecord = {
  id: "a0000000-0000-0000-0000-000000000001",
  name: "AtomProtect Dark (Default)",
  brand_name: "AtomProtect",
  title: "Key System",
  accent_color: "#00a2ff",
  background_color: "#16161e",
  card_color: "#21222e",
  text_color: "#ffffff",
  subtext_color: "#9ca3af",
  corner_radius: 10,
  frame_width: 360,
  frame_height: 250,
  font_face: "GothamMedium",
  custom_subtitle: "Enter your license key below",
  key_placeholder: "Paste your license key here...",
  verify_button_text: "VERIFY KEY",
  claim_button_text: "GET KEY (COPY LINK)",
  show_discord_button: false,
  discord_button_text: "JOIN DISCORD",
  discord_invite_url: "https://discord.gg/NdrTc27GxT",
  show_watermark: true,
  watermark_text: "AtomProtect",
  status_verifying: "Verifying key with server...",
  status_verified: "Verified! Launching script...",
  status_expired: "Key expired. Please get a new key.",
  status_error: "Verification failed. Check your key.",
  webhook_enabled: false,
  webhook_url: "",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const defaultCreatorProfile: CreatorProfile = {
  display_name: "Revile",
  bio: "Lead Developer & Script Engineer. Building high-performance, tamper-protected scripts.",
  avatar_url: "https://api.dicebear.com/7.x/bottts/svg?seed=Revile21",
  emblems: [
    { id: "1", label: "Verified Developer", icon: "verified", color: "#3b82f6" },
    { id: "2", label: "Founder", icon: "crown", color: "#eab308" },
    { id: "3", label: "Tamper Proof", icon: "shield", color: "#10b981" },
  ],
  socials: {
    discord: "https://discord.gg/NdrTc27GxT",
    youtube: "https://youtube.com/@revile",
    twitter: "https://x.com/revile",
    github: "https://github.com/",
    tiktok: "",
    roblox: "",
    telegram: "",
  },
};

const defaultCheckpoints: CheckpointItem[] = [
  {
    id: "c0000000-0000-0000-0000-000000000001",
    script_id: "all",
    title: "Visit Community Portal",
    url: "https://discord.gg/NdrTc27GxT",
    duration_seconds: 5,
    order: 1,
    created_at: new Date().toISOString(),
  },
];

const initialDb: LocalDatabase = {
  loader_configs: [defaultLoaderConfig],
  scripts: [],
  keys: [],
  sessions: [],
  execution_logs: [],
  checkpoint_logs: [],
  checkpoints: defaultCheckpoints,
  creator_profile: defaultCreatorProfile,
  banned_ips: {},
  banned_hwids: {},
  bypass_attempts: [],
  settings: {
    claim_method: "checkpoints",
    checkpoint_delay_seconds: 5,
    discord_guild_id: "",
    discord_bot_token: "",
    discord_invite_url: "https://discord.gg/NdrTc27GxT",
    vpn_detection_enabled: true,
    tos_content: `1. Acceptance of Terms: By obtaining or using any script or key from this service, you agree to these Terms.\n2. No Tampering: Decompiling, reverse engineering, dumping bytecode, or bypassing heartbeat checks is strictly prohibited.\n3. IP Binding: License keys are uniquely tied to the IP address and identity of the claimant. Sharing keys is not permitted.\n4. Violations: Any violation results in an automatic, permanent IP and session ban without prior notice.`,
  },
  staff_reviews: [],
  global_announcements: [],
  client_errors: [],
  chatroom_messages: [],
  chatroom_blacklist: [],
  dev_messages: [],
};

const DB_BACKUP_FILE = path.join(DB_DIR, "db.json.bak");
let inMemoryDbCache: LocalDatabase | null = null;
const probeTokenCache = new Map<string, any>();

// BUGFIX: on a deployment with a read-only filesystem (e.g. Vercel's Linux runtime --
// /var/task is read-only outside /tmp), every single request used to retry the same
// doomed fs.mkdirSync/writeFileSync and log a fresh "Error reading local db" line, for
// the lifetime of the warm serverless instance. Functionally harmless (there's already
// a graceful in-memory/Supabase fallback), but it's pure wasted syscalls plus log spam
// that looks like a live crash on every request. Remember the result of the FIRST
// attempt per warm instance and skip straight to the fallback after that, logging only
// once instead of forever.
let localFsKnownUnavailable = false;

function readLocalDb(): LocalDatabase {
  // Supabase is the single source of truth whenever it's configured. The local JSON store is a
  // per-instance copy on serverless (Vercel), which caused stale/duplicated state (deleted scripts
  // reappearing, kicks never delivered, strikes counted per instance). Return a fresh copy of the
  // built-in defaults every time instead: defaults keep working, nothing is ever remembered locally.
  // The JSON file is only used for local development without a database.
  if (isSupabaseConfigured) {
    return structuredClone(initialDb);
  }
  if (localFsKnownUnavailable) {
    return inMemoryDbCache || initialDb;
  }
  try {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2), "utf8");
      inMemoryDbCache = initialDb;
      return initialDb;
    }
    const raw = fs.readFileSync(DB_FILE, "utf8");
    if (!raw.trim()) {
      if (inMemoryDbCache) return inMemoryDbCache;
    }
    const data = JSON.parse(raw);
    const parsed: LocalDatabase = {
      ...initialDb,
      ...data,
      execution_logs: data.execution_logs || [],
      checkpoint_logs: data.checkpoint_logs || [],
      checkpoints: data.checkpoints && data.checkpoints.length > 0 ? data.checkpoints : defaultCheckpoints,
      creator_profile: data.creator_profile ? { ...defaultCreatorProfile, ...data.creator_profile } : defaultCreatorProfile,
      staff_reviews: data.staff_reviews || [],
      global_announcements: data.global_announcements || [],
      client_errors: data.client_errors || [],
      chatroom_messages: data.chatroom_messages || [],
      chatroom_blacklist: data.chatroom_blacklist || [],
      dev_messages: data.dev_messages || [],
      banned_hwids: data.banned_hwids || {},
      bypass_attempts: data.bypass_attempts || [],
    };
    inMemoryDbCache = parsed;
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "EROFS" || code === "EACCES") {
      // A read-only/unwritable filesystem is an environment fact that won't change for
      // the life of this process -- stop retrying it and log it exactly once.
      localFsKnownUnavailable = true;
      console.warn(
        `[store] Local disk cache unavailable (${code}) -- this is expected on a read-only deployment filesystem. ` +
          "Falling back to in-memory cache / Supabase for the rest of this instance's lifetime."
      );
    } else {
      console.error("Error reading local db, falling back to memory cache or backup", err);
    }
    if (inMemoryDbCache) {
      return inMemoryDbCache;
    }
    try {
      if (fs.existsSync(DB_BACKUP_FILE)) {
        const backupRaw = fs.readFileSync(DB_BACKUP_FILE, "utf8");
        const backupData = JSON.parse(backupRaw);
        inMemoryDbCache = backupData;
        return backupData;
      }
    } catch {
      // fallback to initialDb
    }
    return initialDb;
  }
}

function writeLocalDb(db: LocalDatabase) {
  if (isSupabaseConfigured) return; // see readLocalDb: no local state when Supabase is configured
  // Keep the in-memory cache current regardless of whether disk is writable -- this is
  // what lets readLocalDb() above serve up-to-date data for the rest of this warm
  // instance's lifetime even when the filesystem is read-only.
  inMemoryDbCache = db;
  if (localFsKnownUnavailable) return;
  try {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    const tempFile = path.join(DB_DIR, `db.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
    const json = JSON.stringify(db, null, 2);
    fs.writeFileSync(tempFile, json, "utf8");
    try {
      fs.renameSync(tempFile, DB_FILE);
    } catch {
      // Fallback on Windows if rename encounters temporary file lock
      fs.copyFileSync(tempFile, DB_FILE);
      try {
        fs.unlinkSync(tempFile);
      } catch {}
    }
    try {
      fs.copyFileSync(DB_FILE, DB_BACKUP_FILE);
    } catch {}
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "EROFS" || code === "EACCES") {
      localFsKnownUnavailable = true;
      console.warn(`[store] Local disk cache unavailable (${code}) for writes -- same as reads, expected on a read-only deployment filesystem.`);
    } else {
      console.error("Error writing local db", err);
    }
  }
}

function getTimeCutoff(timeframe?: string): number {
  const now = Date.now();
  if (timeframe === "day") return now - 24 * 60 * 60 * 1000;
  if (timeframe === "week") return now - 7 * 24 * 60 * 60 * 1000;
  if (timeframe === "month") return now - 30 * 24 * 60 * 60 * 1000;
  if (timeframe === "year") return now - 365 * 24 * 60 * 60 * 1000;
  return 0; // all time
}

// In-memory rate limiting map for chatroom messages
const lastChatTimeByUser = new Map<string, number>();

export const dbService = {
  // Loader configs
  async getLoaderConfigs(): Promise<LoaderConfigRecord[]> {
    const localConfigs = readLocalDb().loader_configs;
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.from("loader_configs").select("*").order("created_at", { ascending: false });
        if (data && data.length > 0 && !error) {
          return data.map((remote) => {
            const local = localConfigs.find((l) => l.id === remote.id);
            return {
              ...local,
              ...remote,
              layout_positions: remote.layout_positions || local?.layout_positions,
              key_placeholder: remote.key_placeholder || local?.key_placeholder,
              verify_button_text: remote.verify_button_text || local?.verify_button_text,
              claim_button_text: remote.claim_button_text || local?.claim_button_text,
              show_discord_button: remote.show_discord_button ?? local?.show_discord_button,
              discord_button_text: remote.discord_button_text || local?.discord_button_text,
              discord_invite_url: remote.discord_invite_url || local?.discord_invite_url,
              show_watermark: remote.show_watermark ?? local?.show_watermark,
              watermark_text: remote.watermark_text || local?.watermark_text,
            };
          });
        }
      } catch (e) {
        console.error("Supabase getLoaderConfigs error:", e);
      }
    }
    return localConfigs;
  },

  async getLoaderConfigById(id: string): Promise<LoaderConfigRecord | null> {
    const local = readLocalDb().loader_configs.find((c) => c.id === id) || null;
    if (isSupabaseConfigured && supabase) {
      try {
        const { data } = await supabase.from("loader_configs").select("*").eq("id", id).maybeSingle();
        if (data) {
          return {
            ...local,
            ...data,
            layout_positions: data.layout_positions || local?.layout_positions,
            key_placeholder: data.key_placeholder || local?.key_placeholder,
            verify_button_text: data.verify_button_text || local?.verify_button_text,
            claim_button_text: data.claim_button_text || local?.claim_button_text,
            show_discord_button: data.show_discord_button ?? local?.show_discord_button,
            discord_button_text: data.discord_button_text || local?.discord_button_text,
            discord_invite_url: data.discord_invite_url || local?.discord_invite_url,
            show_watermark: data.show_watermark ?? local?.show_watermark,
            watermark_text: data.watermark_text || local?.watermark_text,
          };
        }
      } catch (err) {
        console.error("Supabase getLoaderConfigById error:", err);
      }
    }
    return local;
  },

  async saveLoaderConfig(config: Omit<LoaderConfigRecord, "id" | "created_at" | "updated_at"> & { id?: string }): Promise<LoaderConfigRecord> {
    const id = config.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const record: LoaderConfigRecord = {
      ...config,
      id,
      created_at: now,
      updated_at: now,
    };

    // Always persist to local DB first
    const db = readLocalDb();
    const index = db.loader_configs.findIndex((c) => c.id === id);
    if (index >= 0) db.loader_configs[index] = record;
    else db.loader_configs.unshift(record);
    writeLocalDb(db);

    // Save to Supabase with column fallback
    if (isSupabaseConfigured && supabase) {
      try {
        const res = await supabase.from("loader_configs").upsert(record);
        if (res.error) {
          console.warn("Full upsert to Supabase loader_configs failed, falling back to base columns:", res.error.message);
          const baseRecord = {
            id: record.id,
            name: record.name,
            brand_name: record.brand_name,
            title: record.title,
            accent_color: record.accent_color,
            background_color: record.background_color,
            card_color: record.card_color,
            text_color: record.text_color,
            subtext_color: record.subtext_color,
            corner_radius: record.corner_radius,
            frame_width: record.frame_width,
            frame_height: record.frame_height,
            font_face: record.font_face,
            custom_subtitle: record.custom_subtitle,
            key_placeholder: record.key_placeholder,
            verify_button_text: record.verify_button_text,
            claim_button_text: record.claim_button_text,
            show_discord_button: record.show_discord_button,
            discord_button_text: record.discord_button_text,
            discord_invite_url: record.discord_invite_url,
            show_watermark: record.show_watermark,
            watermark_text: record.watermark_text,
            status_verifying: record.status_verifying,
            status_verified: record.status_verified,
            status_expired: record.status_expired,
            status_error: record.status_error,
            webhook_enabled: record.webhook_enabled,
            webhook_url: record.webhook_url,
            created_at: record.created_at,
            updated_at: record.updated_at,
          };
          await supabase.from("loader_configs").upsert(baseRecord);
        }
      } catch (err) {
        console.error("Supabase upsert error:", err);
      }
    }

    return record;
  },

  // Scripts
  async getScripts(): Promise<ScriptRecord[]> {
    const local = readLocalDb().scripts;
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.from("scripts").select("*").order("created_at", { ascending: false });
        // Trust Supabase even when it returns zero rows — falling back to the per-instance local copy
        // made deleted scripts reappear.
        if (data && !error) {
          return data.map((remote) => {
            const loc = local.find((l) => l.id === remote.id || l.slug === remote.slug);
            return {
              ...loc,
              ...remote,
              modules: remote.modules || loc?.modules || {},
              use_auth: remote.use_auth ?? loc?.use_auth ?? true,
              loader_config_id: remote.loader_config_id || loc?.loader_config_id || null,
            };
          });
        }
      } catch (err) {
        console.error("Supabase getScripts error:", err);
      }
    }
    return local;
  },

  // Metadata-only script list (no modules / payloads / github_token). Use this on
  // hot paths that only need id, is_active, use_auth, etc.
  async getScriptsLite(): Promise<ScriptRecord[]> {
    const now = Date.now();
    if (scriptsLiteCache && now - scriptsLiteCache.at < SCRIPT_CACHE_TTL_MS) {
      return scriptsLiteCache.value;
    }
    if (scriptsLiteInflight.p) return scriptsLiteInflight.p;
    const shared = await kvGetJSON<ScriptRecord[]>("scripts:lite");
    if (Array.isArray(shared)) {
      scriptsLiteCache = { at: now, value: shared };
      return shared;
    }

    scriptsLiteInflight.p = (async () => {
      const local = readLocalDb().scripts;
      let result: ScriptRecord[] = local;
      if (isSupabaseConfigured && supabase) {
        try {
          const { data, error } = await supabase
            .from("scripts")
            .select(SCRIPT_META_COLUMNS)
            .order("created_at", { ascending: false });
          if (data && !error) {
            result = (data as any[]).map((remote) => {
              const loc = local.find((l) => l.id === remote.id || l.slug === remote.slug);
              return {
                ...loc,
                ...remote,
                modules: loc?.modules || {},
                use_auth: remote.use_auth ?? loc?.use_auth ?? true,
                loader_config_id: remote.loader_config_id || loc?.loader_config_id || null,
              } as ScriptRecord;
            });
            scriptsLiteCache = { at: Date.now(), value: result };
            void kvSetJSON("scripts:lite", result, 30);
          }
        } catch (err) {
          console.error("Supabase getScriptsLite error:", err);
        }
      }
      return result;
    })().finally(() => {
      scriptsLiteInflight.p = null;
    });
    return scriptsLiteInflight.p;
  },

  // Metadata-only lookup by slug/name (cached list, no payload columns). Falls back
  // to the full lookup only if nothing matches, to preserve UUID/name fallbacks.
  async getScriptMetaBySlug(slug: string): Promise<ScriptRecord | null> {
    if (!slug) return null;
    const normalized = slug.trim().toLowerCase();
    const list = await this.getScriptsLite();
    const hit = list.find(
      (s) => s.slug.toLowerCase() === normalized || s.name.toLowerCase() === normalized || s.id === slug.trim()
    );
    return hit || this.getScriptBySlug(slug);
  },

  async getScriptBySlug(slug: string): Promise<ScriptRecord | null> {
    if (!slug) return null;
    const clean = slug.trim();
    const normalized = clean.toLowerCase();

    const cached = scriptBySlugCache.get(normalized);
    if (cached && Date.now() - cached.at < SCRIPT_CACHE_TTL_MS) return cached.value;
    const result = await this._getScriptBySlugUncached(clean, normalized);
    if (scriptBySlugCache.size > 200) scriptBySlugCache.clear();
    scriptBySlugCache.set(normalized, { at: Date.now(), value: result });
    return result;
  },

  async _getScriptBySlugUncached(clean: string, normalized: string): Promise<ScriptRecord | null> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean);

    const local = readLocalDb().scripts.find(
      (s) => s.slug.toLowerCase() === normalized || s.name.toLowerCase() === normalized || s.id === clean
    ) || null;

    let remoteAnswered = false;
    if (isSupabaseConfigured && supabase) {
      try {
        // Slugs are always stored lowercase (see saveScript), so an exact match can use the index.
        const { data, error } = await supabase.from("scripts").select("*").eq("slug", normalized).maybeSingle();
        if (!error) remoteAnswered = true;
        if (data && !error) {
          return {
            ...local,
            ...data,
            modules: typeof data.modules === "string" ? JSON.parse(data.modules) : (data.modules || local?.modules || {}),
            use_auth: data.use_auth ?? local?.use_auth ?? true,
            loader_config_id: data.loader_config_id || local?.loader_config_id || null,
          };
        }

        // Case-insensitive name lookup or UUID lookup.
        // SECURITY: this used to interpolate the raw caller-supplied value into a PostgREST `or(...)`
        // filter string, so a slug containing `,` / `)` could inject extra filter clauses (e.g. match
        // any script), and `%` / `_` acted as wildcards. Now each condition is a separate, parameterised
        // filter with LIKE metacharacters escaped, and only plausible names/slugs are looked up at all.
        let list: any[] | null = null;
        if (isUuid) {
          const { data } = await supabase.from("scripts").select("*").eq("id", clean).limit(1);
          list = data;
        } else if (/^[\w .-]{1,120}$/.test(clean)) {
          const escaped = normalized.replace(/[\\%_]/g, (m) => "\\" + m);
          const bySlug = await supabase.from("scripts").select("*").ilike("slug", escaped).limit(1);
          list = bySlug.data && bySlug.data.length ? bySlug.data : null;
          if (!list) {
            const byName = await supabase.from("scripts").select("*").ilike("name", escaped).limit(1);
            list = byName.data;
          }
        }
        if (list && list.length > 0) {
          const matched = list[0];
          return {
            ...local,
            ...matched,
            modules: typeof matched.modules === "string" ? JSON.parse(matched.modules) : (matched.modules || local?.modules || {}),
            use_auth: matched.use_auth ?? local?.use_auth ?? true,
            loader_config_id: matched.loader_config_id || local?.loader_config_id || null,
          };
        }
      } catch (err) {
        console.error("Supabase getScriptBySlug error:", err);
      }
    }
    // If Supabase answered and the script isn't there, it doesn't exist — never resurrect a deleted
    // script from a stale per-instance local copy (it would still be served by the loader).
    // The local copy is only used when Supabase isn't configured or is unreachable.
    return remoteAnswered ? null : local;
  },

  async saveScript(script: Omit<ScriptRecord, "id" | "created_at" | "updated_at"> & { id?: string }): Promise<ScriptRecord> {
    const id = script.id || crypto.randomUUID();
    const now = new Date().toISOString();
    // SECURITY: the slug is used to build filesystem paths for the protected-payload
    // cache (deleteScript/getProtectedPayload/saveProtectedPayload below) via
    // path.join(PROTECTED_DIR, `${slug}.lua`). It must be whitelist-sanitized
    // unconditionally — previously only the *auto-generated* fallback slug went
    // through this filter, so a client-supplied slug like "../../../foo" could write
    // the obfuscated payload outside PROTECTED_DIR entirely (path traversal / arbitrary
    // file write).
    const cleanSlug = (script.slug || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-");

    const db = readLocalDb();
    // Validate slug uniqueness against other scripts.
    // When Supabase is configured it is the ONLY source of truth: the local JSON store is a
    // per-serverless-instance memory copy on Vercel, so a script deleted via one instance can
    // linger in another instance's copy and wrongly block re-adding the same slug.
    if (isSupabaseConfigured && supabase) {
      const { data: clash, error: clashErr } = await supabase
        .from("scripts")
        .select("id, name")
        .eq("slug", cleanSlug)
        .neq("id", id)
        .limit(1);
      if (clashErr) throw new Error("Could not verify slug availability. Please try again.");
      if (clash && clash.length > 0) {
        throw new Error(`A script with the URL slug '${cleanSlug}' already exists ('${clash[0].name}'). Please choose a unique slug.`);
      }
      // Drop any stale local copies of deleted scripts that used this slug.
      db.scripts = db.scripts.filter((s) => !(s.slug.toLowerCase() === cleanSlug && s.id !== id));
    } else {
      const slugConflict = db.scripts.find((s) => s.slug.toLowerCase() === cleanSlug && s.id !== id);
      if (slugConflict) {
        throw new Error(`A script with the URL slug '${cleanSlug}' already exists ('${slugConflict.name}'). Please choose a unique slug.`);
      }
    }

    const record: ScriptRecord = {
      ...script,
      slug: cleanSlug,
      id,
      created_at: now,
      updated_at: now,
    };

    // Always persist to local DB first for safety
    const index = db.scripts.findIndex((s) => s.id === id);
    if (index >= 0) db.scripts[index] = record;
    else db.scripts.unshift(record);
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const sanitizedLoaderConfigId =
        record.loader_config_id && UUID_REGEX.test(record.loader_config_id.trim())
          ? record.loader_config_id.trim()
          : null;

      const supabaseRecord: any = {
        id: record.id,
        name: record.name,
        slug: record.slug,
        entry_file: record.entry_file || "main.lua",
        modules: record.modules || {},
        loader_config_id: sanitizedLoaderConfigId,
        watermark_text: record.watermark_text || "AERO PROTECT",
        show_watermark: record.show_watermark !== false,
        is_active: record.is_active !== false,
        use_auth: record.use_auth !== false,
        is_maintenance: record.is_maintenance === true,
        maintenance_message: record.maintenance_message || null,
        github_repo: record.github_repo || null,
        github_branch: record.github_branch || 'main',
        github_directory: record.github_directory || '',
        github_token: record.github_token || null,
        github_auto_pull: record.github_auto_pull === true,
        github_last_commit: record.github_last_commit || null,
        github_last_pulled_at: record.github_last_pulled_at || null,
        is_obfuscated: record.is_obfuscated !== false,
        obfuscated_at: record.obfuscated_at || null,
        obfuscation_stats: record.obfuscation_stats || null,
        vm_preset: record.vm_preset || 'balanced',
        created_at: record.created_at,
        updated_at: record.updated_at,
      };

      try {
        const { error } = await supabase.from("scripts").upsert(supabaseRecord);
        if (error) {
          console.warn("Supabase upsert script failed, trying fallback without loader_config_id:", error.message);
          // Retry without loader_config_id in case foreign key was missing
          const fallbackRecord = { ...supabaseRecord, loader_config_id: null };
          const resFallback = await supabase.from("scripts").upsert(fallbackRecord);
          if (resFallback.error) {
            console.error("Supabase fallback upsert script also failed:", resFallback.error.message);
            // Don't report success for a script that was never stored.
            invalidateScriptCaches();
            throw new Error("Saving the script to the database failed: " + resFallback.error.message);
          }
        }
      } catch (err) {
        console.error("Supabase saveScript exception:", err);
        throw err instanceof Error ? err : new Error("Saving the script to the database failed.");
      }
    }

    invalidateScriptCaches();
    return record;
  },

  async deleteScript(id: string) {
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("scripts").delete().eq("id", id);
      } catch (err) {
        console.error("Supabase deleteScript error:", err);
      }
    }
    invalidateScriptCaches();
    const db = readLocalDb();
    const target = db.scripts.find((s) => s.id === id);
    if (target && target.slug) {
      const pFile = protectedPayloadPath(target.slug);
      if (pFile && fs.existsSync(pFile)) {
        try { fs.unlinkSync(pFile); } catch (_) {}
      }
    }
    db.scripts = db.scripts.filter((s) => s.id !== id);
    writeLocalDb(db);
  },

  async getProtectedPayload(slugOrId: string): Promise<string | null> {
    if (!slugOrId) return null;
    const clean = slugOrId.trim().toLowerCase();
    // Disk cache only in local no-database mode (on Vercel it would serve an instance's stale build).
    const filePath = isSupabaseConfigured ? null : protectedPayloadPath(clean);
    if (filePath && fs.existsSync(filePath)) {
      try {
        return fs.readFileSync(filePath, "utf8");
      } catch (e) {
        console.error("Error reading protected payload file:", e);
      }
    }
    const script = await this.getScriptBySlug(clean);
    if (script?.obfuscated_payload) {
      return script.obfuscated_payload;
    }
    return null;
  },

  async saveProtectedPayload(slug: string, payload: string, stats?: any): Promise<void> {
    if (!slug || !payload) return;
    const clean = slug.trim().toLowerCase();

    // BUGFIX: this block used to run unguarded (no try/catch), unlike every other local-FS
    // write in this file. On a read-only deployment filesystem (e.g. Vercel's Linux
    // runtime -- /var/task is read-only except /tmp), fs.mkdirSync throws ENOENT/EROFS,
    // which was uncaught and crashed the whole request. The local disk cache is a
    // best-effort dev-machine convenience, not the durable store -- Supabase (below) is --
    // so a failure here must never block anything.
    if (!isSupabaseConfigured && !localFsKnownUnavailable) {
      try {
        if (!fs.existsSync(PROTECTED_DIR)) {
          fs.mkdirSync(PROTECTED_DIR, { recursive: true });
        }
        const filePath = protectedPayloadPath(clean);
        if (!filePath) {
          console.error(`Refusing to save protected payload to disk: slug "${slug}" resolves outside PROTECTED_DIR`);
        } else {
          fs.writeFileSync(filePath, payload, "utf8");
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT" || code === "EROFS" || code === "EACCES") {
          localFsKnownUnavailable = true;
          console.warn(`[store] saveProtectedPayload: local disk cache unavailable (${code}) -- expected on a read-only deployment filesystem.`);
        } else {
          console.error(`saveProtectedPayload: local disk cache error for "${slug}":`, err);
        }
      }
    }

    // readLocalDb()/writeLocalDb() already short-circuit to the in-memory cache when
    // localFsKnownUnavailable, so this stays correct (and cheap) either way.
    const db = readLocalDb();
    const localScript = db.scripts.find((s) => s.slug.toLowerCase() === clean);
    if (localScript) {
      localScript.is_obfuscated = true;
      localScript.obfuscated_at = new Date().toISOString();
      localScript.obfuscation_stats = stats || null;
      localScript.obfuscated_payload = payload;
      writeLocalDb(db);
    }

    // BUGFIX: this used to be gated on `script` found above in the LOCAL json db, which
    // is always empty/fallback on a deployment with no writable filesystem -- meaning the
    // Supabase write (the actually-durable one) would silently never run there even with
    // Supabase fully configured. Update by slug directly (unique in the schema) instead of
    // requiring a local-db lookup to have already succeeded.
    if (isSupabaseConfigured && supabase) {
      try {
        const { error } = await supabase.from("scripts").update({
          is_obfuscated: true,
          obfuscated_at: new Date().toISOString(),
          obfuscation_stats: stats || null,
          obfuscated_payload: payload,
        }).eq("slug", clean);
        if (error) console.warn("Supabase update protected payload failed:", error);
      } catch (err) {
        console.warn("Supabase update protected payload fallback:", err);
      }
    }
    invalidateScriptCaches();
  },

  // Keys
  async getKeys(): Promise<KeyRecord[]> {
    const local = readLocalDb().keys;
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.from("keys").select("*").order("created_at", { ascending: false });
        if (!error && Array.isArray(data)) {
          return data;
        }
      } catch (err) {
        console.error("Supabase getKeys error:", err);
      }
    }
    return local;
  },

  async createKeys(
    keys: Array<{
      key_string: string;
      script_id: string;
      duration_hours: number | null;
      status?: "unclaimed" | "claimed" | "active" | "banned";
      is_staff_review?: boolean;
      claimed_discord_tag?: string | null;
      claimed_discord_id?: string | null;
      notes?: string | null;
    }>
  ): Promise<KeyRecord[]> {
    const now = new Date().toISOString();
    const records: KeyRecord[] = keys.map((k) => ({
      id: crypto.randomUUID(),
      key_string: k.key_string,
      script_id: k.script_id || "all",
      status: k.status || (k.is_staff_review ? "active" : "unclaimed"),
      duration_hours: k.is_staff_review ? null : k.duration_hours,
      claimed_ip: null,
      claimed_discord_id: k.claimed_discord_id || (k.is_staff_review ? "STAFF_REVIEW" : null),
      claimed_discord_tag: k.claimed_discord_tag || (k.is_staff_review ? "STAFF_REVIEW" : null),
      claimed_at: k.is_staff_review ? now : null,
      activated_at: k.is_staff_review ? now : null,
      expires_at: null,
      created_at: now,
      is_staff_review: Boolean(k.is_staff_review),
      notes: k.notes || (k.is_staff_review ? "Staff Review Key" : null),
    }));

    const db = readLocalDb();
    db.keys.unshift(...records);
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        const { error } = await supabase.from("keys").insert(records);
        if (error) {
          console.warn("Supabase insert keys failed, retrying without optional columns:", error.message);
          const fallbackRecords = records.map(({ activated_at, is_staff_review, notes, ...rest }) => rest);
          await supabase.from("keys").insert(fallbackRecords);
        }
      } catch (err) {
        console.error("Supabase createKeys error:", err);
      }
    }

    return records;
  },

  async getActiveKeyForIp(ip: string, scriptId?: string): Promise<KeyRecord | null> {
    const target = normalizeIp(ip);
    const now = new Date();

    const matchesActiveKey = (k: KeyRecord) => {
      if (isStaffReviewKey(k) || k.is_staff_review) return false;
      if (k.status !== "claimed" && k.status !== "active") return false;
      if (normalizeIp(k.claimed_ip) !== target) return false;

      // If scriptId is specified, check compatibility
      if (scriptId && scriptId !== "all") {
        if (k.script_id && k.script_id !== "all" && k.script_id !== scriptId) {
          return false;
        }
      }

      // Check if expired
      if (k.expires_at) {
        const expires = new Date(k.expires_at);
        if (now > expires) return false;
      }
      return true;
    };

    // 1. Check Supabase first if configured
    if (isSupabaseConfigured && supabase) {
      try {
        // Filter by IP in the database (was: download every claimed/active key and filter in JS).
        // claimed_ip is always stored normalized (claimKey / activateKey / resetKeyIp).
        const { data, error } = await supabase
          .from("keys")
          .select("*")
          .in("status", ["claimed", "active"])
          .in("claimed_ip", [target, "::ffff:" + target]);

        if (data && !error && data.length > 0) {
          const match = (data as KeyRecord[]).find(matchesActiveKey);
          if (match) return match;
        }
      } catch (err) {
        console.error("Supabase getActiveKeyForIp error:", err);
      }
    }

    // 2. Check local DB fallback
    const db = readLocalDb();
    const existing = db.keys.find(matchesActiveKey);
    return existing || null;
  },

  async claimKey(scriptId: string, ip: string, discord?: { id: string; tag: string }): Promise<KeyRecord | null> {
    // Preferred path: one atomic UPDATE ... FOR UPDATE SKIP LOCKED in Postgres, so two
    // concurrent claimants can never be handed the same key (the select-then-update path
    // below is racy). Falls back to the legacy path only if the function isn't deployed yet.
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.rpc("claim_key", {
          p_script_id: scriptId || "all",
          p_ip: ip,
          p_discord_id: discord?.id ?? null,
          p_discord_tag: discord?.tag ?? null,
        });
        if (!error) {
          const row = Array.isArray(data) ? data[0] : data;
          return row && row.id ? (row as KeyRecord) : null;
        }
        if (error.code !== "PGRST202" && error.code !== "42883") {
          console.error("claim_key rpc error:", error.message);
          return null;
        }
      } catch (err) {
        console.error("claim_key rpc exception:", err);
      }
    }

    const isEligibleKey = (k: KeyRecord) => {
      if (k.status !== "unclaimed") return false;
      if (isStaffReviewKey(k) || k.is_staff_review) return false;
      if (k.claimed_discord_tag === "STAFF_REVIEW" || k.claimed_discord_id === "STAFF_REVIEW") return false;
      // Lifetime keys (duration_hours === null) are exclusively for paid direct buyers and cannot be claimed via checkpoints
      if (k.duration_hours === null || k.duration_hours === undefined) return false;

      // Universal keys (script_id is "all", null, or empty) are eligible for ANY script
      if (!k.script_id || k.script_id === "all" || k.script_id === "") return true;

      // If claimant didn't ask for a specific script, any non-staff key is eligible
      if (!scriptId || scriptId === "all") return true;

      // Otherwise, the key's script_id must match the requested scriptId
      return k.script_id === scriptId;
    };

    let key: KeyRecord | null = null;

    // 1. Query Supabase first if configured (where production keys are stored)
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from("keys")
          .select("*")
          .eq("status", "unclaimed")
          .not("duration_hours", "is", null)
          .order("created_at", { ascending: true })
          .limit(200);

        if (data && !error && data.length > 0) {
          const typedData = data as KeyRecord[];
          // Prefer a script-specific key first if one exists, otherwise fallback to universal
          const specificMatch =
            scriptId && scriptId !== "all"
              ? typedData.find((k) => k.script_id === scriptId && isEligibleKey(k))
              : null;

          const match = specificMatch || typedData.find(isEligibleKey);
          if (match) {
            key = { ...match };
          }
        }
      } catch (err) {
        console.error("Supabase claimKey search error:", err);
      }
    }

    // 2. Fall back to local DB if not found in Supabase
    if (!key) {
      const db = readLocalDb();
      const specificMatch =
        scriptId && scriptId !== "all"
          ? db.keys.find((k) => k.script_id === scriptId && isEligibleKey(k))
          : null;

      const match = specificMatch || db.keys.find(isEligibleKey);
      if (match) {
        key = { ...match };
      }
    }

    if (!key) return null;

    // 3. Mark key as claimed and bind to claimant IP / Discord
    const now = new Date();
    key.status = "claimed";
    key.claimed_ip = ip;
    key.claimed_at = now.toISOString();

    // If key was universal and claimed for a specific script, bind it to that script
    if (scriptId && scriptId !== "all" && (!key.script_id || key.script_id === "all")) {
      key.script_id = scriptId;
    }
    if (discord) {
      key.claimed_discord_id = discord.id;
      key.claimed_discord_tag = discord.tag;
    }
    key.expires_at = null;
    key.activated_at = null;

    // 4. Update in local DB
    const db = readLocalDb();
    const localIdx = db.keys.findIndex((k) => k.id === key!.id);
    if (localIdx >= 0) {
      db.keys[localIdx] = { ...key };
    } else {
      db.keys.unshift({ ...key });
    }
    writeLocalDb(db);

    // 5. Update in Supabase
    if (isSupabaseConfigured && supabase) {
      try {
        const { error } = await supabase
          .from("keys")
          .update({
            status: key.status,
            claimed_ip: key.claimed_ip,
            claimed_at: key.claimed_at,
            script_id: key.script_id,
            claimed_discord_id: key.claimed_discord_id,
            claimed_discord_tag: key.claimed_discord_tag,
            expires_at: key.expires_at,
            activated_at: key.activated_at,
          })
          .eq("id", key.id);

        if (error) {
          console.warn("Supabase update key on claim failed, retrying base fields:", error.message);
          await supabase
            .from("keys")
            .update({
              status: key.status,
              claimed_ip: key.claimed_ip,
              claimed_at: key.claimed_at,
              script_id: key.script_id,
            })
            .eq("id", key.id);
        }
      } catch (err) {
        console.error("Supabase claimKey update error:", err);
      }
    }

    return key;
  },

  async activateKey(id: string, ip?: string): Promise<KeyRecord | null> {
    let key: KeyRecord | null = null;
    const db = readLocalDb();
    const local = db.keys.find((k) => k.id === id);
    if (local) {
      key = local;
    } else if (isSupabaseConfigured && supabase) {
      try {
        const { data } = await supabase.from("keys").select("*").eq("id", id).maybeSingle();
        if (data) key = data as KeyRecord;
      } catch (err) {
        console.error("Supabase activateKey find error:", err);
      }
    }

    if (!key) return null;

    const now = new Date();
    key.status = "active";
    if (ip && !key.claimed_ip) {
      key.claimed_ip = ip;
      key.claimed_at = now.toISOString();
    }
    if (isStaffReviewKey(key)) {
      key.duration_hours = null;
      key.expires_at = null;
    } else if (!key.activated_at) {
      key.activated_at = now.toISOString();
      if (key.duration_hours) {
        const expires = new Date(now.getTime() + key.duration_hours * 3600 * 1000);
        key.expires_at = expires.toISOString();
      }
    }

    const localIdx = db.keys.findIndex((k) => k.id === id);
    if (localIdx >= 0) {
      db.keys[localIdx] = { ...key };
    } else {
      db.keys.unshift({ ...key });
    }
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        const { error } = await supabase.from("keys").update(key).eq("id", key.id);
        if (error) {
          const { activated_at, is_staff_review, notes, ...rest } = key;
          await supabase.from("keys").update(rest).eq("id", key.id);
        }
      } catch (err) {
        console.error("Supabase activateKey error:", err);
      }
    }
    return key;
  },

  async updateKeyNotes(id: string, notes: string | null) {
    const db = readLocalDb();
    const key = db.keys.find((k) => k.id === id);
    if (key) {
      key.notes = notes;
      writeLocalDb(db);
    }
    if (isSupabaseConfigured && supabase) {
      try {
        const { error } = await supabase.from("keys").update({ notes }).eq("id", id);
        if (error) {
          console.warn("Supabase updateKeyNotes error:", error.message);
        }
      } catch (err) {
        console.error("Supabase updateKeyNotes exception:", err);
      }
    }
  },

  async getKeyById(id: string): Promise<KeyRecord | null> {
    const db = readLocalDb();
    const local = db.keys.find((k) => k.id === id) || null;
    if (isSupabaseConfigured && supabase) {
      try {
        const { data } = await supabase.from("keys").select("*").eq("id", id).maybeSingle();
        if (data) return data;
      } catch (err) {
        console.error("Supabase getKeyById error:", err);
      }
    }
    return local;
  },

  async getKeyByString(keyString: string): Promise<KeyRecord | null> {
    const db = readLocalDb();
    const local = db.keys.find((k) => k.key_string === keyString) || null;
    if (isSupabaseConfigured && supabase) {
      try {
        const { data } = await supabase.from("keys").select("*").eq("key_string", keyString).maybeSingle();
        if (data) return data;
      } catch (err) {
        console.error("Supabase getKeyByString error:", err);
      }
    }
    return local;
  },

  async resetKeyIp(keyString: string, newIp: string): Promise<KeyRecord> {
    const cleanKey = keyString.trim();
    const key = await this.getKeyByString(cleanKey);
    if (!key) {
      throw new Error("License key not found.");
    }
    if (key.status === "banned") {
      throw new Error("This license key is banned and cannot be transferred.");
    }
    if (await this.isIpBanned(newIp)) {
      throw new Error("Cannot bind key to blacklisted IP address.");
    }

    // 12-hour cooldown. Source of truth is the dedicated `ip_reset_at` column; the legacy
    // `[IP_RESET:<ts>]` tag in `notes` is still honoured so existing keys keep their cooldown.
    const COOLDOWN_MS = 12 * 60 * 60 * 1000;
    const tagMatch = (key.notes || "").match(/\[IP_RESET:(\d+)\]/);
    const columnMs = key.ip_reset_at ? Date.parse(key.ip_reset_at) : NaN;
    const lastResetMs = !isNaN(columnMs) ? columnMs : tagMatch ? Number(tagMatch[1]) : NaN;
    if (!isNaN(lastResetMs)) {
      const lastReset = lastResetMs;
      const elapsed = Date.now() - lastReset;
      if (elapsed < COOLDOWN_MS) {
        const remainingHours = Math.ceil((COOLDOWN_MS - elapsed) / (60 * 60 * 1000));
        throw new Error(`IP reset is on cooldown. You can reset your key IP again in ${remainingHours} hour(s).`);
      }
    }

    const normNewIp = normalizeIp(newIp);
    key.claimed_ip = normNewIp;
    key.ip_reset_at = new Date().toISOString();
    // Strip the legacy tag; the cooldown now lives in the column.
    key.notes = (key.notes || "").replace(/\s*\[IP_RESET:\d+\]/g, "").trim() || null;

    const db = readLocalDb();
    const localIdx = db.keys.findIndex((k) => k.id === key.id);
    if (localIdx >= 0) db.keys[localIdx] = key;
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        const { error } = await supabase
          .from("keys")
          .update({
            claimed_ip: key.claimed_ip,
            notes: key.notes,
            ip_reset_at: key.ip_reset_at,
          })
          .eq("id", key.id);
        if (error) {
          // Database predates the ip_reset_at column: fall back to the legacy notes tag so the
          // cooldown is still enforced.
          const legacyNotes = `${key.notes ? key.notes + " " : ""}[IP_RESET:${Date.now()}]`;
          await supabase.from("keys").update({ claimed_ip: key.claimed_ip, notes: legacyNotes }).eq("id", key.id);
        }
      } catch (err) {
        console.error("Supabase resetKeyIp error:", err);
      }
    }

    return key;
  },

  async updateKeyStatus(id: string, status: KeyRecord["status"]) {
    const db = readLocalDb();
    const key = db.keys.find((k) => k.id === id);
    if (key) {
      key.status = status;
      writeLocalDb(db);
    }
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("keys").update({ status }).eq("id", id);
      } catch (err) {
        console.error("Supabase updateKeyStatus error:", err);
      }
    }
  },

  async deleteKey(id: string) {
    const db = readLocalDb();
    db.keys = db.keys.filter((k) => k.id !== id);
    writeLocalDb(db);
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("keys").delete().eq("id", id);
      } catch (err) {
        console.error("Supabase deleteKey error:", err);
      }
    }
  },

  async purgeExpiredKeys(): Promise<number> {
    const nowIso = new Date().toISOString();
    let deletedCount = 0;

    // 1. Purge from Supabase
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from("keys")
          .delete()
          .not("expires_at", "is", null)
          .lt("expires_at", nowIso)
          .select("id");
        if (data) {
          deletedCount = data.length;
        }
        if (error) {
          console.error("Supabase purgeExpiredKeys error:", error);
        }
      } catch (err) {
        console.error("Supabase purgeExpiredKeys error:", err);
      }
    }

    // 2. Purge from Local DB
    const db = readLocalDb();
    const originalLen = db.keys.length;
    const nowDate = new Date();
    db.keys = db.keys.filter((k) => {
      if (!k.expires_at) return true;
      return new Date(k.expires_at) >= nowDate;
    });
    if (db.keys.length !== originalLen) {
      writeLocalDb(db);
      if (deletedCount === 0) {
        deletedCount = originalLen - db.keys.length;
      }
    }

    return deletedCount;
  },

  // Sessions
  async getSessions(options?: { activeOnly?: boolean; maxAgeMs?: number }): Promise<SessionRecord[]> {
    const db = readLocalDb();
    let remote: SessionRecord[] = [];
    if (isSupabaseConfigured && supabase) {
      try {
        let query = supabase.from("sessions").select("*");
        if (options?.activeOnly) {
          const maxAge = options.maxAgeMs || 35000;
          const cutoffIso = new Date(Date.now() - maxAge).toISOString();
          query = query.eq("status", "active").gte("last_heartbeat", cutoffIso);
        }
        const { data, error } = await query
          .order("last_heartbeat", { ascending: false })
          .limit(options?.activeOnly ? 200 : 1000);
        if (data && !error && data.length > 0) {
          remote = data as SessionRecord[];
        }
      } catch (err) {
        console.error("Supabase getSessions error:", err);
      }
    }
    const sessionMap = new Map<string, SessionRecord>();
    for (const s of remote) sessionMap.set(s.id, s);
    for (const s of db.sessions || []) {
      if (!sessionMap.has(s.id)) {
        if (options?.activeOnly) {
          const maxAge = options.maxAgeMs || 35000;
          const pingTime = new Date(s.last_heartbeat).getTime();
          if (s.status === "active" && Date.now() - pingTime <= maxAge) {
            sessionMap.set(s.id, s);
          }
        } else {
          sessionMap.set(s.id, s);
        }
      }
    }
    return Array.from(sessionMap.values()).sort(
      (a, b) => new Date(b.last_heartbeat).getTime() - new Date(a.last_heartbeat).getTime()
    );
  },

  async markStaleSessionsDisconnected(cutoffMs: number = 90000, force: boolean = false): Promise<number> {
    const now = Date.now();
    // Throttle cleanup to at most once per 60 seconds to avoid database locks and thrashing
    if (!force && (global as any).__lastStaleCleanup && now - (global as any).__lastStaleCleanup < 60000) {
      return 0;
    }
    (global as any).__lastStaleCleanup = now;

    const cutoffIso = new Date(now - cutoffMs).toISOString();
    let count = 0;
    const db = readLocalDb();
    let changed = false;
    for (const s of db.sessions || []) {
      if (s.status === "active" && new Date(s.last_heartbeat).getTime() < now - cutoffMs) {
        s.status = "disconnected";
        changed = true;
        count++;
      }
    }
    if (changed) writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase
          .from("sessions")
          .update({ status: "disconnected" })
          .eq("status", "active")
          .lt("last_heartbeat", cutoffIso);

        // Auto-purge dead sessions inactive for > 24 hours to prevent database bloat
        const deadCutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();
        await supabase
          .from("sessions")
          .delete()
          .lt("last_heartbeat", deadCutoff);
      } catch (err) {
        console.error("Supabase markStaleSessionsDisconnected error:", err);
      }
    }
    return count;
  },

  // --- Shared security primitives (Postgres-backed so they work across serverless instances) ---
  // Each calls a SECURITY DEFINER function defined in migration/001_schema.sql. If the function
  // doesn't exist yet (old database), they fall back to per-instance memory so nothing breaks
  // mid-migration — but the memory fallback is NOT safe on serverless; deploy the schema.

  /** Returns true if the action is allowed (under the limit), false if it should be blocked. */
  async rateLimit(bucket: string, key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const viaKv = await kvRateLimit(bucket, key, limit, windowSeconds);
    if (viaKv !== null) return viaKv;
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.rpc("rate_limit_hit", {
          p_bucket: bucket,
          p_key: key,
          p_limit: limit,
          p_window_seconds: windowSeconds,
        });
        if (!error && typeof data === "boolean") return data;
      } catch {
        // fall through to memory
      }
    }
    const now = Date.now();
    const k = `${bucket}:${key}`;
    if (memRateLimits.size > 5000) {
      memRateLimits.forEach((v, kk) => {
        if (now > v.resetAt) memRateLimits.delete(kk);
      });
    }
    const rec = memRateLimits.get(k);
    if (!rec || now > rec.resetAt) {
      memRateLimits.set(k, { count: 1, resetAt: now + windowSeconds * 1000 });
      return true;
    }
    rec.count += 1;
    return rec.count <= limit;
  },

  /** Returns true the first time a nonce is seen within the TTL, false on replay. */
  async consumeNonce(nonce: string, ttlSeconds: number = 300): Promise<boolean> {
    const viaKv = await kvConsumeOnce("nonce:" + nonce, ttlSeconds);
    if (viaKv !== null) return viaKv;
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.rpc("consume_nonce", { p_nonce: nonce, p_ttl_seconds: ttlSeconds });
        if (!error && typeof data === "boolean") return data;
      } catch {
        // fall through
      }
    }
    const now = Date.now();
    const exp = memNonces.get(nonce);
    if (exp !== undefined && now < exp) return false;
    if (memNonces.size > 5000) {
      memNonces.forEach((v, kk) => {
        if (now > v) memNonces.delete(kk);
      });
    }
    memNonces.set(nonce, now + ttlSeconds * 1000);
    return true;
  },

  async createProbeSession(s: {
    session_id: string;
    slug: string;
    salt: string;
    expected: number;
    ip: string;
    ttlSeconds: number;
  }): Promise<void> {
    if (isRedisConfigured) {
      const ok = await kvSetJSON(
        "probe:" + s.session_id,
        { slug: s.slug, salt: s.salt, expected: s.expected, ip: s.ip },
        s.ttlSeconds
      );
      if (ok) return;
    }
    if (isSupabaseConfigured && supabase) {
      try {
        const { error } = await supabase.rpc("create_probe_session", {
          p_session_id: s.session_id,
          p_slug: s.slug,
          p_salt: s.salt,
          p_expected: s.expected,
          p_ip: s.ip,
          p_ttl_seconds: s.ttlSeconds,
        });
        if (!error) return;
      } catch {
        // fall through
      }
    }
    memProbeSessions.set(s.session_id, { ...s, expiresAt: Date.now() + s.ttlSeconds * 1000 });
  },

  /** Single-use: returns the session and deletes it, or null if missing/expired. */
  async consumeProbeSession(
    sessionId: string
  ): Promise<{ slug: string; salt: string; expected: number; ip: string } | null> {
    if (isRedisConfigured) {
      const v = await kvGetDelJSON<{ slug: string; salt: string; expected: number; ip: string }>("probe:" + sessionId);
      if (v) return { ...v, expected: Number(v.expected) };
      // null = not in Redis (it may have been stored in Postgres during a Redis hiccup) → check there too
    }
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.rpc("consume_probe_session", { p_session_id: sessionId });
        if (!error) {
          const row = Array.isArray(data) ? data[0] : data;
          return row && row.slug ? { slug: row.slug, salt: row.salt, expected: Number(row.expected), ip: row.ip } : null;
        }
      } catch {
        // fall through
      }
    }
    const m = memProbeSessions.get(sessionId);
    if (!m) return null;
    memProbeSessions.delete(sessionId);
    if (Date.now() > m.expiresAt) return null;
    return { slug: m.slug, salt: m.salt, expected: m.expected, ip: m.ip };
  },

  /** Single-use claim-token consumption. Returns true if this is the first use. */
  async consumeClaimToken(tokenId: string, ttlSeconds: number = 900): Promise<boolean> {
    return this.consumeNonce("claim:" + tokenId, ttlSeconds);
  },

  // --- Script versions (build snapshots in the private "script-builds" Storage bucket) ---

  /**
   * Snapshots a script's current source + compiled build. Best-effort: never throws, so a storage
   * hiccup can't block saving a script. Keeps the newest SCRIPT_VERSIONS_KEPT per script.
   */
  async snapshotScript(slug: string, note?: string): Promise<void> {
    if (!isSupabaseConfigured || !supabase) return;
    try {
      invalidateScriptCaches();
      const s = await this.getScriptBySlug(slug);
      if (!s || !s.id) return;
      const payload = JSON.stringify({
        entry_file: s.entry_file,
        modules: s.modules || {},
        obfuscated_payload: s.obfuscated_payload || null,
        vm_preset: s.vm_preset || null,
        obfuscation_stats: s.obfuscation_stats || null,
      });
      const path = `${s.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json`;
      const up = await supabase.storage
        .from("script-builds")
        .upload(path, new Blob([payload], { type: "application/json" }), { contentType: "application/json", upsert: false });
      if (up.error) {
        console.error("snapshot upload failed:", up.error.message);
        return;
      }
      const { error } = await supabase.rpc("create_script_version", {
        p_script_id: s.id,
        p_storage_path: path,
        p_entry_file: s.entry_file || null,
        p_vm_preset: s.vm_preset || null,
        p_stats: s.obfuscation_stats || null,
        p_size: Buffer.byteLength(payload),
        p_note: note ? note.slice(0, 200) : null,
      });
      if (error) {
        await supabase.storage.from("script-builds").remove([path]);
        return;
      }
      const { data: stale } = await supabase.rpc("prune_script_versions", { p_script_id: s.id, p_keep: SCRIPT_VERSIONS_KEPT });
      const stalePaths = (Array.isArray(stale) ? stale : [])
        .map((r: unknown) => (typeof r === "string" ? r : r && typeof r === "object" ? Object.values(r as Record<string, string>)[0] : null))
        .filter((p): p is string => typeof p === "string");
      if (stalePaths.length) await supabase.storage.from("script-builds").remove(stalePaths);
    } catch (err) {
      console.error("snapshotScript error:", err);
    }
  },

  async listScriptVersions(scriptId: string): Promise<ScriptVersion[]> {
    if (!isSupabaseConfigured || !supabase || !UUID_RE.test(scriptId)) return [];
    const { data, error } = await supabase
      .from("script_versions")
      .select("id, script_id, version, entry_file, vm_preset, obfuscation_stats, size_bytes, note, created_at")
      .eq("script_id", scriptId)
      .order("version", { ascending: false });
    return error ? [] : (data as ScriptVersion[]);
  },

  /** Restores a snapshot onto the live script, then records the restore as a new version. */
  async restoreScriptVersion(scriptId: string, versionId: string): Promise<{ slug: string; version: number }> {
    if (!isSupabaseConfigured || !supabase || !UUID_RE.test(scriptId) || !UUID_RE.test(versionId)) throw new Error("Not available");
    const { data: v, error } = await supabase
      .from("script_versions")
      .select("version, storage_path")
      .eq("id", versionId)
      .eq("script_id", scriptId)
      .maybeSingle();
    if (error || !v) throw new Error("Version not found");
    const dl = await supabase.storage.from("script-builds").download(v.storage_path);
    if (dl.error || !dl.data) throw new Error("Could not load that version's files");
    const snap = JSON.parse(await dl.data.text());
    const now = new Date().toISOString();
    const { data: updated, error: upErr } = await supabase
      .from("scripts")
      .update({
        entry_file: snap.entry_file || "main.lua",
        modules: snap.modules || {},
        obfuscated_payload: snap.obfuscated_payload,
        obfuscation_stats: snap.obfuscation_stats,
        vm_preset: snap.vm_preset || "balanced",
        is_obfuscated: Boolean(snap.obfuscated_payload),
        obfuscated_at: now,
        updated_at: now,
      })
      .eq("id", scriptId)
      .select("slug")
      .maybeSingle();
    if (upErr || !updated) throw new Error("Restore failed: " + (upErr?.message || "script not found"));
    invalidateScriptCaches();
    await this.snapshotScript(updated.slug, `Restored from v${v.version}`);
    return { slug: updated.slug, version: v.version };
  },

  // --- Analytics insights (aggregated in Postgres; see migration 002) ---

  async getInsights(days: number, scriptId?: string | null): Promise<AnalyticsInsights> {
    const empty: AnalyticsInsights = { unavailable: true, days, daily: [], retention: null, executors: [], os: [], countries: [], funnel: null, keys: null };
    if (!isSupabaseConfigured || !supabase) return empty;
    const d = Math.max(1, Math.min(3650, Math.floor(days)));
    const from = new Date(Date.now() - d * 86400 * 1000).toISOString();
    const dailyFrom = new Date(Date.now() - Math.min(d, 90) * 86400 * 1000).toISOString(); // line chart: max 90 days
    const p_script = scriptId && UUID_RE.test(scriptId) ? scriptId : null;
    const [daily, retention, ex, os, co, funnel, keys] = await Promise.all([
      supabase.rpc("analytics_daily_active", { p_from: dailyFrom, p_script }),
      supabase.rpc("analytics_retention", { p_from: from, p_script }),
      supabase.rpc("analytics_breakdown", { p_from: from, p_script, p_dimension: "executor" }),
      supabase.rpc("analytics_breakdown", { p_from: from, p_script, p_dimension: "os" }),
      supabase.rpc("analytics_breakdown", { p_from: from, p_script, p_dimension: "country" }),
      supabase.rpc("analytics_checkpoint_funnel", { p_from: from, p_script }),
      supabase.rpc("analytics_key_usage", { p_script }),
    ]);
    if (daily.error) return empty; // migration 002 not applied yet
    return {
      unavailable: false,
      days: d,
      daily: (daily.data || []) as AnalyticsInsights["daily"],
      retention: (retention.data || null) as AnalyticsInsights["retention"],
      executors: (ex.data || []) as AnalyticsInsights["executors"],
      os: (os.data || []) as AnalyticsInsights["os"],
      countries: (co.data || []) as AnalyticsInsights["countries"],
      funnel: (funnel.data || null) as AnalyticsInsights["funnel"],
      keys: (keys.data || null) as AnalyticsInsights["keys"],
    };
  },

  // --- Audit log viewer ---

  async getAuditLog(opts: { category?: string; from?: string; to?: string; beforeId?: number; limit?: number }): Promise<AuditRow[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    let q = supabase
      .from("audit_log")
      .select("id, actor, action, target, ip_address, details, created_at")
      .order("id", { ascending: false })
      .limit(Math.min(Math.max(opts.limit || 100, 1), 1000));
    if (opts.category && /^[a-z0-9_]{1,32}$/.test(opts.category)) q = q.like("action", `${opts.category}.%`);
    if (opts.from && !isNaN(Date.parse(opts.from))) q = q.gte("created_at", new Date(opts.from).toISOString());
    if (opts.to && !isNaN(Date.parse(opts.to))) q = q.lte("created_at", new Date(opts.to).toISOString());
    if (opts.beforeId && Number.isInteger(opts.beforeId)) q = q.lt("id", opts.beforeId);
    const { data, error } = await q;
    if (error) return [];
    return data as AuditRow[];
  },

  // --- Status page ---

  async getStatusPage(): Promise<StatusPageData> {
    const empty: StatusPageData = { components: [], incidents: [], overall: "operational", unavailable: true };
    if (!isSupabaseConfigured || !supabase) return empty;
    const [compsRes, scripts] = await Promise.all([
      supabase.from("status_components").select("*").order("sort_order").order("name"),
      this.getScriptsLite(),
    ]);
    if (compsRes.error) return empty;
    let comps = (compsRes.data || []) as StatusComponent[];

    // Make sure the website and every active script have a component (created on first view).
    const missing: Partial<StatusComponent>[] = [];
    if (!comps.some((c) => c.kind === "website")) missing.push({ name: "Website & key system", kind: "website", sort_order: 0 });
    for (const s of scripts.filter((x) => x.is_active !== false)) {
      if (!comps.some((c) => c.script_id === s.id)) missing.push({ name: s.name, kind: "script", script_id: s.id, sort_order: 10 });
    }
    if (missing.length) {
      await supabase.from("status_components").upsert(missing, { onConflict: "script_id", ignoreDuplicates: true });
      const again = await supabase.from("status_components").select("*").order("sort_order").order("name");
      comps = (again.data || comps) as StatusComponent[];
    }

    const byScript = new Map(scripts.map((s) => [s.id, s]));
    const visible = comps
      .filter((c) => c.kind !== "script" || (c.script_id && byScript.get(c.script_id)?.is_active !== false))
      .map((c) => {
        const sc = c.script_id ? byScript.get(c.script_id) : undefined;
        // A script in maintenance mode shows as Maintenance unless you set something more severe.
        const effective = sc?.is_maintenance && c.status === "operational" ? "maintenance" : c.status;
        return {
          ...c,
          name: sc ? sc.name : c.name,
          effective_status: effective,
          message: c.message || (sc?.is_maintenance && effective === "maintenance" ? sc.maintenance_message || null : null),
        };
      });

    const since = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
    const { data: inc } = await supabase
      .from("status_incidents")
      .select("*")
      .or(`state.neq.resolved,resolved_at.gte.${since}`)
      .order("created_at", { ascending: false })
      .limit(30);

    const rank: Record<string, number> = { operational: 0, maintenance: 1, degraded: 2, partial_outage: 3, major_outage: 4 };
    let overall = visible.reduce((w, c) => (rank[c.effective_status] > rank[w] ? c.effective_status : w), "operational");
    for (const i of (inc || []) as StatusIncident[]) {
      if (i.state === "resolved") continue;
      const sev = i.severity === "critical" ? "major_outage" : i.severity === "major" ? "partial_outage" : i.severity === "maintenance" ? "maintenance" : "degraded";
      if (rank[sev] > rank[overall]) overall = sev;
    }
    return { components: visible, incidents: (inc || []) as StatusIncident[], overall, unavailable: false };
  },

  async updateStatusComponent(id: string, patch: { status?: string; message?: string | null; sort_order?: number; name?: string }) {
    if (!isSupabaseConfigured || !supabase || !UUID_RE.test(id)) throw new Error("Not available");
    const clean: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) clean.status = patch.status;
    if (patch.message !== undefined) clean.message = patch.message ? String(patch.message).slice(0, 500) : null;
    if (patch.sort_order !== undefined) clean.sort_order = Math.max(-1000, Math.min(1000, Math.floor(patch.sort_order)));
    if (patch.name !== undefined) clean.name = String(patch.name).slice(0, 80);
    const { error } = await supabase.from("status_components").update(clean).eq("id", id);
    if (error) throw new Error(error.message);
  },

  async createStatusComponent(name: string) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Not available");
    const { error } = await supabase.from("status_components").insert({ name: String(name).slice(0, 80), kind: "service", sort_order: 20 });
    if (error) throw new Error(error.message);
  },

  async deleteStatusComponent(id: string) {
    if (!isSupabaseConfigured || !supabase || !UUID_RE.test(id)) throw new Error("Not available");
    // Website/script components are managed automatically; only custom services can be deleted.
    const { error } = await supabase.from("status_components").delete().eq("id", id).eq("kind", "service");
    if (error) throw new Error(error.message);
  },

  async saveIncident(inc: { id?: string; title: string; body?: string | null; severity: string; state: string }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Not available");
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      title: String(inc.title).slice(0, 160),
      body: inc.body ? String(inc.body).slice(0, 4000) : null,
      severity: inc.severity,
      state: inc.state,
      updated_at: now,
      resolved_at: inc.state === "resolved" ? now : null,
    };
    const q = inc.id && UUID_RE.test(inc.id)
      ? supabase.from("status_incidents").update(row).eq("id", inc.id)
      : supabase.from("status_incidents").insert(row);
    const { error } = await q;
    if (error) throw new Error(error.message);
  },

  async deleteIncident(id: string) {
    if (!isSupabaseConfigured || !supabase || !UUID_RE.test(id)) throw new Error("Not available");
    const { error } = await supabase.from("status_incidents").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  // --- HWID licensing ---

  /**
   * Trust-on-first-use device binding.
   * "bound" = this call bound it, "match" = already bound to this HWID, "mismatch" = bound to another
   * device, "unsupported" = migration 002 not applied yet (caller falls back to legacy IP binding).
   */
  async bindKeyHwid(keyId: string, hwid: string): Promise<"bound" | "match" | "mismatch" | "unsupported"> {
    if (!isSupabaseConfigured || !supabase) return "unsupported";
    const { data, error } = await supabase.rpc("bind_key_hwid", { p_key_id: keyId, p_hwid: hwid });
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") return "unsupported";
      throw new Error("HWID binding failed: " + error.message);
    }
    if (Array.isArray(data) && data.length > 0) return "bound";
    const { data: row } = await supabase.from("keys").select("bound_hwid").eq("id", keyId).maybeSingle();
    return row?.bound_hwid === hwid ? "match" : "mismatch";
  },

  /** Records a successful use from an IP. Returns distinct IPs/countries for this key in 24h. */
  async recordKeyIp(keyId: string, ip: string, country?: string | null): Promise<{ ips_24h: number; countries_24h: number } | null> {
    if (!isSupabaseConfigured || !supabase) return null;
    const { data, error } = await supabase.rpc("record_key_ip", { p_key_id: keyId, p_ip: ip, p_country: country || "" });
    if (error) return null;
    return data as { ips_24h: number; countries_24h: number };
  },

  /** Clears a key's device binding. Players get a cooldown; admins pass cooldownHours = 0. */
  async resetKeyHwid(keyId: string, cooldownHours: number): Promise<{ ok: boolean; reason?: string; retry_at?: string }> {
    if (!isSupabaseConfigured || !supabase) return { ok: false, reason: "unsupported" };
    const { data, error } = await supabase.rpc("reset_key_hwid", { p_key_id: keyId, p_cooldown_hours: cooldownHours });
    if (error) return { ok: false, reason: error.code === "PGRST202" ? "unsupported" : "error" };
    return data as { ok: boolean; reason?: string; retry_at?: string };
  },

  /** IP history for keys seen in the last `hours` (for the keys dashboard). */
  async getRecentKeyIps(hours = 24): Promise<Record<string, { ips: string[]; countries: string[] }>> {
    const out: Record<string, { ips: string[]; countries: string[] }> = {};
    if (!isSupabaseConfigured || !supabase) return out;
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const { data, error } = await supabase
      .from("key_ip_history")
      .select("key_id, ip, country")
      .gte("last_seen", since)
      .limit(5000);
    if (error || !data) return out;
    for (const r of data as { key_id: string; ip: string; country: string | null }[]) {
      const e = (out[r.key_id] ||= { ips: [], countries: [] });
      if (!e.ips.includes(r.ip)) e.ips.push(r.ip);
      if (r.country && !e.countries.includes(r.country)) e.countries.push(r.country);
    }
    return out;
  },

  // --- Admin sessions (server-side, revocable) ---

  async createAdminSession(s: {
    token_hash: string;
    admin_username: string;
    ip_address: string | null;
    device_info: string | null;
    expires_at: string;
  }): Promise<void> {
    if (!isSupabaseConfigured || !supabase) return; // local dev: token signature alone is trusted
    const { error } = await supabase.from("admin_sessions").insert({ ...s, is_active: true });
    if (error) throw new Error("Could not create admin session: " + error.message);
    adminSessionCache.delete(s.token_hash);
  },

  async isAdminSessionLive(tokenHash: string): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return true;
    const now = Date.now();
    const cached = adminSessionCache.get(tokenHash);
    if (cached && now - cached.at < 15000) return cached.ok;
    // Shared cache: a revocation on one instance is seen by all of them immediately.
    const shared = await kvGetJSON<boolean>("adm:" + tokenHash);
    if (typeof shared === "boolean") {
      adminSessionCache.set(tokenHash, { ok: shared, at: now });
      return shared;
    }
    try {
      const { data, error } = await supabase
        .from("admin_sessions")
        .select("is_active, expires_at, last_active_at")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (error) throw error;
      const ok = Boolean(data && data.is_active && new Date(data.expires_at).getTime() > now);
      adminSessionCache.set(tokenHash, { ok, at: now });
      void kvSetJSON("adm:" + tokenHash, ok, 15);
      if (adminSessionCache.size > 500) adminSessionCache.clear();
      if (ok && data && now - new Date(data.last_active_at).getTime() > 5 * 60 * 1000) {
        void supabase.from("admin_sessions").update({ last_active_at: new Date().toISOString() }).eq("token_hash", tokenHash);
      }
      return ok;
    } catch (err) {
      console.error("isAdminSessionLive error:", err);
      // DB hiccup: keep a recently-confirmed session alive for a short grace period, otherwise fail closed.
      return Boolean(cached && cached.ok && now - cached.at < 5 * 60 * 1000);
    }
  },

  async revokeAdminSession(tokenHash: string): Promise<void> {
    adminSessionCache.set(tokenHash, { ok: false, at: Date.now() });
    await kvSetJSON("adm:" + tokenHash, false, 3600);
    if (isSupabaseConfigured && supabase) {
      await supabase.from("admin_sessions").update({ is_active: false }).eq("token_hash", tokenHash);
    }
  },

  async revokeAllAdminSessions(): Promise<void> {
    adminSessionCache.clear();
    if (isSupabaseConfigured && supabase) {
      // Mark every live session revoked in the shared cache so all instances drop them at once.
      const { data: live } = await supabase.from("admin_sessions").select("token_hash").eq("is_active", true);
      await Promise.all((live || []).map((r: { token_hash: string }) => kvSetJSON("adm:" + r.token_hash, false, 3600)));
      await supabase.from("admin_sessions").update({ is_active: false }).eq("is_active", true);
    }
  },

  // --- Player identity for public endpoints (chat / DMs / telemetry) ---
  // A request may act as Roblox user X only if X has a recent, authenticated (key-verified) session from
  // the SAME IP address as this request. The client-supplied userId alone proves nothing.
  async getPlayerSession(userId: string, ip: string): Promise<SessionRecord | null> {
    if (!userId || !/^\d{1,12}$/.test(userId) || !ip) return null;
    const cacheKey = `${userId}|${ip}`;
    const now = Date.now();
    const cached = playerSessionCache.get(cacheKey);
    if (cached && now - cached.at < (cached.value ? 30000 : 10000)) return cached.value;
    const shared = await kvGetJSON<{ s: SessionRecord | null }>("ps:" + cacheKey);
    if (shared) {
      playerSessionCache.set(cacheKey, { at: now, value: shared.s });
      return shared.s;
    }

    let found: SessionRecord | null = null;
    if (isSupabaseConfigured && supabase) {
      try {
        const cutoff = new Date(now - 10 * 60 * 1000).toISOString();
        const { data } = await supabase
          .from("sessions")
          .select("*")
          .eq("roblox_user_id", userId)
          .eq("ip_address", ip)
          .eq("status", "active")
          .gte("last_heartbeat", cutoff)
          .order("last_heartbeat", { ascending: false })
          .limit(1);
        found = data && data.length ? (data[0] as SessionRecord) : null;
      } catch (err) {
        console.error("getPlayerSession error:", err);
      }
    } else {
      found =
        (readLocalDb().sessions || []).find(
          (s) => s.roblox_user_id === userId && s.ip_address === ip && s.status === "active"
        ) || null;
    }
    if (playerSessionCache.size > 2000) playerSessionCache.clear();
    playerSessionCache.set(cacheKey, { at: now, value: found });
    void kvSetJSON("ps:" + cacheKey, { s: found }, found ? 30 : 10);
    return found;
  },

  /** Deletes expired rows from the security tables (also scheduled via pg_cron if enabled). */
  async pruneSecurityTables(): Promise<void> {
    if (!isSupabaseConfigured || !supabase) return;
    const { error } = await supabase.rpc("prune_security_tables");
    if (error && error.code !== "PGRST202") console.error("prune_security_tables error:", error.message);
  },

  /** Best-effort audit trail (table exists in the new schema; silently ignored if it doesn't). */
  async audit(action: string, opts: { target?: string; ip?: string; details?: Record<string, unknown> } = {}): Promise<void> {
    if (!isSupabaseConfigured || !supabase) return;
    try {
      await supabase.from("audit_log").insert({
        actor: "admin",
        action,
        target: opts.target ? String(opts.target).slice(0, 200) : null,
        ip_address: opts.ip || null,
        details: opts.details || {},
      });
    } catch {
      // never let auditing break a request
    }
  },

  // --- Targeted lookups (avoid full-table scans on hot request paths) ---

  async getSessionById(id: string): Promise<SessionRecord | null> {
    if (!id || !UUID_RE.test(id)) return null;
    const local = (readLocalDb().sessions || []).find((s) => s.id === id) || null;
    if (isSupabaseConfigured && supabase) {
      try {
        const { data } = await supabase.from("sessions").select("*").eq("id", id).maybeSingle();
        if (data) return data as SessionRecord;
      } catch (err) {
        console.error("Supabase getSessionById error:", err);
      }
    }
    return local;
  },

  async getStaffReviewById(id: string): Promise<StaffReviewRecord | null> {
    if (!id || !STAFF_REVIEW_ID_RE.test(id)) return null;
    const local = (readLocalDb().staff_reviews || []).find((r) => r.id === id) || null;
    if (local) return local;
    if (isSupabaseConfigured && supabase) {
      try {
        const { data } = await supabase.from("staff_reviews").select("*").eq("id", id).maybeSingle();
        if (data) return data as StaffReviewRecord;
      } catch (err) {
        console.error("Supabase getStaffReviewById error:", err);
      }
    }
    return null;
  },

  // Cheap online-player count (COUNT, no row transfer), cached briefly.
  async getOnlineCount(maxAgeMs: number = 35000): Promise<number> {
    const now = Date.now();
    if (onlineCountCache && now - onlineCountCache.at < 10000) return onlineCountCache.value;
    const shared = await kvGetJSON<number>("online:" + maxAgeMs);
    if (typeof shared === "number") {
      onlineCountCache = { at: now, value: shared };
      return shared;
    }
    let value = 0;
    if (isSupabaseConfigured && supabase) {
      try {
        const cutoffIso = new Date(now - maxAgeMs).toISOString();
        const { count } = await supabase
          .from("sessions")
          .select("id", { count: "exact", head: true })
          .eq("status", "active")
          .gte("last_heartbeat", cutoffIso);
        value = count || 0;
      } catch (err) {
        console.error("Supabase getOnlineCount error:", err);
      }
    }
    onlineCountCache = { at: now, value };
    void kvSetJSON("online:" + maxAgeMs, value, 10);
    return value;
  },

  async getSessionByToken(loaderToken: string): Promise<SessionRecord | null> {
    const db = readLocalDb();
    const local = (db.sessions || []).find((s) => s.loader_token === loaderToken) || null;
    if (local) return local;
    if (isSupabaseConfigured && supabase) {
      try {
        const { data } = await supabase
          .from("sessions")
          .select("*")
          .eq("loader_token", loaderToken)
          .maybeSingle();
        if (data) return data as SessionRecord;
      } catch (err) {
        console.error("Supabase getSessionByToken error:", err);
      }
    }
    return null;
  },
  async createSession(session: Omit<SessionRecord, "id" | "created_at" | "session_started" | "last_heartbeat" | "pending_commands">): Promise<SessionRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const avatarUrl =
      session.avatar_url ||
      (session.roblox_user_id
        ? `https://www.roblox.com/headshot-thumbnail/image?userId=${session.roblox_user_id}&width=150&height=150&format=png`
        : null);

    const record: SessionRecord = {
      ...session,
      avatar_url: avatarUrl,
      id,
      pending_commands: [],
      session_started: now,
      last_heartbeat: now,
      created_at: now,
    };

    const db = readLocalDb();
    db.sessions.unshift(record);
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        const baseSession = {
          id: record.id,
          key_id: record.key_id,
          script_id: record.script_id,
          ip_address: record.ip_address,
          hwid: record.hwid,
          roblox_username: record.roblox_username,
          roblox_user_id: record.roblox_user_id,
          status: record.status,
          tamper_flags: record.tamper_flags || [],
          pending_commands: record.pending_commands || [],
          session_started: record.session_started,
          last_heartbeat: record.last_heartbeat,
          created_at: record.created_at,
          place_id: record.place_id ? String(record.place_id) : null,
          place_name: record.place_name || null,
          job_id: record.job_id || null,
          avatar_url: record.avatar_url || null,
        };
        const { error } = await supabase.from("sessions").insert([record]);
        if (error) {
          const res = await supabase.from("sessions").insert([baseSession]);
          if (res.error) console.error("Supabase fallback createSession error:", res.error.message);
        }
      } catch (err) {
        console.error("Supabase createSession error:", err);
      }
    }
    return record;
  },

  async upgradeLoaderSession(
    sessionId: string,
    updates: {
      key_id: string;
      script_id: string;
      status: "active";
      hwid: string | null;
      tamper_flags: string[];
      country?: string | null;
      city?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    }
  ): Promise<void> {
    if (isSupabaseConfigured && supabase) {
      // Always promote in the database. (The old code only did this when the session happened to be in
      // this instance's memory, so on Vercel loader sessions mostly never became "active".)
      const patch: Record<string, unknown> = {
        key_id: updates.key_id,
        script_id: updates.script_id,
        status: updates.status,
      };
      if (updates.hwid !== undefined) patch.hwid = updates.hwid;
      if (updates.tamper_flags) patch.tamper_flags = updates.tamper_flags;
      if (updates.country !== undefined) patch.country = updates.country;
      if (updates.city !== undefined) patch.city = updates.city;
      if (updates.latitude !== undefined) patch.latitude = updates.latitude;
      if (updates.longitude !== undefined) patch.longitude = updates.longitude;
      const { error } = await supabase.from("sessions").update(patch).eq("id", sessionId);
      if (error) console.error("upgradeLoaderSession error:", error.message);
      return;
    }
    const db = readLocalDb();
    const session = db.sessions.find((s) => s.id === sessionId);
    if (session) {
      session.key_id = updates.key_id;
      session.script_id = updates.script_id;
      session.status = updates.status;
      if (updates.hwid !== undefined) session.hwid = updates.hwid;
      if (updates.tamper_flags) session.tamper_flags = updates.tamper_flags;
      if (updates.country !== undefined) session.country = updates.country;
      if (updates.city !== undefined) session.city = updates.city;
      if (updates.latitude !== undefined) session.latitude = updates.latitude;
      if (updates.longitude !== undefined) session.longitude = updates.longitude;
      writeLocalDb(db);

      if (isSupabaseConfigured && supabase) {
        try {
          await supabase.from("sessions").update({
            key_id: session.key_id,
            script_id: session.script_id,
            status: session.status,
            hwid: session.hwid,
            tamper_flags: session.tamper_flags,
            country: session.country,
            city: session.city,
            latitude: session.latitude,
            longitude: session.longitude,
          }).eq("id", sessionId);
        } catch { /* ignore */ }
      }
    }
  },
  async updateHeartbeat(
    sessionId: string,
    ip?: string,
    metadata?: {
      place_id?: string | number;
      place_name?: string;
      job_id?: string;
      roblox_username?: string;
      roblox_user_id?: string;
    }
  ): Promise<SessionRecord> {
    const db = readLocalDb();
    let session = db.sessions.find((s) => s.id === sessionId);

    // 1. Query Supabase if not present in ephemeral local container memory
    if (!session && isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
        if (data && !error) {
          session = data;
          db.sessions.unshift(data);
          writeLocalDb(db);
        }
      } catch (err) {
        console.error("Supabase updateHeartbeat lookup error:", err);
      }
    }

    const now = new Date().toISOString();

    // 2. Unknown session id. SECURITY: this used to "revive" any unrecognised id into a brand-new
    // ACTIVE session with no key, so anyone could mint unlimited fake online players by pinging
    // random UUIDs. Sessions are only created by /api/auth/verify and /api/session/loader-ping.
    // The heartbeat route fails open on this error, so real players are never kicked for it.
    if (!session && isSupabaseConfigured && supabase) {
      throw new Error("Unknown session");
    }
    if (!session) {
      session = {
        id: sessionId,
        key_id: "active",
        script_id: "active",
        ip_address: ip || "127.0.0.1",
        hwid: null,
        roblox_username: metadata?.roblox_username || "Player",
        roblox_user_id: metadata?.roblox_user_id || null,
        avatar_url: metadata?.roblox_user_id ? `/api/roblox/avatar?userId=${metadata.roblox_user_id}` : null,
        place_id: metadata?.place_id ? String(metadata.place_id) : null,
        place_name: metadata?.place_name || null,
        job_id: metadata?.job_id || null,
        status: "active",
        tamper_flags: [],
        pending_commands: [],
        session_started: now,
        last_heartbeat: now,
        created_at: now,
      };
      db.sessions.unshift(session);
      writeLocalDb(db);

      if (isSupabaseConfigured && supabase) {
        try {
          const baseSession = {
            id: session.id,
            key_id: session.key_id,
            script_id: session.script_id,
            ip_address: session.ip_address,
            hwid: session.hwid,
            roblox_username: session.roblox_username,
            roblox_user_id: session.roblox_user_id,
            status: session.status,
            tamper_flags: session.tamper_flags || [],
            pending_commands: session.pending_commands || [],
            session_started: session.session_started,
            last_heartbeat: session.last_heartbeat,
            created_at: session.created_at,
            place_id: session.place_id ? String(session.place_id) : null,
            place_name: session.place_name || null,
            job_id: session.job_id || null,
            avatar_url: session.avatar_url || null,
          };
          const { error } = await supabase.from("sessions").upsert([session]);
          if (error) {
            await supabase.from("sessions").upsert([baseSession]);
          }
        } catch {
          // ignore
        }
      }
    } else {
      session.last_heartbeat = now;
      if (metadata?.place_id) session.place_id = String(metadata.place_id);
      if (metadata?.place_name) session.place_name = metadata.place_name;
      if (metadata?.job_id) session.job_id = metadata.job_id;
      if (metadata?.roblox_username && metadata.roblox_username !== "Player") {
        session.roblox_username = metadata.roblox_username;
      }
      if (metadata?.roblox_user_id) {
        session.roblox_user_id = metadata.roblox_user_id;
        session.avatar_url = `/api/roblox/avatar?userId=${metadata.roblox_user_id}`;
      }
      if (session.status === "disconnected") {
        session.status = "active"; // Player reconnected
      }
      writeLocalDb(db);

      if (isSupabaseConfigured && supabase) {
        try {
          await supabase
            .from("sessions")
            .update({
              last_heartbeat: now,
              status: session.status,
              place_id: session.place_id,
              place_name: session.place_name,
              job_id: session.job_id,
              roblox_username: session.roblox_username,
              roblox_user_id: session.roblox_user_id,
              avatar_url: session.avatar_url,
            })
            .eq("id", sessionId);
        } catch {
          // ignore
        }
      }
    }

    return session;
  },

  async addSessionCommand(sessionId: string, command: Omit<SessionCommand, "id">) {
    if (isSupabaseConfigured && supabase) {
      // Atomic append in the database (the old path only worked if this instance had the session in memory).
      if (!UUID_RE.test(sessionId)) return;
      const cmd = { id: crypto.randomUUID(), ...command };
      const { error } = await supabase.rpc("push_session_command", {
        p_session_id: sessionId,
        p_command: cmd,
        p_kick: command.type === "kick",
      });
      if (error && (error.code === "PGRST202" || error.code === "42883")) {
        // migration 002 not applied yet: non-atomic fallback so kicks still work meanwhile
        const { data: row } = await supabase.from("sessions").select("pending_commands, status").eq("id", sessionId).maybeSingle();
        if (row) {
          await supabase
            .from("sessions")
            .update({
              pending_commands: [...((row.pending_commands as SessionCommand[]) || []), cmd],
              status: command.type === "kick" ? "kicked" : row.status,
            })
            .eq("id", sessionId);
        }
      } else if (error) {
        console.error("push_session_command error:", error.message);
      }
      return;
    }
    const db = readLocalDb();
    const session = db.sessions.find((s) => s.id === sessionId);
    if (session) {
      session.pending_commands.push({ id: crypto.randomUUID(), ...command });
      if (command.type === "kick") {
        session.status = "kicked";
      }
      writeLocalDb(db);

      if (isSupabaseConfigured && supabase) {
        try {
          await supabase.from("sessions").update({
            status: session.status,
            pending_commands: session.pending_commands,
          }).eq("id", sessionId);
        } catch (err) {
          console.error("Supabase addSessionCommand error:", err);
        }
      }
    }
  },

  async broadcastAnnouncement(announcement: Omit<GlobalAnnouncement, "id" | "created_at">): Promise<GlobalAnnouncement> {
    const record: GlobalAnnouncement = {
      ...announcement,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    const db = readLocalDb();
    if (!db.global_announcements) db.global_announcements = [];
    db.global_announcements.unshift(record);
    if (db.global_announcements.length > 50) {
      db.global_announcements = db.global_announcements.slice(0, 50);
    }

    // Push announcement command to currently active sessions
    const now = Date.now();
    for (const s of db.sessions) {
      const ping = new Date(s.last_heartbeat).getTime();
      if (s.status === "active" && now - ping < 15000) {
        if (!announcement.script_id || announcement.script_id === "all" || s.script_id === announcement.script_id) {
          s.pending_commands.push({
            id: crypto.randomUUID(),
            type: "announcement",
            title: announcement.title,
            message: announcement.message,
            duration_seconds: announcement.duration_seconds || 10,
          });
        }
      }
    }
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("global_announcements").insert([record]);
        // Deliver to every player who pinged in the last 15s (was: only sessions in this instance's memory).
        const { error } = await supabase.rpc("push_command_to_active", {
          p_command: {
            id: crypto.randomUUID(),
            type: "announcement",
            title: announcement.title,
            message: announcement.message,
            duration_seconds: announcement.duration_seconds || 10,
          },
          p_script: announcement.script_id || "all",
          p_max_age_seconds: 15,
          p_kick: false,
        });
        if (error) console.error("push_command_to_active error:", error.message);
      } catch (err) {
        console.error("Supabase broadcastAnnouncement error:", err);
      }
    }

    return record;
  },

  async getGlobalAnnouncements(scriptId?: string): Promise<GlobalAnnouncement[]> {
    let list: GlobalAnnouncement[] = [];
    if (isSupabaseConfigured && supabase) {
      try {
        let query = supabase.from("global_announcements").select("*").order("created_at", { ascending: false });
        if (scriptId && scriptId !== "all") {
          // Only interpolate a validated UUID into the filter string (prevents filter injection).
          query = UUID_RE.test(scriptId)
            ? query.or(`script_id.eq.all,script_id.eq.${scriptId}`)
            : query.eq("script_id", "all");
        }
        const { data, error } = await query.limit(50);
        if (data && !error) {
          list = data;
        }
      } catch (err) {
        console.error("Supabase getGlobalAnnouncements error:", err);
      }
    }

    const db = readLocalDb();
    const map = new Map<string, GlobalAnnouncement>();
    for (const a of list) map.set(a.id, a);
    for (const a of db.global_announcements || []) {
      if (!map.has(a.id)) {
        if (!scriptId || scriptId === "all" || a.script_id === "all" || a.script_id === scriptId) {
          map.set(a.id, a);
        }
      }
    }

    return Array.from(map.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  },

  async deleteGlobalAnnouncement(id: string): Promise<boolean> {
    const db = readLocalDb();
    if (!db.global_announcements) db.global_announcements = [];
    const lenBefore = db.global_announcements.length;
    db.global_announcements = db.global_announcements.filter((a) => a.id !== id);
    if (db.global_announcements.length !== lenBefore) {
      writeLocalDb(db);
    }

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("global_announcements").delete().eq("id", id);
      } catch (err) {
        console.error("Supabase deleteGlobalAnnouncement error:", err);
      }
    }
    return true;
  },

  async broadcastCommand(command: Omit<SessionCommand, "id">, scriptId?: string): Promise<number> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc("push_command_to_active", {
        p_command: { id: crypto.randomUUID(), ...command },
        p_script: scriptId || "all",
        p_max_age_seconds: 15,
        p_kick: command.type === "kick",
      });
      if (error) console.error("push_command_to_active error:", error.message);
      return typeof data === "number" ? data : 0;
    }
    const db = readLocalDb();
    const now = Date.now();
    let count = 0;
    for (const s of db.sessions) {
      const ping = new Date(s.last_heartbeat).getTime();
      if (s.status === "active" && now - ping < 15000) {
        if (!scriptId || scriptId === "all" || s.script_id === scriptId) {
          s.pending_commands.push({ id: crypto.randomUUID(), ...command });
          if (command.type === "kick") {
            s.status = "kicked";
          }
          count++;
        }
      }
    }
    if (count > 0) {
      writeLocalDb(db);
    }
    return count;
  },

  async clearPendingCommands(sessionId: string): Promise<SessionCommand[]> {
    if (isSupabaseConfigured && supabase) {
      // Read-and-clear atomically, so a command is delivered exactly once.
      if (!UUID_RE.test(sessionId)) return [];
      const { data, error } = await supabase.rpc("take_session_commands", { p_session_id: sessionId });
      if (error && (error.code === "PGRST202" || error.code === "42883")) {
        // migration 002 not applied yet: non-atomic fallback
        const { data: row } = await supabase.from("sessions").select("pending_commands").eq("id", sessionId).maybeSingle();
        const cmds = ((row?.pending_commands as SessionCommand[]) || []);
        if (cmds.length) await supabase.from("sessions").update({ pending_commands: [] }).eq("id", sessionId);
        return cmds;
      }
      if (error) {
        console.error("take_session_commands error:", error.message);
        return [];
      }
      return Array.isArray(data) ? (data as SessionCommand[]) : [];
    }
    const db = readLocalDb();
    const session = db.sessions.find((s) => s.id === sessionId);
    if (!session) return [];
    const cmds = [...session.pending_commands];
    session.pending_commands = [];
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("sessions").update({ pending_commands: [] }).eq("id", sessionId);
      } catch (err) {
        console.error("Supabase clearPendingCommands error:", err);
      }
    }
    return cmds;
  },

  async deleteSession(sessionId: string): Promise<boolean> {
    const db = readLocalDb();
    db.sessions = db.sessions.filter((s) => s.id !== sessionId);
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("sessions").delete().eq("id", sessionId);
      } catch (err) {
        console.error("Supabase deleteSession error:", err);
      }
    }
    return true;
  },

  // Staff Reviews
  async createStaffReview(review: {
    key_id: string;
    script_id: string;
    script_name: string;
    key_label: string;
  }): Promise<StaffReviewRecord> {
    const now = new Date().toISOString();
    const record: StaffReviewRecord = {
      id: "staff_review_" + crypto.randomUUID(),
      key_id: review.key_id,
      script_id: review.script_id,
      script_name: review.script_name,
      key_label: review.key_label,
      status: "reviewing",
      review_started: now,
      last_heartbeat: now,
      duration_seconds: 0,
      created_at: now,
    };

    const db = readLocalDb();
    if (!db.staff_reviews) db.staff_reviews = [];
    db.staff_reviews.unshift(record);
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("staff_reviews").insert(record);
      } catch {
        // Fallback gracefully if table not yet migrated
      }
    }

    return record;
  },

  async updateStaffReviewHeartbeat(sessionToken: string): Promise<StaffReviewRecord | null> {
    if (isSupabaseConfigured && supabase) {
      const review = await this.getStaffReviewById(sessionToken);
      if (!review) return null;
      const now = new Date();
      const duration = Math.max(0, Math.floor((now.getTime() - new Date(review.review_started).getTime()) / 1000));
      await supabase
        .from("staff_reviews")
        .update({ last_heartbeat: now.toISOString(), duration_seconds: duration, status: "reviewing" })
        .eq("id", review.id);
      return { ...review, last_heartbeat: now.toISOString(), duration_seconds: duration, status: "reviewing" };
    }
    const db = readLocalDb();
    if (!db.staff_reviews) db.staff_reviews = [];
    const review = db.staff_reviews.find((r) => r.id === sessionToken);
    if (!review) return null;

    const now = new Date();
    const startTime = new Date(review.review_started).getTime();
    review.last_heartbeat = now.toISOString();
    review.status = "reviewing";
    review.duration_seconds = Math.max(0, Math.floor((now.getTime() - startTime) / 1000));

    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase
          .from("staff_reviews")
          .update({
            last_heartbeat: review.last_heartbeat,
            duration_seconds: review.duration_seconds,
            status: "reviewing",
          })
          .eq("id", review.id);
      } catch {
        // ignore
      }
    }

    return review;
  },

  async getStaffReviews(): Promise<StaffReviewRecord[]> {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from("staff_reviews")
        .select("*")
        .order("review_started", { ascending: false })
        .limit(200);
      if (error || !data) return [];
      // Reviews with no heartbeat for 6s are finished; persist that so every instance agrees.
      const now = Date.now();
      const finished: StaffReviewRecord[] = [];
      for (const r of data as StaffReviewRecord[]) {
        const ping = new Date(r.last_heartbeat).getTime();
        if (r.status === "reviewing" && now - ping > 6000) {
          r.status = "completed";
          r.duration_seconds = Math.max(0, Math.floor((ping - new Date(r.review_started).getTime()) / 1000));
          finished.push(r);
        }
      }
      await Promise.all(
        finished.map((r) =>
          supabase!.from("staff_reviews").update({ status: "completed", duration_seconds: r.duration_seconds }).eq("id", r.id)
        )
      );
      return data as StaffReviewRecord[];
    }
    const db = readLocalDb();
    if (!db.staff_reviews) db.staff_reviews = [];
    const now = Date.now();
    const TIMEOUT_MS = 6000; // 6s without heartbeat -> marked completed review

    let modified = false;
    for (const r of db.staff_reviews) {
      const pingTime = new Date(r.last_heartbeat).getTime();
      const startTime = new Date(r.review_started).getTime();
      const elapsed = now - pingTime;

      if (r.status === "reviewing" && elapsed > TIMEOUT_MS) {
        r.status = "completed";
        r.duration_seconds = Math.max(0, Math.floor((pingTime - startTime) / 1000));
        modified = true;
      }
    }

    if (modified) {
      writeLocalDb(db);
    }

    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from("staff_reviews")
          .select("*")
          .order("review_started", { ascending: false });
        if (data && !error && data.length > 0) {
          const merged = [...db.staff_reviews];
          for (const item of data) {
            if (!merged.some((m) => m.id === item.id)) {
              merged.push(item);
            }
          }
          return merged.sort(
            (a, b) => new Date(b.review_started).getTime() - new Date(a.review_started).getTime()
          );
        }
      } catch {
        // fallback
      }
    }

    return db.staff_reviews.sort(
      (a, b) => new Date(b.review_started).getTime() - new Date(a.review_started).getTime()
    );
  },

  // IP Bans
  async isIpBanned(ip: string): Promise<boolean> {
    const cleanIp = normalizeIp(ip);
    if (!cleanIp || cleanIp === "127.0.0.1") return false;
    const db = readLocalDb();
    if (Boolean(db.banned_ips[cleanIp]) || Boolean(db.banned_ips[ip])) return true;
    if (isSupabaseConfigured && supabase) {
      try {
        const { data } = await supabase.from("banned_ips").select("ip_address").eq("ip_address", cleanIp).maybeSingle();
        if (data) return true;
      } catch (err) {
        console.error("Supabase isIpBanned error:", err);
      }
    }
    return false;
  },

  async banIp(ip: string, reason: string) {
    const cleanIp = normalizeIp(ip);
    if (!cleanIp || cleanIp === "127.0.0.1") return;
    const db = readLocalDb();
    const banned_at = new Date().toISOString();
    db.banned_ips[cleanIp] = { reason, banned_at };

    // Cascading IP Ban: automatically set status = "banned" on all keys claimed by or bound to this IP
    db.keys.forEach((k) => {
      if (k.claimed_ip && normalizeIp(k.claimed_ip) === cleanIp) {
        k.status = "banned";
      }
    });

    db.sessions.forEach((s) => {
      if (s.ip_address && normalizeIp(s.ip_address) === cleanIp) {
        s.status = "kicked";
        s.pending_commands.push({ id: crypto.randomUUID(), type: "kick", reason: "IP address has been banned." });
      }
    });
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("banned_ips").upsert({ ip_address: cleanIp, reason, banned_at });
        await supabase.from("keys").update({ status: "banned" }).eq("claimed_ip", cleanIp);
      } catch (err) {
        console.error("Supabase banIp error:", err);
      }
    }
  },

  /**
   * Automates critical tamper / abuse bans:
   * 1. Bans the requester's current IP address.
   * 2. If the request was verified to be from the key's bound owner (or verified session),
   *    revokes the license key and bans the bound IP.
   *    PREVENTS THIRD-PARTY GRIEFING: Never bans an innocent third-party claimed_ip from an unauthenticated probe.
   */
  async autoBanOffender(
    currentIp: string,
    keyRecordOrIdOrString?: KeyRecord | string | null,
    reason: string = "Security Integrity Violation",
    options: { banLinkedClaimedIp?: boolean } = {}
  ): Promise<{ bannedIps: string[]; keyBanned: boolean }> {
    const bannedIps: string[] = [];
    let keyBanned = false;

    // 1. Ban current client IP
    const normCurrent = normalizeIp(currentIp);
    if (normCurrent && normCurrent !== "127.0.0.1") {
      await this.banIp(normCurrent, reason);
      bannedIps.push(normCurrent);
    }

    // 2. Resolve key record if provided
    let key: KeyRecord | null = null;
    if (typeof keyRecordOrIdOrString === "string") {
      key = await this.getKeyById(keyRecordOrIdOrString);
      if (!key) {
        key = await this.getKeyByString(keyRecordOrIdOrString);
      }
    } else if (keyRecordOrIdOrString && typeof keyRecordOrIdOrString === "object") {
      key = keyRecordOrIdOrString;
    }

    // Never ban staff review keys or their IPs
    if (key && isStaffReviewKey(key)) {
      return { bannedIps, keyBanned: false };
    }

    // 3. Only revoke key and ban claimed_ip if the requester is the key owner
    // OR if explicitly requested from an authenticated session (banLinkedClaimedIp)
    if (key) {
      const claimed = key.claimed_ip ? normalizeIp(key.claimed_ip) : null;
      const isOwner = Boolean(claimed && claimed === normCurrent);
      const shouldBanLinked = isOwner || options.banLinkedClaimedIp === true;

      if (shouldBanLinked) {
        if (claimed && claimed !== "127.0.0.1" && claimed !== normCurrent) {
          await this.banIp(
            claimed,
            `Linked Key Tampering: Original IP bound during key claim (${key.key_string}) — Reason: ${reason}`
          );
          bannedIps.push(claimed);
        }

        if (key.status !== "banned") {
          await this.updateKeyStatus(key.id, "banned");
          keyBanned = true;
        }
      }
    }

    return { bannedIps, keyBanned };
  },

  async unbanIp(ip: string) {
    const cleanIp = normalizeIp(ip);
    const db = readLocalDb();
    delete db.banned_ips[cleanIp];
    delete db.banned_ips[ip];
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("banned_ips").delete().eq("ip_address", ip);
      } catch (err) {
        console.error("Supabase unbanIp error:", err);
      }
    }
  },

  async getBannedIps(): Promise<Record<string, { reason: string; banned_at: string }>> {
    const local = readLocalDb().banned_ips;
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.from("banned_ips").select("*");
        if (data && !error) {
          const map: Record<string, { reason: string; banned_at: string }> = { ...local };
          data.forEach((row) => {
            map[row.ip_address] = { reason: row.reason, banned_at: row.banned_at };
          });
          return map;
        }
      } catch (err) {
        console.error("Supabase getBannedIps error:", err);
      }
    }
    return local;
  },

  // HWID Bans & Checkpoint Bypass Lockouts
  async isHwidBanned(hwid: string): Promise<boolean> {
    const cleanHwid = (hwid || "").trim();
    if (!cleanHwid) return false;
    const db = readLocalDb();
    if (db.banned_hwids && Boolean(db.banned_hwids[cleanHwid])) return true;
    if (isSupabaseConfigured && supabase) {
      try {
        const { data } = await supabase.from("banned_hwids").select("hwid").eq("hwid", cleanHwid).maybeSingle();
        if (data) return true;
      } catch (err) {
        console.error("Supabase isHwidBanned error:", err);
      }
    }
    return false;
  },

  async banHwid(hwid: string, ip?: string, reason: string = "Checkpoint Bypass Lockout (3 attempts reached)") {
    const cleanHwid = (hwid || "").trim();
    if (!cleanHwid) return;
    const db = readLocalDb();
    if (!db.banned_hwids) db.banned_hwids = {};
    const banned_at = new Date().toISOString();
    db.banned_hwids[cleanHwid] = { reason, banned_at, ip_address: ip };

    // Kick any active sessions matching this HWID
    db.sessions.forEach((s) => {
      if (s.hwid && s.hwid.trim() === cleanHwid) {
        s.status = "kicked";
        s.pending_commands.push({ id: crypto.randomUUID(), type: "kick", reason: "Device HWID has been locked out." });
      }
    });

    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("banned_hwids").upsert({
          hwid: cleanHwid,
          ip_address: ip || null,
          reason,
          banned_at,
        });
      } catch (err) {
        console.error("Supabase banHwid error:", err);
      }
    }
  },

  async unbanHwid(hwid: string) {
    const cleanHwid = (hwid || "").trim();
    const db = readLocalDb();
    if (db.banned_hwids) {
      delete db.banned_hwids[cleanHwid];
      writeLocalDb(db);
    }
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("banned_hwids").delete().eq("hwid", cleanHwid);
      } catch (err) {
        console.error("Supabase unbanHwid error:", err);
      }
    }
  },

  async getBannedHwids(): Promise<Record<string, { reason: string; banned_at: string; ip_address?: string }>> {
    const local = readLocalDb().banned_hwids || {};
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.from("banned_hwids").select("*");
        if (data && !error) {
          const map: Record<string, { reason: string; banned_at: string; ip_address?: string }> = { ...local };
          data.forEach((row) => {
            map[row.hwid] = { reason: row.reason, banned_at: row.banned_at, ip_address: row.ip_address };
          });
          return map;
        }
      } catch (err) {
        console.error("Supabase getBannedHwids error:", err);
      }
    }
    return local;
  },

  // Record a detected bypass attempt and enforce 3-strikes auto-lockout
  async recordBypassAttempt(
    ip: string,
    hwid?: string | null,
    scriptId?: string | null,
    reason: string = "Checkpoint Bypass Attempt",
    stepIndex?: number
  ): Promise<{ lockedOut: boolean; attemptCount: number; bannedIps: string[]; bannedHwids: string[] }> {
    const cleanIp = normalizeIp(ip);
    const cleanHwid = (hwid || "").trim();
    const db = readLocalDb();
    if (!db.bypass_attempts) db.bypass_attempts = [];

    const attempt: BypassAttemptRecord = {
      id: crypto.randomUUID(),
      ip_address: cleanIp,
      hwid: cleanHwid || null,
      script_id: scriptId || null,
      step_index: stepIndex,
      reason,
      created_at: new Date().toISOString(),
    };

    db.bypass_attempts.unshift(attempt);
    if (db.bypass_attempts.length > 1000) {
      db.bypass_attempts = db.bypass_attempts.slice(0, 1000);
    }
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("bypass_attempts").insert({
          id: attempt.id,
          ip_address: cleanIp,
          hwid: cleanHwid || null,
          script_id: scriptId || null,
          step_index: stepIndex,
          reason,
          created_at: attempt.created_at,
        });
      } catch (err) {
        console.error("Supabase recordBypassAttempt error:", err);
      }
    }

    // Count attempts for this IP or HWID. With Supabase configured, count in the database (the
    // local copy is per-instance on serverless, so strikes were being counted separately per
    // instance). Union = byIp + byHwid - both. Separate parameterised filters (hwid is client input).
    let attemptCount: number;
    if (isSupabaseConfigured && supabase) {
      const head = () => supabase!.from("bypass_attempts").select("id", { count: "exact", head: true });
      const [byIp, byHwid, both] = await Promise.all([
        head().eq("ip_address", cleanIp),
        cleanHwid ? head().eq("hwid", cleanHwid) : Promise.resolve({ count: 0 }),
        cleanHwid ? head().eq("ip_address", cleanIp).eq("hwid", cleanHwid) : Promise.resolve({ count: 0 }),
      ]);
      attemptCount = (byIp.count || 0) + (byHwid.count || 0) - (both.count || 0);
    } else {
      attemptCount = db.bypass_attempts.filter((a) => {
        const matchIp = a.ip_address === cleanIp;
        const matchHwid = Boolean(cleanHwid && a.hwid && a.hwid.trim() === cleanHwid);
        return matchIp || matchHwid;
      }).length;
    }

    const bannedIps: string[] = [];
    const bannedHwids: string[] = [];

    // Spike detection across everyone: 10+ bypass attempts in 10 minutes.
    if (!(await this.rateLimit("bypass-spike", "all", 10, 600))) {
      void adminAlert("bypass_spike", "Checkpoint bypass spike", { "Attempts (10 min)": "10+", "Latest reason": reason }, { windowSec: 600 });
    }

    // Auto-lockout rule: 3 or more attempts locks out IP and HWID permanently
    if (attemptCount >= 3) {
      void adminAlert(
        "bypass_lockout",
        "Bypass lockout triggered",
        { IP: cleanIp, HWID: cleanHwid || "—", Attempts: attemptCount, Reason: reason },
        { dedupKey: cleanIp, windowSec: 3600 }
      );
      const lockoutReason = `Automated Security Lockout: 3 bypass attempts recorded on checkpoint claim (Latest: ${reason})`;
      if (cleanIp && cleanIp !== "127.0.0.1") {
        await this.banIp(cleanIp, lockoutReason);
        bannedIps.push(cleanIp);
      }
      if (cleanHwid) {
        await this.banHwid(cleanHwid, cleanIp, lockoutReason);
        bannedHwids.push(cleanHwid);
      }
      return { lockedOut: true, attemptCount, bannedIps, bannedHwids };
    }

    return { lockedOut: false, attemptCount, bannedIps, bannedHwids };
  },

  async getBypassAttempts(): Promise<BypassAttemptRecord[]> {
    const local = readLocalDb().bypass_attempts || [];
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from("bypass_attempts")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200);
        if (data && !error) {
          return data as BypassAttemptRecord[];
        }
      } catch (err) {
        console.error("Supabase getBypassAttempts error:", err);
      }
    }
    return local;
  },

  async clearBypassAttempts(filter?: { ip?: string; hwid?: string }): Promise<void> {
    const db = readLocalDb();
    if (!filter || (!filter.ip && !filter.hwid)) {
      db.bypass_attempts = [];
    } else {
      const cleanIp = filter.ip ? normalizeIp(filter.ip) : null;
      const cleanHwid = filter.hwid ? filter.hwid.trim() : null;
      db.bypass_attempts = (db.bypass_attempts || []).filter((a) => {
        if (cleanIp && a.ip_address === cleanIp) return false;
        if (cleanHwid && a.hwid && a.hwid.trim() === cleanHwid) return false;
        return true;
      });
    }
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        if (!filter || (!filter.ip && !filter.hwid)) {
          await supabase.from("bypass_attempts").delete().neq("id", "00000000-0000-0000-0000-000000000000");
        } else {
          let query = supabase.from("bypass_attempts").delete();
          if (filter.ip) query = query.eq("ip_address", normalizeIp(filter.ip));
          if (filter.hwid) query = query.eq("hwid", filter.hwid.trim());
          await query;
        }
      } catch (err) {
        console.error("Supabase clearBypassAttempts error:", err);
      }
    }
  },

  // Settings
  async getSettings(): Promise<SystemSettings> {
    const local = readLocalDb().settings;
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.from("system_settings").select("*").eq("id", 1).maybeSingle();
        if (data && !error) {
          return {
            ...local,
            ...data,
          };
        }
      } catch (err) {
        console.error("Supabase getSettings error:", err);
      }
    }
    return local;
  },

  async saveSettings(settings: Partial<SystemSettings>): Promise<SystemSettings> {
    const db = readLocalDb();
    // Merge onto the CURRENT saved settings (from the database), not the built-in defaults —
    // otherwise saving one field would silently reset every other field.
    db.settings = { ...(await this.getSettings()), ...settings };
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("system_settings").upsert({
          id: 1,
          ...db.settings,
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error("Supabase saveSettings error:", err);
      }
    }
    return db.settings;
  },

  // Execution & Analytics Logging
  async recordExecution(log: Omit<ExecutionLog, "id" | "created_at">): Promise<ExecutionLog> {
    const id = crypto.randomUUID();
    const avatarUrl =
      log.avatar_url ||
      (log.roblox_user_id
        ? `https://www.roblox.com/headshot-thumbnail/image?userId=${log.roblox_user_id}&width=150&height=150&format=png`
        : null);

    const record: ExecutionLog = {
      ...log,
      avatar_url: avatarUrl,
      id,
      created_at: new Date().toISOString(),
    };

    const db = readLocalDb();
    db.execution_logs.unshift(record);
    if (db.execution_logs.length > 5000) {
      db.execution_logs = db.execution_logs.slice(0, 5000);
    }
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        const baseRecord = {
          id: record.id,
          script_id: record.script_id,
          script_name: record.script_name,
          roblox_username: record.roblox_username || null,
          roblox_user_id: record.roblox_user_id || null,
          ip_address: record.ip_address,
          isp: record.isp || (record.city ? `${record.city}, ${record.country || ""}`.trim() : null),
          os: record.os || null,
          executor: record.executor || null,
          key_last4: record.key_last4 || null,
          status: record.status,
          failure_reason: record.failure_reason || null,
          created_at: record.created_at,
          place_id: record.place_id ? String(record.place_id) : null,
          place_name: record.place_name || null,
          job_id: record.job_id || null,
          avatar_url: record.avatar_url || null,
        };

        const { error } = await supabase.from("execution_logs").insert([record]);
        if (error) {
          const res = await supabase.from("execution_logs").insert([baseRecord]);
          if (res.error) {
            console.error("Supabase recordExecution fallback error:", res.error.message);
          }
        }
      } catch (err) {
        console.error("Supabase recordExecution error:", err);
      }
    }
    return record;
  },

  /**
   * True if the checkpoint session has a log row for `stage` (and optionally a given step index).
   * Used to enforce that checkpoint steps are completed in order, server-side.
   */
  async hasCheckpointLog(sessionId: string, stage: string, stepIndex?: number): Promise<boolean> {
    if (!sessionId) return false;
    if (isSupabaseConfigured && supabase) {
      try {
        let q = supabase
          .from("checkpoint_logs")
          .select("id", { count: "exact", head: true })
          .eq("session_id", sessionId)
          .eq("stage", stage);
        if (stepIndex !== undefined) q = q.eq("step_index", stepIndex);
        const { count, error } = await q;
        if (!error) return (count || 0) > 0;
        console.error("hasCheckpointLog error:", error.message);
      } catch (err) {
        console.error("hasCheckpointLog exception:", err);
      }
    }
    const logs = readLocalDb().checkpoint_logs || [];
    return logs.some(
      (l) =>
        l.session_id === sessionId && l.stage === stage && (stepIndex === undefined || l.step_index === stepIndex)
    );
  },

  /** The script and start time of a checkpoint session (from its "started" log), or null. */
  async getCheckpointSessionInfo(sessionId: string): Promise<{ script_id: string | null; created_at: string } | null> {
    if (!sessionId || !UUID_RE.test(sessionId)) return null;
    if (isSupabaseConfigured && supabase) {
      const { data } = await supabase
        .from("checkpoint_logs")
        .select("script_id, created_at")
        .eq("session_id", sessionId)
        .eq("stage", "started")
        .order("created_at", { ascending: true })
        .limit(1);
      return data && data.length ? (data[0] as { script_id: string | null; created_at: string }) : null;
    }
    const l = (readLocalDb().checkpoint_logs || []).find((x) => x.session_id === sessionId && x.stage === "started");
    return l ? { script_id: l.script_id || null, created_at: l.created_at } : null;
  },

  /** Step indexes recorded as completed for a checkpoint session (server truth for Work.ink progress). */
  async getCompletedSteps(sessionId: string): Promise<number[]> {
    if (!sessionId) return [];
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from("checkpoint_logs")
        .select("step_index")
        .eq("session_id", sessionId)
        .eq("stage", "step_completed")
        .not("step_index", "is", null)
        .limit(100);
      if (!error && data) return Array.from(new Set(data.map((r: { step_index: number }) => r.step_index)));
    }
    const logs = readLocalDb().checkpoint_logs || [];
    return Array.from(
      new Set(
        logs
          .filter((l) => l.session_id === sessionId && l.stage === "step_completed" && typeof l.step_index === "number")
          .map((l) => l.step_index as number)
      )
    );
  },

  async recordCheckpoint(
    stage: "started" | "completed" | "step_started" | "step_completed",
    ip: string,
    scriptId?: string,
    meta?: { stepIndex?: number; checkpointTitle?: string; sessionId?: string }
  ): Promise<void> {
    const record: CheckpointLog = {
      id: crypto.randomUUID(),
      script_id: scriptId,
      ip_address: ip,
      stage,
      step_index: meta?.stepIndex,
      checkpoint_title: meta?.checkpointTitle,
      session_id: meta?.sessionId,
      created_at: new Date().toISOString(),
    };

    const db = readLocalDb();
    if (!db.checkpoint_logs) db.checkpoint_logs = [];
    db.checkpoint_logs.unshift(record);
    if (db.checkpoint_logs.length > 5000) {
      db.checkpoint_logs = db.checkpoint_logs.slice(0, 5000);
    }
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        const { error } = await supabase.from("checkpoint_logs").insert([record]);
        if (error) {
          // Fallback if Supabase has legacy CHECK constraint
          const safeStage = stage === "completed" ? "completed" : "started";
          const baseRecord = {
            id: record.id,
            ip_address: record.ip_address,
            stage: safeStage,
            created_at: record.created_at,
          };
          const res = await supabase.from("checkpoint_logs").insert([baseRecord]);
          if (res.error) {
            console.error("Supabase recordCheckpoint fallback error:", res.error.message);
          }
        }
      } catch (err) {
        console.error("Supabase recordCheckpoint error:", err);
      }
    }
  },

  async getAnalytics(timeframe = "all", scriptId?: string) {
    // Opportunistic background pruning (runs at most once every 6h)
    this.autoPruneStaleLogs().catch(() => {});

    const cutoff = getTimeCutoff(timeframe);
    let executions: ExecutionLog[] = [];
    let checkpoints: CheckpointLog[] = [];

    // Resolve script filter early so Supabase count & log queries can filter accurately
    let matchedScriptId: string | null = null;
    let matchedScriptName: string | null = null;
    if (scriptId && scriptId !== "all") {
      const allScripts = await dbService.getScripts();
      const matched = allScripts.find(
        (s) => s.id === scriptId || s.slug === scriptId || s.name.toLowerCase() === scriptId.toLowerCase()
      );
      if (matched) {
        matchedScriptId = matched.id;
        matchedScriptName = matched.name;
      } else {
        matchedScriptId = scriptId;
      }
    }

    // Exact count metrics directly from Supabase (bypasses PostgREST 1,000 max-rows limit)
    let exactTotal: number | null = null;
    let exactPassed: number | null = null;
    let exactFailed: number | null = null;
    let exactCpStarted: number | null = null;
    let exactCpCompleted: number | null = null;

    // 1. Fetch remote logs and exact counts from Supabase if configured
    if (isSupabaseConfigured && supabase) {
      try {
        const cutoffIso = cutoff ? new Date(cutoff).toISOString() : null;

        let totalCountQ = supabase.from("execution_logs").select("*", { count: "exact", head: true });
        let passedCountQ = supabase.from("execution_logs").select("*", { count: "exact", head: true }).eq("status", "success");
        let failedCountQ = supabase.from("execution_logs").select("*", { count: "exact", head: true }).eq("status", "failed");
        let cpStartedQ = supabase.from("checkpoint_logs").select("*", { count: "exact", head: true }).eq("stage", "started");
        let cpCompletedQ = supabase.from("checkpoint_logs").select("*", { count: "exact", head: true }).eq("stage", "completed");

        if (cutoffIso) {
          totalCountQ = totalCountQ.gte("created_at", cutoffIso);
          passedCountQ = passedCountQ.gte("created_at", cutoffIso);
          failedCountQ = failedCountQ.gte("created_at", cutoffIso);
          cpStartedQ = cpStartedQ.gte("created_at", cutoffIso);
          cpCompletedQ = cpCompletedQ.gte("created_at", cutoffIso);
        }

        if (matchedScriptId) {
          totalCountQ = totalCountQ.eq("script_id", matchedScriptId);
          passedCountQ = passedCountQ.eq("script_id", matchedScriptId);
          failedCountQ = failedCountQ.eq("script_id", matchedScriptId);
          cpStartedQ = cpStartedQ.eq("script_id", matchedScriptId);
          cpCompletedQ = cpCompletedQ.eq("script_id", matchedScriptId);
        }

        let execQuery = supabase
          .from("execution_logs")
          .select("*")
          .order("created_at", { ascending: false });

        if (cutoffIso) {
          execQuery = execQuery.gte("created_at", cutoffIso);
        }
        if (matchedScriptId) {
          execQuery = execQuery.eq("script_id", matchedScriptId);
        }

        let cpQuery = supabase
          .from("checkpoint_logs")
          .select("*")
          .order("created_at", { ascending: false });

        if (cutoffIso) {
          cpQuery = cpQuery.gte("created_at", cutoffIso);
        }
        if (matchedScriptId) {
          cpQuery = cpQuery.eq("script_id", matchedScriptId);
        }

        const [
          totalRes,
          passedRes,
          failedRes,
          cpStartedRes,
          cpCompletedRes,
          logsRes,
          cpLogsRes,
        ] = await Promise.all([
          totalCountQ,
          passedCountQ,
          failedCountQ,
          cpStartedQ,
          cpCompletedQ,
          execQuery.limit(200),
          cpQuery.limit(200),
        ]);

        if (typeof totalRes.count === "number") exactTotal = totalRes.count;
        if (typeof passedRes.count === "number") exactPassed = passedRes.count;
        if (typeof failedRes.count === "number") exactFailed = failedRes.count;
        if (typeof cpStartedRes.count === "number") exactCpStarted = cpStartedRes.count;
        if (typeof cpCompletedRes.count === "number") exactCpCompleted = cpCompletedRes.count;

        if (logsRes.data && !logsRes.error) {
          executions = logsRes.data;
        }
        if (cpLogsRes.data && !cpLogsRes.error) {
          checkpoints = cpLogsRes.data;
        }
      } catch (err) {
        console.error("Supabase getAnalytics error:", err);
      }
    }

    // 2. Fallback and merge with local database (de-duplicated by id)
    const db = readLocalDb();
    const execMap = new Map<string, ExecutionLog>();
    for (const log of executions) execMap.set(log.id, log);
    for (const log of db.execution_logs || []) {
      if (!execMap.has(log.id)) {
        if (cutoff && new Date(log.created_at).getTime() < cutoff) continue;
        execMap.set(log.id, log);
      }
    }
    let allExecs = Array.from(execMap.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // Filter by specific script if requested
    if (matchedScriptId) {
      allExecs = allExecs.filter(
        (e) =>
          e.script_id === matchedScriptId ||
          (matchedScriptName && e.script_name?.toLowerCase() === matchedScriptName.toLowerCase())
      );
    }

    const cpMap = new Map<string, CheckpointLog>();
    for (const cp of checkpoints) cpMap.set(cp.id, cp);
    for (const cp of db.checkpoint_logs || []) {
      if (!cpMap.has(cp.id)) {
        if (cutoff && new Date(cp.created_at).getTime() < cutoff) continue;
        cpMap.set(cp.id, cp);
      }
    }
    let allCps = Array.from(cpMap.values());
    if (matchedScriptId) {
      allCps = allCps.filter((c) => !c.script_id || c.script_id === matchedScriptId);
    }

    // 3. Compute KPI Metrics (Prioritizing exact database counts)
    const localPassed = allExecs.filter((e) => e.status === "success").length;
    const localFailed = allExecs.filter((e) => e.status === "failed").length;

    const totalExecutions = exactTotal !== null ? Math.max(exactTotal, allExecs.length) : allExecs.length;
    const passedExecutions = exactPassed !== null ? exactPassed : localPassed;
    const failedExecutions = exactFailed !== null ? exactFailed : localFailed;
    const passRate = totalExecutions > 0 ? Math.round((passedExecutions / totalExecutions) * 100) : 100;

    const uniqueUsers = new Set(
      allExecs.map((e) => e.roblox_user_id || e.roblox_username || e.ip_address).filter(Boolean)
    ).size;
    const uniqueIps = new Set(allExecs.map((e) => e.ip_address).filter(Boolean)).size;

    // Checkpoint metrics
    const localCpStarted = allCps.filter((c) => c.stage === "started").length;
    const localCpCompleted = allCps.filter((c) => c.stage === "completed").length;

    const checkpointsStarted = exactCpStarted !== null ? Math.max(exactCpStarted, localCpStarted) : localCpStarted;
    const checkpointsCompleted = exactCpCompleted !== null ? Math.max(exactCpCompleted, localCpCompleted) : localCpCompleted;
    const checkpointConversionRate =
      checkpointsStarted > 0 ? Math.round((checkpointsCompleted / checkpointsStarted) * 100) : 100;

    // Failure reason breakdown (Normalized & filtered to remove malformed key clutter)
    const failureReasons: Record<string, number> = {};
    allExecs
      .filter((e) => e.status === "failed" && e.failure_reason)
      .forEach((e) => {
        let reason = (e.failure_reason || "Unknown Security Rejection").trim();

        // Exclude malformed keys completely as requested
        if (
          reason.startsWith("Malformed Key") ||
          reason.startsWith("Missing Key") ||
          reason.includes("Invalid key syntax")
        ) {
          return;
        }

        // Normalize dynamic variations into clean security buckets
        if (reason.startsWith("Brute-Force")) {
          reason = "Brute-Force Key Guessing Attack";
        } else if (reason.startsWith("IP Mismatch")) {
          reason = "IP Mismatch (Bound to different device)";
        } else if (reason.startsWith("Script Mismatch")) {
          reason = "Script Mismatch (Key claimed for different script)";
        } else if (reason.startsWith("Identity Spoofing")) {
          reason = "Identity Spoofing Blocked";
        } else if (
          reason.startsWith("Security Integrity Violation") ||
          reason.startsWith("Critical Client Tampering") ||
          reason.startsWith("Security Tampering")
        ) {
          reason = "Security Tampering Detected";
        } else if (reason.startsWith("Security Alert: Missing or forged executor")) {
          reason = "Invalid / Forged Executor";
        } else if (reason.startsWith("Invalid Key")) {
          reason = "Invalid Key (Key does not exist)";
        } else if (reason.startsWith("Expired Key")) {
          reason = "Expired License Key";
        } else if (reason.startsWith("Revoked Key")) {
          reason = "Revoked / Banned Key";
        } else if (reason.startsWith("Unclaimed Key")) {
          reason = "Unclaimed Key (Not claimed from site)";
        } else if (reason.startsWith("IP Banned")) {
          reason = "IP Banned (Blacklisted)";
        } else if (reason.startsWith("Maintenance Mode")) {
          reason = "Maintenance Mode Block";
        }

        failureReasons[reason] = (failureReasons[reason] || 0) + 1;
      });

    // Top executors
    const executors: Record<string, number> = {};
    allExecs.forEach((e) => {
      const exec = e.executor || "Unknown Executor";
      executors[exec] = (executors[exec] || 0) + 1;
    });

    // Top OS
    const operatingSystems: Record<string, number> = {};
    allExecs.forEach((e) => {
      const os = e.os || "Desktop (Windows)";
      operatingSystems[os] = (operatingSystems[os] || 0) + 1;
    });

    // Scripts breakdown
    const scriptsBreakdown: Record<string, { total: number; passed: number; failed: number }> = {};
    allExecs.forEach((e) => {
      const sName = e.script_name || "Unknown Script";
      if (!scriptsBreakdown[sName]) {
        scriptsBreakdown[sName] = { total: 0, passed: 0, failed: 0 };
      }
      scriptsBreakdown[sName].total += 1;
      if (e.status === "success") scriptsBreakdown[sName].passed += 1;
      else scriptsBreakdown[sName].failed += 1;
    });

    // Activity timeline (grouped by hour if past day, or by date otherwise)
    const isDay = timeframe === "day";
    const timelineMap: Record<string, { label: string; passed: number; failed: number; total: number }> = {};

    allExecs.forEach((e) => {
      const d = new Date(e.created_at);
      let key = "";
      let label = "";

      if (isDay) {
        const hour = d.getHours();
        key = `${hour.toString().padStart(2, "0")}:00`;
        label = key;
      } else {
        key = d.toISOString().split("T")[0];
        label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      }

      if (!timelineMap[key]) {
        timelineMap[key] = { label, passed: 0, failed: 0, total: 0 };
      }
      timelineMap[key].total += 1;
      if (e.status === "success") timelineMap[key].passed += 1;
      else timelineMap[key].failed += 1;
    });

    const timeline = Object.entries(timelineMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => ({ key, ...val }));

    // Top Games / Place IDs
    const gamesMap: Record<string, { place_id: string; place_name: string; count: number }> = {};
    allExecs.forEach((e) => {
      const pId = e.place_id ? String(e.place_id).trim() : null;
      if (pId) {
        const pName = e.place_name || `Place #${pId}`;
        if (!gamesMap[pId]) {
          gamesMap[pId] = { place_id: pId, place_name: pName, count: 0 };
        }
        gamesMap[pId].count += 1;
      }
    });
    const topGames = Object.values(gamesMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((g) => ({
        ...g,
        percentage: totalExecutions > 0 ? Math.round((g.count / totalExecutions) * 100) : 100,
      }));

    // Top Executors with percentage
    const topExecutors = Object.entries(executors)
      .sort(([, a], [, b]) => b - a)
      .map(([name, count]) => ({
        name,
        count,
        percentage: totalExecutions > 0 ? Math.round((count / totalExecutions) * 100) : 100,
      }));

    // Average session duration
    const allSessions = await dbService.getSessions();
    const relevantSessions = allSessions.filter(
      (s) => !cutoff || new Date(s.session_started).getTime() >= cutoff
    );
    let totalDurationSec = 0;
    relevantSessions.forEach((s) => {
      const start = new Date(s.session_started).getTime();
      const end = new Date(s.last_heartbeat).getTime();
      totalDurationSec += Math.max(0, Math.floor((end - start) / 1000));
    });
    const avgSessionDurationSec =
      relevantSessions.length > 0 ? Math.round(totalDurationSec / relevantSessions.length) : 0;

    return {
      timeframe,
      totalExecutions,
      passedExecutions,
      failedExecutions,
      passRate,
      uniqueUsers,
      uniqueIps,
      checkpointsStarted,
      checkpointsCompleted,
      checkpointConversionRate,
      failureReasons,
      executors,
      topExecutors,
      topGames,
      avgSessionDurationSec,
      operatingSystems,
      scriptsBreakdown,
      timeline,
      recentLogs: allExecs.slice(0, 200),
    };
  },

  async clearAnalytics(): Promise<boolean> {
    const db = readLocalDb();
    db.execution_logs = [];
    db.checkpoint_logs = [];
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("execution_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
        await supabase.from("checkpoint_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      } catch (err) {
        console.error("Supabase clearAnalytics error:", err);
      }
    }
    return true;
  },

  /**
   * Automatic background retention prune for logs and high-churn tables.
   * Throttled to at most once per 6 hours to minimize database writes.
   */
  async autoPruneStaleLogs(force = false): Promise<void> {
    const now = Date.now();
    if (!force && (global as any).__lastLogsPrune && now - (global as any).__lastLogsPrune < 6 * 3600 * 1000) {
      return;
    }
    (global as any).__lastLogsPrune = now;

    if (!isSupabaseConfigured || !supabase) return;

    try {
      const sevenDaysAgo = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
      const thirtyDaysAgo = new Date(now - 30 * 24 * 3600 * 1000).toISOString();

      await Promise.allSettled([
        supabase.from("checkpoint_logs").delete().lt("created_at", sevenDaysAgo),
        supabase.from("execution_logs").delete().lt("created_at", sevenDaysAgo),
        supabase.from("client_errors").delete().lt("created_at", sevenDaysAgo),
        supabase.from("bypass_attempts").delete().lt("created_at", thirtyDaysAgo),
      ]);
    } catch (err) {
      console.warn("[autoPruneStaleLogs Warning]", err);
    }
  },

  /**
   * Checkpoint completion report, built per checkpoint SESSION (one visit to the claim page, resumed
   * across reloads / Work.ink round-trips). Replaces the dashboard's old analytics, which double-counted
   * completions, reported the step BEFORE the one a player actually quit on, counted players still
   * mid-task as drop-offs, and filled gaps with estimated numbers.
   */
  async getCheckpointReport(scriptId: string | undefined, rangeDays: number): Promise<CheckpointReport> {
    const now = Date.now();
    const since = rangeDays > 0 ? new Date(now - rangeDays * 86400 * 1000).toISOString() : null;
    const IN_PROGRESS_MS = 60 * 60 * 1000; // sessions touched in the last hour are "in progress", not dropped

    const scripts = await this.getScriptsLite();
    const scope = scriptId && scriptId !== "all"
      ? scripts.find((s) => s.id === scriptId || s.slug === scriptId) || null
      : null;
    const nameOf = (sid?: string | null) => scripts.find((s) => s.id === sid)?.name || (sid ? "Unknown script" : "—");

    // Step titles: per script (each script has its own checkpoint set, or the shared default)
    const stepsCache = new Map<string, CheckpointItem[]>();
    const stepsFor = async (sid?: string | null) => {
      const k = sid || "all";
      if (!stepsCache.has(k)) stepsCache.set(k, await this.getCheckpoints(sid || undefined));
      return stepsCache.get(k)!;
    };

    let logs: CheckpointLog[] = [];
    let keysClaimed = 0;
    let bypassCount = 0;
    if (isSupabaseConfigured && supabase) {
      // PostgREST returns at most 1000 rows per request → page newest-first (cap 20k rows), then put in time order.
      const page = (from: number) => {
        let q = supabase!
          .from("checkpoint_logs")
          .select("session_id, script_id, ip_address, stage, step_index, created_at")
          .not("session_id", "is", null)
          .order("created_at", { ascending: false })
          .range(from, from + 999);
        if (scope) q = q.eq("script_id", scope.id);
        if (since) q = q.gte("created_at", since);
        return q;
      };
      const fetchLogs = async () => {
        const out: CheckpointLog[] = [];
        for (let from = 0; from < 20000; from += 1000) {
          const { data, error } = await page(from);
          if (error || !data) break;
          out.push(...(data as CheckpointLog[]));
          if (data.length < 1000) break;
        }
        return out.reverse();
      };
      let kq = supabase.from("keys").select("id", { count: "exact", head: true }).not("claimed_at", "is", null);
      if (scope) kq = kq.eq("script_id", scope.id);
      if (since) kq = kq.gte("claimed_at", since);
      let bq = supabase.from("bypass_attempts").select("id", { count: "exact", head: true });
      if (scope) bq = bq.eq("script_id", scope.id);
      if (since) bq = bq.gte("created_at", since);
      const [l, k, b] = await Promise.all([fetchLogs(), kq, bq]);
      logs = l;
      keysClaimed = k.count || 0;
      bypassCount = b.count || 0;
    } else {
      logs = (readLocalDb().checkpoint_logs || [])
        .filter((x) => x.session_id && (!scope || x.script_id === scope.id) && (!since || x.created_at >= since))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    type S = { id: string; ip: string; script_id: string | null; started_at: string; last_at: string; done: Set<number>; finished_at: string | null };
    const sessions = new Map<string, S>();
    for (const log of logs) {
      const sid = log.session_id as string;
      let s = sessions.get(sid);
      if (!s) {
        if (log.stage !== "started") continue; // only sessions whose start is inside the window
        s = { id: sid, ip: log.ip_address, script_id: log.script_id || null, started_at: log.created_at, last_at: log.created_at, done: new Set(), finished_at: null };
        sessions.set(sid, s);
      }
      s.last_at = log.created_at;
      if (log.stage === "step_completed" && typeof log.step_index === "number") s.done.add(log.step_index);
      if (log.stage === "completed" && !s.finished_at) s.finished_at = log.created_at;
    }

    const list = Array.from(sessions.values());
    const enriched = await Promise.all(
      list.map(async (s) => {
        const steps = await stepsFor(s.script_id);
        const total = Math.max(1, steps.length);
        let reachedIdx = 0; // first step NOT completed = the step the player is on / quit on
        while (s.done.has(reachedIdx)) reachedIdx++;
        const finished = Boolean(s.finished_at);
        const status: "finished" | "in_progress" | "stopped" = finished
          ? "finished"
          : now - new Date(s.last_at).getTime() < IN_PROGRESS_MS
          ? "in_progress"
          : "stopped";
        return {
          ...s,
          total,
          stepIdx: finished ? total : Math.min(reachedIdx, total - 1),
          stepsDone: finished ? total : Math.min(reachedIdx, total),
          status,
          title: finished ? null : steps[Math.min(reachedIdx, total - 1)]?.title || `Step ${Math.min(reachedIdx, total - 1) + 1}`,
        };
      })
    );

    // Collapse sessions into PLAYERS (same IP + script). Reloading the claim page or coming back later starts a
    // new session; counting each abandoned one as a drop-off made step 1 look far worse than it is.
    // A player is represented by their furthest session (finished > most steps > most recent).
    type E = (typeof enriched)[number];
    const byPlayer = new Map<string, E[]>();
    for (const e of enriched) {
      const k = `${e.ip}|${e.script_id || "all"}`;
      const arr = byPlayer.get(k);
      if (arr) arr.push(e);
      else byPlayer.set(k, [e]);
    }
    const rank = (e: E) => (e.status === "finished" ? 1e6 : 0) + e.stepsDone * 1e3;
    const players = Array.from(byPlayer.values()).map((sess) => {
      const best = sess.reduce((b, e) => (rank(e) > rank(b) || (rank(e) === rank(b) && e.last_at > b.last_at) ? e : b));
      const firstStart = sess.reduce((m, e) => (e.started_at < m ? e.started_at : m), best.started_at);
      const lastAt = sess.reduce((m, e) => {
        const t = e.finished_at || e.last_at;
        return t > m ? t : m;
      }, best.last_at);
      // still active on any visit → in progress (unless they already finished)
      const status: E["status"] =
        best.status === "finished" ? "finished" : sess.some((e) => e.status === "in_progress") ? "in_progress" : "stopped";
      return { ...best, status, first_started_at: firstStart, last_activity: lastAt, attempts: sess.length };
    });

    // Funnel: only meaningful within one checkpoint set, so only when a single script is selected
    const funnelSteps = scope ? await stepsFor(scope.id) : [];
    const maxSteps = scope ? Math.max(1, funnelSteps.length) : 0; // no cross-script funnel (step 1 of A ≠ step 1 of B)
    const funnel = Array.from({ length: maxSteps }, (_, i) => {
      const inScope = players.filter((e) => i < e.total);
      return {
        step: i,
        title: scope ? funnelSteps[i]?.title || `Step ${i + 1}` : `Step ${i + 1}`,
        is_workink: Boolean(funnelSteps[i] && (Number(funnelSteps[i].duration_seconds) === 0 || /work\.ink|workink\.net/.test(funnelSteps[i].url || ""))),
        reached: inScope.filter((e) => e.stepsDone >= i).length,
        completed: inScope.filter((e) => e.stepsDone > i).length,
        stopped_here: inScope.filter((e) => e.status === "stopped" && e.stepIdx === i).length,
        in_progress_here: inScope.filter((e) => e.status === "in_progress" && e.stepIdx === i).length,
      };
    });

    const finishedList = players.filter((e) => e.status === "finished");
    const durations = finishedList
      .map((e) => (new Date(e.finished_at!).getTime() - new Date(e.started_at).getTime()) / 60000)
      .filter((m) => m >= 0)
      .sort((a, b) => a - b);
    const median = durations.length ? durations[Math.floor(durations.length / 2)] : null;
    const worst = funnel.reduce<(typeof funnel)[number] | null>((w, f) => (f.stopped_here > (w?.stopped_here || 0) ? f : w), null);

    // Daily trend (UTC), at most the last 30 days of the window
    const days = Math.min(rangeDays > 0 ? rangeDays : 30, 30);
    const daily: { day: string; started: number; finished: number }[] = [];
    for (let d = days - 1; d >= 0; d--) {
      const day = new Date(now - d * 86400 * 1000).toISOString().slice(0, 10);
      daily.push({
        day,
        started: players.filter((e) => e.first_started_at.slice(0, 10) === day).length,
        finished: finishedList.filter((e) => (e.finished_at || "").slice(0, 10) === day).length,
      });
    }

    return {
      scope: scope ? { id: scope.id, name: scope.name } : null,
      range_days: rangeDays,
      summary: {
        visitors: players.length,
        sessions: enriched.length,
        unique_visitors: new Set(enriched.map((e) => e.ip)).size,
        finished: finishedList.length,
        in_progress: players.filter((e) => e.status === "in_progress").length,
        stopped: players.filter((e) => e.status === "stopped").length,
        completion_rate: players.length ? Math.round((finishedList.length / players.length) * 100) : 0,
        keys_claimed: keysClaimed,
        bypass_attempts: bypassCount,
        median_minutes_to_finish: median === null ? null : Math.round(median * 10) / 10,
        biggest_drop: worst && worst.stopped_here > 0 ? { step: worst.step, title: worst.title, count: worst.stopped_here } : null,
      },
      funnel,
      daily,
      recent: players
        .sort((a, b) => b.last_activity.localeCompare(a.last_activity))
        .slice(0, 100)
        .map((e) => ({
          session: e.id.slice(0, 8),
          ip: e.ip,
          script: nameOf(e.script_id),
          started_at: e.first_started_at,
          last_at: e.last_activity,
          steps_done: e.stepsDone,
          total: e.total,
          status: e.status,
          step_title: e.title,
          attempts: e.attempts,
        })),
    };
  },

  async getCheckpointAnalytics(scriptId?: string) {
    let rawCheckpoints: CheckpointLog[] = [];
    if (isSupabaseConfigured && supabase) {
      try {
        const q = supabase
          .from("checkpoint_logs")
          .select("*")
          .order("created_at", { ascending: false });
        const { data, error } = await q.limit(5000);
        if (data && !error) {
          rawCheckpoints = data as CheckpointLog[];
        }
      } catch (err) {
        console.error("Supabase getCheckpointAnalytics error:", err);
      }
    }

    const db = readLocalDb();
    const cpMap = new Map<string, CheckpointLog>();
    for (const cp of rawCheckpoints) cpMap.set(cp.id, cp);
    for (const cp of db.checkpoint_logs || []) {
      if (!cpMap.has(cp.id)) cpMap.set(cp.id, cp);
    }

    let allLogs = Array.from(cpMap.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    if (scriptId && scriptId !== "all") {
      const clean = scriptId.trim().toLowerCase();
      const allScripts = await this.getScripts();
      const matched = allScripts.find(
        (s) => s.id.toLowerCase() === clean || s.slug.toLowerCase() === clean
      );
      const targetId = matched ? matched.id : scriptId;
      allLogs = allLogs.filter(
        (l) => !l.script_id || l.script_id === targetId || (matched && l.script_id === matched.slug)
      );
    }

    const configuredCheckpoints = await this.getCheckpoints(scriptId);
    const sortedCheckpoints = [...configuredCheckpoints].sort((a, b) => a.order - b.order);

    const visitorLogs = allLogs.filter((l) => l.stage === "started");
    const completedLogs = allLogs.filter((l) => l.stage === "completed");

    const totalVisitors = visitorLogs.length;
    const uniqueVisitors = new Set(visitorLogs.map((l) => l.ip_address).filter(Boolean)).size;

    const totalCompleted = completedLogs.length;
    const uniqueCompleted = new Set(completedLogs.map((l) => l.ip_address).filter(Boolean)).size;

    const completionRate = totalVisitors > 0 ? Math.round((totalCompleted / totalVisitors) * 100) : 0;
    const totalDropped = Math.max(0, totalVisitors - totalCompleted);
    const dropRate = totalVisitors > 0 ? Math.round((totalDropped / totalVisitors) * 100) : 0;

    interface Journey {
      id: string;
      ip: string;
      script_id?: string;
      started_at: string;
      completed: boolean;
      highestStepIndex: number;
      highestStepTitle?: string;
      stoppedOnStepIndex: number;
      stoppedOnStepTitle: string;
      events: CheckpointLog[];
    }

    const sessionJourneys = new Map<string, Journey>();
    const chronological = [...allLogs].reverse();
    for (const log of chronological) {
      const key = log.session_id ? `sid_${log.session_id}` : `ip_${log.ip_address}_${log.created_at.slice(0, 13)}`;
      let journey = sessionJourneys.get(key);
      if (!journey) {
        journey = {
          id: log.session_id || log.id,
          ip: log.ip_address,
          script_id: log.script_id,
          started_at: log.created_at,
          completed: false,
          highestStepIndex: 0,
          highestStepTitle: sortedCheckpoints[0]?.title || "Checkpoint 1",
          stoppedOnStepIndex: 0,
          stoppedOnStepTitle: sortedCheckpoints[0]?.title || "Checkpoint 1",
          events: [],
        };
        sessionJourneys.set(key, journey);
      }
      journey.events.push(log);

      if (log.stage === "completed") {
        journey.completed = true;
        journey.highestStepIndex = sortedCheckpoints.length;
      } else if (typeof log.step_index === "number") {
        if (log.step_index >= journey.highestStepIndex) {
          journey.highestStepIndex = log.step_index;
          if (sortedCheckpoints[log.step_index]) {
            journey.highestStepTitle = sortedCheckpoints[log.step_index].title;
          }
        }
      }
    }

    sessionJourneys.forEach((journey) => {
      if (!journey.completed) {
        journey.stoppedOnStepIndex = journey.highestStepIndex;
        const targetCp = sortedCheckpoints[journey.highestStepIndex];
        journey.stoppedOnStepTitle = targetCp ? targetCp.title : `Checkpoint Step ${journey.highestStepIndex + 1}`;
      }
    });

    const stepCounts: Record<number, { reached: number; completed: number; stopped: number }> = {};
    for (let i = 0; i < sortedCheckpoints.length; i++) {
      stepCounts[i] = { reached: 0, completed: 0, stopped: 0 };
    }

    const journeysList = Array.from(sessionJourneys.values());
    const hasDetailedStepLogs = allLogs.some((l) => typeof l.step_index === "number");

    if (hasDetailedStepLogs) {
      for (const j of journeysList) {
        if (j.completed) {
          for (let i = 0; i < sortedCheckpoints.length; i++) {
            stepCounts[i].reached += 1;
            stepCounts[i].completed += 1;
          }
        } else {
          for (let i = 0; i <= j.stoppedOnStepIndex && i < sortedCheckpoints.length; i++) {
            stepCounts[i].reached += 1;
            if (i < j.stoppedOnStepIndex) {
              stepCounts[i].completed += 1;
            } else if (i === j.stoppedOnStepIndex) {
              stepCounts[i].stopped += 1;
            }
          }
        }
      }
    } else {
      const totalSteps = Math.max(1, sortedCheckpoints.length);
      sortedCheckpoints.forEach((_, idx) => {
        const stepDropWeight = (totalSteps - idx) / ((totalSteps * (totalSteps + 1)) / 2);
        const estimatedStopped = Math.round(totalDropped * stepDropWeight);
        stepCounts[idx] = {
          reached: Math.max(totalCompleted, totalVisitors - Math.round(totalDropped * (idx / totalSteps))),
          completed: Math.max(totalCompleted, totalVisitors - Math.round(totalDropped * ((idx + 1) / totalSteps))),
          stopped: estimatedStopped,
        };
      });
    }

    const stepFunnel = sortedCheckpoints.map((cp, idx) => {
      const stats = stepCounts[idx] || { reached: 0, completed: 0, stopped: 0 };
      const stoppedPercent = totalDropped > 0 ? Math.round((stats.stopped / totalDropped) * 100) : 0;
      const retentionPercent = stats.reached > 0 ? Math.round((stats.completed / stats.reached) * 100) : 100;

      return {
        id: cp.id,
        order: cp.order || idx + 1,
        title: cp.title,
        url: cp.url,
        duration_seconds: cp.duration_seconds || 5,
        step_index: idx,
        reached_count: stats.reached,
        completed_count: stats.completed,
        stopped_count: stats.stopped,
        stopped_percentage: stoppedPercent,
        retention_percentage: retentionPercent,
      };
    });

    const recentActivity = allLogs.slice(0, 60).map((l) => {
      let description = "Visited checkpoint portal";
      if (l.stage === "completed") description = "Completed all checkpoints & claimed key";
      else if (l.stage === "step_completed") description = `Completed ${l.checkpoint_title || `Step ${(l.step_index ?? 0) + 1}`}`;
      else if (l.stage === "step_started") description = `Started ${l.checkpoint_title || `Step ${(l.step_index ?? 0) + 1}`}`;
      else if (l.stage === "started") description = "Opened checkpoint claim page";

      return {
        id: l.id,
        ip_address: l.ip_address,
        script_id: l.script_id,
        stage: l.stage,
        step_index: l.step_index,
        checkpoint_title: l.checkpoint_title,
        description,
        created_at: l.created_at,
      };
    });

    return {
      total_visitors: totalVisitors,
      unique_visitors: uniqueVisitors,
      total_completed: totalCompleted,
      unique_completed: uniqueCompleted,
      completion_rate: completionRate,
      total_dropped: totalDropped,
      drop_rate: dropRate,
      step_funnel: stepFunnel,
      recent_activity: recentActivity,
      active_checkpoints_count: sortedCheckpoints.length,
    };
  },

  // Checkpoints Management
  async getCheckpoints(scriptId?: string): Promise<CheckpointItem[]> {
    const all = await this.getAllCheckpoints();
    if (all.length === 0) return [];
    if (!scriptId || scriptId === "all") {
      return all;
    }

    const clean = scriptId.trim().toLowerCase();
    const scripts = await this.getScriptsLite(); // metadata only (was: every script's full payload)
    const matchedScript = scripts.find(
      (s) => s.id.toLowerCase() === clean || s.slug.toLowerCase() === clean || s.name.toLowerCase() === clean
    );
    const targetId = matchedScript ? matchedScript.id : scriptId;

    // Each script has its own checkpoint set (Work.ink and regular). If it has none, it uses the
    // shared default set ("all"). It never receives another script's checkpoints — previously a
    // script with no checkpoints of its own fell back to EVERY checkpoint of every script, and
    // shared ones were always mixed in, which made everything behave like one pool.
    const own = all.filter(
      (cp) => cp.script_id === targetId || (matchedScript && cp.script_id === matchedScript.slug)
    );
    const set = own.length > 0 ? own : all.filter((cp) => !cp.script_id || cp.script_id === "all");
    return [...set].sort((a, b) => a.order - b.order);
  },

  async getAllCheckpoints(): Promise<CheckpointItem[]> {
    const local = (readLocalDb().checkpoints || []).sort((a, b) => a.order - b.order);
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.from("checkpoints").select("*").order("order", { ascending: true });
        if (!error && Array.isArray(data)) {
          return data;
        }
      } catch (err) {
        console.error("Supabase getAllCheckpoints error:", err);
      }
    }
    return local;
  },

  async saveCheckpoint(
    checkpoint: Omit<CheckpointItem, "id" | "created_at"> & { id?: string }
  ): Promise<CheckpointItem> {
    const db = readLocalDb();
    if (!db.checkpoints) db.checkpoints = [];

    const id = checkpoint.id || crypto.randomUUID();
    const existingIndex = db.checkpoints.findIndex((cp) => cp.id === id);

    const record: CheckpointItem = {
      ...checkpoint,
      id,
      created_at: existingIndex >= 0 ? db.checkpoints[existingIndex].created_at : new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      db.checkpoints[existingIndex] = record;
    } else {
      db.checkpoints.push(record);
    }
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("checkpoints").upsert(record);
      } catch (err) {
        console.error("Supabase saveCheckpoint error:", err);
      }
    }

    return record;
  },

  async deleteCheckpoint(id: string): Promise<boolean> {
    const db = readLocalDb();
    if (db.checkpoints) {
      db.checkpoints = db.checkpoints.filter((cp) => cp.id !== id);
      writeLocalDb(db);
    }

    if (isSupabaseConfigured && supabase) {
      try {
        const { error } = await supabase.from("checkpoints").delete().eq("id", id);
        if (error) {
          console.error("Supabase deleteCheckpoint error:", error);
          throw new Error(error.message);
        }
      } catch (err) {
        console.error("Supabase deleteCheckpoint error:", err);
        throw err;
      }
    }
    return true;
  },

  // Creator Profile (Guns.lol style)
  async getCreatorProfile(): Promise<CreatorProfile> {
    const local = readLocalDb().creator_profile || defaultCreatorProfile;
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.from("creator_profile").select("*").eq("id", 1).maybeSingle();
        if (data && !error) {
          return {
            ...local,
            display_name: data.display_name || local.display_name,
            bio: data.bio || local.bio,
            avatar_url: data.avatar_url || local.avatar_url,
            emblems: data.emblems || local.emblems,
            socials: data.socials || local.socials,
          };
        }
      } catch (err) {
        console.error("Supabase getCreatorProfile error:", err);
      }
    }
    return local;
  },

  async saveCreatorProfile(profile: Partial<CreatorProfile>): Promise<CreatorProfile> {
    const db = readLocalDb();
    // Start from the CURRENT saved profile (database), not the built-in defaults.
    db.creator_profile = await this.getCreatorProfile();
    db.creator_profile = {
      ...(db.creator_profile || defaultCreatorProfile),
      ...profile,
      socials: {
        ...(db.creator_profile?.socials || defaultCreatorProfile.socials),
        ...(profile.socials || {}),
      },
      emblems: profile.emblems || db.creator_profile?.emblems || defaultCreatorProfile.emblems,
    };
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("creator_profile").upsert({
          id: 1,
          display_name: db.creator_profile.display_name,
          bio: db.creator_profile.bio,
          avatar_url: db.creator_profile.avatar_url,
          emblems: db.creator_profile.emblems,
          socials: db.creator_profile.socials,
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error("Supabase saveCreatorProfile error:", err);
      }
    }

    return db.creator_profile;
  },

  // Client Errors & Debug Telemetry
  async recordClientError(errorLog: Omit<ClientErrorLog, "id" | "created_at">): Promise<ClientErrorLog> {
    const id = crypto.randomUUID();
    const record: ClientErrorLog = {
      ...errorLog,
      id,
      created_at: new Date().toISOString(),
    };

    const db = readLocalDb();
    if (!db.client_errors) db.client_errors = [];
    db.client_errors.unshift(record);
    if (db.client_errors.length > 500) {
      db.client_errors = db.client_errors.slice(0, 500);
    }
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        const baseRecord = {
          id: record.id,
          session_id: record.session_id || null,
          script_id: record.script_id || null,
          script_name: record.script_name || null,
          roblox_username: record.roblox_username || null,
          roblox_user_id: record.roblox_user_id || null,
          executor: record.executor || null,
          os: record.os || null,
          error_message: record.error_message,
          stack_trace: record.stack_trace || null,
          created_at: record.created_at,
        };
        const { error } = await supabase.from("client_errors").insert([record]);
        if (error) {
          await supabase.from("client_errors").insert([baseRecord]);
        }
      } catch {
        // graceful fallback if table not yet created
      }
    }
    return record;
  },

  async getClientErrors(limit = 100): Promise<ClientErrorLog[]> {
    let remote: ClientErrorLog[] = [];
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from("client_errors")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit);
        if (data && !error) remote = data;
      } catch {
        // fallback
      }
    }

    const db = readLocalDb();
    const map = new Map<string, ClientErrorLog>();
    for (const e of remote) map.set(e.id, e);
    for (const e of db.client_errors || []) {
      if (!map.has(e.id)) map.set(e.id, e);
    }

    return Array.from(map.values())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  },

  async clearClientErrors(): Promise<boolean> {
    const db = readLocalDb();
    db.client_errors = [];
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("client_errors").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      } catch {
        // ignore
      }
    }
    return true;
  },

  // --------------------------------------------------------------------------
  // CHATROOM & WORD BLACKLIST METHODS
  // --------------------------------------------------------------------------

  async getChatroomCooldown(): Promise<number> {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from("system_settings")
          .select("chatroom_cooldown_seconds")
          .eq("id", 1)
          .maybeSingle();
        if (data && !error && typeof data.chatroom_cooldown_seconds === "number") {
          return data.chatroom_cooldown_seconds;
        }
      } catch {
        // fallback
      }
    }
    const db = readLocalDb();
    const val = db.settings?.chatroom_cooldown_seconds;
    return typeof val === "number" ? val : 5; // Default 5s
  },

  async setChatroomCooldown(seconds: number): Promise<number> {
    const clamped = Math.max(0, Math.min(300, Math.floor(seconds || 0)));
    const db = readLocalDb();
    if (!db.settings) {
      db.settings = {
        claim_method: "checkpoints",
        checkpoint_delay_seconds: 5,
        discord_guild_id: "",
        discord_bot_token: "",
        discord_invite_url: "",
        vpn_detection_enabled: false,
        tos_content: "",
      };
    }
    db.settings.chatroom_cooldown_seconds = clamped;
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase
          .from("system_settings")
          .update({ chatroom_cooldown_seconds: clamped })
          .eq("id", 1);
      } catch {
        // column might not exist yet; gracefully handled
      }
    }
    return clamped;
  },

  async getBlacklistWords(): Promise<string[]> {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from("chatroom_blacklist")
          .select("word")
          .order("created_at", { ascending: false });
        if (data && !error) {
          return data.map((r: any) => String(r.word).trim().toLowerCase()).filter(Boolean);
        }
      } catch (err) {
        console.error("Supabase getBlacklistWords error:", err);
      }
    }
    const db = readLocalDb();
    return (db.chatroom_blacklist || []).map((w) => w.word.trim().toLowerCase()).filter(Boolean);
  },

  async addBlacklistWord(word: string): Promise<boolean> {
    const cleaned = (word || "").trim().toLowerCase();
    if (!cleaned) return false;

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("chatroom_blacklist").upsert({ word: cleaned }, { onConflict: "word" });
      } catch (err) {
        console.error("Supabase addBlacklistWord error:", err);
      }
    }

    const db = readLocalDb();
    if (!db.chatroom_blacklist) db.chatroom_blacklist = [];
    if (!db.chatroom_blacklist.some((w) => w.word.toLowerCase() === cleaned)) {
      db.chatroom_blacklist.push({
        id: crypto.randomUUID(),
        word: cleaned,
        created_at: new Date().toISOString(),
      });
      writeLocalDb(db);
    }

    // Automatically purge existing messages containing this blacklisted word
    try {
      await this.purgeBlacklistedMessages([cleaned]);
    } catch {
      // non-fatal
    }

    return true;
  },

  async addBlacklistWords(words: string[]): Promise<string[]> {
    const cleaned = Array.from(
      new Set(
        (words || [])
          .map((w) => (w || "").trim().toLowerCase())
          .filter(Boolean)
      )
    );
    if (!cleaned.length) return await this.getBlacklistWords();

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase
          .from("chatroom_blacklist")
          .upsert(
            cleaned.map((w) => ({ word: w })),
            { onConflict: "word" }
          );
      } catch (err) {
        console.error("Supabase addBlacklistWords error:", err);
      }
    }

    const db = readLocalDb();
    if (!db.chatroom_blacklist) db.chatroom_blacklist = [];
    for (const w of cleaned) {
      if (!db.chatroom_blacklist.some((item) => item.word.toLowerCase() === w)) {
        db.chatroom_blacklist.push({
          id: crypto.randomUUID(),
          word: w,
          created_at: new Date().toISOString(),
        });
      }
    }
    writeLocalDb(db);

    try {
      await this.purgeBlacklistedMessages(cleaned);
    } catch {
      // non-fatal
    }

    return await this.getBlacklistWords();
  },

  async deleteBlacklistWord(word: string): Promise<boolean> {
    const cleaned = (word || "").trim().toLowerCase();
    if (!cleaned) return false;

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("chatroom_blacklist").delete().ilike("word", cleaned);
      } catch (err) {
        console.error("Supabase deleteBlacklistWord error:", err);
      }
    }

    const db = readLocalDb();
    if (db.chatroom_blacklist) {
      db.chatroom_blacklist = db.chatroom_blacklist.filter((w) => w.word.toLowerCase() !== cleaned);
      writeLocalDb(db);
    }
    return true;
  },

  async purgeBlacklistedMessages(blacklistWords?: string[]): Promise<number> {
    const words = blacklistWords || (await this.getBlacklistWords());
    if (!words.length) return 0;

    let purgedCount = 0;
    if (isSupabaseConfigured && supabase) {
      try {
        for (const w of words) {
          const safe = w.replace(/[%_]/g, "\\$&");
          await supabase.from("chatroom_messages").delete().ilike("message", `%${safe}%`);
        }
      } catch (err) {
        console.error("Supabase purge error:", err);
      }
    }

    const db = readLocalDb();
    if (db.chatroom_messages) {
      const originalLen = db.chatroom_messages.length;
      db.chatroom_messages = db.chatroom_messages.filter((m) => {
        const text = m.message.toLowerCase();
        return !words.some((w) => text.includes(w));
      });
      purgedCount += originalLen - db.chatroom_messages.length;
      writeLocalDb(db);
    }
    return purgedCount;
  },

  async getChatroomMessages(since?: string, limit = 100): Promise<ChatroomMessage[]> {
    let remote: ChatroomMessage[] = [];
    if (isSupabaseConfigured && supabase) {
      try {
        let q = supabase
          .from("chatroom_messages")
          .select("*")
          .order("created_at", { ascending: true })
          .limit(limit);
        if (since) {
          q = q.gt("created_at", since);
        }
        const { data, error } = await q;
        if (data && !error) remote = data;
      } catch {
        // fallback
      }
    }

    const db = readLocalDb();
    const map = new Map<string, ChatroomMessage>();
    for (const m of remote) map.set(m.id, m);
    for (const m of db.chatroom_messages || []) {
      if (!map.has(m.id)) {
        if (!since || new Date(m.created_at).getTime() > new Date(since).getTime()) {
          map.set(m.id, m);
        }
      }
    }

    const words = await this.getBlacklistWords();
    return Array.from(map.values())
      .filter((m) => {
        const text = (m.message || "").toLowerCase();
        return !words.some((w) => text.includes(w));
      })
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .slice(-limit);
  },

  async postChatroomMessage(msg: {
    user_id: string;
    username: string;
    display_name?: string;
    avatar_url?: string;
    message: string;
    is_dev?: boolean;
  }): Promise<{ success: boolean; data?: ChatroomMessage; blocked?: boolean; rateLimited?: boolean; remaining?: number; error?: string }> {
    const rawText = (msg.message || "").trim();
    if (!rawText) {
      return { success: false, error: "Message cannot be empty." };
    }

    // Cooldown check for regular players (dev messages bypass cooldown)
    if (!msg.is_dev) {
      const cooldownSecs = await this.getChatroomCooldown();
      // Shared across instances (Redis / Postgres). The old per-instance Map let players dodge
      // the cooldown just by landing on a different server.
      if (cooldownSecs > 0 && isSupabaseConfigured) {
        if (!(await this.consumeNonce("chatcd:" + String(msg.user_id), cooldownSecs))) {
          return {
            success: false,
            rateLimited: true,
            remaining: cooldownSecs,
            error: `Slow down! Chat cooldown is active. Please wait up to ${cooldownSecs} second${cooldownSecs === 1 ? "" : "s"}.`,
          };
        }
      } else if (cooldownSecs > 0) {
        const lastSent = lastChatTimeByUser.get(String(msg.user_id));
        const now = Date.now();
        if (lastSent && now - lastSent < cooldownSecs * 1000) {
          const remainingSecs = Math.ceil((cooldownSecs * 1000 - (now - lastSent)) / 1000);
          return {
            success: false,
            rateLimited: true,
            remaining: remainingSecs,
            error: `Slow down! Chat cooldown is active. Please wait ${remainingSecs} second${remainingSecs === 1 ? "" : "s"}.`,
          };
        }
      }
    }

    // Check blacklist
    const words = await this.getBlacklistWords();
    const lower = rawText.toLowerCase();
    const isBlocked = words.some((w) => lower.includes(w));
    if (isBlocked) {
      return { success: false, blocked: true, error: "Message contains blacklisted language and was blocked." };
    }

    const uid = String(msg.user_id || "0");
    const record: ChatroomMessage = {
      id: crypto.randomUUID(),
      user_id: uid,
      username: msg.username || "Anonymous",
      display_name: msg.display_name || msg.username || "Anonymous",
      avatar_url: msg.avatar_url || (uid && uid !== "0"
        ? `/api/roblox/avatar?userId=${uid}`
        : `/api/roblox/avatar?username=${encodeURIComponent(msg.username || "")}`),
      message: rawText,
      is_dev: Boolean(msg.is_dev),
      created_at: new Date().toISOString(),
    };

    if (!msg.is_dev) {
      lastChatTimeByUser.set(uid, Date.now());
    }

    const db = readLocalDb();
    if (!db.chatroom_messages) db.chatroom_messages = [];
    db.chatroom_messages.push(record);
    if (db.chatroom_messages.length > 500) {
      db.chatroom_messages = db.chatroom_messages.slice(-500);
    }
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("chatroom_messages").insert([record]);
      } catch {
        // fallback
      }
    }

    return { success: true, data: record };
  },

  async deleteChatroomMessage(id: string): Promise<boolean> {
    const db = readLocalDb();
    if (db.chatroom_messages) {
      db.chatroom_messages = db.chatroom_messages.filter((m) => m.id !== id);
      writeLocalDb(db);
    }

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("chatroom_messages").delete().eq("id", id);
      } catch {
        // fallback
      }
    }
    return true;
  },

  async clearAllChatroomMessages(): Promise<boolean> {
    const db = readLocalDb();
    db.chatroom_messages = [];
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("chatroom_messages").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      } catch (err) {
        console.error("Supabase clearAllChatroomMessages error:", err);
      }
    }
    return true;
  },

  // --------------------------------------------------------------------------
  // CONTACT DEV / DIRECT MESSAGES (DMs)
  // --------------------------------------------------------------------------

  async getDevConversations(): Promise<
    Array<{
      user_id: string;
      username: string;
      display_name?: string;
      avatar_url?: string;
      last_message: string;
      last_timestamp: string;
      unread_count: number;
    }>
  > {
    let allMsgs: DevMessage[] = [];
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from("dev_messages")
          .select("*")
          .order("created_at", { ascending: true });
        if (data && !error) allMsgs = data;
      } catch {
        // fallback
      }
    }

    const db = readLocalDb();
    const map = new Map<string, DevMessage>();
    for (const m of allMsgs) map.set(m.id, m);
    for (const m of db.dev_messages || []) {
      if (!map.has(m.id)) map.set(m.id, m);
    }

    const combined = Array.from(map.values());
    const convMap = new Map<
      string,
      {
        user_id: string;
        username: string;
        display_name?: string;
        avatar_url?: string;
        last_message: string;
        last_timestamp: string;
        unread_count: number;
      }
    >();

    for (const m of combined) {
      const uid = String(m.user_id);
      const existing = convMap.get(uid);
      const isUnreadUser = m.sender_type === "user" && !m.read;

      if (!existing) {
        convMap.set(uid, {
          user_id: uid,
          username: m.username || "Player",
          display_name: m.display_name || m.username || "Player",
          avatar_url: m.avatar_url,
          last_message: m.message,
          last_timestamp: m.created_at,
          unread_count: isUnreadUser ? 1 : 0,
        });
      } else {
        if (new Date(m.created_at).getTime() > new Date(existing.last_timestamp).getTime()) {
          existing.last_message = m.message;
          existing.last_timestamp = m.created_at;
          if (m.sender_type === "user") {
            if (m.username) existing.username = m.username;
            if (m.avatar_url) existing.avatar_url = m.avatar_url;
          }
        }
        if (isUnreadUser) {
          existing.unread_count += 1;
        }
      }
    }

    return Array.from(convMap.values()).sort(
      (a, b) => new Date(b.last_timestamp).getTime() - new Date(a.last_timestamp).getTime()
    );
  },

  async getDevMessages(userId: string): Promise<DevMessage[]> {
    const uid = String(userId);
    let remote: DevMessage[] = [];
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from("dev_messages")
          .select("*")
          .eq("user_id", uid)
          .order("created_at", { ascending: true });
        if (data && !error) remote = data;
      } catch {
        // fallback
      }
    }

    const db = readLocalDb();
    const map = new Map<string, DevMessage>();
    for (const m of remote) map.set(m.id, m);
    for (const m of db.dev_messages || []) {
      if (String(m.user_id) === uid && !map.has(m.id)) {
        map.set(m.id, m);
      }
    }

    return Array.from(map.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  },

  async postDevMessage(msg: {
    user_id: string;
    username: string;
    display_name?: string;
    avatar_url?: string;
    sender_type: "user" | "dev";
    message: string;
  }): Promise<{ success: boolean; data?: DevMessage; blocked?: boolean; error?: string }> {
    const rawText = (msg.message || "").trim();
    if (!rawText) {
      return { success: false, error: "Message cannot be empty." };
    }

    // Check blacklist if user is sender
    if (msg.sender_type === "user") {
      const words = await this.getBlacklistWords();
      const lower = rawText.toLowerCase();
      if (words.some((w) => lower.includes(w))) {
        return { success: false, blocked: true, error: "Message contains prohibited language and was blocked." };
      }
    }

    const uid = String(msg.user_id);
    const isDev = msg.sender_type === "dev";
    const record: DevMessage = {
      id: crypto.randomUUID(),
      user_id: uid,
      username: isDev ? "Admin / Dev" : (msg.username || "Player"),
      display_name: isDev ? "Admin / Dev" : (msg.display_name || msg.username || "Player"),
      avatar_url: msg.avatar_url || (uid && uid !== "0"
        ? `/api/roblox/avatar?userId=${uid}`
        : `/api/roblox/avatar?username=${encodeURIComponent(msg.username || "")}`),
      sender_type: msg.sender_type,
      message: rawText,
      read: false, // unread until the recipient (admin or player) reads it
      created_at: new Date().toISOString(),
    };

    const db = readLocalDb();
    if (!db.dev_messages) db.dev_messages = [];
    db.dev_messages.push(record);
    writeLocalDb(db);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("dev_messages").insert([record]);
      } catch {
        // fallback
      }
    }

    return { success: true, data: record };
  },

  async markDevMessagesRead(userId: string, reader: "admin" | "player" | "all" = "admin"): Promise<boolean> {
    const uid = String(userId);
    const targetSender = reader === "admin" ? "user" : (reader === "player" ? "dev" : null);
    const db = readLocalDb();
    if (db.dev_messages) {
      for (const m of db.dev_messages) {
        if (String(m.user_id) === uid && (!targetSender || m.sender_type === targetSender)) {
          m.read = true;
        }
      }
      writeLocalDb(db);
    }

    if (isSupabaseConfigured && supabase) {
      try {
        let query = supabase.from("dev_messages").update({ read: true }).eq("user_id", uid);
        if (targetSender) {
          query = query.eq("sender_type", targetSender);
        }
        await query;
      } catch {
        // fallback
      }
    }
    return true;
  },
  // Auth Probe Tokens (Pre-Flight Gatekeeper)
  async createProbeToken(data: {
    script_slug: string;
    ip_address: string;
    hwid?: string | null;
    challenge_seed: string;
    expires_in_sec?: number;
  }): Promise<string> {
    const token = "gpt_" + crypto.randomUUID().replace(/-/g, "") + "_" + Date.now().toString(36);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (data.expires_in_sec || 120) * 1000).toISOString();

    const record = {
      token,
      script_slug: data.script_slug.toLowerCase(),
      ip_address: normalizeIp(data.ip_address),
      hwid: data.hwid || null,
      challenge_seed: data.challenge_seed,
      is_used: false,
      expires_at: expiresAt,
      created_at: now.toISOString(),
    };

    probeTokenCache.set(token, record);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from("auth_probe_tokens").insert(record);
      } catch (err) {
        console.warn("Supabase auth_probe_tokens insert skipped/failed:", err);
      }
    }

    return token;
  },

  async verifyAndConsumeProbeToken(
    token: string,
    script_slug: string,
    ip_address: string
  ): Promise<{ valid: boolean; reason?: string }> {
    if (!token || typeof token !== "string") {
      return { valid: false, reason: "Missing Gateway Access Token. Pre-flight verification required." };
    }

    const normIp = normalizeIp(ip_address);
    const normSlug = script_slug.toLowerCase();
    const nowTime = Date.now();

    const cached = probeTokenCache.get(token);
    if (cached) {
      if (cached.is_used) {
        return { valid: false, reason: "Gateway Access Token has already been consumed (single-use)." };
      }
      if (new Date(cached.expires_at).getTime() < nowTime) {
        probeTokenCache.delete(token);
        return { valid: false, reason: "Gateway Access Token expired." };
      }
      if (cached.script_slug !== normSlug) {
        return { valid: false, reason: "Gateway Access Token was issued for a different script." };
      }
      if (cached.ip_address !== normIp && normIp !== "127.0.0.1" && cached.ip_address !== "127.0.0.1") {
        return { valid: false, reason: "Gateway Access Token IP mismatch." };
      }

      cached.is_used = true;
      if (isSupabaseConfigured && supabase) {
        try {
          await supabase.from("auth_probe_tokens").update({ is_used: true }).eq("token", token);
        } catch {
          // ignore
        }
      }
      return { valid: true };
    }

    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from("auth_probe_tokens")
          .select("*")
          .eq("token", token)
          .maybeSingle();

        if (data && !error) {
          if (data.is_used) {
            return { valid: false, reason: "Gateway Access Token has already been consumed." };
          }
          if (new Date(data.expires_at).getTime() < nowTime) {
            return { valid: false, reason: "Gateway Access Token expired." };
          }
          if (data.script_slug !== normSlug) {
            return { valid: false, reason: "Gateway Access Token script slug mismatch." };
          }
          await supabase.from("auth_probe_tokens").update({ is_used: true }).eq("token", token);
          return { valid: true };
        }
      } catch (err) {
        console.error("Supabase probe token check error:", err);
      }
    }

    return { valid: false, reason: "Invalid or unrecognized Gateway Access Token." };
  },

};
