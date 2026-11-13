// core/opcodeTable.js
// Authoritative Luau bytecode opcode table, transcribed directly from the official Luau source
// (luau-lang/luau, Common/include/Luau/Bytecode.h, the `LuauOpcode` enum — MIT licensed). Opcode NUMBER
// is the array index (order-sensitive, per that file's own comment: "ALL enums declared in this file
// are order-sensitive since the values are baked into bytecode"). NAME matches what luau-compile.exe's
// --text disassembler prints (verified against real compiled samples — see core/lifter.js's binary
// decoder for the empirically-verified field semantics, especially around AUX encodings, which are NOT
// simply "whatever the header comment literally says" in a couple of surprising cases).
//
// MODE is the instruction word's operand layout: 'ABC' (three 8-bit fields A/B/C), 'AD' (8-bit A + signed
// 16-bit D), or 'E' (signed 24-bit E only). HAS_AUX marks instructions followed by one extra 32-bit word.
//
// The bundled luau-compile.exe's REAL default target is bytecode version 14, confirmed by reading byte
// 0 of real compiled output (an earlier assumption of "version 13" here was wrong, and masked a real
// decoder-coverage gap — see CALLFB's note below). Opcodes gated behind genuinely experimental/WIP
// versions (Luau Classes, v100+) are included for completeness/defensive handling and confirmed to
// never actually appear in this project's real fixture corpus; see each one's own note for what was
// actually checked versus merely assumed from the upstream header's doc labels.

'use strict';

const OPCODE_TABLE = [
  // num, name, mode, hasAux
  [0, 'NOP', 'ABC', false],
  [1, 'BREAK', 'ABC', false],
  [2, 'LOADNIL', 'ABC', false],
  [3, 'LOADB', 'ABC', false],
  [4, 'LOADN', 'AD', false],
  [5, 'LOADK', 'AD', false],
  [6, 'MOVE', 'ABC', false],
  [7, 'GETGLOBAL', 'ABC', true],
  [8, 'SETGLOBAL', 'ABC', true],
  [9, 'GETUPVAL', 'ABC', false],
  [10, 'SETUPVAL', 'ABC', false],
  [11, 'CLOSEUPVALS', 'ABC', false],
  [12, 'GETIMPORT', 'AD', true],
  [13, 'GETTABLE', 'ABC', false],
  [14, 'SETTABLE', 'ABC', false],
  [15, 'GETTABLEKS', 'ABC', true],
  [16, 'SETTABLEKS', 'ABC', true],
  [17, 'GETTABLEN', 'ABC', false],
  [18, 'SETTABLEN', 'ABC', false],
  [19, 'NEWCLOSURE', 'AD', false],
  [20, 'NAMECALL', 'ABC', true],
  [21, 'CALL', 'ABC', false],
  [22, 'RETURN', 'ABC', false],
  [23, 'JUMP', 'AD', false],
  [24, 'JUMPBACK', 'AD', false],
  [25, 'JUMPIF', 'AD', false],
  [26, 'JUMPIFNOT', 'AD', false],
  [27, 'JUMPIFEQ', 'AD', true],
  [28, 'JUMPIFLE', 'AD', true],
  [29, 'JUMPIFLT', 'AD', true],
  [30, 'JUMPIFNOTEQ', 'AD', true],
  [31, 'JUMPIFNOTLE', 'AD', true],
  [32, 'JUMPIFNOTLT', 'AD', true],
  [33, 'ADD', 'ABC', false],
  [34, 'SUB', 'ABC', false],
  [35, 'MUL', 'ABC', false],
  [36, 'DIV', 'ABC', false],
  [37, 'MOD', 'ABC', false],
  [38, 'POW', 'ABC', false],
  [39, 'ADDK', 'ABC', false],
  [40, 'SUBK', 'ABC', false],
  [41, 'MULK', 'ABC', false],
  [42, 'DIVK', 'ABC', false],
  [43, 'MODK', 'ABC', false],
  [44, 'POWK', 'ABC', false],
  [45, 'AND', 'ABC', false],
  [46, 'OR', 'ABC', false],
  [47, 'ANDK', 'ABC', false],
  [48, 'ORK', 'ABC', false],
  [49, 'CONCAT', 'ABC', false],
  [50, 'NOT', 'ABC', false],
  [51, 'MINUS', 'ABC', false],
  [52, 'LENGTH', 'ABC', false],
  [53, 'NEWTABLE', 'ABC', true],
  [54, 'DUPTABLE', 'AD', false],
  [55, 'SETLIST', 'ABC', true],
  [56, 'FORNPREP', 'AD', false],
  [57, 'FORNLOOP', 'AD', false],
  [58, 'FORGLOOP', 'AD', true],
  [59, 'FORGPREP_INEXT', 'AD', false],
  [60, 'FASTCALL3', 'ABC', true],
  [61, 'FORGPREP_NEXT', 'AD', false],
  [62, 'NATIVECALL', 'ABC', false], // pseudo-op, never emitted by the compiler
  [63, 'GETVARARGS', 'ABC', false],
  [64, 'DUPCLOSURE', 'AD', false],
  [65, 'PREPVARARGS', 'ABC', false],
  [66, 'LOADKX', 'ABC', true],
  [67, 'JUMPX', 'E', false],
  [68, 'FASTCALL', 'ABC', false],
  [69, 'COVERAGE', 'E', false],
  [70, 'CAPTURE', 'ABC', false],
  [71, 'SUBRK', 'ABC', false],
  [72, 'DIVRK', 'ABC', false],
  [73, 'FASTCALL1', 'ABC', false],
  [74, 'FASTCALL2', 'ABC', true],
  [75, 'FASTCALL2K', 'ABC', true],
  [76, 'FORGPREP', 'AD', false],
  [77, 'JUMPXEQKNIL', 'AD', true],
  [78, 'JUMPXEQKB', 'AD', true],
  [79, 'JUMPXEQKN', 'AD', true],
  [80, 'JUMPXEQKS', 'AD', true],
  [81, 'IDIV', 'ABC', false],
  [82, 'IDIVK', 'ABC', false],
  // Atom-based userdata field access acceleration (bytecode v9, "currently supported" but requires
  // --typeinfo-driven compilation to ever be emitted; not expected from our default compile flags).
  [83, 'GETUDATAKS', 'ABC', true],
  [84, 'SETUDATAKS', 'ABC', true],
  [85, 'NAMECALLUDATA', 'ABC', true],
  // Experimental (Luau Classes, v10+) — not expected from a default, non-flag-gated compile.
  [86, 'NEWCLASSMEMBER', 'ABC', true],
  // CALLFB (87): the Luau reference header's "Version 11 ... Experimental" label is misleading for
  // THIS project — empirically confirmed (Round 2, Phase 4) that the bundled luau-compile.exe's real
  // default target is bytecode version 14 (not 13, as previously assumed — see core/compiler.js), and
  // at that version CALLFB is commonly emitted for ordinary function calls in real compiled output
  // (not rare/experimental in practice). Decoded with the same args shape as CALL in core/lifter.js.
  [87, 'CALLFB', 'ABC', true],
  // CMPPROTO (88): same "Version 11 ... Experimental" doc label as CALLFB, but — unlike CALLFB — zero
  // occurrences found across ~103,000 real instructions / ~2,400 protos in this project's full fixture
  // corpus (two real production scripts + two large third-party scripts). Left modeled defensively
  // (bails safely to text fallback, per the `default:` case in core/lifter.js) rather than guessed at.
  [88, 'CMPPROTO', 'AD', true],
  // FASTPCALL (89): the header lists this as "Currently supported" at v14 (our real default target —
  // see CALLFB's note above), but like CMPPROTO, zero occurrences found in the same corpus. Left
  // modeled defensively for the same reason — revisit if a future fixture ever actually bails on it.
  [89, 'FASTPCALL', 'ABC', false],
  // Experimental (Luau Classes, v100) — not expected.
  [90, 'NEWCLASS', 'ABC', true],
  [91, 'CONSTRUCT', 'ABC', true],
  [92, 'FINCONSTRUCT', 'ABC', false],
  [93, 'GETPRIVATEFIELD', 'ABC', true],
  [94, 'SETPRIVATEFIELD', 'ABC', true],
];

const OPCODE_NAMES = [];
const OPCODE_MODE = [];
const OPCODE_HAS_AUX = [];
const OPCODE_NUMBER_BY_NAME = {};
for (const [num, name, mode, hasAux] of OPCODE_TABLE) {
  OPCODE_NAMES[num] = name;
  OPCODE_MODE[num] = mode;
  OPCODE_HAS_AUX[num] = hasAux;
  OPCODE_NUMBER_BY_NAME[name] = num;
}

module.exports = { OPCODE_NAMES, OPCODE_MODE, OPCODE_HAS_AUX, OPCODE_NUMBER_BY_NAME };
