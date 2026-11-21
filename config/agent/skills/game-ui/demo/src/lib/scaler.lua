-- Virtual resolution: draw everything into a small canvas (e.g. 480x270), then scale it to the window.
--   mode "pixel" (default): largest WHOLE-number scale that fits, centred - every pixel the same size, crisp.
--   mode "fill": largest scale that fits, fractional allowed - no borders on 16:9 screens, pixels slightly uneven.
-- Whatever the canvas doesn't cover is drawn by the backdrop function passed to finish() (e.g. the background
-- shader), so borders look intentional instead of black. Mouse positions are mapped back with to_virtual().
local scaler = { w = 480, h = 270, scale = 1, ox = 0, oy = 0, mode = "pixel", ww = 0, wh = 0 }

function scaler.init(w, h, mode)
  scaler.w, scaler.h = w, h
  scaler.mode = mode or scaler.mode
  love.graphics.setDefaultFilter("nearest", "nearest")   -- before creating images, canvases and fonts
  scaler.canvas = love.graphics.newCanvas(w, h)
  scaler.resize(love.graphics.getDimensions())
end

function scaler.set_mode(mode)
  assert(mode == "pixel" or mode == "fill", "scaler.set_mode: 'pixel' or 'fill'")
  scaler.mode = mode
  scaler.resize(love.graphics.getDimensions())
end

function scaler.resize(ww, wh)
  scaler.ww, scaler.wh = ww, wh
  local fit = math.min(ww / scaler.w, wh / scaler.h)
  if scaler.mode == "pixel" then scaler.scale = math.max(1, math.floor(fit)) else scaler.scale = fit end
  scaler.ox = math.floor((ww - scaler.w * scaler.scale) / 2)
  scaler.oy = math.floor((wh - scaler.h * scaler.scale) / 2)
end

-- Window pixels -> virtual pixels (nil when outside the game area)
function scaler.to_virtual(x, y)
  local vx, vy = (x - scaler.ox) / scaler.scale, (y - scaler.oy) / scaler.scale
  if vx < 0 or vy < 0 or vx >= scaler.w or vy >= scaler.h then return nil end
  return vx, vy
end

function scaler.begin()
  love.graphics.setCanvas(scaler.canvas)
  love.graphics.clear(0, 0, 0, 1)
end

-- shader: optional post effect for the game image (e.g. CRT). backdrop(ww, wh): optional, draws the whole window
-- behind the game (borders); without it the borders are black.
function scaler.finish(shader, backdrop)
  love.graphics.setCanvas()
  love.graphics.clear(0, 0, 0, 1)
  if backdrop then backdrop(scaler.ww, scaler.wh) end
  love.graphics.setColor(1, 1, 1, 1)
  if shader then love.graphics.setShader(shader) end
  love.graphics.draw(scaler.canvas, scaler.ox, scaler.oy, 0, scaler.scale, scaler.scale)
  love.graphics.setShader()
end

return scaler
