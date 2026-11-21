-- luajit anim_test.lua  (from the skill folder) - tests the template's src/lib/anim.lua without a window
package.path = (arg and arg[0] and arg[0]:match("^(.*[/\\])") or "./") .. "../love2d/template/?.lua;" .. package.path
local anim = require("src.lib.anim")
local passed = 0
local function eq(name, cond) if not cond then error(name, 2) end passed = passed + 1 end

do -- a spring settles on its target and overshoots on the way (that's the "juice")
  local s = anim.spring(1, 260, 13)
  s.target = 1.1
  local peak = 1
  for _ = 1, 120 do anim.spring_update(s, 1 / 60); peak = math.max(peak, s.x) end
  eq("spring settles", math.abs(s.x - 1.1) < 0.002)
  eq("spring overshoots", peak > 1.1)
end

do -- a kick pops away from the target and comes back; big dt stays stable
  local s = anim.spring(1)
  anim.kick(s, 5)
  anim.spring_update(s, 1 / 60)
  eq("kick moves", s.x > 1)
  for _ = 1, 10 do anim.spring_update(s, 0.25) end
  eq("stable at 4 fps", math.abs(s.x - 1) < 0.01)
end

do -- queue runs steps in order, with exact timing, including zero-length calls
  local q, log = anim.queue(), {}
  q:add(0.5, function() log[#log + 1] = "a" end)
  q:call(function() log[#log + 1] = "b" end)
  q:wait(0.25)
  q:add(0.25, function() log[#log + 1] = "c" end, function(p) log.p = p end)
  q:update(0.4)
  eq("only a started", table.concat(log) == "a")
  q:update(0.2)          -- t = 0.6: a done, b ran, inside the wait
  eq("b ran after a", table.concat(log) == "ab")
  eq("still busy", q:busy())
  q:update(0.3)          -- t = 0.9: c started, 0.15 into its 0.25
  eq("c started", table.concat(log) == "abc")
  eq("progress", math.abs(log.p - 0.6) < 1e-9)
  q:update(1)
  eq("finished", not q:busy() and log.p == 1)
end

print("anim tests: " .. passed .. " passed")
