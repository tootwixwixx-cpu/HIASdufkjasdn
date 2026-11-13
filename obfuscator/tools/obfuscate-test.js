// tools/obfuscate-test.js
// Reusable local test driver for the AtomProtect pipeline. Replaces the pile of stale ad-hoc
// test_*.js/debug_*.js/inspect_*.js scripts that previously accumulated at the repo root and in bin/.
//
// Usage:
//   node tools/obfuscate-test.js <path-to-lua-file> [preset]
//
// preset is one of: standard (default) | maximum | ultra | debug
//
// What it does, in order (cheapest checks first, so a bad fix fails fast without touching the game):
//   1. Calls core/pipeline.js's obfuscate() directly (no HTTP server needed).
//   2. If ok:false, prints the pipeline's error and stops — does not write/execute anything.
//   3. On success, writes the obfuscated output to tools/out/<basename>.obf.lua and prints stats.
//   4. Shells out to bin/luau-compile.exe (--binary, output discarded) against the obfuscated output
//      for a fast local syntax/compile sanity check. Note: bin/luau-analyze.exe is NOT used here —
//      it's a strict type-checker that flags legitimate Roblox-only globals (task, bit, getgenv,
//      Vector3, etc.) as "unknown" since it has no Roblox type definitions loaded, which is noise, not
//      a real failure; luau-compile.exe (the same tool the pipeline itself uses) only fails on genuine
//      syntax errors. This check is NOT sufficient on its own — a script that silently jumps to the
//      wrong place at runtime still compiles fine — but it's a free, instant gate before ever touching
//      the live Roblox client.
//
// Live-device execution (via roblox-executor-mcp) is intentionally a SEPARATE, manual step — this
// driver only prepares and locally validates the output; see the obfuscator's plan notes for the
// loadstring-wrapper -> execute-file -> get-data-by-code convention used to verify behaviour live.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { obfuscate } = require('../core/pipeline');

async function main() {
  const inputPath = process.argv[2];
  const preset = process.argv[3] || 'standard';

  if (!inputPath) {
    console.error('Usage: node tools/obfuscate-test.js <path-to-lua-file> [preset]');
    process.exit(1);
  }

  const resolvedInput = path.resolve(inputPath);
  if (!fs.existsSync(resolvedInput)) {
    console.error(`Input file not found: ${resolvedInput}`);
    process.exit(1);
  }

  const sourceCode = fs.readFileSync(resolvedInput, 'utf8');
  console.log(`[obfuscate-test] input: ${resolvedInput} (${sourceCode.length} bytes, preset=${preset})`);

  const t0 = Date.now();
  const result = await obfuscate(sourceCode, { preset });
  const elapsed = Date.now() - t0;

  if (!result.ok) {
    console.error(`[obfuscate-test] FAILED (${elapsed}ms): ${result.error}`);
    console.error('[obfuscate-test] stats so far:', JSON.stringify(result.stats, null, 2));
    process.exit(2);
  }

  console.log(`[obfuscate-test] ok:true in ${elapsed}ms`);
  console.log('[obfuscate-test] stats:', JSON.stringify(result.stats, null, 2));
  if (result.note) console.log(`[obfuscate-test] note: ${result.note}`);

  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const baseName = path.basename(resolvedInput).replace(/\.lua$/i, '');
  const outPath = path.join(outDir, `${baseName}.${preset}.obf.lua`);
  fs.writeFileSync(outPath, result.output, 'utf8');
  console.log(`[obfuscate-test] wrote obfuscated output: ${outPath} (${result.output.length} bytes)`);

  const binDir = path.join(__dirname, '..', 'bin');
  const compileExe = path.join(binDir, 'luau-compile.exe');

  let checked = false;
  if (fs.existsSync(compileExe)) {
    checked = true;
    try {
      // --binary writes real bytecode to stdout; discard it, we only care whether compilation succeeds.
      execFileSync(compileExe, ['--binary', outPath], { stdio: ['ignore', 'ignore', 'pipe'] });
      console.log('[obfuscate-test] luau-compile.exe: PASS (compiles to real Luau bytecode with no syntax errors)');
    } catch (err) {
      console.error('[obfuscate-test] luau-compile.exe: FAIL — the obfuscated output does not compile');
      console.error((err.stderr || '').toString());
      process.exit(3);
    }
  }

  if (!checked) {
    console.warn('[obfuscate-test] no bin/luau-compile.exe found — skipped local syntax check.');
  }

  console.log('[obfuscate-test] DONE. Local checks passed. Live-device verification (roblox-executor-mcp) is a separate manual step.');
}

main().catch((err) => {
  console.error('[obfuscate-test] unexpected error:', err);
  process.exit(1);
});
