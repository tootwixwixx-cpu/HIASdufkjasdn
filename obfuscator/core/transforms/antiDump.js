// core/transforms/antiDump.js
// Best-effort memory cleanup — NOT real memory-dump resistance.
//
// Honest scope, revised in Round 2 Phase 7 after actually tracing the string-cache's real lifecycle
// (see generateStringCacheScrub below — this is a real fix, not just a re-description):
//
// - The decrypted-STRING CACHE (stringEncrypt.js's per-string `__index` metatable) now IS scrubbed for
//   real, automatically, with no caveats — see generateStringCacheScrub. This was previously honestly
//   documented as NOT done; it's done now because tracing every consumer found exactly one: each
//   proto's own Consts table is built via a table CONSTRUCTOR that runs ONCE, unconditionally, for
//   EVERY proto, immediately at script load (before the VM interpreter ever executes a single
//   instruction) — `[k]=${idTbl}[i]` as a constructor field evaluates and copies the plaintext value
//   into that proto's own plain array exactly once. Nothing in the generated output ever indexes the
//   decrypt-cache table again after that load-time construction pass completes, for any proto, under
//   any code path (confirmed: the cache table reference appears nowhere else in the generator). So
//   clearing it immediately afterward is unconditionally safe, not a tradeoff.
// - The live columnar bytecode/VM arrays (`_BC`, `_p_strs`, the interpreter loop's own locals) are a
//   genuinely different case and are NOT touched, deliberately: those ARE read on every single
//   instruction for as long as the script runs, including from closures, event listeners, and UI hooks
//   that are explicitly designed to outlive the script's initial top-to-bottom execution — exactly the
//   shape of every real script this obfuscator has been verified against (BriskVisualSuite.lua,
//   BloxStrikeSuite.lua: persistent hooks/HUD/event handlers for the whole session). There is no safe
//   point to clear these automatically, and no safe way to expose a voluntary "clear it now" hook to the
//   wrapped script either — the wrapped script has no legitimate way to know whether some OTHER
//   still-live closure (one it doesn't own, e.g. a UI callback registered earlier) will call back into
//   the VM again before the process/session actually ends, and calling such a hook too early would
//   corrupt every future call for the rest of the script's life. Memory for these is only ever
//   reclaimed the same way as any other live Lua state: when the whole script/thread is actually torn
//   down and garbage collected (e.g. the executor unloads it, or the Roblox session ends) — there is no
//   earlier "safe" point for a VM of this design (self-contained bytecode interpreter, long-lived by
//   construction) to give up access to its own bytecode while still being able to run.
// - A heap snapshot taken while the script is running will still show the live VM state — that part of
//   the original honest disclosure remains true and is not fixed here, because fixing it would require
//   the script to stop being able to run, which defeats the point.

'use strict';

/**
 * Generate Lua code that zeros out a table variable and nils the reference.
 */
function generateZeroCode(varName) {
  return `
do
  if type(${varName}) == "table" then
    if table.clear then
      table.clear(${varName})
    else
      for __zi = 1, #${varName} do ${varName}[__zi] = nil end
    end
  end
  ${varName} = nil
end`;
}

/**
 * Generate Lua code that zeros out a string variable
 */
function generateStringZero(varName) {
  return `${varName} = nil`;
}

/**
 * Generates the postamble that nils one transient decryption-buffer local after execution.
 * This is best-effort cosmetic cleanup, not real dump resistance — see the file header above.
 * Long-lived scripts (GUIs, admin tools, event handlers) require _BC, _p_strs, and the VM itself
 * to remain alive in memory for callbacks and event listeners, so none of those are touched here.
 */
function generateAntiDumpPostamble(ids) {
  return `
do
  ${ids.buf} = nil
end
`;
}

/**
 * Round 2, Phase 7: real (not cosmetic) scrub of the decrypted-string cache table. Safe to run
 * unconditionally once called — see the file header's trace of why nothing legitimately reads this
 * table again after proto construction. Detaches the __index metatable too (belt-and-suspenders: even
 * if some future generator change ever added a second reader, it would get a clean nil instead of
 * either stale data or silently re-deriving from already-wiped ciphertext).
 * `idTbl` is `ids.strTable` — the same identifier generateDecryptionLua (stringEncrypt.js) already
 * exported as its `tableRef`, so no new identifier needs to be threaded through.
 */
function generateStringCacheScrub(idTbl) {
  return `
do
  if ${idTbl} ~= nil then
    if table.clear then table.clear(${idTbl}) else for __sk in pairs(${idTbl}) do ${idTbl}[__sk] = nil end end
    pcall(setmetatable, ${idTbl}, nil)
  end
end
`;
}

module.exports = { generateZeroCode, generateStringZero, generateAntiDumpPostamble, generateStringCacheScrub };
