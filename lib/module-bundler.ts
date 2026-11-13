// lib/module-bundler.ts
// Secure Virtual File System and Dynamic Modular Streaming Engine for Luau scripts
import { obfuscateLuau } from "@/lib/obfuscator";

export interface ModuleBundle {
  entryFile: string;
  files: Record<string, string>;
  dynamicStreaming?: boolean;
  slug?: string;
  sessionToken?: string;
  baseUrl?: string;
  key?: string;
  obfuscate?: boolean;
}

/**
 * Packs multiple Lua files into a self-contained runtime bundle with an in-memory virtual `require` environment.
 * Supports Zero-Knowledge Dynamic Streaming (fetching modules just-in-time over authenticated sessions).
 */
export function bundleModularScript(bundle: ModuleBundle): string {
  const {
    entryFile,
    files,
    dynamicStreaming = false,
    slug = "",
    sessionToken = "",
    baseUrl = "",
    key = "",
    obfuscate = true,
  } = bundle;

  // Normalize entry file lookup
  const cleanEntry = entryFile.replace(/\\/g, "/");
  const entryBase = cleanEntry.split("/").pop() || cleanEntry;
  const entryContent =
    files[entryFile] ||
    files[cleanEntry] ||
    files[entryBase] ||
    files["init.lua"] ||
    files["main.lua"] ||
    Object.values(files)[0] ||
    "";

  // Prepare modules table with shared function pointers (prevents duplicate compilation and saves memory)
  const moduleDefs: string[] = [];
  const moduleRegistrations: string[] = [];
  const registeredKeys = new Set<string>();
  const contentToVarMap = new Map<string, string>();
  let modIdx = 0;

  for (const [filePath, content] of Object.entries(files)) {
    if (filePath === entryFile || filePath === cleanEntry) continue;

    const cleanKey = filePath.replace(/\\/g, "/");
    const keyWithoutExt = cleanKey.replace(/\.(lua|txt)$/i, "");
    const baseName = cleanKey.split("/").pop() || cleanKey;
    const baseNameWithoutExt = baseName.replace(/\.(lua|txt)$/i, "");

    let modVar = contentToVarMap.get(content);
    if (!modVar) {
      modVar = `__mod_${modIdx++}`;
      contentToVarMap.set(content, modVar);
      moduleDefs.push(`local ${modVar} = function()\n${content}\nend\n`);
    }

    const registerKey = (k: string) => {
      if (!registeredKeys.has(k)) {
        registeredKeys.add(k);
        moduleRegistrations.push(`__VFS_MODULES["${k}"] = ${modVar}`);
      }
    };

    registerKey(cleanKey);
    registerKey(keyWithoutExt);
    registerKey(keyWithoutExt + ".lua");
    registerKey(keyWithoutExt + ".txt");
    registerKey(baseName);
    registerKey(baseNameWithoutExt);
    registerKey(baseNameWithoutExt + ".lua");
    registerKey(baseNameWithoutExt + ".txt");

    // Handle features / fetaures typo alias
    if (baseNameWithoutExt === "fetaures") {
      registerKey("features");
      registerKey("features.lua");
      registerKey("features.txt");
    } else if (baseNameWithoutExt === "features") {
      registerKey("fetaures");
      registerKey("fetaures.lua");
      registerKey("fetaures.txt");
    }
  }

  const streamingRequireLogic = dynamicStreaming && slug && sessionToken
    ? `
    -- Dynamic Just-In-Time Module Streamer
    local _streamBase = "${baseUrl}/api/loader/${slug}/"
    local _sessionToken = "${sessionToken}"
    local _licenseKey = "${encodeURIComponent(key)}"
    local _http = nil
    if type(syn) == "table" and type(syn.request) == "function" then
        _http = syn.request
    elseif type(http) == "table" and type(http.request) == "function" then
        _http = http.request
    elseif type(http_request) == "function" then
        _http = http_request
    elseif type(request) == "function" then
        _http = request
    elseif type(fluxus) == "table" and type(fluxus.request) == "function" then
        _http = fluxus.request
    end
    
    if type(_http) == "function" then
        local _cleanMod = normalized:gsub("%.lua$", ""):gsub("%.txt$", "")
        local _targetUrl = _streamBase .. _cleanMod .. ".lua?session=" .. _sessionToken .. "&key=" .. _licenseKey
        local _res = nil
        pcall(function()
            _res = _http({
                Url = _targetUrl,
                Method = "GET",
                Headers = { ["User-Agent"] = "Roblox/WinInet" }
            })
        end)
        local _statusCode = (_res and (_res.StatusCode or _res.Status or _res.status_code or _res.status)) or 0
        local _bodyStr = (_res and (_res.Body or _res.body)) or ""
        
        -- If .lua fails, try .txt
        if (_statusCode ~= 200 or _bodyStr:find("Error:")) and _cleanMod then
            local _altUrl = _streamBase .. _cleanMod .. ".txt?session=" .. _sessionToken .. "&key=" .. _licenseKey
            pcall(function()
                local _resAlt = _http({ Url = _altUrl, Method = "GET", Headers = { ["User-Agent"] = "Roblox/WinInet" } })
                if _resAlt and (_resAlt.StatusCode == 200 or _resAlt.Status == 200) and _resAlt.Body and not _resAlt.Body:find("Error:") then
                    _res = _resAlt
                    _statusCode = 200
                    _bodyStr = _resAlt.Body
                end
            end)
        end

        if _statusCode == 200 and _bodyStr ~= "" and not _bodyStr:find("Error:") then
            local _fn, _err = nil, nil
            pcall(function()
                if type(loadstring) == "function" then
                    _fn, _err = loadstring(_bodyStr)
                end
            end)
            _bodyStr = nil
            if type(_fn) == "function" then
                local _ok, _dynResult = pcall(_fn)
                if _ok then
                    if _dynResult == nil then _dynResult = true end
                    __VFS_CACHE[normalized] = _dynResult
                    __VFS_CACHE[_cleanMod] = _dynResult
                    return _dynResult
                end
            end
        end
    end`
    : "";

  const assembledBundle = `--[[
  =======================================================
  ATOMPROTECT SECURE VIRTUAL MODULE RUNTIME
  Protected In-Memory Virtual File System
  =======================================================
]]--
local __VFS_MODULES = {}
${moduleDefs.join("\n")}
${moduleRegistrations.join("\n")}

local __VFS_CACHE = {}

-- Virtual require hook
local original_require = require
local function __vfs_require(moduleName)
    local normalized = tostring(moduleName):gsub(string.char(92), "/")
    local cleanMod = normalized:gsub("%.lua$", ""):gsub("%.txt$", "")

    if __VFS_CACHE[normalized] then
        return __VFS_CACHE[normalized]
    end
    if __VFS_CACHE[cleanMod] then
        return __VFS_CACHE[cleanMod]
    end

    local loader = __VFS_MODULES[normalized] 
        or __VFS_MODULES[cleanMod] 
        or __VFS_MODULES[cleanMod .. ".lua"] 
        or __VFS_MODULES[cleanMod .. ".txt"]
        or (cleanMod == "features" and (__VFS_MODULES["fetaures"] or __VFS_MODULES["fetaures.txt"] or __VFS_MODULES["fetaures.lua"]))
        or (cleanMod == "fetaures" and (__VFS_MODULES["features"] or __VFS_MODULES["features.txt"] or __VFS_MODULES["features.lua"]))

    if loader then
        local result = loader()
        if result == nil then result = true end
        __VFS_CACHE[normalized] = result
        __VFS_CACHE[cleanMod] = result
        return result
    end
${streamingRequireLogic}
    -- Fallback to standard require for non-string (e.g. Instance/asset ID)
    if original_require and type(moduleName) ~= "string" then
        return original_require(moduleName)
    end
    error("[AtomProtect VFS] Module not found in virtual registry: " .. tostring(moduleName))
end

-- Inject __vfs_require into environment
local env = (getfenv and getfenv()) or _G
pcall(function() env.require = __vfs_require end)
pcall(function() _G.require = __vfs_require end)
local require = __vfs_require

-- =======================================================
-- ENTRY SCRIPT EXECUTION (${entryFile})
-- =======================================================
do
${entryContent}
end
`;

  if (obfuscate) {
    try {
      // Safe, verified Luau obfuscation (string virtualization + invariants, zero ambiguous syntax)
      return obfuscateLuau(assembledBundle, {
        encryptStrings: true,
        mangleNumbers: false,
        stripComments: true,
        injectOpaquePredicates: true,
        mangleIdentifiers: false, // Keep identifiers clean for giant modules to ensure property compatibility
      });
    } catch {
      return assembledBundle;
    }
  }

  return assembledBundle;
}
