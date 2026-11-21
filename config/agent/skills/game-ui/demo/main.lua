-- Game UI demo: every piece of the UI kit in one screen, plus a scripted --selftest that drives the mouse.
-- Build: copy the love2d template's src/ and shaders/ next to this file (see game-ui SKILL.md), then
--   lovec.exe .            (play: drag the badges, hover them, press SCORE / SHOP)
--   lovec.exe . --selftest (scripted run, screenshots shot_*.png, prints SELFTEST PASS/FAIL)
package.path = package.path .. ";src/?.lua"
local scaler = require("src.lib.scaler")
local anim = require("src.lib.anim")
local ui = require("src.lib.ui")
local scene = require("src.lib.scene")
local log = require("src.lib.log")

local VW, VH = 480, 270
local bg, crt, font
local T = 0

-- Example modifiers (placeholder data; real ones live in the game's modifier module and scoring engine)
local MODS = {
  { id = "A", name = "Harvest", color = { 0.3, 0.75, 0.4 }, add_points = 5, tip = "Harvest: +5 points" },
  { id = "B", name = "Drum", color = { 0.95, 0.65, 0.2 }, add_mult = 2, tip = "Drum: +2 mult" },
  { id = "C", name = "Crown", color = { 0.85, 0.3, 0.6 }, mul_mult = 2, tip = "Crown: x2 mult (order matters!)" },
  { id = "D", name = "Seedling", color = { 0.35, 0.6, 0.95 }, add_points = 3, tip = "Seedling: +3 points" },
}

-- Round screen state
local R = { points = 10, mult = 1, shown_points = 10, shown_mult = 1, total = 0, shown_total = 0, popups = {},
            queue = anim.queue(), order_changes = 0 }
local row, score_btn, shop_btn, back_btn, shake = nil, nil, nil, nil, 0

local function popup(text, x, y, color)
  local p = { text = text, x = x, y = y, a = 1, color = color }
  R.popups[#R.popups + 1] = p
  return p
end

-- Logic decides the result first; the queue only shows it step by step.
local function play_scoring()
  if R.queue:busy() then return end
  local points, mult = 10, 1
  R.points, R.mult, R.shown_points, R.shown_mult = points, mult, points, mult
  for i, item in ipairs(row.items) do
    local m = item.mod
    if m.add_points then points = points + m.add_points end
    if m.add_mult then mult = mult + m.add_mult end
    if m.mul_mult then mult = mult * m.mul_mult end
    local p_after, m_after, step = points, mult, i
    R.queue:add(0.35, function()
      ui.pop(item, 5)
      local x = item.px.x + row.slot_w / 2 - 12
      local label = m.add_points and ("+" .. m.add_points) or (m.add_mult and ("+" .. m.add_mult .. " mult") or ("x" .. m.mul_mult .. " mult"))
      popup(label, x, row.y - 6, m.color)
      R.points, R.mult = p_after, m_after
      log.info("score", "step " .. step .. " " .. m.name .. " -> " .. p_after .. " x " .. m_after)
    end)
  end
  R.total = points * mult
  R.queue:add(0.6, function()
    shake = math.min(0.6, 0.15 + R.total / 400)
    ui.pop(score_btn, 6)
    log.info("score", "total " .. R.total)
  end)
  return R.total
end

local round = {}
function round.enter() score_btn.enabled, shop_btn.enabled, back_btn.enabled = true, true, false; log.info("scene", "round") end
function round.update(dt)
  R.queue:update(dt)
  R.shown_points = R.shown_points + (R.points - R.shown_points) * math.min(1, dt * 12)
  R.shown_mult = R.shown_mult + (R.mult - R.shown_mult) * math.min(1, dt * 12)
  if not R.queue:busy() then                            -- count up fast, then snap so it always lands on the number
    R.shown_total = R.shown_total + (R.total - R.shown_total) * math.min(1, dt * 10)
    if math.abs(R.total - R.shown_total) < 0.5 then R.shown_total = R.total end
  end
  for i = #R.popups, 1, -1 do
    local p = R.popups[i]
    p.y, p.a = p.y - dt * 18, p.a - dt * 1.2
    if p.a <= 0 then table.remove(R.popups, i) end
  end
end
function round.draw()
  -- score panel
  love.graphics.setColor(0.08, 0.06, 0.12, 0.85)
  love.graphics.rectangle("fill", 12, 12, 120, 70, 4, 4)
  love.graphics.setColor(1, 0.97, 0.9, 1)
  love.graphics.print("POINTS", 20, 18)
  love.graphics.print("MULT", 80, 18)
  love.graphics.setColor(0.45, 0.75, 1, 1)
  love.graphics.print(string.format("%d", math.floor(R.shown_points + 0.5)), 20, 30)
  love.graphics.setColor(1, 0.45, 0.35, 1)
  love.graphics.print(string.format("%.0f", R.shown_mult), 80, 30)
  love.graphics.setColor(1, 0.85, 0.4, 1)
  love.graphics.print(string.format("TOTAL %d", math.floor(R.shown_total + 0.5)), 20, 56)
  love.graphics.setColor(1, 1, 1, 1)
  ui.draw_slots(row, function(item, w, h)
    local c = item.mod.color
    love.graphics.setColor(c[1] * 0.45, c[2] * 0.45, c[3] * 0.45, 1)
    love.graphics.rectangle("fill", -w / 2, -h / 2, w, h, 3, 3)
    love.graphics.setColor(c)
    love.graphics.rectangle("fill", -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 2, 2)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf(item.mod.id, -w / 2, -6, w, "center")
  end)
  for _, p in ipairs(R.popups) do
    love.graphics.setColor(p.color[1], p.color[2], p.color[3], p.a)
    love.graphics.print(p.text, math.floor(p.x), math.floor(p.y))
  end
  love.graphics.setColor(1, 1, 1, 1)
  ui.draw(score_btn)
  ui.draw(shop_btn)
  ui.draw_tooltip(VW, VH)
end
function round.mousepressed(x, y, b) ui.mousepressed(x, y, b) end
function round.mousereleased(x, y, b) ui.mousereleased(x, y, b) end

local shop = {}
function shop.enter() score_btn.enabled, shop_btn.enabled, back_btn.enabled = false, false, true; log.info("scene", "shop") end
function shop.draw()
  love.graphics.setColor(0.08, 0.06, 0.12, 0.85)
  love.graphics.rectangle("fill", 140, 60, 200, 150, 4, 4)
  love.graphics.setColor(1, 0.97, 0.9, 1)
  love.graphics.printf("SHOP", 140, 70, 200, "center")
  love.graphics.setColor(1, 1, 1, 1)
  ui.draw(back_btn)
end
function shop.mousepressed(x, y, b) ui.mousepressed(x, y, b) end

-- Selftest: scripted virtual mouse -----------------------------------------------------------------------
local st = { on = false, f = 0, mx = nil, my = nil, ok = true, notes = {} }
local function check(cond, what) if not cond then st.ok = false; st.notes[#st.notes + 1] = what end end
local function centre_of_slot(i) return ui.slot_x(row, i) + row.slot_w / 2, row.y + row.slot_h / 2 end

local script = {
  [10] = function() st.mx, st.my = centre_of_slot(1) end,                                   -- hover item A
  [40] = function() check(ui.hovered == row.items[1], "hover on A"); love.graphics.captureScreenshot("shot_1_hover.png") end,
  [45] = function() check(ui.mousepressed(st.mx, st.my, 1), "press A starts drag"); check(ui.drag ~= nil, "dragging") end,
  [46] = function() st.target_x = select(1, centre_of_slot(3)) + 2 end,
  [70] = function() love.graphics.captureScreenshot("shot_2_drag.png") end,
  [80] = function() ui.mousereleased(st.mx, st.my, 1) end,
  [81] = function()
    local ids = {}
    for _, it in ipairs(row.items) do ids[#ids + 1] = it.mod.id end
    check(table.concat(ids) == "BCAD", "order after drag is BCAD, got " .. table.concat(ids))
    check(R.order_changes == 1, "on_reorder called once")
  end,
  [100] = function() st.mx, st.my = score_btn.x + 10, score_btn.y + 10; ui.mousepressed(st.mx, st.my, 1) end,
  [101] = function() check(R.total == (10 + 5 + 3) * ((1 + 2) * 2), "total BCAD = 18*6=108, got " .. R.total) end,
  [140] = function() love.graphics.captureScreenshot("shot_3_scoring.png") end,
  [260] = function() check(not R.queue:busy(), "scoring show finished"); check(math.floor(R.shown_total + 0.5) == R.total, "count-up reached total") end,
  [265] = function() st.mx, st.my = shop_btn.x + 10, shop_btn.y + 10; scene.mousepressed(st.mx, st.my, 1) end,
  [272] = function() check(scene.busy(), "transition playing"); love.graphics.captureScreenshot("shot_4_wipe.png") end,
  [330] = function() check(scene.name == "shop" and not scene.busy(), "on shop after wipe"); love.graphics.captureScreenshot("shot_5_shop.png") end,
  [335] = function() st.mx, st.my = back_btn.x + 10, back_btn.y + 10; scene.mousepressed(st.mx, st.my, 1) end,
  [400] = function() check(scene.name == "round", "back on round") end,
  [401] = function()
    log.info("selftest", st.ok and "SELFTEST PASS" or ("SELFTEST FAIL: " .. table.concat(st.notes, "; ")))
  end,
  [404] = function() love.event.quit(st.ok and 0 or 1) end,
}

-- LOVE callbacks -----------------------------------------------------------------------------------------
function love.load(args)
  for _, a in ipairs(args or {}) do if a == "--selftest" then st.on = true end end
  scaler.init(VW, VH)
  font = love.graphics.newFont(8)
  love.graphics.setFont(font)
  bg = love.graphics.newShader("shaders/background.glsl")
  bg:send("size", { VW, VH })
  bg:send("col_a", { 0.10, 0.07, 0.14 })
  bg:send("col_b", { 0.22, 0.12, 0.20 })
  bg:send("col_c", { 0.40, 0.18, 0.22 })
  crt = love.graphics.newShader("shaders/crt.glsl")
  crt:send("resolution", { VW, VH })
  crt:send("strength", 0.5)
  local items = {}
  for _, m in ipairs(MODS) do items[#items + 1] = { mod = m, tip = m.tip } end
  row = ui.slots{ x = 160, y = 30, slot_w = 34, slot_h = 46, gap = 8, items = items,
                  on_reorder = function() R.order_changes = R.order_changes + 1 end }
  score_btn = ui.button{ x = 170, y = 200, w = 70, h = 22, text = "SCORE", on_click = function() play_scoring() end }
  shop_btn = ui.button{ x = 250, y = 200, w = 70, h = 22, text = "SHOP", color = { 0.25, 0.45, 0.8, 1 },
                        on_click = function() scene.go("shop") end }
  back_btn = ui.button{ x = 205, y = 170, w = 70, h = 22, text = "BACK", on_click = function() scene.go("round") end }
  scene.add("round", round)
  scene.add("shop", shop)
  scene.go("round")
end

function love.resize(w, h) scaler.resize(w, h) end

function love.update(dt)
  if st.on then
    dt = 1 / 60                                         -- fixed steps: the script is frame-exact on any machine
    st.f = st.f + 1
    if st.target_x and ui.drag then st.mx = st.mx + (st.target_x - st.mx) * 0.2 end
    if script[st.f] then script[st.f]() end
  end
  T = T + dt
  local mx, my
  if st.on then mx, my = st.mx, st.my else mx, my = scaler.to_virtual(love.mouse.getPosition()) end
  ui.update(dt, mx, my)
  scene.update(dt)
  shake = math.max(0, shake - dt)
  bg:send("time", T)
end

function love.draw()
  scaler.begin()
  love.graphics.setShader(bg)
  love.graphics.rectangle("fill", 0, 0, VW, VH)
  love.graphics.setShader()
  love.graphics.push()
  if shake > 0 then love.graphics.translate(love.math.random(-2, 2) * shake * 3, love.math.random(-2, 2) * shake * 3) end
  scene.draw(VW, VH)
  love.graphics.pop()
  scaler.finish(crt)
end

function love.mousepressed(x, y, b) local vx, vy = scaler.to_virtual(x, y); if vx then scene.mousepressed(vx, vy, b) end end
function love.mousereleased(x, y, b) local vx, vy = scaler.to_virtual(x, y); scene.mousereleased(vx, vy, b) end
function love.keypressed(k) if k == "escape" then love.event.quit() end end
