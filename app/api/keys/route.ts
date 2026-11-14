// app/api/keys/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/store";
import { isAuthenticated } from "@/lib/auth";

import crypto from "crypto";

function generateRandomKey(prefix = "KEY"): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const cleanPrefix = (prefix || "KEY").toUpperCase().trim().replace(/[^A-Z0-9_-]/g, "");
  const getChunk = (len: number) => {
    const bytes = crypto.randomBytes(len);
    let chunk = "";
    for (let i = 0; i < len; i++) {
      chunk += chars[bytes[i] % chars.length];
    }
    return chunk;
  };
  return `${cleanPrefix}-${getChunk(4)}-${getChunk(4)}-${getChunk(4)}`;
}

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized. Admin session required." }, { status: 401 });
  }
  // Automatically purge any expired keys from the pool
  await dbService.purgeExpiredKeys();
  const [rawKeys, bannedIps, recentIps] = await Promise.all([
    dbService.getKeys(),
    dbService.getBannedIps(),
    dbService.getRecentKeyIps(24),
  ]);
  // Attach the 24h IP/country history and a sharing flag (same thresholds as the Discord alert).
  const keys = rawKeys.map((k) => {
    const h = recentIps[k.id];
    const ips24h = h?.ips.length || 0;
    const countries24h = h?.countries.length || 0;
    return {
      ...k,
      ips_24h: h?.ips || [],
      countries_24h: h?.countries || [],
      sharing_flag: ips24h >= 3 || countries24h >= 2,
    };
  });
  return NextResponse.json({ keys, banned_ips: bannedIps });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized. Admin session required." }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      count = 1,
      prefix = "KEY",
      script_id = "",
      duration_hours = null,
      is_staff_review = false,
      custom_key = "",
      notes = "",
    } = body;

    // Must match the database CHECK constraint, otherwise the insert fails silently and the
    // dashboard would show a key that doesn't exist.
    if (custom_key && !/^[A-Za-z0-9_-]{6,64}$/.test(String(custom_key).trim())) {
      return NextResponse.json(
        { error: "Custom key must be 6–64 characters: letters, numbers, '-' or '_'." },
        { status: 400 }
      );
    }

    if (is_staff_review) {
      const staffKeyString =
        custom_key && custom_key.trim()
          ? custom_key.trim().toUpperCase()
          : generateRandomKey(prefix && prefix !== "KEY" ? prefix : "STAFF-REV");

      const created = await dbService.createKeys([
        {
          key_string: staffKeyString,
          script_id: script_id || "all",
          duration_hours: null,
          is_staff_review: true,
          status: "active",
          claimed_discord_tag: "STAFF_REVIEW",
          claimed_discord_id: "STAFF_REVIEW",
          notes: notes && notes.trim() ? notes.trim() : "Staff Review Key",
        },
      ]);

      return NextResponse.json({ success: true, count: 1, keys: created });
    }

    const numKeys = Math.min(Math.max(1, Number(count)), 100);
    const generatedList = [];

    for (let i = 0; i < numKeys; i++) {
      generatedList.push({
        key_string: generateRandomKey(prefix),
        script_id,
        duration_hours: duration_hours ? Number(duration_hours) : null,
        notes: notes && notes.trim() ? notes.trim() : null,
      });
    }

    const created = await dbService.createKeys(generatedList);
    void dbService.audit("keys.create", { details: { count: created.length, script_id: script_id || "all" } });
    return NextResponse.json({ success: true, count: created.length, keys: created });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Error generating keys";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized. Admin session required." }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, status, notes, action } = body;
    if (!id) return NextResponse.json({ error: "Missing key id" }, { status: 400 });

    // Admin device reset: no cooldown.
    if (action === "reset_hwid") {
      const res = await dbService.resetKeyHwid(String(id), 0);
      if (!res.ok) {
        return NextResponse.json(
          { error: res.reason === "unsupported" ? "Run migration 002 first." : "Key not found." },
          { status: 400 }
        );
      }
      void dbService.audit("keys.hwid_reset_admin", { target: String(id) });
      return NextResponse.json({ success: true });
    }

    if (status) {
      // Only the four valid states are accepted (the DB also enforces this with a CHECK constraint).
      if (!["unclaimed", "claimed", "active", "banned"].includes(status)) {
        return NextResponse.json({ error: "Invalid key status." }, { status: 400 });
      }
      await dbService.updateKeyStatus(id, status);
      void dbService.audit("keys.status", { target: id, details: { status } });
    }
    if (notes !== undefined) {
      await dbService.updateKeyNotes(id, notes && notes.trim() ? notes.trim() : null);
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Error updating key";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized. Admin session required." }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    if (action === "purge_expired") {
      const purgedCount = await dbService.purgeExpiredKeys();
      return NextResponse.json({ success: true, purged: purgedCount });
    }

    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    await dbService.deleteKey(id);
    void dbService.audit("keys.delete", { target: id });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Error deleting key";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
