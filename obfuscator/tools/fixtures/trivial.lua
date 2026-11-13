-- trivial.lua — smallest possible regression fixture
local function add(a, b)
    return a + b
end

local x = 10
local y = 20
local sum = add(x, y)

print("sum =", sum)
print("hello", "world", 42)
