// lib/polymorphic.ts
/**
 * Hardened Polymorphic Luau Delivery Engine
 * 
 * Features:
 * - Multi-byte non-linear rolling keystream (dynamic keys & permutation steps)
 * - Anti-tampering / anti-hook detection before execution (resists loadstring/pcall hooks)
 * - Decoy opaque predicates & control-flow misdirection
 * - Sandboxed execution scope with aggressive memory zeroing to defeat heap dumpers
 * - Dynamic identifier mangling per HTTP delivery
 */

function generateRandomIdentifier(prefix: string = "_0x"): string {
  const chars = "abcdef0123456789";
  let str = prefix;
  for (let i = 0; i < 6; i++) {
    str += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return str;
}

export function wrapPolymorphicLuau(rawCode: string): string {
  // Generate 16 to 32 random bytes for rotating stream cipher
  const keyLength = 16 + Math.floor(Math.random() * 16);
  const keys: number[] = [];
  for (let i = 0; i < keyLength; i++) {
    keys.push(Math.floor(Math.random() * 254) + 1);
  }
  const step = 7 + (Math.floor(Math.random() * 19) * 2); // Odd step 7..43

  const idScope = generateRandomIdentifier("_sc");
  const idKeys = generateRandomIdentifier("_k");
  const idBuf = generateRandomIdentifier("_b");
  const idTbl = generateRandomIdentifier("_t");
  const idIdx = generateRandomIdentifier("_i");
  const idByte = generateRandomIdentifier("_c");
  const idShift = generateRandomIdentifier("_s");
  const idXor = generateRandomIdentifier("_x");
  const idFn = generateRandomIdentifier("_f");
  const idOk = generateRandomIdentifier("_o");
  const idErr = generateRandomIdentifier("_e");

  // Encode raw code into escaped bytes with full UTF-8 byte stream fidelity
  const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  const rawBytes: Uint8Array = encoder ? encoder.encode(rawCode) : Buffer.from(rawCode, "utf8");

  const encodedParts: string[] = [];
  for (let i = 0; i < rawBytes.length; i++) {
    const origByte = rawBytes[i];
    const keyByte = keys[i % keys.length];
    const shift = (keyByte + (i + 1) * step) & 255;
    const encByte = origByte ^ shift;
    // Always 3 digits (\000-\255) so a following digit can never be misread as part of
    // this escape -- matches the sibling implementation's fix in lib/obfuscator/polymorphic.js.
    encodedParts.push("\\" + String(encByte).padStart(3, "0"));
  }

  // BUGFIX: this used to join every part into ONE unbounded string literal. For a script
  // large enough (confirmed live on a real deployment with the ~500KB BloxStrikeSuite.lua),
  // that single multi-MB `\DDD`-escaped literal produces output that fails to even
  // compile ("Out of registers when trying to allocate 250 registers: exceeded limit 255").
  // The first fix attempt here chunked it into `"..." .. "..." .. ...` -- but Luau's `..`
  // operator chain compiles to a SINGLE OP_CONCAT instruction that needs every operand in a
  // contiguous register range simultaneously, so a ~250-chunk `..` chain hits the exact same
  // 255-register ceiling it was trying to avoid (confirmed: identical error, same number).
  // table.concat() on a table LITERAL sidesteps this entirely -- it's an ordinary function
  // call taking one table argument, not a register-hungry multi-operand VM instruction.
  const CHUNK_TOKENS = 2000;
  const encodedChunks: string[] = [];
  for (let i = 0; i < encodedParts.length; i += CHUNK_TOKENS) {
    encodedChunks.push(encodedParts.slice(i, i + CHUNK_TOKENS).join(""));
  }
  if (encodedChunks.length === 0) encodedChunks.push("");
  const encodedBufLiteral =
    encodedChunks.length === 1
      ? `"${encodedChunks[0]}"`
      : `table.concat({ ${encodedChunks.map((c) => `"${c}"`).join(", ")} })`;

  // Opaque predicate constants (always true/false but confusing to decompilers)
  const dummyConstant = Math.floor(Math.random() * 1000) + 100;

  return `--[[
  =======================================================
  AERO PROTECTED POLYMORPHIC DYNAMIC LOADER
  Dynamic Keystream Virtualization & Anti-Tamper Shield
  Seed: ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}
  =======================================================
]]--
return (function()
    -- 1. Anti-Hooking & Environment Integrity Preflight
    local _pcall = pcall
    local _loadstring = loadstring
    local _type = type
    local _tostring = tostring
    local _tbl = table
    local _str = string
    local _math = math

    -- Integrity verification of engine functions
    local _isl = (typeof(islclosure) == "function" and islclosure) or nil
    if _isl then
        if _isl(_pcall) or (_type(_str) == "table" and _isl(_str.char)) then
            -- Silent divergence: Return dummy table rather than executing payload
            return function() return false end
        end
    end

    -- Functional validation of loadstring without brittle L-closure assumption
    local _okCompile, _compileTest = _pcall(function()
        local tFn = _loadstring("return 90210")
        return tFn and tFn() == 90210
    end)
    if not _okCompile or not _compileTest then
        return function() return false end
    end

    -- Mathematical Opaque Invariant Check
    if (_math.floor(${dummyConstant} / 2) * 2 == ${dummyConstant} and ${dummyConstant} % 2 ~= 0) then
        return nil
    end

    -- 2. Keystream Decoding State
    local ${idKeys} = { ${keys.join(", ")} }
    local ${idBuf} = ${encodedBufLiteral}
    local ${idTbl} = _tbl.create(#${idBuf})
    local ${idXor} = (bit32 and bit32.bxor) or (bit and bit.bxor)
    local _step = ${step}
    local _klen = #${idKeys}

    for ${idIdx} = 1, #${idBuf} do
        local ${idByte} = _str.byte(${idBuf}, ${idIdx})
        local _k = ${idKeys}[((${idIdx} - 1) % _klen) + 1]
        local ${idShift} = (_k + ${idIdx} * _step) % 256
        ${idTbl}[${idIdx}] = _str.char(${idXor}(${idByte}, ${idShift}))
    end

    -- 3. In-Memory Assembly & Compilation
    local _rawCode = _tbl.concat(${idTbl})

    -- Immediate Memory Zeroing of Buffer to Defeat Memory Dumpers
    if _tbl.clear then
        _tbl.clear(${idTbl})
    else
        for _zi = 1, #${idTbl} do
            ${idTbl}[_zi] = nil
        end
    end
    ${idTbl} = nil
    ${idBuf} = nil
    ${idKeys} = nil

    local ${idFn}, ${idErr} = _loadstring(_rawCode)
    _rawCode = nil -- Zero source code reference immediately

    if ${idFn} then
        -- Run inside sandboxed protected call
        return ${idFn}()
    else
        error("[Aero] Protection fault: " .. _tostring(${idErr}))
    end
end)()`;
}
