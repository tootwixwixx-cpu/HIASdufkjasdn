'use strict';

/**
 * Emit lightweight anti-tamper / anti-trace probes for the VM entry.
 * Quiet failures only ("VM Error"). Avoid gethook — Delta/MCP may instrument.
 *
 * Honest scope + false-positive hardening: earlier versions tripped on a single signal (either hook
 * check alone, or one slow timing reading alone), which is a real false-positive risk against
 * LEGITIMATE clients/executors — some executors present real C builtins as Lua closures for
 * compatibility reasons (not because they're hooked), and a single timing sample can be slow purely
 * from a GC pause or a loading-screen hitch, not tracing. Neither signal alone is reliable, so this
 * accumulates a cumulative suspicion SCORE across signals and only trips once the score crosses a
 * threshold that single incidental signals can't reach on their own. This is still a best-effort
 * heuristic, not a real anti-tamper system — a determined attacker who also controls
 * debug.getinfo/os.clock defeats it trivially; its job is to add friction against casual hooking, not
 * to be a security boundary.
 *
 * Round 2, Phase 6: added a second timing probe shaped differently from the first (string
 * concatenation instead of integer addition — a hooked/traced string library would slow this one down
 * even if integer arithmetic stayed fast, and vice versa) so an attacker has to spoof past two
 * independently-shaped timing signals rather than one, while each still only contributes to the same
 * safe cumulative score — this does not meaningfully raise legitimate-client false-positive risk,
 * since score 2 already required two signals before this, and still does.
 *
 * `strength` ("standard" default | "strict" | "off") lets a caller trade detection aggressiveness for
 * false-positive risk deliberately instead of the fixed threshold being guessed at once and never
 * revisited: "strict" lowers the trip threshold (same signals, less margin for an attacker to clear
 * two but not all three), "off" skips the preamble entirely (useful while debugging a VM Error that
 * might be this, not real corruption).
 */
function generateAntiTamperPreamble(strength) {
  const mode = strength === 'strict' || strength === 'off' ? strength : 'standard';
  if (mode === 'off') return '';
  // "standard" keeps the exact threshold (2) and every exact trip condition this preamble already had
  // before this phase (both hook signals together, or the integer-timing probe alone, or the sentinel
  // alone) — the new string-timing signal only ever adds a new combination (itself + one hook) that
  // couldn't trip before, never removes or weakens an existing one. "strict" lowers the threshold to 1,
  // so any single signal (including a lone, possibly-incidental hook ping) trips it — deliberately more
  // false-positive-prone, for callers who've accepted that trade.
  const threshold = mode === 'strict' ? 1 : 2;
  return `
do
  local _err=error
  local _score=0
  local _bx=((bit32 and bit32.bxor) or (bit and bit.bxor))
  if type(_bx)~="function" then _err("VM Error") end
  if debug and debug.getinfo then
    local _ok,_info=pcall(debug.getinfo,_bx,"S")
    if _ok and type(_info)=="table" and _info.what=="Lua" then _score=_score+1 end
    local _ok2,_info2=pcall(debug.getinfo,pcall,"S")
    if _ok2 and type(_info2)=="table" and _info2.what=="Lua" then _score=_score+1 end
  end
  if os and os.clock then
    local _best=math.huge
    for _trial=1,3 do
      local _t0=os.clock()
      local _x=0
      for _i=1,64 do _x=_x+_i end
      local _dt=os.clock()-_t0
      if _dt>=0 and _dt<_best then _best=_dt end
    end
    if _best<math.huge and _best>2.5 then _score=_score+2 end
  end
  if string and string.rep then
    local _best2=math.huge
    for _trial=1,3 do
      local _t0=os.clock()
      local _s=""
      for _i=1,48 do _s=_s.._i end
      local _dt=os.clock()-_t0
      if _dt>=0 and _dt<_best2 then _best2=_dt end
    end
    if _best2<math.huge and _best2>2.5 then _score=_score+1 end
  end
  pcall(function()
    if getgenv then
      local _g=getgenv()
      if type(_g)=="table" and _g.__ATOM_TRACE==true then _score=_score+3 end
    end
  end)
  if _score>=${threshold} then _err("VM Error") end
end
`;
}

module.exports = { generateAntiTamperPreamble };
