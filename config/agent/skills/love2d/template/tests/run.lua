-- Pure-logic tests, no window: run from the project root with  luajit tests/run.lua
-- Every module in src/ that has no love.* calls gets tests here (rules, scoring, shop, RNG use, save data shapes).
package.path = "./?.lua;./src/?.lua;" .. package.path

local passed, failed = 0, 0
local function test(name, fn)
  local ok, err = pcall(fn)
  if ok then passed = passed + 1 else failed = failed + 1; print("FAIL " .. name .. ": " .. tostring(err)) end
end
local function eq(got, want, what)
  if got ~= want then error((what or "value") .. ": got " .. tostring(got) .. ", want " .. tostring(want), 2) end
end

local tween = require("src.lib.tween")

test("tween reaches its target and calls on_done", function()
  local o, done = { x = 0 }, false
  tween.to(o, 0.5, { x = 10 }, "outCubic", function() done = true end)
  for _ = 1, 10 do tween.update(0.1) end
  eq(o.x, 10, "x"); eq(done, true, "done")
end)

test("outBack overshoots then settles", function()
  tween.clear()
  local o, peak = { s = 1 }, 1
  tween.to(o, 1, { s = 2 }, "outBack")
  for _ = 1, 100 do tween.update(0.01); peak = math.max(peak, o.s) end
  eq(peak > 2, true, "overshoot"); eq(o.s, 2, "final")
end)

print(string.format("tests: %d passed, %d failed", passed, failed))
os.exit(failed == 0 and 0 or 1)
