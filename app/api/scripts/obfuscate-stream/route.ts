// app/api/scripts/obfuscate-stream/route.ts
// Real-time SSE streaming route for AtomProtect Luau VM Obfuscation

import { NextRequest } from "next/server";
import { dbService } from "@/lib/store";
import { isAuthenticated } from "@/lib/auth";
import { obfuscateLuauVM, bundleModules, verifyLuauBytecode } from "@/lib/obfuscator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return new Response(JSON.stringify({ error: "Unauthorized. Admin session required." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const {
    name,
    slug,
    entry_file,
    modules,
    preset = "balanced",
    loader_config_id,
    watermark_text,
    show_watermark,
    use_auth = true,
    is_maintenance = false,
    maintenance_message,
    github_repo,
    github_branch = "main",
    github_directory = "",
    github_token,
    github_auto_pull = false,
  } = body;

  if (!name || !entry_file || !modules || Object.keys(modules).length === 0) {
    return new Response(
      JSON.stringify({ error: "Script name, entry_file, and at least one module are required." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const sendEvent = async (event: string, data: any) => {
    try {
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      await writer.write(encoder.encode(payload));
    } catch (_) {}
  };

  (async () => {
    const startTime = Date.now();
    try {
      let cleanSlug = (slug || name.toLowerCase().replace(/[^a-z0-9_-]/g, "-")).trim();

      // Lock slug if updating existing script
      if (body.id) {
        const allScripts = await dbService.getScripts();
        const existing = allScripts.find((s) => s.id === body.id);
        if (existing && existing.slug) {
          cleanSlug = existing.slug;
        }
      }

      await sendEvent("progress", {
        step: "bundling",
        percent: 10,
        message: `Bundling ${Object.keys(modules).length} modular file(s) into VFS...`,
      });

      // Step 1: Pack modular VFS
      let bundledCode: string;
      if (Object.keys(modules).length === 1 && (modules[entry_file] || Object.values(modules)[0])) {
        bundledCode = modules[entry_file] || Object.values(modules)[0];
      } else {
        bundledCode = bundleModules({
          entryFile: entry_file,
          files: modules,
        });
      }

      const rawSizeBytes = Buffer.byteLength(bundledCode, "utf8");

      // Step 2: Full VM Obfuscation
      const vmPreset = (preset === "maximum" || preset === "ultra" || preset === "debug") ? preset : "balanced";
      const obfResult = await obfuscateLuauVM(bundledCode, {
        preset: vmPreset,
        onProgress: (p: { step: string; percent: number; message: string }) => {
          sendEvent("progress", {
            step: p.step,
            percent: Math.min(90, Math.max(15, p.percent)),
            message: p.message,
          });
        },
      });

      if (!obfResult.ok) {
        throw new Error(obfResult.error || "VM Obfuscation failed");
      }

      // Step 3: Luau Compilation Verification
      await sendEvent("progress", {
        step: "verifying",
        percent: 92,
        message: "Validating protected bytecode with luau-compile.exe -O1...",
      });

      const verifyCheck = verifyLuauBytecode(obfResult.output);
      if (!verifyCheck.ok) {
        throw new Error(`Luau Bytecode Syntax Validation Failed: ${verifyCheck.error}`);
      }

      await sendEvent("progress", {
        step: "saving",
        percent: 98,
        message: "Saving protected artifact and database record...",
      });

      // Step 4: Persist DB record & disk artifact
      let validConfigId = null;
      if (loader_config_id && typeof loader_config_id === "string" && loader_config_id.trim().length > 0) {
        const trimmed = loader_config_id.trim();
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
        if (isUuid) validConfigId = trimmed;
      }

      const durTotal = ((Date.now() - startTime) / 1000).toFixed(2);
      const outSizeBytes = Buffer.byteLength(obfResult.output, "utf8");
      const expansionRatio = (outSizeBytes / Math.max(1, rawSizeBytes)).toFixed(2);

      const stats = {
        inputSize: rawSizeBytes,
        outputSize: outSizeBytes,
        time: Date.now() - startTime,
        expansionRatio: Number(expansionRatio),
        preset: vmPreset,
        layers: obfResult.stats?.layers || [],
      };

      const script = await dbService.saveScript({
        id: body.id || undefined,
        name,
        slug: cleanSlug,
        entry_file,
        modules,
        loader_config_id: validConfigId,
        watermark_text: watermark_text || name,
        show_watermark: show_watermark !== false,
        is_active: true,
        use_auth: use_auth !== false,
        is_maintenance: is_maintenance === true,
        maintenance_message: maintenance_message || null,
        github_repo: github_repo || null,
        github_branch: github_branch || "main",
        github_directory: github_directory || "",
        github_token: github_token || null,
        github_auto_pull: github_auto_pull === true,
        github_last_commit: body.github_last_commit || null,
        github_last_pulled_at: body.github_last_pulled_at || null,
        is_obfuscated: true,
        obfuscated_at: new Date().toISOString(),
        obfuscation_stats: stats,
        vm_preset: vmPreset,
      });

      await dbService.saveProtectedPayload(cleanSlug, obfResult.output, stats);

      const host = req.headers.get("host") || "localhost:3000";
      const proto = req.headers.get("x-forwarded-proto") || "http";
      const loadstring = `loadstring(game:HttpGet("${proto}://${host}/api/loader/${script.slug}"))()`;

      await sendEvent("complete", {
        success: true,
        script,
        loadstring,
        stats: {
          rawSize: `${(rawSizeBytes / 1024).toFixed(1)} KB`,
          protectedSize: `${(outSizeBytes / 1024).toFixed(1)} KB`,
          expansionRatio: `${expansionRatio}x`,
          duration: `${durTotal}s`,
          preset: vmPreset,
          layers: stats.layers,
        },
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await sendEvent("error", { error: errorMsg });
    } finally {
      try {
        await writer.close();
      } catch (_) {}
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
