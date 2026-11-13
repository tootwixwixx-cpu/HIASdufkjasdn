// core/bundler.js
// AtomProtect Multi-Module Virtual File System Bundler
// Packs multiple Lua/Luau module scripts into a unified in-memory runtime
// with a virtual filesystem, cached require hook, and seamless entry point invocation.

'use strict';

/**
 * Normalizes a file path to use forward slashes and removes leading slashes.
 * @param {string} p 
 * @returns {string}
 */
function normalizePath(p) {
  if (!p) return '';
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Packs multiple Lua files into a self-contained runtime bundle with an in-memory virtual `require` environment.
 * 
 * @param {Object} bundle
 * @param {string} bundle.entryFile - Filename or relative path of the entry module (e.g. "init.lua")
 * @param {Object.<string, string>} bundle.files - Map of relative paths/filenames to Lua file content
 * @param {Object} [bundle.options] - Optional configurations
 * @returns {string} Assembled single Lua script ready for compilation/obfuscation
 */
function bundleModularScript(bundle) {
  const { entryFile, files, options = {} } = bundle;

  if (!files || typeof files !== 'object' || Object.keys(files).length === 0) {
    throw new Error('No module files provided to bundle.');
  }

  if (!entryFile || typeof entryFile !== 'string') {
    throw new Error('Missing entryFile parameter specifying the main init module.');
  }

  // Normalize entry file lookup
  const cleanEntry = normalizePath(entryFile);
  const entryBase = cleanEntry.split('/').pop() || cleanEntry;

  // Locate the entry file content
  let entryContent = null;
  let resolvedEntryKey = null;

  const candidateEntryKeys = [
    entryFile,
    cleanEntry,
    entryBase,
    cleanEntry.toLowerCase(),
    entryBase.toLowerCase(),
    'init.lua',
    'init.luau',
    'main.lua',
    'main.luau'
  ];

  for (const cand of candidateEntryKeys) {
    for (const [k, v] of Object.entries(files)) {
      const normK = normalizePath(k);
      const baseK = normK.split('/').pop() || normK;
      if (k === cand || normK === cand || baseK === cand || normK.toLowerCase() === cand.toLowerCase() || baseK.toLowerCase() === cand.toLowerCase()) {
        entryContent = v;
        resolvedEntryKey = k;
        break;
      }
    }
    if (entryContent !== null) break;
  }

  if (entryContent === null) {
    // Fallback: pick the first file if user provided invalid name
    const firstKey = Object.keys(files)[0];
    entryContent = files[firstKey];
    resolvedEntryKey = firstKey;
  }

  // Prepare modules table with shared function pointers
  // Reusing identical content maps saves massive amounts of memory and prevents duplicate compilation
  const moduleDefs = [];
  const moduleRegistrations = [];
  const registeredKeys = new Set();
  const contentToVarMap = new Map();
  const contentToPathMap = new Map();
  const modulesMeta = [];
  let modIdx = 0;

  // Add entry module metadata
  modulesMeta.push({
    name: entryBase,
    relativePath: resolvedEntryKey,
    size: (entryContent || '').length,
    isEntry: true,
    modVar: 'ENTRY_POINT',
    isDeduplicated: false,
    duplicateOf: null,
    content: entryContent
  });

  const allFileKeys = Object.keys(files);
  let processedCount = 0;

  for (const [filePath, content] of Object.entries(files)) {
    processedCount++;
    // Skip the entry module as it is executed directly at the end of the bundle
    if (filePath === resolvedEntryKey) continue;
    const cleanKey = normalizePath(filePath);
    if (cleanKey === normalizePath(resolvedEntryKey)) continue;

    const baseName = cleanKey.split('/').pop() || cleanKey;
    const keyWithoutExt = cleanKey.replace(/\.(lua|luau|txt)$/i, '');
    const baseNameWithoutExt = baseName.replace(/\.(lua|luau|txt)$/i, '');

    const wasDeduplicated = contentToVarMap.has(content);
    let modVar = contentToVarMap.get(content);
    let duplicateOf = null;

    if (!modVar) {
      modVar = `__mod_${modIdx++}`;
      contentToVarMap.set(content, modVar);
      contentToPathMap.set(content, cleanKey);
      moduleDefs.push(`local ${modVar} = function(...)\n${content}\nend\n`);
    } else {
      duplicateOf = contentToPathMap.get(content);
    }

    modulesMeta.push({
      name: baseName,
      relativePath: cleanKey,
      size: (content || '').length,
      isEntry: false,
      modVar,
      isDeduplicated: wasDeduplicated,
      duplicateOf,
      content
    });

    if (typeof options.onProgress === 'function') {
      const pct = Math.round((processedCount / allFileKeys.length) * 20);
      options.onProgress({
        step: 'bundle_module',
        percent: pct,
        message: `Mounted module [${processedCount}/${allFileKeys.length}]: ${baseName}${wasDeduplicated ? ` (shared with ${duplicateOf})` : ''}`
      });
    }

    const registerKey = (k) => {
      if (!k) return;
      const keyNorm = normalizePath(k);
      if (!registeredKeys.has(keyNorm)) {
        registeredKeys.add(keyNorm);
        moduleRegistrations.push(`__VFS_MODULES[${JSON.stringify(keyNorm)}] = ${modVar}`);
      }
      // Also register lower-case for case-insensitive executors
      const lower = keyNorm.toLowerCase();
      if (!registeredKeys.has(lower)) {
        registeredKeys.add(lower);
        moduleRegistrations.push(`__VFS_MODULES[${JSON.stringify(lower)}] = ${modVar}`);
      }
    };

    // 1. Full relative path & base name variations
    registerKey(cleanKey);
    registerKey(keyWithoutExt);
    registerKey(keyWithoutExt + '.lua');
    registerKey(keyWithoutExt + '.luau');
    registerKey(keyWithoutExt + '.txt');

    registerKey(baseName);
    registerKey(baseNameWithoutExt);
    registerKey(baseNameWithoutExt + '.lua');
    registerKey(baseNameWithoutExt + '.luau');
    registerKey(baseNameWithoutExt + '.txt');

    // 2. Folder-prefixed aliases (Rivals/..., rivals/...)
    if (!cleanKey.toLowerCase().startsWith('rivals/')) {
      registerKey('Rivals/' + cleanKey);
      registerKey('rivals/' + cleanKey);
      registerKey('Rivals/' + baseName);
      registerKey('rivals/' + baseName);
      registerKey('Rivals/' + baseNameWithoutExt + '.lua');
      registerKey('rivals/' + baseNameWithoutExt + '.lua');
    }

    // 3. Typo compatibility (fetaures <-> features)
    if (baseNameWithoutExt === 'fetaures') {
      registerKey('features');
      registerKey('features.lua');
      registerKey('features.luau');
      registerKey('features.txt');
      registerKey('Rivals/features.lua');
      registerKey('rivals/features.lua');
    } else if (baseNameWithoutExt === 'features') {
      registerKey('fetaures');
      registerKey('fetaures.lua');
      registerKey('fetaures.luau');
      registerKey('fetaures.txt');
      registerKey('Rivals/fetaures.lua');
      registerKey('rivals/fetaures.lua');
    }
  }

  const assembledBundle = `--[[
  =======================================================
  ATOMPROTECT SECURE VIRTUAL MODULE RUNTIME
  Virtual File System & In-Memory Module Registry
  Entry Module: ${resolvedEntryKey}
  Bundled Modules: ${Object.keys(files).length}
  =======================================================
]]--
local __VFS_MODULES = {}
${moduleDefs.join('\n')}
${moduleRegistrations.join('\n')}

local __VFS_CACHE = {}

-- Virtual require hook
local original_require = require
local function __vfs_require(moduleName)
    local rawStr = tostring(moduleName)
    local normalized = rawStr:gsub(string.char(92), "/"):gsub("^/+", "")
    local cleanMod = normalized:gsub("%.luau$", ""):gsub("%.lua$", ""):gsub("%.txt$", "")
    local lowerNorm = normalized:lower()
    local lowerClean = cleanMod:lower()

    -- Check cache first
    if __VFS_CACHE[normalized] ~= nil then
        return __VFS_CACHE[normalized]
    end
    if __VFS_CACHE[cleanMod] ~= nil then
        return __VFS_CACHE[cleanMod]
    end
    if __VFS_CACHE[lowerNorm] ~= nil then
        return __VFS_CACHE[lowerNorm]
    end
    if __VFS_CACHE[lowerClean] ~= nil then
        return __VFS_CACHE[lowerClean]
    end

    -- Lookup in Virtual File System registry
    local loader = __VFS_MODULES[normalized]
        or __VFS_MODULES[cleanMod]
        or __VFS_MODULES[lowerNorm]
        or __VFS_MODULES[lowerClean]
        or __VFS_MODULES[cleanMod .. ".lua"]
        or __VFS_MODULES[cleanMod .. ".luau"]
        or __VFS_MODULES[cleanMod .. ".txt"]
        or __VFS_MODULES["Rivals/" .. cleanMod]
        or __VFS_MODULES["rivals/" .. cleanMod]
        or __VFS_MODULES["Rivals/" .. cleanMod .. ".lua"]
        or __VFS_MODULES["rivals/" .. cleanMod .. ".lua"]
        or (cleanMod == "features" and (__VFS_MODULES["fetaures"] or __VFS_MODULES["fetaures.lua"]))
        or (cleanMod == "fetaures" and (__VFS_MODULES["features"] or __VFS_MODULES["features.lua"]))

    if loader then
        local result = loader()
        if result == nil then result = true end
        __VFS_CACHE[normalized] = result
        __VFS_CACHE[cleanMod] = result
        __VFS_CACHE[lowerNorm] = result
        __VFS_CACHE[lowerClean] = result
        return result
    end

    -- Fallback to standard require for non-string or host game instances
    if original_require and type(moduleName) ~= "string" then
        return original_require(moduleName)
    end

    error("[AtomProtect VFS] Module not found in virtual registry: " .. rawStr)
end

-- Expose __VFS_MODULES and __vfs_require to both local scope and global environments
local _env = (getfenv and getfenv()) or _G
pcall(function() _env.__VFS_MODULES = __VFS_MODULES end)
pcall(function() _G.__VFS_MODULES = __VFS_MODULES end)
pcall(function() _env.require = __vfs_require end)
pcall(function() _G.require = __vfs_require end)
local require = __vfs_require

-- =======================================================
-- ENTRY SCRIPT EXECUTION (${resolvedEntryKey})
-- =======================================================
do
${entryContent}
end
`;

  if (options.returnDetails) {
    return {
      code: assembledBundle,
      entryKey: resolvedEntryKey,
      modules: modulesMeta,
      totalModules: Object.keys(files).length,
      totalSize: Object.values(files).reduce((a, b) => a + (b ? b.length : 0), 0)
    };
  }

  return assembledBundle;
}

module.exports = {
  bundleModularScript,
  normalizePath
};
