-- tools/fixtures/scrub.lua
-- Exercises a large number of distinct string constants (so the obfuscator's string-encryption cache
-- actually gets populated and then scrubbed by generateStringCacheScrub — Round 2, Phase 7) and
-- confirms every one of them still resolves correctly. A failure here would mean the automatic
-- string-cache scrub broke a proto's Consts table instead of running strictly after it was built.

local labels = {
  "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
  "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa",
  "quebec", "romeo", "sierra", "tango", "uniform", "victor", "whiskey", "yankee",
}

local function describe(i)
  -- each call references its own string constant, exercised inside a function (not just top-level),
  -- to make sure the scrub doesn't depend on "only top-level code touches constants" being true.
  return "label #" .. tostring(i) .. " = " .. labels[i]
end

local out = {}
for i = 1, #labels do
  out[i] = describe(i)
end

print(table.concat(out, " | "))

-- a nested closure capturing a string constant, to mirror the "hooks defined once at startup, read
-- from later" shape real scripts use (e.g. a UI label built once, read again from an event handler).
local function makeGreeter(name)
  local greeting = "Hello, " .. name .. "!"
  return function()
    return greeting
  end
end

local greet = makeGreeter("Scrub Test")
print(greet())
print(greet()) -- second call: confirms the captured string constant still works after the closure's
                -- own proto's Consts table (built once at load) keeps returning the same value.
