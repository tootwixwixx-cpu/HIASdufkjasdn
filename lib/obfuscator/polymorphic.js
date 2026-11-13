// core/polymorphic.js
// Polymorphic XOR keystream wrapper
// Wraps Lua source in a self-decrypting cipher envelope

'use strict';

function generateKey(length) {
  const keys = [];
  for (let i = 0; i < length; i++) {
    keys.push(Math.floor(Math.random() * 254) + 1);
  }
  return keys;
}

function randomId(prefix = '_') {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let s = prefix;
  for (let i = 0; i < 6; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function wrapPolymorphic(source) {
  const keyLength = 16 + Math.floor(Math.random() * 16);
  const keys = generateKey(keyLength);
  const step = 7 + Math.floor(Math.random() * 19) * 2; // odd step 7..43

  const rawBytes = Buffer.from(source, 'utf8');
  const encoded = [];
  for (let i = 0; i < rawBytes.length; i++) {
    const shift = (keys[i % keys.length] + (i + 1) * step) & 0xFF;
    const encVal = (rawBytes[i] ^ shift) & 0xFF;
    // Always format with 3 digits (\000 to \255) to prevent ambiguity with following digits
    encoded.push(`\\${encVal.toString().padStart(3, '0')}`);
  }

  const dummyConst = Math.floor(Math.random() * 1000) + 100;
  const isMutatedEven = dummyConst % 2 === 0;

  // Chunk the escaped payload into bounded-size string literals instead of one unbounded token: a
  // single multi-hundred-KB `\DDD`-escaped literal is itself a 4x size blowup over the raw bytes AND
  // risks hitting engine/executor literal-size limits on large scripts. ~2000 \DDD tokens (~8KB of
  // source text) per chunk, concatenated with `..` — identical runtime value, no single giant token.
  const CHUNK_TOKENS = 2000;
  const chunks = [];
  for (let i = 0; i < encoded.length; i += CHUNK_TOKENS) {
    chunks.push(encoded.slice(i, i + CHUNK_TOKENS).join(''));
  }
  if (chunks.length === 0) chunks.push('');
  const bufLiteral = chunks.map(c => `"${c}"`).join(' .. ');

  const idKeys  = randomId('_k');
  const idBuf   = randomId('_b');
  const idTbl   = randomId('_t');
  const idIdx   = randomId('_i');
  const idByte  = randomId('_c');
  const idShift = randomId('_s');
  const idXor   = randomId('_x');
  const idFn    = randomId('_f');
  const idStep  = randomId('_p');

  return `return (function()
  local _pcall = pcall
  local _loadstring = loadstring
  local _type = type
  local _tbl = table
  local _str = string
  local _math = math

  local _isl = (typeof(islclosure) == "function" and islclosure) or nil
  if _isl then
    if _isl(_pcall) or (_type(_str) == "table" and _isl(_str.byte)) then
      return function() return false end
    end
  end

  local _ok, _ct = _pcall(function()
    local _f = _loadstring("return 90210")
    return _f and _f() == 90210
  end)
  -- This is an ENVIRONMENT compatibility gap (loadstring missing/disabled), not a tamper attempt — unlike
  -- the hook-detection bail above, which stays deliberately silent/ambiguous so as not to hand an
  -- attacker a "you were detected" signal, here a loud, clear error is the right behavior: a script
  -- author deploying to an executor without loadstring needs to know immediately why nothing ran,
  -- not have it silently do nothing (the previous behavior of this bail).
  if not _ok or not _ct then
    error("[AtomProtect] This fallback protection mode requires 'loadstring', which is not available/working in this environment. The script cannot run here.")
  end

  if (${isMutatedEven ? `_math.floor(${dummyConst}/2)*2==${dummyConst} and ${dummyConst}%2~=0` : `_math.floor(${dummyConst}/2)*2~=${dummyConst} and ${dummyConst}%2==0`}) then
    return nil
  end

  local ${idKeys} = { ${keys.join(', ')} }
  local ${idBuf} = ${bufLiteral}
  local ${idTbl} = _tbl.create(#${idBuf})
  local ${idXor} = (bit32 and bit32.bxor) or (bit and bit.bxor)
  local ${idStep} = ${step}
  local _klen = #${idKeys}

  for ${idIdx} = 1, #${idBuf} do
    local ${idByte} = _str.byte(${idBuf}, ${idIdx})
    local _k = ${idKeys}[((${idIdx} - 1) % _klen) + 1]
    local ${idShift} = (_k + ${idIdx} * ${idStep}) % 256
    ${idTbl}[${idIdx}] = _str.char(${idXor}(${idByte}, ${idShift}))
  end

  local _raw = _tbl.concat(${idTbl})
  if _tbl.clear then
    _tbl.clear(${idTbl})
  else
    for _z = 1, #${idTbl} do ${idTbl}[_z] = nil end
  end
  ${idTbl} = nil
  ${idBuf} = nil
  ${idKeys} = nil

  local ${idFn}, _err = _loadstring(_raw)
  _raw = nil

  if ${idFn} then
    return ${idFn}()
  else
    error("[AtomProtect] Protection Envelope Integrity Check Failed: " .. tostring(_err))
  end
end)()`;
}

module.exports = { wrapPolymorphic };
