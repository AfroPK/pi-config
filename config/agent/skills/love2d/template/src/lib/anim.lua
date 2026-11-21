-- Animation helpers for juicy UI (pure Lua, no love.* calls: testable with luajit).
--   springs: values that chase a target with overshoot (hover lift, wobble, tilt, squash)
--   queue:   a timeline of steps played one after another (the scoring show, sowing seed by seed)
local anim = {}

-- Spring: s = anim.spring(1); s.target = 1.1 on hover; anim.spring_update(s, dt) each frame; draw with s.x.
-- stiffness ~ how fast, damping ~ how much it bounces (lower = more wobble).
function anim.spring(x, stiffness, damping)
  return { x = x, v = 0, target = x, k = stiffness or 220, d = damping or 14 }
end

function anim.spring_update(s, dt)
  -- semi-implicit Euler in small steps so it stays stable at low frame rates
  local steps = math.max(1, math.ceil(dt / (1 / 120)))
  local h = dt / steps
  for _ = 1, steps do
    local a = -s.k * (s.x - s.target) - s.d * s.v
    s.v = s.v + a * h
    s.x = s.x + s.v * h
  end
end

-- Kick a spring for a "pop" (e.g. when a modifier fires): it overshoots and settles back on its target.
function anim.kick(s, velocity) s.v = s.v + velocity end

-- Queue: steps run in order. q:add(duration, on_start, on_update) / q:wait(seconds) / q:call(fn).
-- on_update(p) gets progress 0..1. Game logic is already decided before steps are queued; the queue only shows it.
local Queue = {}
Queue.__index = Queue

function anim.queue() return setmetatable({ steps = {}, cur = nil, t = 0 }, Queue) end

function Queue:add(duration, on_start, on_update)
  self.steps[#self.steps + 1] = { d = duration, start = on_start, upd = on_update }
  return self
end
function Queue:wait(seconds) return self:add(seconds) end
function Queue:call(fn) return self:add(0, fn) end
function Queue:busy() return self.cur ~= nil or #self.steps > 0 end
function Queue:clear() self.steps, self.cur, self.t = {}, nil, 0 end

function Queue:update(dt, speed)
  dt = dt * (speed or 1)
  while dt > 0 or (self.cur == nil and #self.steps > 0 and self.steps[1].d == 0) do
    if not self.cur then
      if #self.steps == 0 then return end
      self.cur = table.remove(self.steps, 1)
      self.t = 0
      if self.cur.start then self.cur.start() end
    end
    local left = self.cur.d - self.t
    if dt >= left then
      dt = dt - left
      if self.cur.upd then self.cur.upd(1) end
      self.cur = nil
    else
      self.t = self.t + dt
      if self.cur.upd then self.cur.upd(self.t / self.cur.d) end
      dt = 0
    end
  end
end

-- Idle sway: a small per-element sine offset so a row of items never looks static. phase differs per element.
function anim.sway(time, phase, amount) return math.sin(time * 1.7 + phase) * (amount or 1) end

return anim
