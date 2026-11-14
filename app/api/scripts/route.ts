// app/api/scripts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/store";
import { isAuthenticated } from "@/lib/auth";
import { adminAlert } from "@/lib/alerts";
import { obfuscateLuauVM, bundleModules, verifyLuauBytecode } from "@/lib/obfuscator";

export async function GET() {
  const authed = (await isAuthenticated());
  // Public callers only ever see a handful of metadata fields, so don't load every script's
  // multi-MB payload columns for them (this endpoint is unauthenticated and was a DoS amplifier).
  const scripts = authed ? await dbService.getScripts() : await dbService.getScriptsLite();
  if (!authed) {
    const publicScripts = scripts
      .filter((s) => s.is_active !== false)
      .map(({ id, name, slug, is_active, use_auth, watermark_text, created_at }) => ({
        id,
        name,
        slug,
        is_active,
        use_auth,
        watermark_text,
        created_at,
      }));
    return NextResponse.json({ scripts: publicScripts });
  }
  return NextResponse.json({ scripts });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized. Admin session required." }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, slug, entry_file, modules, loader_config_id, watermark_text, show_watermark } = body;

    if (!name || !entry_file) {
      return NextResponse.json({ error: "Script name and entry_file are required." }, { status: 400 });
    }

    let cleanSlug = (slug || name.toLowerCase().replace(/[^a-z0-9_-]/g, "-")).trim();

    // If updating an existing script by id, lock the slug so loadstring NEVER resets
    if (body.id) {
      const allScripts = await dbService.getScripts();
      const existing = allScripts.find((s) => s.id === body.id);
      if (existing && existing.slug) {
        cleanSlug = existing.slug;
      }
    }

    let validConfigId = null;
    if (loader_config_id && typeof loader_config_id === "string" && loader_config_id.trim().length > 0) {
      const trimmed = loader_config_id.trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
      if (isUuid) validConfigId = trimmed;
    }

    // Bundle and automatically obfuscate with AtomProtect VM
    let bundledCode: string;
    const targetModules = modules || {};
    if (Object.keys(targetModules).length === 1 && (targetModules[entry_file] || Object.values(targetModules)[0])) {
      bundledCode = targetModules[entry_file] || (Object.values(targetModules)[0] as string);
    } else {
      bundledCode = bundleModules({
        entryFile: entry_file,
        files: targetModules,
      });
    }

    const vmPreset = (body.preset === "maximum" || body.preset === "ultra") ? body.preset : "balanced";
    const obfResult = await obfuscateLuauVM(bundledCode, { preset: vmPreset });
    if (!obfResult.ok) {
      return NextResponse.json({ error: `Obfuscation failed: ${obfResult.error}` }, { status: 422 });
    }

    const verifyCheck = verifyLuauBytecode(obfResult.output);
    if (!verifyCheck.ok) {
      return NextResponse.json({ error: `Luau Bytecode Syntax Verification Failed: ${verifyCheck.error}` }, { status: 422 });
    }

    const rawSizeBytes = Buffer.byteLength(bundledCode, "utf8");
    const outSizeBytes = Buffer.byteLength(obfResult.output, "utf8");
    const stats = {
      inputSize: rawSizeBytes,
      outputSize: outSizeBytes,
      time: obfResult.stats?.time || 0,
      expansionRatio: Number((outSizeBytes / Math.max(1, rawSizeBytes)).toFixed(2)),
      preset: vmPreset,
      layers: obfResult.stats?.layers || [],
    };

    const script = await dbService.saveScript({
      id: body.id || undefined,
      name,
      slug: cleanSlug,
      entry_file,
      modules: targetModules,
      loader_config_id: validConfigId,
      watermark_text: watermark_text || name,
      show_watermark: show_watermark !== false,
      is_active: true,
      use_auth: body.use_auth !== false,
      is_maintenance: body.is_maintenance === true,
      maintenance_message: body.maintenance_message || null,
      github_repo: body.github_repo || null,
      github_branch: body.github_branch || 'main',
      github_directory: body.github_directory || '',
      github_token: body.github_token || null,
      github_auto_pull: body.github_auto_pull === true,
      github_last_commit: body.github_last_commit || null,
      github_last_pulled_at: body.github_last_pulled_at || null,
      is_obfuscated: true,
      obfuscated_at: new Date().toISOString(),
      obfuscation_stats: stats,
      vm_preset: vmPreset,
    });

    await dbService.saveProtectedPayload(cleanSlug, obfResult.output, stats);
    await dbService.snapshotScript(cleanSlug, body.id ? "Updated" : "Created");
    void dbService.audit(body.id ? "scripts.update" : "scripts.create", { target: script.id, details: { slug: cleanSlug, preset: vmPreset } });

    return NextResponse.json({ success: true, script, stats });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Error saving script";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized. Admin session required." }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, slug, file_path, file_content, entry_file, modules, action, delete_file } = body;

    if (!id && !slug) {
      return NextResponse.json({ error: "Missing script id or slug" }, { status: 400 });
    }

    const allScripts = await dbService.getScripts();
    const existing = allScripts.find((s) => (id && s.id === id) || (slug && s.slug === slug));

    if (!existing) {
      return NextResponse.json({ error: "Script not found" }, { status: 404 });
    }

    const updatedModules: Record<string, string> = { ...(existing.modules || {}) };

    // Action 1: Delete file
    if (action === "delete_file" || delete_file) {
      const toDelete = delete_file || file_path;
      if (toDelete && updatedModules[toDelete] !== undefined) {
        delete updatedModules[toDelete];
      }
    }
    // Action 2: Update single file
    else if (file_path && file_content !== undefined) {
      updatedModules[file_path] = file_content;
    }
    // Action 3: Bulk replace modules
    else if (modules && typeof modules === "object") {
      Object.assign(updatedModules, modules);
    }

    let targetEntryFile = existing.entry_file;
    if (entry_file) {
      targetEntryFile = entry_file;
    } else if (!updatedModules[targetEntryFile]) {
      targetEntryFile = Object.keys(updatedModules)[0] || "init.lua";
    }

    // If modules or files changed, automatically re-bundle and re-obfuscate
    let reobfStats = existing.obfuscation_stats;
    if (body.modules || body.file_content || body.action === "obfuscate") {
      try {
        let bundledCode: string;
        if (Object.keys(updatedModules).length === 1 && (updatedModules[targetEntryFile] || Object.values(updatedModules)[0])) {
          bundledCode = updatedModules[targetEntryFile] || (Object.values(updatedModules)[0] as string);
        } else {
          bundledCode = bundleModules({ entryFile: targetEntryFile, files: updatedModules });
        }
        const requestedPreset = body.preset || existing.vm_preset;
        const vmPreset =
          requestedPreset === "maximum" || requestedPreset === "ultra" || requestedPreset === "debug"
            ? requestedPreset
            : "balanced";
        const obfResult = await obfuscateLuauVM(bundledCode, { preset: vmPreset });
        if (obfResult.ok) {
          const verifyCheck = verifyLuauBytecode(obfResult.output);
          if (verifyCheck.ok) {
            const rawBytes = Buffer.byteLength(bundledCode, "utf8");
            const outBytes = Buffer.byteLength(obfResult.output, "utf8");
            reobfStats = {
              inputSize: rawBytes,
              outputSize: outBytes,
              time: obfResult.stats?.time || 0,
              expansionRatio: Number((outBytes / Math.max(1, rawBytes)).toFixed(2)),
              preset: vmPreset,
              layers: obfResult.stats?.layers || [],
            };
            await dbService.saveProtectedPayload(existing.slug, obfResult.output, reobfStats);
          }
        }
      } catch (obfErr) {
        console.error("Re-obfuscation error on PATCH:", obfErr);
      }
    }

    // Save and ALWAYS lock slug so the loadstring is never reset
    const updatedScript = await dbService.saveScript({
      ...existing,
      id: existing.id,
      slug: existing.slug, // 100% locked & preserved
      name: body.name || existing.name,
      entry_file: targetEntryFile,
      modules: updatedModules,
      loader_config_id: body.loader_config_id !== undefined ? body.loader_config_id : existing.loader_config_id,
      watermark_text: body.watermark_text !== undefined ? body.watermark_text : existing.watermark_text,
      show_watermark: body.show_watermark !== undefined ? body.show_watermark : existing.show_watermark,
      is_active: body.is_active !== undefined ? body.is_active : existing.is_active,
      use_auth: body.use_auth !== undefined ? body.use_auth : existing.use_auth,
      is_maintenance: body.is_maintenance !== undefined ? body.is_maintenance : existing.is_maintenance,
      maintenance_message: body.maintenance_message !== undefined ? body.maintenance_message : existing.maintenance_message,
      github_repo: body.github_repo !== undefined ? body.github_repo : existing.github_repo,
      github_branch: body.github_branch !== undefined ? body.github_branch : existing.github_branch,
      github_directory: body.github_directory !== undefined ? body.github_directory : existing.github_directory,
      github_token: body.github_token !== undefined ? body.github_token : existing.github_token,
      github_auto_pull: body.github_auto_pull !== undefined ? body.github_auto_pull : existing.github_auto_pull,
      github_last_commit: body.github_last_commit !== undefined ? body.github_last_commit : existing.github_last_commit,
      github_last_pulled_at: body.github_last_pulled_at !== undefined ? body.github_last_pulled_at : existing.github_last_pulled_at,
      is_obfuscated: true,
      obfuscated_at: new Date().toISOString(),
      obfuscation_stats: reobfStats,
      vm_preset: body.preset || existing.vm_preset || "balanced",
    });

    if (body.modules || body.file_content || body.action === "obfuscate" || action === "delete_file" || delete_file) {
      await dbService.snapshotScript(updatedScript.slug, file_path ? `Edited ${String(file_path).slice(0, 80)}` : "Updated");
    }
    void dbService.audit("scripts.update", { target: updatedScript.id, details: { slug: updatedScript.slug } });
    return NextResponse.json({
      success: true,
      script: updatedScript,
      message: `Updated without resetting loadstring (/${updatedScript.slug}).`,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Error updating script";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized. Admin session required." }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing script id" }, { status: 400 });

    await dbService.deleteScript(id);
    void dbService.audit("scripts.delete", { target: id });
    void adminAlert("script_deleted", "Script deleted", { "Script ID": id }, { dedupKey: id, windowSec: 60 });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Error deleting script";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
