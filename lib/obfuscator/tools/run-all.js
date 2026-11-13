// lib/obfuscator/tools/run-all.js
// Regression gate for lib/obfuscator/* — the in-app copy of the AtomProtect Luau VM obfuscator that
// app/api/scripts/route.ts, app/api/scripts/obfuscate-stream/route.ts, app/api/loader/[slug]/route.ts,
// app/api/auth/verify/route.ts, app/api/auth/probe/route.ts, and lib/github-sync.ts actually call
// (via lib/obfuscator/index.ts's obfuscateLuauVM/bundleModules/verifyLuauBytecode/getCompilerStatus).
//
// This is a faithful adaptation of obfuscator/tools/run-all.js's own methodology — same diff-lifters
// binary-vs-text decoder cross-check, same obfuscate() run at every preset, same compile-check via
// bin/luau-compile.exe — pointed at THIS copy's pipeline/compiler/lifter instead of core's, and reusing
// the same fixtures (obfuscator/tools/fixtures/) rather than duplicating them. It also adds one check
// obfuscator/tools/run-all.js doesn't need: asserting the AtomProtect branding/fingerprint header never
// appears in this copy's output at any preset, since lib/obfuscator/transforms/luraphGenerator.js's
// `header` is hardcoded to '' with no customHeader escape hatch (unlike core's, which still allows an
// explicit opt-in) — see pipeline.js / luraphGenerator.js for why that capability was removed here.
//
// Usage: node lib/obfuscator/tools/run-all.js   (from anywhere — paths are __dirname-relative)
// Exit code is non-zero if anything failed.
// Wired as `npm run test:obfuscator` in the project root package.json.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { obfuscate } = require('../pipeline');
const { compileToBytecode } = require('../compiler');
const lifter = require('../lifter');

const PRESETS = ['standard', 'maximum', 'ultra', 'debug'];
// Reuses obfuscator/'s fixtures rather than duplicating them — same corpus, two copies of the engine.
const FIXTURES_DIR = path.join(__dirname, '..', '..', '..', 'obfuscator', 'tools', 'fixtures');
const OUT_DIR = path.join(__dirname, 'out');
const BIN_COMPILE = path.join(__dirname, '..', 'bin', 'luau-compile.exe');

// --- diff-lifters logic, inlined (same as obfuscator/tools/run-all.js's own copy) ---

const REAL_OPERAND_RE = /^(R\d+|K\d+|L\d+|-?\+?\d+|NOT)$/;

function stripDecorative(args) {
  const out = [];
  let i = 0;
  while (i < args.length) {
    if (args[i].startsWith('[')) {
      let j = i;
      while (j < args.length) {
        if (args[j].endsWith(']')) {
          const next = args[j + 1];
          if (next === undefined || REAL_OPERAND_RE.test(next)) break;
        }
        j++;
      }
      i = j + 1;
      continue;
    }
    out.push(args[i]);
    i++;
  }
  return out;
}

const ARGS_IGNORED_OPS = new Set([
  'FASTCALL', 'FASTCALL1', 'FASTCALL2', 'FASTCALL2K', 'FASTCALL3',
  'FASTPCALL', 'FASTPCALL1', 'FASTPCALL2', 'NEWTABLE',
]);

function argsEqual(rawA, rawB, labelsA, labelsB, opName) {
  if (ARGS_IGNORED_OPS.has(opName)) return true;
  const a = stripDecorative(rawA);
  const b = stripDecorative(rawB);
  const shorter = Math.min(a.length, b.length);
  for (let i = 0; i < shorter; i++) {
    if (a[i] === b[i]) continue;
    const isLabel = /^L\d+$/.test(a[i]) && /^L\d+$/.test(b[i]);
    if (isLabel && labelsA[a[i]] === labelsB[b[i]]) continue;
    const numA = /^K?\+?(\d+)$/.exec(a[i]);
    const numB = /^K?\+?(\d+)$/.exec(b[i]);
    if (numA && numB && numA[1] === numB[1]) continue;
    return false;
  }
  if (a.length === b.length) return true;
  if (a.length < b.length) return false;
  for (let i = shorter; i < a.length; i++) if (a[i] !== '0') return false;
  return true;
}

function diffLift(fixturePath) {
  const src = fs.readFileSync(fixturePath, 'utf8');
  const cr = compileToBytecode(src);
  if (!cr.ok) return { ok: false, error: `compile failed: ${cr.error}` };

  lifter.FORCE_TEXT_LIFT = false;
  const binIr = lifter.liftBytecode(cr);
  lifter.FORCE_TEXT_LIFT = true;
  const textIr = lifter.liftBytecode(cr);
  lifter.FORCE_TEXT_LIFT = false;

  if (binIr.protos.length !== textIr.protos.length) {
    return { ok: false, error: `proto count differs (binary=${binIr.protos.length}, text=${textIr.protos.length})` };
  }

  let totalInstr = 0, mismatches = 0;
  const samples = [];
  for (let p = 0; p < binIr.protos.length; p++) {
    const bp = binIr.protos[p], tp = textIr.protos[p];
    if (bp.instructions.length !== tp.instructions.length) {
      mismatches++;
      if (samples.length < 5) samples.push(`proto ${p}: instruction count differs (binary=${bp.instructions.length}, text=${tp.instructions.length})`);
      continue;
    }
    for (let i = 0; i < bp.instructions.length; i++) {
      totalInstr++;
      const bi = bp.instructions[i], ti = tp.instructions[i];
      if (bi.op !== ti.op || !argsEqual(bi.args, ti.args, bp.labels || {}, tp.labels || {}, bi.op)) {
        mismatches++;
        if (samples.length < 5) samples.push(`proto ${p} instr ${i}: binary={${bi.op},${JSON.stringify(bi.args)}} text={${ti.op},${JSON.stringify(ti.args)}}`);
      }
    }
  }
  return { ok: mismatches === 0, protos: binIr.protos.length, totalInstr, mismatches, samples };
}

// --- fixture discovery ---

function listFixtures(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFixtures(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lua')) out.push(full);
  }
  return out;
}

// Branding/fingerprint strings that must NEVER appear in this copy's output, at any preset — see the
// file header above. If this trips, lib/obfuscator/transforms/luraphGenerator.js's `header` constant
// (or pipeline.js passing a customHeader back in) has regressed.
const BRANDING_NEEDLES = ['AtomProtect Pro VM', 'atomprotect.dev', 'AtomProtect Dynamic Envelope'];

// --- main ---

async function main() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    console.error(`[run-all] fixtures dir not found: ${FIXTURES_DIR}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const fixtures = listFixtures(FIXTURES_DIR);
  if (fixtures.length === 0) {
    console.error('[run-all] no .lua fixtures found.');
    process.exit(1);
  }

  const rows = [];
  let anyFail = false;
  let totalBails = 0;
  let sawBailStat = false;

  for (const fixturePath of fixtures) {
    const rel = path.relative(FIXTURES_DIR, fixturePath);

    // 1. diff-lifters
    let diffRes;
    try {
      diffRes = diffLift(fixturePath);
    } catch (err) {
      diffRes = { ok: false, error: err.message };
    }
    rows.push({ fixture: rel, stage: 'diff-lifters', ok: diffRes.ok, detail: diffRes.ok ? `${diffRes.totalInstr} instr, ${diffRes.protos} protos` : diffRes.error });
    if (!diffRes.ok) {
      anyFail = true;
      if (diffRes.samples) for (const s of diffRes.samples) console.error(`  [diff-lifters:${rel}] ${s}`);
    }

    // 2. obfuscate() at every preset
    const sourceCode = fs.readFileSync(fixturePath, 'utf8');
    for (const preset of PRESETS) {
      let result;
      try {
        result = await obfuscate(sourceCode, { preset });
      } catch (err) {
        result = { ok: false, error: err.message };
      }

      if (!result.ok) {
        rows.push({ fixture: rel, stage: `obfuscate(${preset})`, ok: false, detail: result.error });
        anyFail = true;
        continue;
      }

      if (typeof result.stats === 'object' && result.stats && typeof result.stats.binaryDecodeBails === 'number') {
        sawBailStat = true;
        totalBails += result.stats.binaryDecodeBails;
      }

      const brandingHit = BRANDING_NEEDLES.find((needle) => result.output.includes(needle));
      if (brandingHit) {
        rows.push({ fixture: rel, stage: `obfuscate(${preset})`, ok: false, detail: `BRANDING HEADER FOUND IN OUTPUT: "${brandingHit}"` });
        anyFail = true;
        continue;
      }

      const baseName = path.basename(fixturePath).replace(/\.lua$/i, '');
      const outPath = path.join(OUT_DIR, `${baseName}.${preset}.obf.lua`);
      fs.writeFileSync(outPath, result.output, 'utf8');

      let compileOk = true, compileErr = '';
      if (fs.existsSync(BIN_COMPILE)) {
        try {
          execFileSync(BIN_COMPILE, ['--binary', outPath], { stdio: ['ignore', 'ignore', 'pipe'] });
        } catch (err) {
          compileOk = false;
          compileErr = (err.stderr || '').toString().slice(0, 300);
        }
      }

      rows.push({
        fixture: rel,
        stage: `obfuscate(${preset})`,
        ok: compileOk,
        detail: compileOk
          ? `${(result.output.length / 1024).toFixed(1)}KB, deadRate=${result.stats && result.stats.deadRate !== undefined ? result.stats.deadRate : 'n/a'}`
          : `compile FAILED: ${compileErr}`
      });
      if (!compileOk) anyFail = true;
    }
  }

  console.log('\n[run-all] results:');
  const fixtureWidth = Math.max(...rows.map(r => r.fixture.length), 8);
  const stageWidth = Math.max(...rows.map(r => r.stage.length), 5);
  for (const r of rows) {
    const mark = r.ok ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${r.fixture.padEnd(fixtureWidth)} ${r.stage.padEnd(stageWidth)} ${r.detail}`);
  }

  console.log(`\n[run-all] binaryDecodeBails: ${sawBailStat ? totalBails : 'stat not present'}`);
  if (sawBailStat && totalBails > 0) {
    console.warn(`[run-all] WARNING: ${totalBails} binary-decoder bail(s) across fixtures — a non-experimental fixture should bail 0 times. Investigate before trusting the binary decoder's coverage.`);
  }

  const passCount = rows.filter(r => r.ok).length;
  console.log(`\n[run-all] ${passCount}/${rows.length} checks passed.`);

  if (anyFail) {
    console.error('[run-all] FAILED — see FAIL rows above.');
    process.exit(1);
  }
  console.log('[run-all] ALL CLEAR.');
}

main().catch((err) => {
  console.error('[run-all] unexpected error:', err);
  process.exit(1);
});
