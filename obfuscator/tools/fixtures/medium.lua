-- medium.lua — purpose-built regression fixture exercising the specific bug shapes this fix pass
-- targets: nested loops (numeric + generic), closures/upvalues, varargs, multiple returns, and dense
-- branching (to stress jump/label resolution and register pressure beyond what the trivial fixture does).

local function makeCounter(start)
    local count = start
    return function(step)
        count = count + (step or 1)
        return count
    end
end

local counters = {}
for i = 1, 5 do
    counters[i] = makeCounter(i * 10)
end

local function sumAndProduct(...)
    local n = select('#', ...)
    local sum, product = 0, 1
    for i = 1, n do
        local v = select(i, ...)
        sum = sum + v
        product = product * v
    end
    return sum, product, n
end

local total = 0
for round = 1, 20 do
    for i, counter in ipairs(counters) do
        local v = counter(round)
        total = total + v

        -- dense branching: many small conditionals in a row, to pressure jump/label resolution
        if v % 7 == 0 then
            total = total + 1
        elseif v % 5 == 0 then
            total = total + 2
        elseif v % 3 == 0 then
            total = total + 3
        else
            total = total - 1
        end

        -- a loop with both a normal exit and an early break, landing near the same target
        local inner = 0
        for j = 1, 10 do
            inner = inner + j
            if inner > 30 then
                break
            end
        end
        total = total + inner
    end
end

local names = { a = 1, b = 2, c = 3, d = 4, e = 5 }
local keySum = 0
for k, v in pairs(names) do
    keySum = keySum + v
end

-- a register-heavy expression: many locals alive at once in one function
local function heavyRegisters()
    local a1, a2, a3, a4, a5 = 1, 2, 3, 4, 5
    local b1, b2, b3, b4, b5 = 6, 7, 8, 9, 10
    local c1, c2, c3, c4, c5 = 11, 12, 13, 14, 15
    local d1, d2, d3, d4, d5 = 16, 17, 18, 19, 20
    local sum = a1 + a2 + a3 + a4 + a5 + b1 + b2 + b3 + b4 + b5
              + c1 + c2 + c3 + c4 + c5 + d1 + d2 + d3 + d4 + d5
    return sum
end

local sum, product, n = sumAndProduct(1, 2, 3, 4, 5)
local heavy = heavyRegisters()

print("total =", total)
print("keySum =", keySum)
print("sumAndProduct =", sum, product, n)
print("heavy =", heavy)
