-- luajit scoring_test.lua  -> "scoring tests: N passed"
package.path = (arg and arg[0] and arg[0]:match("^(.*[/\\])") or "") .. "?.lua;" .. package.path
local S = require("scoring")
local passed = 0
local function eq(name, got, want)
  if got ~= want then error(name .. ": got " .. tostring(got) .. ", want " .. tostring(want), 2) end
  passed = passed + 1
end

-- Example modifier definitions (placeholders - real names/effects are Freddy's design)
local defs = {
  per_seed = { id = "per_seed", trigger = "capture", apply = function(ctx, ev, st, id) ctx.add_points(ev.seeds * 2, id) end },
  relay_mult = { id = "relay_mult", trigger = "capture", apply = function(ctx, ev, st, id) ctx.add_mult(ev.relays, id) end },
  big_x = { id = "big_x", trigger = "capture", apply = function(ctx, ev, st, id) if ev.seeds >= 5 then ctx.mul_mult(2, id) end end },
  counter = { id = "counter", trigger = "any", apply = function(ctx, ev, st, id) st.n = (st.n or 0) + 1; ctx.add_mult(st.n, id) end },
}

do -- order matters: +mult before xmult differs from xmult before +mult
  local ev = { kind = "capture", seeds = 6, relays = 3 }
  local a = S.score(ev, { { def = defs.per_seed, state = {} }, { def = defs.relay_mult, state = {} }, { def = defs.big_x, state = {} } }, 6, 1)
  eq("points", a.points, 18)             -- 6 + 6*2
  eq("mult", a.mult, 8)                  -- (1 + 3) * 2
  eq("total", a.total, 144)
  eq("steps recorded", #a.steps, 3)
  local b = S.score(ev, { { def = defs.big_x, state = {} }, { def = defs.relay_mult, state = {} } }, 6, 1)
  eq("other order mult", b.mult, 5)      -- 1 * 2 + 3
end

do -- triggers filter, and state persists across events
  local owned = { { def = defs.counter, state = {} }, { def = defs.big_x, state = {} } }
  local r1 = S.score({ kind = "sow_end", seeds = 0 }, owned, 1, 1)
  eq("big_x skipped on sow_end", #r1.steps, 1)
  local r2 = S.score({ kind = "capture", seeds = 2 }, owned, 1, 1)
  eq("counter state grows", r2.mult, 3)  -- 1 + 2 (second event)
end

do -- targets and RNG determinism
  eq("target r1", S.target(1, 100, 1.5), 100)
  eq("target r4", S.target(4, 100, 1.5), 338)
  local a, b = S.rng(42), S.rng(42)
  for _ = 1, 100 do eq("same seed same stream", a.int(1, 1000), b.int(1, 1000)) end
  local c, counts = S.rng(7), {}
  for _ = 1, 6000 do local v = c.int(1, 6); counts[v] = (counts[v] or 0) + 1 end
  for v = 1, 6 do eq("die face " .. v .. " in range", counts[v] > 800 and counts[v] < 1200, true) end
end

print("scoring tests: " .. passed .. " passed")
