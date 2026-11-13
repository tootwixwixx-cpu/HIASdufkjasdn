// core/transforms/deadCode.js
// AtomProtect Industrial Dead Code Injection Engine
// Injects massive volumes of safe, harmless junk bytecode instructions and opaque predicates
// Accurately recalculates label targets so loops, jumps, and continues remain 100% intact.

'use strict';

/**
 * 20+ diverse harmless instruction block templates.
 * Uses isolated scratch registers strictly above the proto's maximum used register.
 */
function createHarmlessInstructionBlock(scratchBase) {
  const r0 = `R${scratchBase}`;
  const r1 = `R${scratchBase + 1}`;
  const r2 = `R${scratchBase + 2}`;
  const r3 = `R${scratchBase + 3}`;
  const r4 = `R${scratchBase + 4}`;

  const templates = [
    // 1. Simple dead math: ADD
    () => [
      { op: 'LOADN', args: [r0, String(Math.floor(Math.random() * 200) + 1)] },
      { op: 'LOADN', args: [r1, String(Math.floor(Math.random() * 200) + 1)] },
      { op: 'ADD',   args: [r2, r0, r1] },
      { op: 'LOADNIL', args: [r0, '2'] }
    ],
    // 2. NOP + dead boolean
    () => [
      { op: 'NOP', args: [] },
      { op: 'LOADB', args: [r0, '0', '0'] },
      { op: 'LOADNIL', args: [r0, '0'] }
    ],
    // 3. Dead subtraction chain
    () => [
      { op: 'LOADN', args: [r0, String(Math.floor(Math.random() * 500) + 100)] },
      { op: 'LOADN', args: [r1, String(Math.floor(Math.random() * 50) + 1)] },
      { op: 'SUB',   args: [r2, r0, r1] },
      { op: 'SUB',   args: [r3, r2, r1] },
      { op: 'LOADNIL', args: [r0, '3'] }
    ],
    // 4. Dead multiplication
    () => {
      const a = Math.floor(Math.random() * 30) + 2;
      const b = Math.floor(Math.random() * 30) + 2;
      return [
        { op: 'LOADN', args: [r0, String(a)] },
        { op: 'LOADN', args: [r1, String(b)] },
        { op: 'MUL',   args: [r2, r0, r1] },
        { op: 'LOADNIL', args: [r0, '2'] }
      ];
    },
    // 5. Dead division and modulus
    () => [
      { op: 'LOADN', args: [r0, String(Math.floor(Math.random() * 100) + 50)] },
      { op: 'LOADN', args: [r1, String(Math.floor(Math.random() * 10) + 2)] },
      { op: 'DIV',   args: [r2, r0, r1] },
      { op: 'MOD',   args: [r3, r0, r1] },
      { op: 'LOADNIL', args: [r0, '3'] }
    ],
    // 6. Dead register move chain
    () => [
      { op: 'LOADN', args: [r0, '42'] },
      { op: 'MOVE',  args: [r1, r0] },
      { op: 'MOVE',  args: [r2, r1] },
      { op: 'MOVE',  args: [r3, r2] },
      { op: 'LOADNIL', args: [r0, '3'] }
    ],
    // 7. Dead NOT + boolean chain
    () => [
      { op: 'LOADB', args: [r0, '1', '0'] },
      { op: 'NOT',   args: [r1, r0] },
      { op: 'NOT',   args: [r2, r1] },
      { op: 'LOADNIL', args: [r0, '2'] }
    ],
    // 8. Dead UNM (unary minus)
    () => [
      { op: 'LOADN', args: [r0, String(Math.floor(Math.random() * 100) + 1)] },
      { op: 'UNM',   args: [r1, r0] },
      { op: 'UNM',   args: [r2, r1] },
      { op: 'LOADNIL', args: [r0, '2'] }
    ],
    // 9. Dead register identity math + nil
    () => [
      { op: 'LOADN', args: [r0, '0'] },
      { op: 'LOADNIL', args: [r0, '0'] }
    ],
    // 10. Dead power operation
    () => [
      { op: 'LOADN', args: [r0, String(Math.floor(Math.random() * 5) + 2)] },
      { op: 'LOADN', args: [r1, '2'] },
      { op: 'POW',   args: [r2, r0, r1] },
      { op: 'LOADNIL', args: [r0, '2'] }
    ],
    // 11. Multi-step arithmetic expression
    () => {
      const a = Math.floor(Math.random() * 50) + 10;
      const b = Math.floor(Math.random() * 50) + 10;
      const c = Math.floor(Math.random() * 50) + 10;
      return [
        { op: 'LOADN', args: [r0, String(a)] },
        { op: 'LOADN', args: [r1, String(b)] },
        { op: 'ADD',   args: [r2, r0, r1] },
        { op: 'LOADN', args: [r3, String(c)] },
        { op: 'MUL',   args: [r4, r2, r3] },
        { op: 'LOADNIL', args: [r0, '4'] }
      ];
    },
    // 12. Dead register inversion + nil
    () => [
      { op: 'LOADN', args: [r0, '42'] },
      { op: 'UNM',   args: [r1, r0] },
      { op: 'LOADNIL', args: [r0, '1'] }
    ],
    // 13. Dead integer division
    () => [
      { op: 'LOADN', args: [r0, String(Math.floor(Math.random() * 200) + 50)] },
      { op: 'LOADN', args: [r1, String(Math.floor(Math.random() * 10) + 2)] },
      { op: 'IDIV',  args: [r2, r0, r1] },
      { op: 'LOADNIL', args: [r0, '2'] }
    ],
    // 14. Dead three-register shuffle
    () => [
      { op: 'LOADN', args: [r0, String(Math.floor(Math.random() * 100))] },
      { op: 'LOADN', args: [r1, String(Math.floor(Math.random() * 100))] },
      { op: 'MOVE',  args: [r2, r0] },
      { op: 'MOVE',  args: [r0, r1] },
      { op: 'MOVE',  args: [r1, r2] },
      { op: 'LOADNIL', args: [r0, '2'] }
    ],
    // 15. Multi-add accumulator
    () => {
      const vals = Array.from({length: 3}, () => Math.floor(Math.random() * 30) + 1);
      return [
        { op: 'LOADN', args: [r0, String(vals[0])] },
        { op: 'LOADN', args: [r1, String(vals[1])] },
        { op: 'ADD',   args: [r0, r0, r1] },
        { op: 'LOADN', args: [r1, String(vals[2])] },
        { op: 'ADD',   args: [r0, r0, r1] },
        { op: 'LOADNIL', args: [r0, '1'] }
      ];
    },
    // 16. Dead boolean true + NOT chain
    () => [
      { op: 'LOADB', args: [r0, '1', '0'] },
      { op: 'LOADB', args: [r1, '0', '0'] },
      { op: 'NOT',   args: [r2, r0] },
      { op: 'NOT',   args: [r3, r1] },
      { op: 'LOADNIL', args: [r0, '3'] }
    ],
    // 17. Dead SUB then ADD (identity)
    () => {
      const v = Math.floor(Math.random() * 100) + 1;
      const d = Math.floor(Math.random() * 20) + 1;
      return [
        { op: 'LOADN', args: [r0, String(v)] },
        { op: 'LOADN', args: [r1, String(d)] },
        { op: 'SUB',   args: [r2, r0, r1] },
        { op: 'ADD',   args: [r3, r2, r1] },
        { op: 'LOADNIL', args: [r0, '3'] }
      ];
    },
    // 18. Triple NOP padding
    () => [
      { op: 'NOP', args: [] },
      { op: 'NOP', args: [] },
      { op: 'NOP', args: [] }
    ],
    // 19. Dead LOADN + MOVE + LOADNIL
    () => {
      const v = Math.floor(Math.random() * 1000);
      return [
        { op: 'LOADN', args: [r0, String(v)] },
        { op: 'MOVE',  args: [r1, r0] },
        { op: 'LOADN', args: [r2, '0'] },
        { op: 'ADD',   args: [r3, r1, r2] },
        { op: 'LOADNIL', args: [r0, '3'] }
      ];
    },
    // 20. Dead complex chain: (a + b) * (a - b) = a² - b²
    () => {
      const a = Math.floor(Math.random() * 20) + 5;
      const b = Math.floor(Math.random() * 4) + 1;
      return [
        { op: 'LOADN', args: [r0, String(a)] },
        { op: 'LOADN', args: [r1, String(b)] },
        { op: 'ADD',   args: [r2, r0, r1] },
        { op: 'SUB',   args: [r3, r0, r1] },
        { op: 'MUL',   args: [r4, r2, r3] },
        { op: 'LOADNIL', args: [r0, '4'] }
      ];
    }
  ];

  return templates[Math.floor(Math.random() * templates.length)]();
}

/**
 * Checks if it is safe to inject dead code before instruction i.
 * Critical Luau instruction sequences that MUST NOT be split:
 * - NEWCLOSURE followed by CAPTURE
 * - CAPTURE followed by CAPTURE
 * - NAMECALL followed by CALL
 * - FASTCALL / FASTCALL1 / FASTCALL2 / FASTCALL2K / FASTCALL3 followed by CALL
 * - LOADB with skip (C != 0) followed by next instruction
 */
function isSafeInjectionPoint(oldInstrs, i, labelTargets) {
  if (i === 0) return true;
  if (labelTargets && labelTargets.has(i)) return false;
  const prev = oldInstrs[i - 1];
  const curr = oldInstrs[i];

  if (curr.op === 'CAPTURE') return false;
  if (prev.op === 'NEWCLOSURE') return false;
  if (prev.op === 'DUPCLOSURE') return false;
  if (prev.op === 'CAPTURE') return false;
  if (prev.op === 'NAMECALL') return false;
  if (prev.op.startsWith('FASTCALL') || prev.op.startsWith('FASTPCALL')) return false;
  // LOADB with skip C != 0
  if (prev.op === 'LOADB' && prev.args && prev.args[2] && prev.args[2] !== '0') return false;
  // Don't inject between FORGPREP and FORGLOOP target sequences
  if (prev.op.startsWith('FORGPREP') || prev.op.startsWith('FORNPREP')) return false;

  // Multret and Multarg sequences (CALL, RETURN, SETLIST, GETVARARGS)
  if (prev.op === 'CALL' || prev.op === 'CALLFB') {
    if (prev.args && (prev.args[2] === '-1' || prev.args[2] === '0')) return false;
  }
  if (prev.op === 'GETVARARGS' && prev.args && (prev.args[1] === '-1' || prev.args[1] === '0')) return false;
  if (curr.op === 'CALL' || curr.op === 'CALLFB') {
    if (curr.args && curr.args[1] === '-1') return false;
  }
  if (curr.op === 'RETURN' && curr.args && curr.args[1] === '-1') return false;
  if (curr.op === 'SETLIST' && curr.args && (curr.args[2] === '-1' || curr.args[2] === '0')) return false;

  return true;
}

/**
 * Injects massive volumes of dead code sequences into proto instruction streams.
 * Accurately updates all jump and loop label mappings.
 *
 * @param {object} ir - The intermediate representation
 * @param {number} injectionRate - Probability of injection at each safe point (0.0 - 1.0)
 * @param {number} maxBlocksPerInject - Maximum junk blocks per injection point (1-3)
 */
function applyDeadCodeInjection(ir, injectionRate = 0.40, maxBlocksPerInject = 2) {
  for (const proto of ir.protos) {
    const oldInstrs = proto.instructions;
    if (!oldInstrs || oldInstrs.length === 0) continue;

    const labelTargets = new Set(Object.values(proto.labels || {}));

    // Determine the maximum register used by this proto. Scan explicit Rn tokens, but ALSO account for
    // implicit multi-register spans from variable-arg-count ops (CALL/CALLFB/RETURN/SETLIST/GETVARARGS
    // with a -1/0 "up to top" sentinel) which can reach well above any single literal register token —
    // and fall back to the proto's own compiler-reported maxStackSize (the true register ceiling for
    // this function, already tracked from the binary bytecode header by the lifter) as an authoritative
    // floor, since the literal-token scan can only ever undercount implicit reach, never overcount it.
    // Undercounting maxReg here is exactly what let injected "scratch" registers collide with real,
    // live registers in register-heavy, call-heavy functions — overwhelmingly more likely in large,
    // real-world scripts than in small test snippets.
    let maxReg = (proto.maxStackSize || 0) - 1;
    for (const ins of oldInstrs) {
      for (const arg of (ins.args || [])) {
        if (arg && arg.startsWith('R')) {
          const rNum = parseInt(arg.slice(1), 10);
          if (!isNaN(rNum)) maxReg = Math.max(maxReg, rNum);
        }
      }
      const touchesVariadicReach =
        ((ins.op === 'CALL' || ins.op === 'CALLFB') && ins.args && (ins.args[1] === '-1' || ins.args[2] === '-1' || ins.args[2] === '0')) ||
        (ins.op === 'RETURN' && ins.args && ins.args[1] === '-1') ||
        (ins.op === 'SETLIST' && ins.args && (ins.args[2] === '-1' || ins.args[2] === '0')) ||
        (ins.op === 'GETVARARGS' && ins.args && (ins.args[1] === '-1' || ins.args[1] === '0'));
      if (touchesVariadicReach) maxReg = Math.max(maxReg, (proto.maxStackSize || 1) - 1);
    }
    if (maxReg < 0) maxReg = 0;

    // Place scratch registers STRICTLY above the real max — never clamp down into territory the real
    // function might still be using. Luau's real per-function register ceiling is 255 (valid indices
    // 0..254); createHarmlessInstructionBlock uses 5 scratch registers (scratchBase..scratchBase+4). If
    // there's no safe room left under that ceiling, skip dead-code injection for this proto entirely
    // instead of silently clamping into occupied register space (the previous `Math.min(240, ...)`
    // clamp did exactly that once maxReg exceeded ~235, corrupting live program state).
    const SCRATCH_WIDTH = 5;
    const REGISTER_CEILING = 254;
    const scratchBase = maxReg + 5;
    const canInject = (scratchBase + SCRATCH_WIDTH - 1) <= REGISTER_CEILING;

    const newInstrs = [];
    const indexMap = [];
    let injectedAny = false;

    for (let i = 0; i < oldInstrs.length; i++) {
      indexMap[i] = newInstrs.length;

      if (canInject && Math.random() < injectionRate && isSafeInjectionPoint(oldInstrs, i, labelTargets)) {
        // Inject 1 to maxBlocksPerInject junk blocks
        const numBlocks = 1 + Math.floor(Math.random() * maxBlocksPerInject);
        for (let b = 0; b < numBlocks; b++) {
          const junkBlock = createHarmlessInstructionBlock(scratchBase);
          for (const j of junkBlock) {
            newInstrs.push(j);
          }
        }
        injectedAny = true;
      }

      newInstrs.push(oldInstrs[i]);
    }
    indexMap[oldInstrs.length] = newInstrs.length;

    // Accurately remap all jump labels to their new instruction indices
    if (proto.labels) {
      for (const [label, oldIdx] of Object.entries(proto.labels)) {
        proto.labels[label] = indexMap[oldIdx] !== undefined ? indexMap[oldIdx] : newInstrs.length;
      }
    }

    if (injectedAny) {
      proto.maxStackSize = Math.max(proto.maxStackSize || 0, scratchBase + SCRATCH_WIDTH);
    }
    proto.instructions = newInstrs;
  }

  return ir;
}

module.exports = { applyDeadCodeInjection };
