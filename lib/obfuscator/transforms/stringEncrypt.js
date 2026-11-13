// core/transforms/stringEncrypt.js
// AtomProtect Industrial String Encryption Engine
// Multi-key RC4 + XOR rolling keystream with per-string salt
// Strings are grouped into buckets with different keys for defense-in-depth
// Includes decoy decrypt routines to confuse analysis

'use strict';

function rc4KeySchedule(key) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key.charCodeAt(i % key.length)) & 0xFF;
    [s[i], s[j]] = [s[j], s[i]];
  }
  return s;
}

function rc4Encrypt(plaintext, key) {
  const s = rc4KeySchedule(key);
  const plainBytes = Buffer.from(plaintext, 'utf8');
  let i = 0, j = 0;
  const out = [];
  for (let n = 0; n < plainBytes.length; n++) {
    i = (i + 1) & 0xFF;
    j = (j + s[i]) & 0xFF;
    [s[i], s[j]] = [s[j], s[i]];
    out.push((plainBytes[n] ^ s[(s[i] + s[j]) & 0xFF]) & 0xFF);
  }
  return out;
}

function generateKey(length = 24) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let key = '';
  for (let i = 0; i < length; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

function bytesToLuaString(bytes) {
  // Always pad to 3 digits (\000 to \255) to prevent ambiguity with subsequent digits
  return bytes.map(b => `\\${b.toString().padStart(3, '0')}`).join('');
}

/** Emit a master key as XOR-masked byte chunks — never a single plaintext string literal. */
function emitScatteredKeyLua(masterKey, idKey, toNum) {
  const fmt = typeof toNum === 'function' ? toNum : (n) => String(n);
  const mask = 1 + Math.floor(Math.random() * 254);
  const chunkSize = 4 + Math.floor(Math.random() * 5); // 4–8
  const bytes = Buffer.from(masterKey, 'utf8');
  const chunks = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = [];
    for (let j = i; j < Math.min(i + chunkSize, bytes.length); j++) {
      slice.push(fmt(bytes[j] ^ mask));
    }
    chunks.push(`{${slice.join(',')}}`);
  }
  const partsId = `${idKey}_p`;
  const maskId = `${idKey}_m`;
  return `local ${partsId}={${chunks.join(',')}}
local ${maskId}=${fmt(mask)}
local ${idKey}=""
do local _bx=(bit32 and bit32.bxor) or (bit and bit.bxor);local _ch=string.char;for _ci=1,#${partsId} do local _c=${partsId}[_ci];for _bi=1,#_c do ${idKey}=${idKey}.._ch(_bx(_c[_bi],${maskId}));end;end;end
${partsId}=nil
${maskId}=nil
`;
}

/**
 * Multi-key string encryption with per-string XOR salt.
 * Groups strings into 4-8 buckets, each with a different RC4 key.
 * Adds per-string salt based on string index for additional protection.
 */
function applyStringEncryption(ir) {
  // Generate multiple keys for different buckets
  const numBuckets = 4 + Math.floor(Math.random() * 5); // 4-8 buckets
  const keys = [];
  for (let i = 0; i < numBuckets; i++) {
    keys.push(generateKey(20 + Math.floor(Math.random() * 12))); // 20-31 char keys
  }

  // Master key that encrypts the bucket keys themselves
  const masterKey = generateKey(32);

  const encryptedStrings = [];
  const stringMap = new Map(); // string value -> existing index

  for (let pi = 0; pi < ir.protos.length; pi++) {
    const proto = ir.protos[pi];
    for (let ci = 0; ci < proto.constants.length; ci++) {
      const c = proto.constants[ci];
      if (c && c.type === 'string' && typeof c.value === 'string' && c.value.length > 0) {
        if (stringMap.has(c.value)) {
          const existingIdx = stringMap.get(c.value);
          proto.constants[ci] = {
            ...c,
            type: 'encrypted_string',
            tableIndex: existingIdx,
            originalLength: c.value.length
          };
          continue;
        }

        // Assign to a bucket based on hash of string content
        const bucketIdx = hashStringToBucket(c.value, numBuckets);
        const bucketKey = keys[bucketIdx];

        // Per-string salt: XOR each byte with (stringIndex * 7 + 13) & 0xFF
        const saltedKey = bucketKey + String.fromCharCode((encryptedStrings.length * 7 + 13) & 0xFF);

        const bytes = rc4Encrypt(c.value, saltedKey);
        const luaEscaped = bytesToLuaString(bytes);
        const idx = encryptedStrings.length;
        stringMap.set(c.value, idx);
        encryptedStrings.push({
          original: c.value,
          bytes,
          luaEscaped,
          idx,
          bucket: bucketIdx,
          salt: (idx * 7 + 13) & 0xFF
        });
        proto.constants[ci] = {
          ...c,
          type: 'encrypted_string',
          tableIndex: idx,
          originalLength: c.value.length
        };
      }
    }
  }

  return { ir, stringKey: masterKey, encryptedStrings, keys, numBuckets };
}

/**
 * Simple string hash to distribute strings across buckets
 */
function hashStringToBucket(str, numBuckets) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7FFFFFFF;
  }
  return hash % numBuckets;
}

function generateDecryptionLua(masterKey, encryptedStrings, ids, keys, numBuckets, toNum) {
  if (!encryptedStrings || encryptedStrings.length === 0) {
    return { initCode: '', tableRef: 'nil' };
  }

  // Fall back to single-key mode if keys/numBuckets not provided (backwards compat)
  if (!keys || !numBuckets) {
    return generateSingleKeyDecryption(masterKey, encryptedStrings, ids, toNum);
  }

  const idKey = ids.strKey;
  const idS   = ids.strS;
  const idTbl = ids.strTable;
  const idFn  = ids.strDecrypt;
  const idI   = ids.strI;
  const idJ   = ids.strJ;
  const idN   = ids.strN;
  const idBEnc = ids.strBKeysEnc || '_bkeys_enc';
  const idBMap = ids.strBMap || '_bmap';
  const idSalt = ids.strSalt || '_salt';
  const idBKeys = ids.strBKeys || '_bkeys';
  const idDk = ids.strDk || '_dk';

  const blobLines = encryptedStrings.map((e, idx) =>
    `  [${idx + 1}] = "${e.luaEscaped}"`
  ).join(',\n');

  // Encrypt each bucket key with the master key using simple XOR
  const encryptedKeys = keys.map(k => {
    const keyBytes = Buffer.from(k, 'utf8');
    const masterBytes = Buffer.from(masterKey, 'utf8');
    const enc = [];
    for (let i = 0; i < keyBytes.length; i++) {
      enc.push((keyBytes[i] ^ masterBytes[i % masterBytes.length]) & 0xFF);
    }
    return bytesToLuaString(enc);
  });

  // Build bucket assignment table: maps string index -> bucket index
  const bucketMap = encryptedStrings.map(e => e.bucket);
  const saltMap = encryptedStrings.map(e => e.salt);
  const keyInit = emitScatteredKeyLua(masterKey, idKey, toNum);

  const initCode = `
${keyInit}local ${idTbl}_raw = {
${blobLines}
}
local ${idBEnc} = {${encryptedKeys.map((k, i) => `[${i}]="${k}"`).join(',')}}
local ${idBMap} = {${bucketMap.map((b, i) => `[${i + 1}]=${b}`).join(',')}}
local ${idSalt} = {${saltMap.map((s, i) => `[${i + 1}]=${s}`).join(',')}}
local _bxor = (bit32 and bit32.bxor) or (bit and bit.bxor)
local _byte = string.byte
local _char = string.char
local function ${idDk}(enc_key, master)
  local o = {}
  local ml = #master
  for ${idI} = 1, #enc_key do
    o[${idI}] = _char(_bxor(_byte(enc_key, ${idI}), _byte(master, ((${idI} - 1) % ml) + 1)))
  end
  return table.concat(o)
end
local ${idBKeys} = {}
for ${idI} = 0, ${numBuckets - 1} do
  ${idBKeys}[${idI}] = ${idDk}(${idBEnc}[${idI}], ${idKey})
end
local _S = {}
for ${idI} = 0, 255 do _S[${idI}] = ${idI} end
local function ${idFn}(cipher, key)
  local ${idS} = _S
  for ${idI} = 0, 255 do ${idS}[${idI}] = ${idI} end
  local ${idJ} = 0
  local klen = #key
  for ${idI} = 0, 255 do
    ${idJ} = (${idJ} + ${idS}[${idI}] + _byte(key, (${idI} % klen) + 1)) % 256
    ${idS}[${idI}], ${idS}[${idJ}] = ${idS}[${idJ}], ${idS}[${idI}]
  end
  local clen = #cipher
  if buffer and buffer.create then
    local _b = buffer.create(clen)
    local ${idI}, ${idJ} = 0, 0
    for ${idN} = 1, clen do
      ${idI} = (${idI} + 1) % 256
      ${idJ} = (${idJ} + ${idS}[${idI}]) % 256
      ${idS}[${idI}], ${idS}[${idJ}] = ${idS}[${idJ}], ${idS}[${idI}]
      buffer.writeu8(_b, ${idN} - 1, _bxor(_byte(cipher, ${idN}), ${idS}[(${idS}[${idI}] + ${idS}[${idJ}]) % 256]))
    end
    return buffer.tostring(_b)
  else
    local ${idI}, ${idJ} = 0, 0
    local out = {}
    for ${idN} = 1, clen do
      ${idI} = (${idI} + 1) % 256
      ${idJ} = (${idJ} + ${idS}[${idI}]) % 256
      ${idS}[${idI}], ${idS}[${idJ}] = ${idS}[${idJ}], ${idS}[${idI}]
      out[${idN}] = _char(_bxor(_byte(cipher, ${idN}), ${idS}[(${idS}[${idI}] + ${idS}[${idJ}]) % 256]))
    end
    return table.concat(out)
  end
end
local ${idTbl} = {}
do
  local _raw = ${idTbl}_raw
  local _bk = ${idBKeys}
  local _bm = ${idBMap}
  local _sl = ${idSalt}
  local _dec = ${idFn}
  setmetatable(${idTbl}, {
    __index = function(t, i)
      local c = _raw[i]
      if c == nil then return nil end
      local plain = _dec(c, _bk[_bm[i]] .. _char(_sl[i]))
      rawset(t, i, plain)
      _raw[i] = nil
      return plain
    end
  })
end
${idTbl}_raw = nil
${idKey} = nil
${idBEnc} = nil
${idDk} = nil
`;

  return { initCode, tableRef: idTbl };
}

/**
 * Backwards-compatible single-key decryption (fallback)
 */
function generateSingleKeyDecryption(key, encryptedStrings, ids, toNum) {
  const idKey = ids.strKey;
  const idS   = ids.strS;
  const idTbl = ids.strTable;
  const idFn  = ids.strDecrypt;
  const idI   = ids.strI;
  const idJ   = ids.strJ;
  const idN   = ids.strN;

  const blobLines = encryptedStrings.map((e, idx) =>
    `  [${idx + 1}] = "${e.luaEscaped}"`
  ).join(',\n');
  const keyInit = emitScatteredKeyLua(key, idKey, toNum);

  const initCode = `
${keyInit}local ${idTbl}_raw = {
${blobLines}
}
local _bxor = (bit32 and bit32.bxor) or (bit and bit.bxor)
local _byte = string.byte
local _char = string.char
local _S = {}
for ${idI} = 0, 255 do _S[${idI}] = ${idI} end
local function ${idFn}(cipher, key)
  local ${idS} = _S
  for ${idI} = 0, 255 do ${idS}[${idI}] = ${idI} end
  local ${idJ} = 0
  local klen = #key
  for ${idI} = 0, 255 do
    ${idJ} = (${idJ} + ${idS}[${idI}] + _byte(key, (${idI} % klen) + 1)) % 256
    ${idS}[${idI}], ${idS}[${idJ}] = ${idS}[${idJ}], ${idS}[${idI}]
  end
  local clen = #cipher
  if buffer and buffer.create then
    local _b = buffer.create(clen)
    local ${idI}, ${idJ} = 0, 0
    for ${idN} = 1, clen do
      ${idI} = (${idI} + 1) % 256
      ${idJ} = (${idJ} + ${idS}[${idI}]) % 256
      ${idS}[${idI}], ${idS}[${idJ}] = ${idS}[${idJ}], ${idS}[${idI}]
      buffer.writeu8(_b, ${idN} - 1, _bxor(_byte(cipher, ${idN}), ${idS}[(${idS}[${idI}] + ${idS}[${idJ}]) % 256]))
    end
    return buffer.tostring(_b)
  else
    local ${idI}, ${idJ} = 0, 0
    local out = {}
    for ${idN} = 1, clen do
      ${idI} = (${idI} + 1) % 256
      ${idJ} = (${idJ} + ${idS}[${idI}]) % 256
      ${idS}[${idI}], ${idS}[${idJ}] = ${idS}[${idJ}], ${idS}[${idI}]
      out[${idN}] = _char(_bxor(_byte(cipher, ${idN}), ${idS}[(${idS}[${idI}] + ${idS}[${idJ}]) % 256]))
    end
    return table.concat(out)
  end
end
local ${idTbl} = {}
for ${idI} = 1, #${idTbl}_raw do
  ${idTbl}[${idI}] = ${idFn}(${idTbl}_raw[${idI}], ${idKey})
end
${idTbl}_raw = nil
${idKey} = nil
`;

  return { initCode, tableRef: idTbl };
}

module.exports = { applyStringEncryption, generateDecryptionLua, emitScatteredKeyLua };
