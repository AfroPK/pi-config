-- Sprites from Aseprite exports. Convention: one horizontal strip PNG per animation, all frames the same size
-- (Aseprite MCP: export_spritesheet(..., sheet_type="horizontal", tag_name="idle")). No JSON needed.
local sprite = {}

-- anim = sprite.strip("assets/slime_idle.png", 32, 8)   -- frame width 32 px, 8 frames per second
function sprite.strip(path_or_image, frame_w, fps)
  local img = type(path_or_image) == "string" and love.graphics.newImage(path_or_image) or path_or_image
  local iw, ih = img:getDimensions()
  assert(iw % frame_w == 0, "sprite.strip: image width " .. iw .. " is not a multiple of " .. frame_w)
  local quads = {}
  for i = 0, iw / frame_w - 1 do quads[#quads + 1] = love.graphics.newQuad(i * frame_w, 0, frame_w, ih, iw, ih) end
  return { img = img, quads = quads, fps = fps or 8, t = 0, w = frame_w, h = ih, loop = true }
end

function sprite.update(anim, dt) anim.t = anim.t + dt end

function sprite.frame(anim)
  local n = #anim.quads
  local f = math.floor(anim.t * anim.fps)
  return anim.loop and (f % n) + 1 or math.min(f + 1, n)
end

-- Draw centred on (x, y) with optional scale (whole numbers keep pixels crisp), rotation and flip.
function sprite.draw(anim, x, y, r, sx, sy)
  love.graphics.draw(anim.img, anim.quads[sprite.frame(anim)], math.floor(x), math.floor(y), r or 0,
    sx or 1, sy or sx or 1, anim.w / 2, anim.h / 2)
end

-- 9-slice panel: corners stay fixed, edges and centre stretch. `b` = border size in pixels of the source image.
-- panel = sprite.nine("assets/panel.png", 6); sprite.draw_nine(panel, x, y, w, h)
function sprite.nine(path_or_image, b)
  local img = type(path_or_image) == "string" and love.graphics.newImage(path_or_image) or path_or_image
  local iw, ih = img:getDimensions()
  local q = function(x, y, w, h) return love.graphics.newQuad(x, y, w, h, iw, ih) end
  local cw, ch = iw - 2 * b, ih - 2 * b
  return { img = img, b = b, cw = cw, ch = ch, quads = {
    q(0, 0, b, b), q(b, 0, cw, b), q(iw - b, 0, b, b),
    q(0, b, b, ch), q(b, b, cw, ch), q(iw - b, b, b, ch),
    q(0, ih - b, b, b), q(b, ih - b, cw, b), q(iw - b, ih - b, b, b) } }
end

function sprite.draw_nine(p, x, y, w, h)
  local b, Q, img = p.b, p.quads, p.img
  local sx, sy = (w - 2 * b) / p.cw, (h - 2 * b) / p.ch
  love.graphics.draw(img, Q[1], x, y)
  love.graphics.draw(img, Q[2], x + b, y, 0, sx, 1)
  love.graphics.draw(img, Q[3], x + w - b, y)
  love.graphics.draw(img, Q[4], x, y + b, 0, 1, sy)
  love.graphics.draw(img, Q[5], x + b, y + b, 0, sx, sy)
  love.graphics.draw(img, Q[6], x + w - b, y + b, 0, 1, sy)
  love.graphics.draw(img, Q[7], x, y + h - b)
  love.graphics.draw(img, Q[8], x + b, y + h - b, 0, sx, 1)
  love.graphics.draw(img, Q[9], x + w - b, y + h - b)
end

return sprite
