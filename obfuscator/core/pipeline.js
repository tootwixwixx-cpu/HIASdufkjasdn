// core/pipeline.js
// AtomProtect Industrial Luau VM Obfuscator — Unified Core Pipeline
// Single unified architecture: Bytecode Compiler -> IR Lifter -> Keystream Encryption
// -> Number Mutation -> Dead Code Injection -> Columnar BST Virtual Machine -> Anti-Dump

'use strict';

const { compileToBytecode, syntaxCheck, runWithLuau, getCompilerStatus } = require('./compiler');
const { liftBytecode } = require('./lifter');
const { applyStringEncryption } = require('./transforms/stringEncrypt');
const { applyNumberMutation } = require('./transforms/numberMutate');
const { applyDeadCodeInjection } = require('./transforms/deadCode');
const { generateLuraphVM } = require('./transforms/luraphGenerator');
const { wrapPolymorphic } = require('./polymorphic');

/**
 * Main obfuscation entry point.
 * Every execution runs the full industrial-grade pipeline.
 */
async function obfuscate(sourceCode, options = {}) {
  const status = getCompilerStatus();
  const startTime = Date.now();
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

  const stats = {
    layers: [],
    method: 'atomprotect-vm',
    inputSize: sourceCode.length,
    outputSize: 0,
    time: 0
  };

  try {
    if (status.luauCompile) {
      onProgress({ step: 'compile', percent: 25, message: 'Compiling Luau bytecode with luau-compile.exe...' });
      // Step 1: Compile source to Luau bytecode
      const compileResult = compileToBytecode(sourceCode);
      if (!compileResult.ok) {
        throw new Error(`Compile error: ${compileResult.error}`);
      }
      stats.layers.push('bytecode-compile');

      onProgress({ step: 'lift', percent: 40, message: 'Lifting bytecode instructions into Structured IR...' });
      // Step 2: Lift disassembly into structured IR
      let ir = liftBytecode(compileResult);
      stats.layers.push('bytecode-lift');
      // Round 2, Phase 4: a nonzero value here on a normal (non-experimental-bytecode) compile means
      // the binary decoder's opcode/constant-tag coverage has regressed — see core/lifter.js.
      stats.binaryDecodeBails = ir.binaryDecodeBails || 0;
      if (ir.binaryDecodeFullBail) stats.binaryDecodeFullBailReason = ir.binaryDecodeFullBailReason;

      onProgress({ step: 'strings', percent: 55, message: 'Encrypting string pool with RC4 stream cipher keystreams...' });
      // Step 3: Constant string stream encryption (RC4 + keystream)
      const encResult = applyStringEncryption(ir);
      ir = encResult.ir;
      stats.layers.push('string-encryption');

      onProgress({ step: 'mutate', percent: 70, message: 'Applying number mutations & dead code injection...' });
      // Step 4: Number mutation & underscore literal formatting
      ir = applyNumberMutation(ir);
      stats.layers.push('number-mutation');

      // Step 5: Dead code injection — adaptive scaling for executor performance.
      //
      // Round 2, Phase 5: this used to be three DISCRETE tiers (isHuge/isLarge/normal), each a hard
      // step in deadRate at the tier boundary (e.g. standard preset: 0.20 -> 0.02 -> 0.002, a 100x
      // jump across the isLarge/isHuge cliffs). Two scripts straddling a threshold differently — or
      // even the same script re-measured near a boundary — could get wildly different injection rates,
      // and therefore wildly different output sizes, for no reason tied to their actual complexity.
      // This was the leading (though not fully confirmed) hypothesis behind an old size-blowup anomaly.
      // Replaced with ONE continuous function of a composite complexity score: `complexityScore` is 0
      // for a trivial script and reaches exactly 1.0 at the same point the old "isHuge" threshold used
      // to trip (same three dimensions — proto count, instruction count, source length — still each
      // individually capable of driving it). deadRate is then interpolated smoothly (geometrically, so
      // it moves evenly across the ~100x range in log-space rather than linearly, which would barely
      // move for the first 99% of the range) between the normal-script rate (score 0) and the old huge-
      // script rate (score >= 1) — the two endpoints are UNCHANGED from before, so an already-trivial
      // script (score ~0) or an already-confirmed-huge script (score >= 1, e.g. BriskVisualSuite.lua,
      // already verified live at a consistent ~1.0MB output) gets the exact same rate as before; only
      // scripts that used to land ON a cliff now get a smoothly-scaled rate instead of a coin-flip tier.
      const preset = String(options.preset || 'standard').toLowerCase();
      const protoCount = (ir.protos && ir.protos.length) || 0;
      const instrCount = (ir.protos || []).reduce((n, p) => n + ((p.instructions && p.instructions.length) || 0), 0);
      const HUGE_PROTOS = 80, HUGE_INSTRS = 25000, HUGE_LEN = 200000;
      const LARGE_PROTOS = 25, LARGE_INSTRS = 5000, LARGE_LEN = 50000;
      const complexityScore = Math.max(
        protoCount / HUGE_PROTOS,
        instrCount / HUGE_INSTRS,
        sourceCode.length / HUGE_LEN
      );
      // isHuge/isLarge kept as informational flags (same thresholds as before) for stats.hugeScript /
      // largeScript and the VM generator's preset-dependent behavior elsewhere — only deadRate itself
      // is no longer driven by which discrete bucket these fall into.
      const isHuge = protoCount > HUGE_PROTOS || instrCount > HUGE_INSTRS || sourceCode.length > HUGE_LEN;
      const isLarge = !isHuge && (protoCount > LARGE_PROTOS || instrCount > LARGE_INSTRS || sourceCode.length > LARGE_LEN);

      function continuousDeadRate(normalRate, hugeRate) {
        const t = Math.min(1, complexityScore);
        return normalRate * Math.pow(hugeRate / normalRate, t);
      }

      let deadRate;
      let deadBlocks = 1;
      if (preset === 'maximum' || preset === 'ultra') {
        deadRate = continuousDeadRate(0.30, 0.005);
      } else if (preset === 'debug') {
        deadRate = 0.02; // flat by design — debug builds don't scale dead-code with script size
      } else {
        deadRate = continuousDeadRate(0.20, 0.002);
      }

      ir = applyDeadCodeInjection(ir, deadRate, deadBlocks);
      stats.complexityScore = Math.round(complexityScore * 1000) / 1000;
      stats.deadRate = deadRate;
      stats.layers.push('dead-code-injection');
      stats.preset = preset;
      stats.hugeScript = isHuge;

      onProgress({ step: 'vm', percent: 85, message: 'Generating Columnar Struct-of-Arrays BST Virtual Machine...' });
      // Step 6: Emit Columnar Struct-of-Arrays Binary Search Tree VM
      const finalOutput = generateLuraphVM(ir, encResult, {
        // No branding/signature header — see luraphGenerator.js's note on why that's a fingerprint,
        // not a feature, for hardened output.
        preset,
        debug: options.debug === true || preset === 'debug',
        maxProtection: preset === 'maximum' || preset === 'ultra',
        hugeScript: isHuge,
        largeScript: isLarge,
        // Round 2, Phase 6: "standard" (default) | "strict" | "off" — see core/transforms/antiTamper.js.
        antiTamperStrength: options.antiTamperStrength
      });
      stats.layers.push('columnar-bst-vm');
      stats.layers.push('anti-dump-wipe');

      onProgress({ step: 'done', percent: 100, message: `Protection complete! (${(finalOutput.length / 1024 / 1024).toFixed(2)} MB VM bytecode payload)` });
      stats.outputSize = finalOutput.length;
      stats.time = Date.now() - startTime;
      return { ok: true, output: finalOutput, stats };

    } else {
      stats.method = 'polymorphic-xor';
      const output = wrapPolymorphic(sourceCode);
      stats.layers.push('polymorphic-wrap');
      stats.outputSize = output.length;
      stats.time = Date.now() - startTime;

      return {
        ok: true,
        output,
        stats,
        note: 'luau-compile.exe not found — fallback mode.'
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      stats
    };
  }
}

/**
 * Compile / Run entry point for the "Run / Compile" button
 */
async function compile(sourceCode) {
  const status = getCompilerStatus();

  if (status.luau) {
    const result = runWithLuau(sourceCode);
    return {
      ok: result.ok,
      output: result.output || '',
      error: result.error || null,
      method: 'luau-run'
    };
  }

  if (status.luauCompile) {
    const result = compileToBytecode(sourceCode);
    return {
      ok: result.ok,
      output: result.ok ? `Compiled successfully (${result.bytecode.length} bytes bytecode)` : '',
      error: result.error || null,
      method: 'luau-compile'
    };
  }

  const result = syntaxCheck(sourceCode);
  return {
    ok: result.ok,
    output: result.ok ? 'Syntax OK' : '',
    error: result.error || null,
    method: 'js-heuristic',
    note: result.note
  };
}

module.exports = { obfuscate, compile, getCompilerStatus };
