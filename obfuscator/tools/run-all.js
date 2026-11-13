// tools/run-all.js
// One-command regression gate (Round 2, Phase 0). Replaces running obfuscate-test.js / diff-lifters.js
// by hand, one fixture/preset at a time. Reuses the SAME underlying functions those two drivers call
// (core/pipeline.js's obfuscate(), core/compiler.js's compileToBytecode(), core/lifter.js's
// liftBytecode()) rather than shelling out to the drivers themselves, since both of those scripts call
// process.exit() in their own main() and so can't be `require`d safely as library code.
//
// For every fixture in tools/fixtures/ (recursive, including untrusted/) this:
//   1. Runs the diff-lifters binary-vs-text decoder comparison once (preset-independent — lifting
//      happens before any preset-dependent stage).
//   2. Runs the full obfuscate() pipeline at every preset (standard, maximum, ultra, debug), checks
//      ok:true, writes output to tools/out/, and compile-checks it with bin/luau-compile.exe.
//   3. Collects the binaryDecodeBails stat (Phase 4) once it exists; reports it either way.
//
// Usage: node tools/run-all.js   (from the obfuscator/ directory, or anywhere — paths are absolute)
// Exit code is non-zero if anything failed.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { obfuscate } = require('../core/pipeline');
const { compileToBytecode } = require('../core/compiler');
const lifter = require('../core/lifter');

const PRESETS = ['standard', 'maximum', 'ultra', 'debug'];
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const OUT_DIR = path.join(__dirname, 'out');
const BIN_COMPILE = path.join(__dirname, '..', 'bin', 'luau-compile.exe');

// --- diff-lifters logic, inlined (see tools/diff-lifters.js for the full rationale comments) ---

// A token that looks like a genuine operand reference (register/constant/label index, a bare/signed
// number, or the JUMPXEQK* "NOT" flag) — used below to tell "the decorative run just ended" apart from
// "this ']'-ending token is itself mid-sentence inside a longer decorative string" (e.g. a help-text
// constant like "Press [backspace] and [=] at the ..." disassembles into several tokens that each look
// bracket-shaped on their own, even though only one decorative run is actually present).
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
          if (next === undefined || REAL_OPERAND_RE.test(next)) break; // run ends here
        }
        j++;
      }
      i = j + 1; // skip the whole run (or to end-of-array if unterminated)
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

      if (typeof result.stats && result.stats && typeof result.stats.binaryDecodeBails === 'number') {
        sawBailStat = true;
        totalBails += result.stats.binaryDecodeBails;
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

  console.log(`\n[run-all] binaryDecodeBails: ${sawBailStat ? totalBails : 'stat not present yet (Phase 4 not landed)'}`);
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
