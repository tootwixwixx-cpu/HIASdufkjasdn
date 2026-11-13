// lib/obfuscator/index.js
// CommonJS export bridge for Node and Next.js

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const { obfuscate: internalObfuscate } = require('./pipeline');
const { bundleModularScript: internalBundle } = require('./bundler');
const { getCompilerStatus: internalGetStatus } = require('./compiler');

async function obfuscateLuauVM(sourceCode, options = {}) {
  return await internalObfuscate(sourceCode, options);
}

function bundleModules(input) {
  const result = internalBundle(input);
  return typeof result === 'string' ? result : (result.code || '');
}

function verifyLuauBytecode(luaCode) {
  const candidates = [
    path.join(__dirname, 'bin', 'luau-compile.exe'),
    path.join(process.cwd(), 'lib', 'obfuscator', 'bin', 'luau-compile.exe'),
    path.join(process.cwd(), 'obfuscator', 'bin', 'luau-compile.exe'),
  ];
  const bin = candidates.find(p => fs.existsSync(p));
  if (!bin) return { ok: true };

  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const tmpFile = path.join(dataDir, `__verify_${Date.now()}_${Math.random().toString(36).slice(2)}.luau`);

  try {
    fs.writeFileSync(tmpFile, luaCode, 'utf8');
    execFileSync(bin, ['-O1', tmpFile], {
      timeout: 30000,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    return { ok: true };
  } catch (err) {
    const errorMsg = err.stderr ? err.stderr.toString() : err.message;
    return { ok: false, error: errorMsg };
  } finally {
    if (fs.existsSync(tmpFile)) {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
    }
  }
}

module.exports = {
  obfuscateLuauVM,
  bundleModules,
  verifyLuauBytecode,
  getCompilerStatus: internalGetStatus,
};
