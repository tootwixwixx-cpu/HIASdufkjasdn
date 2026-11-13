// core/transforms/numberMutate.js
// AtomProtect Industrial Number Mutation Engine
// Replaces numeric constants with polymorphic arithmetic expressions
// 12+ diverse strategies with nesting support for maximum confusion

'use strict';

const STRATEGIES = [
  // 1. Simple addition split: n = a + (n - a)
  (n) => {
    const a = Math.floor(Math.random() * 80) + 10;
    return { lua: `(${a} + (${n - a}))`, value: n };
  },
  // 2. XOR reconstruction with fallback
  (n) => {
    if (n < 0 || n > 0xFFFF) return STRATEGIES[0](n);
    const a = (Math.floor(Math.random() * 250) + 1);
    const b = (n ^ a);
    return { lua: `((bit32 and bit32.bxor(${a}, ${b})) or (${a} + (${n}) - (${a})))`, value: n };
  },
  // 3. Subtraction: n = a - (a - n)
  (n) => {
    const a = n + Math.floor(Math.random() * 100) + 20;
    return { lua: `(${a} - (${a - n}))`, value: n };
  },
  // 4. Multiply/divide: n = (n * m) / m
  (n) => {
    if (n === 0) return { lua: `(0 * 0)`, value: 0 };
    const m = (Math.floor(Math.random() * 4) + 2);
    return { lua: `((${n * m}) / ${m})`, value: n };
  },
  // 5. Modular arithmetic: n = (n + k*m) % m  where m > n
  (n) => {
    if (n < 0) return STRATEGIES[0](n);
    const m = Math.max(n + 1, Math.floor(Math.random() * 200) + n + 1);
    const k = Math.floor(Math.random() * 5) + 1;
    return { lua: `(((${n + k * m})) % ${m})`, value: n };
  },
  // 6. Floor division reconstruction: n = math.floor(a / b)
  (n) => {
    if (n === 0) return { lua: `math.floor(0.5)`, value: 0 };
    const b = Math.floor(Math.random() * 7) + 2;
    const a = n * b + Math.floor(Math.random() * (b - 1));
    return { lua: `math.floor((${a}) / ${b})`, value: n };
  },
  // 7. Double negation: n = -(-n)  (Spaces prevent accidental Lua '--' comment syntax)
  (n) => {
    if (n === 0) return { lua: `(- ( - 0))`, value: 0 };
    return { lua: `(- ( - (${n})))`, value: n };
  },
  // 8. Bitwise AND mask: n = bit32.band(n, 0xFFFFFFFF)
  (n) => {
    if (n < 0 || n > 0xFFFF) return STRATEGIES[0](n);
    return { lua: `((bit32 and bit32.band(${n}, 0xFFFFFFFF)) or (${n}))`, value: n };
  },
  // 9. Nested addition: n = (a + b + c) where a + b + c = n
  (n) => {
    const a = Math.floor(Math.random() * 30) + 1;
    const b = Math.floor(Math.random() * 30) + 1;
    const c = n - a - b;
    return { lua: `(${a} + ${b} + (${c}))`, value: n };
  },
  // 10. Power and subtract: n = a^2 - (a^2 - n)
  (n) => {
    const a = Math.floor(Math.random() * 10) + 2;
    const sq = a * a;
    return { lua: `(${sq} - (${sq - n}))`, value: n };
  },
  // 11. Conditional expression: n = (true and n or 0)
  (n) => {
    return { lua: `(true and (${n}) or 0)`, value: n };
  },
  // 12. Arithmetic combination: (n * 2) - n
  (n) => {
    return { lua: `(((${n}) * 2) - (${n}))`, value: n };
  },
  // 13. Complex multi-op: n = (a * b) + c
  (n) => {
    const b = Math.floor(Math.random() * 5) + 2;
    const a = Math.floor(n / b);
    const c = n - (a * b);
    return { lua: `((${a}) * ${b} + (${c}))`, value: n };
  },
  // 14. Bit shift: n = bit32.rshift(n << k, k)
  (n) => {
    if (n < 0 || n > 0xFFFF) return STRATEGIES[0](n);
    const k = Math.floor(Math.random() * 4) + 1;
    const shifted = n << k;
    return { lua: `((bit32 and bit32.rshift(${shifted}, ${k})) or (${n}))`, value: n };
  },
  // 15. Offset addition: ((n - a) + a)
  (n) => {
    const a = Math.floor(Math.random() * 50) + 1;
    return { lua: `(((${n}) - ${a}) + ${a})`, value: n };
  },
  // 16. Offset negation: a - (a - n)
  (n) => {
    const a = Math.floor(Math.random() * 500) + 100;
    return { lua: `(${a} - (${a} - (${n})))`, value: n };
  }
];

function mutateNumber(n) {
  if (Object.is(n, -0) || !Number.isInteger(n) || Math.abs(n) > 1000000) return null;
  const strat = STRATEGIES[Math.floor(Math.random() * STRATEGIES.length)];
  const result = strat(n);
  
  // 20% chance of double-nesting for extra confusion
  if (Math.random() < 0.2 && Math.abs(n) < 10000) {
    const inner = result.lua;
    const wrappers = [
      `(${inner} + 0)`,
      `(${inner} * 1)`,
      `(0 + ${inner})`,
      `(${inner} - 0)`,
      `(${inner} + 1 - 1)`,
    ];
    result.lua = wrappers[Math.floor(Math.random() * wrappers.length)];
  }
  
  return result;
}

function applyNumberMutation(ir) {
  for (const proto of ir.protos) {
    if (!proto.constants) continue;
    for (let ci = 0; ci < proto.constants.length; ci++) {
      const c = proto.constants[ci];
      if (c && c.type === 'number') {
        const mutated = mutateNumber(c.value);
        if (mutated) {
          proto.constants[ci] = {
            ...c,
            type: 'mutated_number',
            lua: mutated.lua,
            value: c.value
          };
        }
      }
    }
  }
  return ir;
}

module.exports = { applyNumberMutation, mutateNumber };
