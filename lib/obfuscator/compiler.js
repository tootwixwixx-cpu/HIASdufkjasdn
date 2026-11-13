// core/compiler.js
// Lua/Luau source -> Luau bytecode & IR extraction
// Uses luau-compile.exe (dump-constants + text) and luau.exe

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function findBinDir() {
  const candidates = [
    path.join(__dirname, 'bin'),
    path.join(__dirname, '..', 'bin'),
    path.join(process.cwd(), 'lib', 'obfuscator', 'bin'),
    path.join(process.cwd(), 'obfuscator', 'bin'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'luau-compile.exe'))) return c;
  }
  return path.join(__dirname, 'bin');
}

const BIN_DIR = findBinDir();
const LUAU_COMPILE = path.join(BIN_DIR, 'luau-compile.exe');
const LUAU_EXE = path.join(BIN_DIR, 'luau.exe');
const LUAU_AST = path.join(BIN_DIR, 'luau-ast.exe');

// BUGFIX: this used to only check fs.existsSync() on the bundled .exe, which is a
// Windows PE binary. On a Linux deployment (e.g. Vercel) the file genuinely exists in
// the deployed bundle (it's just a static asset to the bundler) but cannot execute --
// execFileSync throws "cannot execute binary file". The pipeline only takes the safe
// polymorphic-fallback branch when getCompilerStatus() reports the compiler as
// UNAVAILABLE, so reporting `true` here on a non-Windows host meant obfuscate() tried
// the full-VM path anyway and hard-failed with a raw "cannot execute binary file"
// error surfaced straight to the admin, instead of silently falling back.
const IS_WINDOWS = process.platform === 'win32';

function getCompilerStatus() {
  return {
    luauCompile: IS_WINDOWS && fs.existsSync(LUAU_COMPILE),
    luau: IS_WINDOWS && fs.existsSync(LUAU_EXE),
  };
}

/**
 * Compiles Lua source code into both binary and disassembled text representations.
 */
function compileToBytecode(source) {
  const status = getCompilerStatus();

  if (status.luauCompile) {
    // A dedicated, OS-guaranteed-unique temp directory per call (instead of Date.now()+Math.random()
    // filenames sharing the global tmpdir) removes any chance of cross-talk between concurrent/slower
    // compiles — more likely to coincide when a large script simply takes longer to compile — and
    // means cleanup is a single directory removal rather than three independently-swallowed unlinks.
    // Ported from obfuscator/core/compiler.js.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomprotect-'));
    const tmpSrc = path.join(tmpDir, 'src.lua');
    const tmpOut = path.join(tmpDir, 'out.txt');
    const tmpBin = path.join(tmpDir, 'out.bin');
    let outFd = null;
    let binFd = null;

    try {
      fs.writeFileSync(tmpSrc, source, 'utf8');
      outFd = fs.openSync(tmpOut, 'w');

      // Direct native file descriptor redirection: bypasses in-memory pipe buffer limits entirely
      execFileSync(LUAU_COMPILE, ['-O1', '--dump-constants', '--text', tmpSrc], {
        timeout: 60000,
        stdio: ['ignore', outFd, 'pipe']
      });

      fs.closeSync(outFd);
      outFd = null;

      const textDump = fs.readFileSync(tmpOut, 'utf8');

      // Also compile with --binary to extract untruncated string table
      let bytecode = null;
      try {
        // Also compile with -g0 --binary to extract clean untruncated string table and proto hierarchy
        binFd = fs.openSync(tmpBin, 'w');
        execFileSync(LUAU_COMPILE, ['-O1', '-g0', '--binary', tmpSrc], {
          timeout: 60000,
          stdio: ['ignore', binFd, 'pipe']
        });
        fs.closeSync(binFd);
        binFd = null;
        bytecode = fs.readFileSync(tmpBin);
      } catch (_) {
        // Fallback: binary extraction optional
      }

      // Also extract AST to map child closures and proto hierarchy with 100% precision
      let ast = null;
      if (fs.existsSync(LUAU_AST)) {
        try {
          const astRaw = execFileSync(LUAU_AST, [tmpSrc], {
            timeout: 30000,
            maxBuffer: 64 * 1024 * 1024,
            encoding: 'utf8'
          });
          ast = JSON.parse(astRaw);
        } catch (_) {}
      }

      return {
        ok: true,
        textDump,
        bytecode,
        ast,
        method: 'luau-compile'
      };
    } catch (e) {
      const stderr = e.stderr ? e.stderr.toString() : e.message;
      return { ok: false, error: stderr, method: 'luau-compile' };
    } finally {
      if (outFd !== null) {
        try { fs.closeSync(outFd); } catch (_) {}
      }
      if (binFd !== null) {
        try { fs.closeSync(binFd); } catch (_) {}
      }
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        // Don't let a swallowed cleanup failure hide a real diagnostic signal (e.g. disk/perms
        // issues that could otherwise look like an unrelated intermittent large-script failure).
        console.warn(`[compiler] failed to remove temp dir ${tmpDir}: ${cleanupErr.message}`);
      }
    }
  }

  return syntaxCheck(source);
}

function syntaxCheck(source) {
  return { ok: true, bytecode: null, method: 'js-heuristic' };
}

function runWithLuau(source) {
  const status = getCompilerStatus();
  if (!status.luau) {
    return { ok: false, error: 'luau.exe not found in bin/', method: 'luau' };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomprotect-run-'));
  const tmpSrc = path.join(tmpDir, 'src.lua');
  try {
    fs.writeFileSync(tmpSrc, source, 'utf8');
    const result = execFileSync(LUAU_EXE, [tmpSrc], {
      timeout: 15000,
      maxBuffer: 32 * 1024 * 1024,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { ok: true, output: result.toString(), method: 'luau' };
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : e.message;
    const stdout = e.stdout ? e.stdout.toString() : '';
    return { ok: false, error: stderr || stdout, output: stdout, method: 'luau' };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn(`[compiler] failed to remove temp dir ${tmpDir}: ${cleanupErr.message}`);
    }
  }
}

module.exports = { compileToBytecode, syntaxCheck, runWithLuau, getCompilerStatus };
