-- Scene manager with an animated transition (a wipe that covers the old screen, switches, then uncovers).
--   scene.add("round", { enter = function(params) end, update = function(dt) end, draw = function() end,
--                        mousepressed = function(x, y, b) end, keypressed = function(k) end, leave = function() end })
--   scene.go("shop", { money = 12 })       -- animated; scene.go("shop", params, true) switches instantly
-- main.lua forwards love callbacks to scene.update/draw/mousepressed/mousereleased/keypressed.
local scene = { list = {}, current = nil, name = nil, cover = 0, pending = nil, phase = nil, speed = 4 }

function scene.add(name, s) scene.list[name] = s end

local function switch(name, params)
  local s = assert(scene.list[name], "scene.go: unknown scene " .. tostring(name))
  if scene.current and scene.current.leave then scene.current.leave() end
  scene.current, scene.name = s, name
  if s.enter then s.enter(params or {}) end
end

function scene.go(name, params, instant)
  if instant or not scene.current then switch(name, params); return end
  scene.pending, scene.phase = { name = name, params = params }, "in"
end

function scene.busy() return scene.phase ~= nil end

function scene.update(dt)
  if scene.phase == "in" then
    scene.cover = math.min(1, scene.cover + dt * scene.speed)
    if scene.cover >= 1 then
      switch(scene.pending.name, scene.pending.params)
      scene.pending, scene.phase = nil, "out"
    end
  elseif scene.phase == "out" then
    scene.cover = math.max(0, scene.cover - dt * scene.speed)
    if scene.cover <= 0 then scene.phase = nil end
  end
  if scene.current and scene.current.update then scene.current.update(dt) end
end

-- Draw the scene, then the wipe on top (diagonal bands in virtual pixels). vw/vh = virtual size.
function scene.draw(vw, vh, color)
  if scene.current and scene.current.draw then scene.current.draw() end
  if scene.cover > 0 then
    local c = color or { 0.05, 0.04, 0.08, 1 }
    love.graphics.setColor(c)
    local band = 24
    for i = 0, math.ceil((vw + vh) / band) do
      local delay = i / ((vw + vh) / band) * 0.5
      local p = math.max(0, math.min(1, (scene.cover - delay) / 0.5))
      if p > 0 then
        local x = i * band - vh
        local wdt = band * p + 1
        love.graphics.polygon("fill", x, vh, x + vh, 0, x + vh + wdt, 0, x + wdt, vh)
      end
    end
    love.graphics.setColor(1, 1, 1, 1)
  end
end

-- Input is ignored while a transition plays.
for _, cb in ipairs({ "mousepressed", "mousereleased", "keypressed" }) do
  scene[cb] = function(...)
    if scene.phase or not scene.current or not scene.current[cb] then return end
    return scene.current[cb](...)
  end
end

return scene
