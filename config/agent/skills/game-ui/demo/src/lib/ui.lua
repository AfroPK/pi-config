-- Juicy UI widgets in virtual pixels (use with scaler.lua). Every widget hovers, tilts, lifts and pops via springs.
--   local ui = require("src.lib.ui")
--   local b = ui.button{ x = 20, y = 200, w = 80, h = 22, text = "PLAY", on_click = function() ... end }
--   local row = ui.slots{ x = 100, y = 20, slot_w = 40, slot_h = 52, gap = 6, items = {...}, on_reorder = fn }
--   love.update: ui.update(dt, mx, my)  (virtual mouse from scaler.to_virtual, or nil when outside)
--   love.draw:   ui.draw(b); ui.draw_slots(row, draw_item); ui.draw_tooltip()
--   mouse:       ui.mousepressed(mx, my, button) / ui.mousereleased(mx, my, button)
-- Logic modules never import this; ui only displays state and reports clicks/reorders.
local anim = require("src.lib.anim")

local ui = { widgets = {}, rows = {}, mx = nil, my = nil, time = 0, hovered = nil, hover_t = 0,
             drag = nil, font = nil, colors = {
               panel = { 0.16, 0.12, 0.2, 1 }, edge = { 0.95, 0.85, 0.6, 1 }, text = { 1, 0.97, 0.9, 1 },
               button = { 0.85, 0.3, 0.25, 1 }, button_hi = { 0.95, 0.45, 0.3, 1 }, shadow = { 0, 0, 0, 0.45 },
               tip = { 0.08, 0.07, 0.12, 0.95 } } }

local function inside(w, x, y) return x and x >= w.x and x < w.x + w.w and y >= w.y and y < w.y + w.h end

local function juicy(w)
  w.scale = anim.spring(1, 260, 13)
  w.rot = anim.spring(0, 180, 10)
  w.lift = anim.spring(0, 240, 16)
  w.phase = w.phase or (#ui.widgets * 1.3)
  return w
end

function ui.button(def)
  local w = juicy(def)
  w.kind = "button"
  ui.widgets[#ui.widgets + 1] = w
  return w
end

-- Slots: a row of items the player can drag to reorder (e.g. modifiers, whose order changes scoring).
function ui.slots(def)
  local row = def
  row.kind = "slots"
  for i, item in ipairs(row.items) do
    juicy(item)
    item.phase = i * 1.7
    item.px = anim.spring(row.x + (i - 1) * (row.slot_w + row.gap), 200, 18)   -- drawn x position
  end
  ui.rows[#ui.rows + 1] = row
  return row
end

function ui.slot_x(row, i) return row.x + (i - 1) * (row.slot_w + row.gap) end

function ui.pop(w, strength)                -- call when something happens to w (it fired, scored, was bought)
  anim.kick(w.scale, strength or 3)
  anim.kick(w.rot, (strength or 3) * 0.08 * (math.random() < 0.5 and -1 or 1))
end

local function update_juice(w, dt, hovered)
  w.scale.target = hovered and 1.08 or 1
  w.lift.target = hovered and -2 or 0
  w.rot.target = hovered and anim.sway(ui.time * 2.5, w.phase, 0.04) or anim.sway(ui.time, w.phase, 0.015)
  anim.spring_update(w.scale, dt)
  anim.spring_update(w.rot, dt)
  anim.spring_update(w.lift, dt)
end

function ui.update(dt, mx, my)
  ui.time = ui.time + dt
  ui.mx, ui.my = mx, my
  local hovered = nil
  for _, w in ipairs(ui.widgets) do
    local h = not ui.drag and w.enabled ~= false and inside(w, mx, my)
    if h then hovered = w end
    update_juice(w, dt, h)
  end
  for _, row in ipairs(ui.rows) do
    for i, item in ipairs(row.items) do
      local dragging = ui.drag and ui.drag.item == item
      local box = { x = item.px.x, y = row.y, w = row.slot_w, h = row.slot_h }
      local h = not ui.drag and inside(box, mx, my)
      if h then hovered = item end
      update_juice(item, dt, h or dragging)
      if dragging then
        item.px.x = mx - ui.drag.dx                  -- follow the mouse exactly
        item.px.v = 0
      else
        item.px.target = ui.slot_x(row, i)
        anim.spring_update(item.px, dt)
      end
    end
    if ui.drag and ui.drag.row == row then          -- live reorder: move the dragged item to the slot under it
      local from = ui.drag.index
      local centre = (mx or 0) - ui.drag.dx + row.slot_w / 2
      local to = math.max(1, math.min(#row.items, math.floor((centre - row.x) / (row.slot_w + row.gap)) + 1))
      if to ~= from then
        table.insert(row.items, to, table.remove(row.items, from))
        ui.drag.index = to
      end
    end
  end
  if hovered ~= ui.hovered then ui.hovered, ui.hover_t = hovered, 0 else ui.hover_t = ui.hover_t + dt end
end

function ui.mousepressed(mx, my, button)
  if button ~= 1 or not mx then return false end
  for _, row in ipairs(ui.rows) do
    for i, item in ipairs(row.items) do
      if inside({ x = item.px.x, y = row.y, w = row.slot_w, h = row.slot_h }, mx, my) then
        ui.drag = { row = row, item = item, index = i, dx = mx - item.px.x, start = i }
        ui.pop(item, 2)
        return true
      end
    end
  end
  for _, w in ipairs(ui.widgets) do
    if w.enabled ~= false and inside(w, mx, my) then
      ui.pop(w, 4)
      if w.on_click then w.on_click(w) end
      return true
    end
  end
  return false
end

function ui.mousereleased(mx, my, button)
  if button ~= 1 or not ui.drag then return end
  local d = ui.drag
  ui.drag = nil
  ui.pop(d.item, 2)
  if d.index ~= d.start and d.row.on_reorder then d.row.on_reorder(d.row.items, d.start, d.index) end
end

-- Drawing ------------------------------------------------------------------------------------------------------
local function with_transform(cx, cy, w)
  love.graphics.push()
  love.graphics.translate(math.floor(cx + 0.5), math.floor(cy + w.lift.x + 0.5))
  love.graphics.rotate(w.rot.x)
  love.graphics.scale(w.scale.x)
end

function ui.draw(w)
  local c = ui.colors
  local cx, cy = w.x + w.w / 2, w.y + w.h / 2
  love.graphics.setColor(c.shadow)                                  -- shadow stays on the ground while it lifts
  love.graphics.rectangle("fill", w.x + 2, w.y + 3, w.w, w.h, 3, 3)
  with_transform(cx, cy, w)
  local hi = ui.hovered == w
  love.graphics.setColor(w.enabled == false and { 0.4, 0.4, 0.45, 1 } or (hi and c.button_hi or (w.color or c.button)))
  love.graphics.rectangle("fill", -w.w / 2, -w.h / 2, w.w, w.h, 3, 3)
  love.graphics.setColor(c.text)
  local f = love.graphics.getFont()
  love.graphics.printf(w.text or "", -w.w / 2, -math.floor(f:getHeight() / 2), w.w, "center")
  love.graphics.pop()
  love.graphics.setColor(1, 1, 1, 1)
end

-- draw_item(item, w, h) draws one item centred on (0, 0) in its own transformed space.
function ui.draw_slots(row, draw_item)
  local c = ui.colors
  for i = 1, #row.items do                                          -- empty slot outlines
    love.graphics.setColor(1, 1, 1, 0.12)
    love.graphics.rectangle("line", ui.slot_x(row, i) + 0.5, row.y + 0.5, row.slot_w - 1, row.slot_h - 1, 3, 3)
  end
  local dragged
  for _, item in ipairs(row.items) do
    if ui.drag and ui.drag.item == item then dragged = item else
      love.graphics.setColor(c.shadow)
      love.graphics.rectangle("fill", item.px.x + 2, row.y + 3, row.slot_w, row.slot_h, 3, 3)
      with_transform(item.px.x + row.slot_w / 2, row.y + row.slot_h / 2, item)
      love.graphics.setColor(1, 1, 1, 1)
      draw_item(item, row.slot_w, row.slot_h)
      love.graphics.pop()
    end
  end
  if dragged then                                                   -- dragged item on top, higher shadow
    love.graphics.setColor(c.shadow)
    love.graphics.rectangle("fill", dragged.px.x + 4, row.y + 7, row.slot_w, row.slot_h, 3, 3)
    with_transform(dragged.px.x + row.slot_w / 2, row.y + row.slot_h / 2 - 4, dragged)
    love.graphics.setColor(1, 1, 1, 1)
    draw_item(dragged, row.slot_w, row.slot_h)
    love.graphics.pop()
  end
  love.graphics.setColor(1, 1, 1, 1)
end

-- Tooltip for the hovered widget/item after a short delay: set .tip = "text" (or a function returning text) on it.
function ui.draw_tooltip(vw, vh)
  local w = ui.hovered
  if not w or not w.tip or ui.hover_t < 0.25 or not ui.mx then return end
  local text = type(w.tip) == "function" and w.tip(w) or w.tip
  local f = love.graphics.getFont()
  local maxw = 140
  local _, lines = f:getWrap(text, maxw - 8)
  local tw = 8
  for _, l in ipairs(lines) do tw = math.max(tw, f:getWidth(l) + 8) end
  local th = #lines * f:getHeight() + 6
  local x = math.min(ui.mx + 8, (vw or 480) - tw - 2)
  local y = math.max(2, ui.my - th - 6)
  love.graphics.setColor(ui.colors.tip)
  love.graphics.rectangle("fill", x, y, tw, th, 2, 2)
  love.graphics.setColor(ui.colors.edge)
  love.graphics.rectangle("line", x + 0.5, y + 0.5, tw - 1, th - 1, 2, 2)
  love.graphics.setColor(ui.colors.text)
  love.graphics.printf(text, x + 4, y + 3, tw - 8, "left")
  love.graphics.setColor(1, 1, 1, 1)
end

function ui.reset() ui.widgets, ui.rows, ui.hovered, ui.drag = {}, {}, nil, nil end

return ui
