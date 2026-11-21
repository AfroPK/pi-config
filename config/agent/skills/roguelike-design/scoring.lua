-- Data-driven scoring with ordered modifiers (pure Lua, no LOVE). A scoring event (e.g. a capture) starts with
-- base points and mult; each owned modifier whose trigger matches gets to change it, in slot order (left to right),
-- and every change is recorded so the UI can replay the breakdown step by step.
local M = {}

-- Modifier definitions are DATA: id, name, rarity, cost, trigger, and an apply(ctx, ev) that only uses ops below.
-- ops: add_points(n), add_mult(n), mul_mult(x). Text for tooltips is generated from the same data (describe()).
function M.new_context(points, mult)
  local ctx = { points = points, mult = mult, steps = {} }
  function ctx.add_points(n, src) ctx.points = ctx.points + n; ctx.steps[#ctx.steps + 1] = { src = src, op = "+points", v = n } end
  function ctx.add_mult(n, src) ctx.mult = ctx.mult + n; ctx.steps[#ctx.steps + 1] = { src = src, op = "+mult", v = n } end
  function ctx.mul_mult(x, src) ctx.mult = ctx.mult * x; ctx.steps[#ctx.steps + 1] = { src = src, op = "xmult", v = x } end
  return ctx
end

-- ev: what happened, e.g. { kind = "capture", seeds = 6, pit = 3, relays = 2, looped = false }
-- owned: array of modifier instances { def = <definition>, state = {} } in slot order.
function M.score(ev, owned, base_points, base_mult)
  local ctx = M.new_context(base_points, base_mult)
  for _, m in ipairs(owned) do
    if m.def.trigger == ev.kind or m.def.trigger == "any" then m.def.apply(ctx, ev, m.state, m.def.id) end
  end
  ctx.total = math.floor(ctx.points * ctx.mult + 0.5)
  return ctx
end

-- Round targets grow geometrically; tune base/growth with a simulation, not by feel.
function M.target(round, base, growth) return math.floor(base * growth ^ (round - 1) + 0.5) end

-- Independent seeded RNG streams (shop, opponent, events) so one system's draws never shift another's.
-- Pure-Lua generator (xorshift-style via LuaJIT bit ops) so tests and simulations run without LOVE; in the game you
-- can also use love.math.newRandomGenerator(seed + stream_offset).
local bit = require("bit")
function M.rng(seed)
  local s = bit.tobit(seed ~= 0 and seed or 0x9E3779B9)
  local r = {}
  function r.next()
    s = bit.bxor(s, bit.lshift(s, 13)); s = bit.bxor(s, bit.rshift(s, 17)); s = bit.bxor(s, bit.lshift(s, 5))
    return (s % 2147483647) / 2147483647
  end
  function r.int(a, b) return a + math.floor(r.next() * (b - a + 1)) end
  function r.pick(t) return t[r.int(1, #t)] end
  return r
end

return M
