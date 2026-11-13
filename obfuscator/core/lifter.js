// core/lifter.js
// Parses Luau compilation textDump & binary into a clean Intermediate Representation (IR)

'use strict';

const { OPCODE_NAMES, OPCODE_MODE, OPCODE_HAS_AUX } = require('./opcodeTable');

// ----------------------------------------------------------------------------------------------
// Binary instruction decoder.
//
// Decodes a proto's raw instruction-word stream (the part the old code skipped entirely via
// `pos += sizecode * 4`) directly from the documented Luau bytecode instruction encoding, instead of
// depending on luau-compile.exe's --text disassembly formatting (which was the root fragility behind
// most "breaks on large/complex scripts" bugs: see project notes). Every numeric field layout and AUX
// semantic below was verified against real compiled output (not assumed from the header's prose alone)
// — see the project's Obsidian notes for the empirical verification (GETIMPORT's AUX path-segment
// encoding in particular does NOT match a naive reading of the header comment; it indexes the proto's
// OWN constant table directly, not the file-wide string table).
//
// This produces, per proto, the exact same `{op, args}` shape and `labels` map that the existing
// text-disassembly parser already produces — a deliberate design choice so the rest of the pipeline
// (deadCode.js, luraphGenerator.js) needs ZERO changes and keeps consuming whichever source (binary or
// text) produced the instructions, identically.
// ----------------------------------------------------------------------------------------------

// Fields documented as "N + 1, or 0 for MULTRET" are displayed by the disassembler as (encoded - 1),
// so MULTRET (encoded 0) prints as "-1" and any real count N (encoded N+1) prints as "N" directly.
// Verified against real CALL/RETURN samples.
function fmtCountField(encoded) {
  return encoded === 0 ? '-1' : String(encoded - 1);
}

// Decodes `sizecode` 32-bit instruction words starting at `bin[pos]`. Returns { instructions, labels,
// bytesConsumed } in the same shape the text parser produces, or null if an unknown/unsupported opcode
// is encountered (callers fall back to text-based parsing for that proto rather than risk silently
// wrong output).
function decodeBinaryInstructions(bin, pos, sizecode) {
  const startPos = pos;
  // Pass 1: decode each instruction word (+ aux word if applicable), recording its WORD offset
  // (relative to the start of this proto's instruction stream) so jump targets — which are expressed
  // in Luau's bytecode as word offsets, where any aux-consuming instruction occupies 2 words — can be
  // converted into LOGICAL instruction indices (the indexing scheme the rest of the pipeline uses,
  // where every instruction occupies exactly one array slot regardless of whether it carries an aux
  // word).
  const decoded = []; // { wordOffset, width, opNum, name, A, B, C, D, E, aux }
  const wordOffsetToLogicalIndex = new Map();
  let wordOffset = 0;
  let localPos = pos;
  while (wordOffset < sizecode) {
    const word = bin.readInt32LE(localPos);
    localPos += 4;
    const opNum = word & 0xff;
    const name = OPCODE_NAMES[opNum];
    const mode = OPCODE_MODE[opNum];
    if (!name || !mode) return null; // unknown opcode — bail out, caller falls back to text parsing
    const hasAux = OPCODE_HAS_AUX[opNum];
    let A = 0, B = 0, C = 0, D = 0, E = 0;
    if (mode === 'ABC') {
      A = (word >>> 8) & 0xff;
      B = (word >>> 16) & 0xff;
      C = (word >>> 24) & 0xff;
    } else if (mode === 'AD') {
      A = (word >>> 8) & 0xff;
      D = word >> 16; // arithmetic shift of the signed word — matches LUAU_INSN_D exactly
    } else if (mode === 'E') {
      E = word >> 8; // arithmetic shift of the signed word — matches LUAU_INSN_E exactly
    }
    let aux;
    const width = hasAux ? 2 : 1;
    if (hasAux) {
      if (wordOffset + 1 >= sizecode) return null; // malformed — bail out, fall back safely
      aux = bin.readUInt32LE(localPos) >>> 0;
      localPos += 4;
    }
    // PREPVARARGS is the compiler's implicit first instruction of every vararg function (verified: it
    // is never emitted anywhere else). luau-compile.exe's --text disassembler never prints it at all —
    // confirmed against real compiled output — so the text-based lifter's instruction numbering never
    // includes it. Skip it here too (it's also a pure no-op in the generated VM — see the FASTCALL
    // comment below for the same pattern) so binary-decoded logical indices match the text path's
    // numbering exactly, preserving drop-in compatibility with the rest of the pipeline.
    if (name !== 'PREPVARARGS') {
      wordOffsetToLogicalIndex.set(wordOffset, decoded.length);
      decoded.push({ wordOffset, width, opNum, name, A, B, C, D, E, aux });
    }
    wordOffset += width;
  }

  // Pass 2: format each decoded instruction into the {op, args} string shape, resolving jump offsets
  // into synthesized "L<logicalIndex>" labels via the word-offset map built above.
  const instructions = [];
  const labels = {};
  function resolveTarget(ins, offset) {
    // Base is always wordOffset + 1 (the position immediately after the OPCODE word), never +width.
    // Empirically confirmed: using +width (i.e. +2 for aux-bearing jumps like JUMPXEQKN/FORGLOOP/the
    // JUMPIF*-with-register-2 family) landed exactly one instruction too far on every aux-bearing jump
    // tested — the compiler already folds the aux word's extra position into the encoded offset value
    // itself, so decoding must NOT add a second +1 for it on top of the "+1 for the opcode word."
    const targetWord = ins.wordOffset + 1 + offset;
    const targetIdx = wordOffsetToLogicalIndex.get(targetWord);
    if (targetIdx === undefined) return null; // malformed jump — caller bails to text-parse fallback
    const label = 'L' + targetIdx;
    if (!(label in labels)) labels[label] = targetIdx;
    return label;
  }

  let bail = false;
  for (const ins of decoded) {
    const { name, A, B, C, D, E, aux } = ins;
    let args;
    let importSegIds = null;
    switch (name) {
      case 'NOP': case 'BREAK': case 'COVERAGE': case 'NATIVECALL':
        args = [];
        break;
      case 'LOADNIL':
        args = ['R' + A];
        break;
      case 'LOADB':
        args = ['R' + A, String(B), String(C)];
        break;
      case 'LOADN':
        args = ['R' + A, String(D)];
        break;
      case 'LOADK':
        args = ['R' + A, 'K' + D];
        break;
      case 'LOADKX':
        args = ['R' + A, 'K' + aux];
        break;
      case 'MOVE':
        args = ['R' + A, 'R' + B];
        break;
      case 'GETGLOBAL': case 'SETGLOBAL':
        args = ['R' + A, 'K' + aux];
        break;
      case 'GETUPVAL': case 'SETUPVAL':
        args = ['R' + A, 'U' + B];
        break;
      case 'CLOSEUPVALS':
        args = ['R' + A];
        break;
      case 'GETIMPORT': {
        // AUX packs up to 3 path-segment ids (10 bits each) into the proto's OWN constant table —
        // empirically verified; this is NOT the file-wide string table despite the header's wording.
        const count = aux >>> 30;
        const ids = [(aux >>> 20) & 0x3ff, (aux >>> 10) & 0x3ff, aux & 0x3ff];
        importSegIds = ids.slice(0, count);
        args = ['R' + A, String(D), '[' + importSegIds.map((i) => '\0IMPORT_SEG:' + i).join('.') + ']'];
        break;
      }
      case 'GETTABLE': case 'SETTABLE':
        args = ['R' + A, 'R' + B, 'R' + C];
        break;
      case 'GETTABLEKS': case 'SETTABLEKS':
        args = ['R' + A, 'R' + B, 'K' + aux];
        break;
      case 'GETTABLEN': case 'SETTABLEN':
        args = ['R' + A, 'R' + B, String(C + 1)];
        break;
      case 'NEWCLOSURE':
        args = ['R' + A, 'P' + D];
        break;
      case 'NAMECALL':
        args = ['R' + A, 'R' + B, 'K' + aux];
        break;
      case 'CALL': case 'CALLFB':
        // CALLFB (opcode 87) was found, empirically, to NOT be the rare experimental-only op the header
        // comment's "Version 11 ... Experimental" label suggested (Round 2, Phase 4's new
        // binaryDecodeBails counter caught this: it was silently causing the majority of real-world
        // protos in large scripts to bail to the text fallback). The bundled luau-compile.exe's actual
        // default target is bytecode version 14 (confirmed: byte 0 of real compiled output), not 13 as
        // previously assumed, and at that version CALLFB is commonly emitted in ordinary compiled
        // output. Per Bytecode.h, CALLFB's A/B/C fields are identical to CALL's (function + args in A,
        // arg/result counts in B/C); AUX is only a runtime profiling "feedback slot" id with no
        // semantic effect, already correctly ignored by the VM's CALLFB handler in luraphGenerator.js
        // (which already treats CALLFB exactly like CALL, and was correct before this fix — only the
        // binary decoder's args-formatting switch was missing this case).
        args = ['R' + A, fmtCountField(B), fmtCountField(C)];
        break;
      case 'RETURN':
        args = ['R' + A, fmtCountField(B)];
        break;
      case 'JUMP': case 'JUMPBACK': {
        const lbl = resolveTarget(ins, D);
        if (!lbl) { bail = true; break; }
        args = [lbl];
        break;
      }
      case 'JUMPIF': case 'JUMPIFNOT': {
        const lbl = resolveTarget(ins, D);
        if (!lbl) { bail = true; break; }
        args = ['R' + A, lbl];
        break;
      }
      case 'JUMPIFEQ': case 'JUMPIFLE': case 'JUMPIFLT':
      case 'JUMPIFNOTEQ': case 'JUMPIFNOTLE': case 'JUMPIFNOTLT': {
        const lbl = resolveTarget(ins, D);
        if (!lbl) { bail = true; break; }
        args = ['R' + A, 'R' + aux, lbl];
        break;
      }
      case 'JUMPX': {
        const lbl = resolveTarget(ins, E);
        if (!lbl) { bail = true; break; }
        args = [lbl];
        break;
      }
      case 'JUMPXEQKNIL': {
        const lbl = resolveTarget(ins, D);
        if (!lbl) { bail = true; break; }
        args = ['R' + A, lbl];
        if ((aux >>> 31) & 1) args.push('NOT');
        break;
      }
      case 'JUMPXEQKB': {
        const lbl = resolveTarget(ins, D);
        if (!lbl) { bail = true; break; }
        args = ['R' + A, String(aux & 0x1), lbl];
        if ((aux >>> 31) & 1) args.push('NOT');
        break;
      }
      case 'JUMPXEQKN': case 'JUMPXEQKS': {
        const lbl = resolveTarget(ins, D);
        if (!lbl) { bail = true; break; }
        args = ['R' + A, 'K' + (aux & 0xffffff), lbl];
        if ((aux >>> 31) & 1) args.push('NOT');
        break;
      }
      case 'ADD': case 'SUB': case 'MUL': case 'DIV': case 'MOD': case 'POW': case 'IDIV':
      case 'AND': case 'OR': case 'CONCAT':
        args = ['R' + A, 'R' + B, 'R' + C];
        break;
      case 'ADDK': case 'SUBK': case 'MULK': case 'DIVK': case 'MODK': case 'POWK':
      case 'ANDK': case 'ORK': case 'IDIVK':
        args = ['R' + A, 'R' + B, 'K' + C];
        break;
      case 'SUBRK': case 'DIVRK':
        args = ['R' + A, 'K' + B, 'R' + C];
        break;
      case 'NOT': case 'MINUS': case 'LENGTH':
        args = ['R' + A, 'R' + B];
        break;
      case 'NEWTABLE':
        args = ['R' + A];
        break;
      case 'DUPTABLE':
        args = ['R' + A, 'K' + D];
        break;
      case 'SETLIST':
        args = ['R' + A, 'R' + B, fmtCountField(C), '[' + aux + ']'];
        break;
      case 'FORNPREP': case 'FORNLOOP':
      case 'FORGPREP': case 'FORGPREP_INEXT': case 'FORGPREP_NEXT': {
        const lbl = resolveTarget(ins, D);
        if (!lbl) { bail = true; break; }
        args = ['R' + A, lbl];
        break;
      }
      case 'FORGLOOP': {
        const lbl = resolveTarget(ins, D);
        if (!lbl) { bail = true; break; }
        args = ['R' + A, lbl, String(aux & 0xff)];
        break;
      }
      case 'GETVARARGS':
        args = ['R' + A, fmtCountField(B)];
        break;
      case 'DUPCLOSURE':
        args = ['R' + A, 'K' + D];
        break;
      case 'PREPVARARGS':
        args = ['R' + A];
        break;
      case 'CAPTURE': {
        const typeStr = A === 0 ? 'VAL' : A === 1 ? 'REF' : 'UPVAL';
        const srcStr = (A === 2 ? 'U' : 'R') + B;
        args = [typeStr, srcStr];
        break;
      }
      // FASTCALL family and FASTPCALL family: the generated VM treats these as pure no-ops (it never
      // implements the inline fast path, always falling through to the real GETIMPORT/MOVE/GETUPVAL +
      // CALL sequence that follows) — confirmed by reading their VM handler bodies, all of which are
      // just `vPc = vPc + 1`. Their builtin-id/register/jump-offset fields are therefore never read by
      // anything downstream; no args formatting needed beyond not crashing, and no label registration
      // (the VM never actually jumps there).
      case 'FASTCALL': case 'FASTCALL1': case 'FASTCALL2': case 'FASTCALL2K': case 'FASTCALL3':
      case 'FASTPCALL': case 'FASTPCALL1': case 'FASTPCALL2':
        args = [];
        break;
      default:
        // Any opcode reachable only via genuinely experimental/WIP bytecode versions (Luau Classes,
        // CMPPROTO, atom-accelerated userdata access) that we haven't modeled precisely: bail out to
        // the text-parsing fallback rather than risk silently-wrong output for something this rare.
        // (CALLFB used to hit this case too until Round 2, Phase 4 found it was wrongly assumed rare —
        // see its own case above and the note in core/opcodeTable.js.)
        bail = true;
        args = [];
    }
    if (bail) return null;
    const pushed = { op: name, args, raw: name + ' ' + args.join(' ') };
    if (importSegIds) pushed._importSegIds = importSegIds;
    instructions.push(pushed);
  }

  return { instructions, labels, bytesConsumed: localPos - startPos };
}

/**
 * Bulletproof Luau Binary Bytecode Parser.
 * Accurately extracts all prototypes, constants, protolists, and upvalues directly from the compiled binary.
 */
// `report`, if provided, is mutated with bail diagnostics regardless of whether this function returns
// null or a real result — this is how liftBytecode() surfaces `stats.binaryDecodeBails` (Round 2,
// Phase 4) without changing this function's existing null-means-"use text" return contract that every
// call site already relies on (`binData ? binData.X : fallback`).
function parseBytecodeProtos(bin, report) {
  if (!report) report = {};
  report.perProtoBails = 0;
  report.fullBail = false;
  report.fullBailReason = null;
  if (!bin || !Buffer.isBuffer(bin) || bin.length === 0) return null;
  try {
    let pos = 0;
    const version = bin.readUInt8(pos++);
    let typesVersion = 0;
    if (version >= 4) typesVersion = bin.readUInt8(pos++);

    function readVarInt() {
      let result = 0, shift = 0, byte = 0;
      do {
        byte = bin.readUInt8(pos++);
        result |= (byte & 0x7f) << shift;
        shift += 7;
      } while (byte & 0x80);
      return result;
    }

    const stringCount = readVarInt();
    const strings = [''];
    for (let i = 0; i < stringCount; i++) {
      const len = readVarInt();
      strings.push(bin.toString('utf8', pos, pos + len));
      pos += len;
    }

    const userdataTypes = readVarInt();
    for (let i = 0; i < userdataTypes; i++) readVarInt();
    const protoCount = readVarInt();

    const protos = [];

    for (let p = 0; p < protoCount; p++) {
      const protoSize = version >= 12 ? readVarInt() : null;
      const pStart = pos;
      const maxStack = bin.readUInt8(pos++);
      const numParams = bin.readUInt8(pos++);
      const nups = bin.readUInt8(pos++);
      const isVararg = bin.readUInt8(pos++);
      if (version >= 4) {
        const flags = bin.readUInt8(pos++);
        const typeSize = readVarInt();
        pos += typeSize;
      }
      const sizecode = readVarInt();
      const codeStartPos = pos;
      let binDecoded = null;
      try {
        binDecoded = decodeBinaryInstructions(bin, pos, sizecode);
      } catch (_) {
        binDecoded = null;
      }
      if (binDecoded === null) report.perProtoBails++;
      // Always advance by the declared word count regardless of whether decoding succeeded — this
      // keeps the rest of the (proven, unrelated) binary parsing below correctly positioned even if
      // the new instruction decoder bails out for this proto; it falls back to text-based parsing for
      // that proto's instructions later, in liftBytecode().
      pos = codeStartPos + sizecode * 4;
      const sizek = readVarInt();
      const constants = [];
      for (let k = 0; k < sizek; k++) {
        const kt = bin.readUInt8(pos++);
        if (kt === 0) {
          constants.push({ type: 'nil' });
        } else if (kt === 1) {
          constants.push({ type: 'bool', value: bin.readUInt8(pos++) === 1 });
        } else if (kt === 2) {
          const num = bin.readDoubleLE(pos); pos += 8;
          constants.push({ type: 'number', value: num });
        } else if (kt === 3) {
          const strId = readVarInt();
          constants.push({ type: 'string', value: strings[strId] });
        } else if (kt === 4) {
          const imp = bin.readUInt32LE(pos); pos += 4;
          constants.push({ type: 'import', value: imp });
        } else if (kt === 5) {
          const len = readVarInt();
          const keys = [];
          for (let j = 0; j < len; j++) keys.push(readVarInt());
          constants.push({ type: 'table', keys });
        } else if (kt === 6) {
          const pId = readVarInt();
          constants.push({ type: 'closure', value: pId });
        } else if (kt === 7) {
          pos += 16;
          constants.push({ type: 'vec' });
        } else if (kt === 8) {
          const len = readVarInt();
          for (let j = 0; j < len; j++) { readVarInt(); pos += 4; }
          constants.push({ type: 'table' });
        } else if (kt === 9) {
          // LBC_CONSTANT_INTEGER: a real 64-bit integer, not a table — was previously mistagged as
          // 'table' and only skipped 4 bytes (half of the real 8-byte field), silently desyncing every
          // byte read afterward for this proto whenever this constant kind was actually used. Luau's
          // 64-bit integer literal syntax is rare in typical Roblox scripts, which is likely why this
          // went unnoticed; fixed properly rather than left as a skip now that it's been flagged.
          const big = bin.readBigInt64LE(pos);
          pos += 8;
          // Values beyond 2^53 lose precision converting to a JS double — an accepted, documented
          // limitation (Luau numbers are themselves IEEE-754 doubles everywhere else in this pipeline;
          // there is no lossless 64-bit integer path through the rest of the obfuscator regardless).
          constants.push({ type: 'number', value: Number(big) });
        } else if (kt === 10 || kt === 11) {
          // LBC_CONSTANT_CLASS_SHAPE (experimental Luau Classes) / LBC_CONSTANT_VECTORD (double-
          // precision vector, experimental) — both version-gated features our default compile flags
          // don't enable, so these should never actually appear; no exact byte layout has been
          // verified for either. Bail out to the text-based fallback for this whole proto rather than
          // guess at a skip length and silently desync every subsequent byte read, which is exactly
          // the failure mode the 64-bit integer bug above demonstrated.
          report.fullBail = true;
          report.fullBailReason = `unmodeled constant tag ${kt} (LBC_CONSTANT_CLASS_SHAPE/VECTORD)`;
          return null;
        } else {
          // Any other/future constant tag: same reasoning — fail safely rather than guess.
          report.fullBail = true;
          report.fullBailReason = `unknown constant tag ${kt}`;
          return null;
        }
      }
      const sizep = readVarInt();
      const protolist = [];
      for (let j = 0; j < sizep; j++) protolist.push(readVarInt());

      // Fix up GETIMPORT's bracket-displayed path name now that this proto's own constant table
      // (which the AUX-encoded segment ids index into — see decodeBinaryInstructions' comment) is
      // available. The decoder could only leave a placeholder earlier, since constants are parsed
      // after the instruction stream in the binary layout.
      if (binDecoded && binDecoded.instructions) {
        for (const ins of binDecoded.instructions) {
          if (ins.op === 'GETIMPORT' && Array.isArray(ins._importSegIds)) {
            const segs = ins._importSegIds.map((segIdx) => {
              const c = constants[segIdx];
              return c && c.type === 'string' ? c.value : '?';
            });
            ins.args[2] = '[' + segs.join('.') + ']';
            delete ins._importSegIds;
          }
        }
      }

      protos.push({
        id: p, maxStack, numParams, nups, isVararg, constants, protolist,
        binInstructions: binDecoded ? binDecoded.instructions : null,
        binLabels: binDecoded ? binDecoded.labels : null,
      });
      if (protoSize !== null) pos = pStart + protoSize;
    }
    const mainProto = readVarInt();
    return { strings, protos, mainProto };
  } catch (err) {
    if (!report.fullBail) {
      report.fullBail = true;
      report.fullBailReason = `unexpected parse error: ${err.message}`;
    }
    return null;
  }
}

/**
 * Extracts raw UTF-8 string table from Luau binary bytecode.
 */
function parseLuauStringTable(bytecode) {
  if (!bytecode || !Buffer.isBuffer(bytecode) || bytecode.length === 0) return [];
  try {
    let pos = 0;
    const version = bytecode.readUInt8(pos++);
    function readVarInt() {
      let result = 0;
      let shift = 0;
      let byte = 0;
      do {
        byte = bytecode.readUInt8(pos++);
        result |= (byte & 0x7f) << shift;
        shift += 7;
      } while (byte & 0x80);
      return result;
    }

    if (version >= 4) {
      pos++; // typesVersion
    }

    const stringCount = readVarInt();
    const strings = [];
    strings.push(''); // 1-indexed in Luau bytecode
    for (let i = 0; i < stringCount; i++) {
      const len = readVarInt();
      const str = bytecode.toString('utf8', pos, pos + len);
      pos += len;
      strings.push(str);
    }
    return strings;
  } catch (_) {
    return [];
  }
}

/**
 * Resolves a constant string (potentially truncated with '...) against the binary string table.
 */
function resolveStringConstant(kValRaw, stringTable, ctx) {
  let isTruncated = false;
  let target = '';

  if (kValRaw.startsWith("'") && kValRaw.endsWith("'...")) {
    isTruncated = true;
    target = kValRaw.slice(1, -4);
  } else if (kValRaw.startsWith("'") && kValRaw.endsWith("'")) {
    target = kValRaw.slice(1, -1);
  } else if (kValRaw.startsWith('"') && kValRaw.endsWith('"')) {
    target = kValRaw.slice(1, -1);
  } else {
    return null;
  }

  const unescapeDisasm = (str) => {
    return str
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
  };

  const unescapedTarget = unescapeDisasm(target);

  if (stringTable && stringTable.length > 0) {
    // Build (once per ctx, i.e. once per liftBytecode call) an index from exact string value and from
    // 16-char prefix to a list of table indices. Without this, every resolution did a linear forward
    // scan + wraparound scan + (for truncated values) a full second linear scan over the WHOLE string
    // table — fine for a handful of strings, but a real O(n^2)-worst-case cliff for scripts with many
    // string constants, which is exactly the kind of script this fallback is more likely to be hit on
    // repeatedly (large/complex scripts have more strings AND more opportunities for the binary/text
    // proto indexing to disagree, which is what routes a lookup into this fallback in the first place).
    if (ctx && !ctx._strIndex) {
      const byValue = new Map();
      const byPrefix = new Map();
      const shortStrings = []; // strings under 16 chars can't go in the prefix index
      for (let i = 1; i < stringTable.length; i++) {
        const s = stringTable[i];
        if (!byValue.has(s)) byValue.set(s, []);
        byValue.get(s).push(i);
        if (s.length >= 16) {
          const p = s.slice(0, 16);
          if (!byPrefix.has(p)) byPrefix.set(p, []);
          byPrefix.get(p).push(i);
        } else {
          shortStrings.push(i);
        }
      }
      ctx._strIndex = { byValue, byPrefix, shortStrings };
    }
    const idx = ctx && ctx._strIndex;

    if (idx) {
      // Exact match: prefer the earliest index >= lastIdx (preserves the old "search forward, then
      // wrap" preference order for which occurrence gets picked when a string value repeats), falling
      // back to the first occurrence at all.
      const candidates = idx.byValue.get(unescapedTarget);
      if (candidates && candidates.length > 0) {
        const startIdx = (ctx && ctx.lastIdx) ? ctx.lastIdx : 1;
        let chosen = candidates.find((i) => i >= startIdx);
        if (chosen === undefined) chosen = candidates[0];
        ctx.lastIdx = chosen + 1;
        return stringTable[chosen];
      }
      if (isTruncated) {
        // Truncated values only ever carry the plain (non-unescaped) `target` or its unescaped form as
        // a PREFIX of the real string, so prefix-index both forms.
        const p1 = target.length >= 16 ? target.slice(0, 16) : null;
        const p2 = unescapedTarget.length >= 16 ? unescapedTarget.slice(0, 16) : null;
        for (const p of [p1, p2]) {
          if (!p) continue;
          const bucket = idx.byPrefix.get(p);
          if (bucket) {
            for (const i of bucket) {
              const s = stringTable[i];
              if (s.startsWith(target) || s.startsWith(unescapedTarget)) {
                ctx.lastIdx = i + 1;
                return s;
              }
            }
          }
        }
        // Strings shorter than 16 chars aren't in the prefix index (in practice the disassembler only
        // truncates long constants, so this almost never has candidates) — last-resort scan over just
        // that small subset, not the whole table, to preserve full correctness without reintroducing
        // the full-table-scan cost this fix removes.
        for (const i of idx.shortStrings) {
          const s = stringTable[i];
          if (s.startsWith(target) || s.startsWith(unescapedTarget)) {
            ctx.lastIdx = i + 1;
            return s;
          }
        }
      }
    }
  }

  return unescapedTarget;
}

/**
 * Bulletproof Luau table template parser for DUPTABLE constants.
 * Correctly handles quotes inside strings, conflict remarks, hash comments, and truncated strings.
 */
function cleanTableTemplate(kValRaw) {
  let inner = kValRaw.replace(/\s*sizenode=\d+/gi, '').replace(/\s*size=\d+/gi, '').trim();
  if (inner.startsWith('{')) inner = inner.slice(1);
  if (inner.endsWith('}')) inner = inner.slice(0, -1);
  
  const keyRegex = /\[(['"])(.*?)\1\]/g;
  let match;
  const keyPositions = [];
  while ((match = keyRegex.exec(inner)) !== null) {
    keyPositions.push({
      key: match[2],
      start: match.index,
      end: match.index + match[0].length
    });
  }

  const entries = [];
  for (let i = 0; i < keyPositions.length; i++) {
    const cur = keyPositions[i];
    const key = cur.key;
    const valueStart = cur.end;
    const valueEnd = (i + 1 < keyPositions.length) ? keyPositions[i + 1].start : inner.length;
    let valueSegment = inner.substring(valueStart, valueEnd).trim();
    
    valueSegment = valueSegment.replace(/,\s*$/, '').trim();
    valueSegment = valueSegment.replace(/\s*\(conflict[^\)]*\)/gi, '').trim();
    valueSegment = valueSegment.replace(/#\d+/g, '').trim();

    let valLua = 'nil';
    if (valueSegment.startsWith('=')) {
      let rawVal = valueSegment.substring(1).trim();
      rawVal = rawVal.replace(/\s*\(conflict[^\)]*\)/gi, '').trim();
      rawVal = rawVal.replace(/#\d+/g, '').trim();
      
      if (!isNaN(Number(rawVal)) && rawVal !== '') {
        valLua = rawVal;
      } else if (rawVal === 'true' || rawVal === 'false') {
        valLua = rawVal;
      } else if (rawVal.startsWith("'") || rawVal.startsWith('"')) {
        let strVal = rawVal;
        if (strVal.endsWith('...')) strVal = strVal.slice(0, -3).trim();
        if (strVal.startsWith("'") && strVal.endsWith("'")) strVal = strVal.slice(1, -1);
        else if (strVal.startsWith('"') && strVal.endsWith('"')) strVal = strVal.slice(1, -1);
        else if (strVal.startsWith("'")) strVal = strVal.slice(1);
        else if (strVal.startsWith('"')) strVal = strVal.slice(1);
        valLua = JSON.stringify(strVal);
      } else {
        valLua = 'nil';
      }
    }
    
    entries.push(`[${JSON.stringify(key)}] = ${valLua}`);
  }

  return '{ ' + entries.join(', ') + ' }';
}

/**
 * Parses the disassembled text output from `luau-compile --dump-constants --text`
 * into structured functions, constants, instructions, and labels.
 */
function liftBytecode(compileResult) {
  const text = compileResult.textDump || '';
  const lines = text.split(/\r?\n/);
  const decodeReport = {};
  const binData = parseBytecodeProtos(compileResult.bytecode, decodeReport);
  const stringTable = binData ? binData.strings : parseLuauStringTable(compileResult.bytecode);

  const protos = [];
  let currentProto = null;
  const stringCtx = { lastIdx: 1 };

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx];
    const line = rawLine.trim();

    if (!line) continue;

    // Function header: e.g. "Function 0 (add):" or "Function 1 (??):"
    const fnMatch = line.match(/^Function\s+(\d+)\s*\(([^)]*)\):/);
    if (fnMatch) {
      if (currentProto) protos.push(currentProto);
      currentProto = {
        id: parseInt(fnMatch[1], 10),
        name: fnMatch[2],
        constants: [],
        instructions: [],
        labels: {},
        maxStackSize: 32,
        numParams: 0,
        numUpvalues: 0,
        isVararg: 1
      };
      continue;
    }

    if (!currentProto) continue;

    // Constants: e.g. "K0: 'hello'" or "K1: 42" or "K2: print"
    const kMatch = line.match(/^K(\d+):\s*(.*)$/);
    if (kMatch) {
      const kIndex = parseInt(kMatch[1], 10);
      const kValRaw = kMatch[2];
      let constant = { index: kIndex, raw: kValRaw };

      const binProto = binData ? binData.protos[currentProto.id] : null;
      const binConst = binProto && binProto.constants ? binProto.constants[kIndex] : null;

      if (binConst && binConst.type === 'string') {
        constant.type = 'string';
        constant.value = binConst.value;
      } else if (binConst && binConst.type === 'closure') {
        constant.type = 'proto_ref';
        constant.value = String(binConst.value);
        constant.targetProtoId = binConst.value;
      } else if (binConst && binConst.type === 'number') {
        constant.type = 'number';
        constant.value = binConst.value;
        if (Object.is(binConst.value, -0)) constant.lua = '(-0)';
        else if (Number.isNaN(binConst.value)) constant.lua = '(0/0)';
        else if (binConst.value === Infinity) constant.lua = 'math.huge';
        else if (binConst.value === -Infinity) constant.lua = '(-math.huge)';
      } else if (binConst && binConst.type === 'bool') {
        constant.type = 'boolean';
        constant.value = binConst.value;
      } else {
        const resolvedStr = resolveStringConstant(kValRaw, stringTable, stringCtx);
        if (resolvedStr !== null) {
          constant.type = 'string';
          constant.value = resolvedStr;
        } else if (kValRaw === 'inf') {
          constant.type = 'number';
          constant.value = Infinity;
          constant.lua = 'math.huge';
        } else if (kValRaw === '-inf') {
          constant.type = 'number';
          constant.value = -Infinity;
          constant.lua = '(-math.huge)';
        } else if (/^-?nan/i.test(kValRaw)) {
          constant.type = 'number';
          constant.value = NaN;
          constant.lua = '(0/0)';
        } else if (kValRaw === '-0' || Object.is(Number(kValRaw), -0)) {
          constant.type = 'number';
          constant.value = -0;
          constant.lua = '(-0)';
        } else if (!isNaN(Number(kValRaw))) {
          // Number literal
          constant.type = 'number';
          constant.value = Number(kValRaw);
        } else if (kValRaw.startsWith('function') || kValRaw === 'function') {
          constant.type = 'proto_ref';
          constant.value = kValRaw.replace(/^function\s*/, '').trim();
        } else if (kValRaw.startsWith('{')) {
          constant.type = 'table_template';
          constant.lua = cleanTableTemplate(kValRaw);
        } else {
          constant.type = 'identifier';
          constant.value = kValRaw.replace(/^\[|\]$/g, '').trim();
        }
      }

      currentProto.constants[kIndex] = constant;
      continue;
    }

    // Skip source line mappings or remarks (e.g. "  1: local x = 10", "REMARK ...", "0 R12: any", "slot 0:")
    if (/^\d+:/.test(line) || line.startsWith('REMARK') || /^(\d+\s+)?([RU]\d+:|slot\s+\d+:)/.test(line)) {
      continue;
    }

    // Label: e.g. "L0:" or "L1: RETURN R0 0" or even "L3: L4: RETURN R0 0" (two jump targets
    // coinciding on one disassembly line — strip ALL leading labels, not just the first one,
    // or a second coincident label silently vanishes and its "L4:" text gets parsed as a bogus
    // instruction (op="L4:") further down. This is far more likely in large/complex scripts with
    // more overlapping jump/loop targets than in small test scripts.
    let workingLine = line;
    for (;;) {
      const labelMatch = workingLine.match(/^(L\d+):\s*(.*)$/);
      if (!labelMatch) break;
      const labelName = labelMatch[1];
      currentProto.labels[labelName] = currentProto.instructions.length;
      workingLine = labelMatch[2].trim();
    }
    if (!workingLine) continue;

    // Instruction parse
    const parts = workingLine.split(/\s+/);
    const op = parts[0];
    const args = parts.slice(1);

    currentProto.instructions.push({
      op,
      args,
      raw: workingLine
    });
  }

  if (currentProto) {
    protos.push(currentProto);
  }

  // Attach exact child protolists and VM limits from binary bytecode if available
  if (binData && binData.protos) {
    for (const proto of protos) {
      const bp = binData.protos[proto.id];
      if (bp) {
        proto.protolist = bp.protolist;
        proto.maxStackSize = Math.max(proto.maxStackSize || 32, bp.maxStack);
        proto.numParams = bp.numParams;
        proto.numUpvalues = bp.nups;
        proto.isVararg = bp.isVararg;
        // Prefer instructions decoded directly from the real binary instruction words over the
        // text-disassembly-derived ones built above, when available — this is the actual fix for the
        // lifter's root fragility (dependency on luau-compile.exe's --text formatting staying in a
        // simple, stable shape). Falls back to the already-built text-derived instructions/labels for
        // this proto automatically if binary decoding bailed out for it (bp.binInstructions is null),
        // e.g. an opcode outside what's modeled in decodeBinaryInstructions.
        // module.exports.FORCE_TEXT_LIFT can be set by a test/debug driver to force the legacy
        // text-only path for differential comparison against the binary path.
        if (bp.binInstructions && !module.exports.FORCE_TEXT_LIFT) {
          proto.instructions = bp.binInstructions;
          proto.labels = bp.binLabels || {};
        }
      }
    }
  } else if (compileResult.ast && compileResult.ast.root) {
    let nextProtoId = 0;
    function processFunction(funcNode) {
      funcNode.childFuncs = [];
      function findChildren(node) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'AstExprFunction') {
          processFunction(node);
          funcNode.childFuncs.push(node);
          return;
        }
        for (const k of Object.keys(node)) {
          if (k !== 'parent') findChildren(node[k]);
        }
      }
      if (funcNode.body) findChildren(funcNode.body);
      funcNode.protoId = nextProtoId++;
    }

    const rootFunc = { type: 'AstExprFunction', body: compileResult.ast.root, debugname: '__main__' };
    processFunction(rootFunc);

    function attachProtolists(node) {
      const p = protos.find(pr => pr.id === node.protoId);
      if (p) {
        p.protolist = (node.childFuncs || []).map(c => c.protoId);
        p.numParams = (node.self ? 1 : 0) + ((node.args && Array.isArray(node.args)) ? node.args.length : 0);
      }
      for (const c of (node.childFuncs || [])) attachProtolists(c);
    }
    attachProtolists(rootFunc);
  }

  // Fallback if AST and binary were unavailable
  const mainProtoId = (binData && binData.mainProto !== undefined) ? binData.mainProto : (protos.length > 0 ? protos.length - 1 : 0);
  for (const proto of protos) {
    if (!proto.protolist) {
      if (proto.id === mainProtoId) {
        proto.protolist = [];
      } else {
        const closures = (proto.instructions || []).filter(ins => ins.op === 'NEWCLOSURE' || ins.op === 'DUPCLOSURE');
        const M = closures.length;
        proto.protolist = [];
        for (let k = 0; k < M; k++) {
          proto.protolist.push((proto.id - M) + k);
        }
      }
    }
  }

  // Resolve targetProtoId for all closures (both NEWCLOSURE and DUPCLOSURE)
  for (const proto of protos) {
    if (!proto.instructions) continue;
    const plist = proto.protolist || [];
    const taken = new Set();
    proto.instructions.forEach(ins => {
      if (ins.op === 'NEWCLOSURE') {
        const d = parseInt((ins.args[1] || '').replace(/^P/, ''), 10) || 0;
        taken.add(d);
        ins.targetProtoId = plist[d] !== undefined ? plist[d] : d;
      }
    });

    const remainingIndices = [];
    for (let i = 0; i < plist.length; i++) {
      if (!taken.has(i)) remainingIndices.push(i);
    }
    let rIdx = 0;
    proto.instructions.forEach(ins => {
      if (ins.op === 'DUPCLOSURE') {
        const kIdx = parseInt((ins.args[1] || '').replace(/^K/, ''), 10);
        if (proto.constants && proto.constants[kIdx] && proto.constants[kIdx].targetProtoId !== undefined) {
          ins.targetProtoId = proto.constants[kIdx].targetProtoId;
        } else {
          const childIdx = remainingIndices[rIdx++];
          const targetProtoId = plist[childIdx] !== undefined ? plist[childIdx] : childIdx;
          ins.targetProtoId = targetProtoId;
          if (proto.constants && proto.constants[kIdx]) {
            proto.constants[kIdx].targetProtoId = targetProtoId;
          }
        }
      }
    });
  }

  // Round 2, Phase 4: surface decoder-coverage gaps as a real stat instead of a silent per-proto
  // fallback. binaryDecodeBails counts protos whose instructions came from the text-disassembly path
  // because the binary decoder couldn't handle them (0 expected on any non-experimental compile).
  const binaryDecodeBails = decodeReport.fullBail
    ? protos.length
    : decodeReport.perProtoBails;

  return {
    protos,
    mainProto: mainProtoId,
    rawBytecode: compileResult.bytecode,
    binaryDecodeBails,
    binaryDecodeFullBail: decodeReport.fullBail,
    binaryDecodeFullBailReason: decodeReport.fullBailReason
  };
}

module.exports = { liftBytecode, parseLuauStringTable };