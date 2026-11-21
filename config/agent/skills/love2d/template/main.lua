-- LOVE 11.4 game template (verified on __PI_HOME__/love2d/lovec.exe). Run:  lovec.exe .   Self-test:  lovec.exe . --selftest
-- Layout: main.lua wires LOVE callbacks to scenes; game logic lives in src/ (pure Lua where possible, testable with luajit).
package.path = package.path .. ";src/?.lua;src/?/init.lua"   -- lets plain luajit tests require the same modules

local scaler = require("src.lib.scaler")
local tween = require("src.lib.tween")
local save = require("src.lib.save")
local log = require("src.lib.log")
local sprite = require("src.lib.sprite")
local settings = require("src.lib.settings")
local ui = require("src.lib.ui")

local VW, VH = 480, 270           -- virtual resolution: 16:9, scales x2/x3/x4 to 960x540 / 1440x810 / 1920x1080
local game = { scene = "menu", t = 0, shake = 0, score = 0, shown_score = 0, button = { x = 190, y = 160, w = 100, h = 24, s = 1 } }
local crt, bg, font, particles, anim, panel
local menu_buttons, settings_buttons = {}, {}
local selftest = { on = false, frame = 0 }

-- A 2-frame 16x16 strip and a 12x12 9-slice panel made in code so the template has no asset files.
-- Real games load Aseprite exports: sprite.strip("assets/slime_idle.png", 32, 8), sprite.nine("assets/panel.png", 4)
local function make_art()
  local strip = love.image.newImageData(32, 16)
  strip:mapPixel(function(x, y)
    local cx, r = (x % 16) - 7.5, (x < 16) and 6 or 7
    if cx * cx + (y - 7.5) ^ 2 <= r * r then return 0.95, 0.75, 0.3, 1 end
    return 0, 0, 0, 0
  end)
  local box = love.image.newImageData(12, 12)
  box:mapPixel(function(x, y)
    if x == 0 or y == 0 or x == 11 or y == 11 then return 0.95, 0.85, 0.6, 1 end
    if x < 4 or y < 4 or x > 7 or y > 7 then return 0.45, 0.28, 0.18, 1 end
    return 0.3, 0.18, 0.12, 1
  end)
  return sprite.strip(love.graphics.newImage(strip), 16, 4), sprite.nine(love.graphics.newImage(box), 4)
end

local function make_particles()
  local dot = love.image.newImageData(2, 2)
  dot:mapPixel(function() return 1, 1, 1, 1 end)
  local ps = love.graphics.newParticleSystem(love.graphics.newImage(dot), 64)
  ps:setParticleLifetime(0.3, 0.7)
  ps:setSpeed(40, 120)
  ps:setSpread(math.pi * 2)
  ps:setLinearAcceleration(0, 120, 0, 200)
  ps:setColors(1, 0.9, 0.4, 1, 1, 0.4, 0.2, 0)
  return ps
end

local function press_button()
  local b = game.button
  game.score = game.score + 10
  game.shake = 0.25
  particles:setPosition(b.x + b.w / 2, b.y + b.h / 2)
  particles:emit(24)
  b.s = 1.25
  tween.to(b, 0.25, { s = 1 }, "outBack")
  log.info("score", "button pressed, score " .. game.score)
end

local function show(scene)
  game.scene = scene
  for _, b in ipairs(menu_buttons) do b.enabled = scene == "menu" end
  for _, b in ipairs(settings_buttons) do b.enabled = scene == "settings" end
end

-- Menu and settings screens from the ui kit; a real game keeps these in their own scene files.
local function make_screens()
  local function btn(list, y, text, on_click, w)
    local b = ui.button{ x = (VW - (w or 160)) / 2, y = y, w = w or 160, h = 20, text = text, on_click = on_click }
    list[#list + 1] = b
    return b
  end
  btn(menu_buttons, 120, "PLAY", function() show("play") end)
  btn(menu_buttons, 146, "SETTINGS", function() show("settings") end)
  btn(menu_buttons, 172, "QUIT", function() love.event.quit() end)
  local s_full = btn(settings_buttons, 80, "", function() settings.toggle_fullscreen() end, 200)
  local s_scale = btn(settings_buttons, 106, "", function() settings.toggle_scaling() end, 200)
  local s_vol = btn(settings_buttons, 132, "", function() end, 120)
  local s_minus = ui.button{ x = s_vol.x - 26, y = 132, w = 20, h = 20, text = "-", on_click = function() settings.change_volume(-0.1) end }
  local s_plus = ui.button{ x = s_vol.x + s_vol.w + 6, y = 132, w = 20, h = 20, text = "+", on_click = function() settings.change_volume(0.1) end }
  settings_buttons[#settings_buttons + 1] = s_minus
  settings_buttons[#settings_buttons + 1] = s_plus
  btn(settings_buttons, 176, "BACK", function() show("menu") end, 100)
  game.labels = function()                              -- button labels follow the current values
    s_full.text, s_scale.text, s_vol.text = settings.label("fullscreen"), settings.label("scaling"), settings.label("volume")
  end
  game.sbtn = { full = s_full, scale = s_scale, minus = s_minus, plus = s_plus }
end

function love.load(args)
  for _, a in ipairs(args or {}) do
    if a == "--selftest" then selftest.on = true end
    if a == "--selftest" or a == "--windowed" then settings.window_locked = true end   -- never touch the real window mode
  end
  scaler.init(VW, VH)
  if selftest.on then settings.file = "settings_selftest.lua" end                -- don't overwrite the player's settings
  settings.load()
  settings.apply()
  font = love.graphics.newFont(8)                      -- default font at small size; for crisp pixel text use newImageFont
  love.graphics.setFont(font)
  crt = love.graphics.newShader("shaders/crt.glsl")
  crt:send("resolution", { VW, VH })
  crt:send("strength", 0.6)
  bg = love.graphics.newShader("shaders/background.glsl")  -- also fills the borders around the game image
  bg:send("col_a", { 0.06, 0.05, 0.09 }); bg:send("col_b", { 0.12, 0.08, 0.14 }); bg:send("col_c", { 0.2, 0.1, 0.16 })
  make_screens()
  show("menu")
  particles = make_particles()
  anim, panel = make_art()
  local rng = love.math.newRandomGenerator(12345)      -- seeded: same run every time for a given seed
  game.seed_roll = rng:random(1, 100)
  local best = save.read("best.lua")
  game.best = best and best.score or 0
  log.info("boot", "virtual " .. VW .. "x" .. VH .. ", seed roll " .. game.seed_roll .. ", best " .. game.best)
end

function love.resize(w, h) scaler.resize(w, h) end

function love.update(dt)
  dt = math.min(dt, 1 / 20)                            -- avoid huge steps after a window drag or breakpoint
  game.t = game.t + dt
  tween.update(dt)
  particles:update(dt)
  sprite.update(anim, dt)
  game.shake = math.max(0, game.shake - dt)
  game.shown_score = game.shown_score + (game.score - game.shown_score) * math.min(1, dt * 10)   -- count-up
  game.labels()
  local mx, my
  if selftest.on then mx, my = selftest.mx, selftest.my else mx, my = scaler.to_virtual(love.mouse.getPosition()) end
  ui.update(dt, mx, my)
  bg:send("time", game.t)

  if selftest.on then
    local f = selftest.frame + 1
    selftest.frame = f
    local function click(b) selftest.mx, selftest.my = b.x + 5, b.y + 5; ui.mousepressed(selftest.mx, selftest.my, 1) end
    local function check(c, what) if not c then selftest.fail = (selftest.fail or "") .. what .. "; " end end
    if f == 5 then click(menu_buttons[2]) end                                       -- SETTINGS
    if f == 6 then check(game.scene == "settings", "settings opens") end
    if f == 10 then click(game.sbtn.scale) end                                      -- -> fill screen
    if f == 11 then check(scaler.mode == "fill" and scaler.scale ~= math.floor(scaler.scale), "fill mode uses a fractional scale (" .. scaler.scale .. ")") end
    if f == 30 then love.graphics.captureScreenshot("selftest_settings_fill.png") end
    if f == 35 then click(game.sbtn.scale) end                                      -- -> pixel-perfect
    if f == 36 then check(scaler.mode == "pixel" and scaler.scale == math.floor(scaler.scale), "pixel mode uses a whole-number scale") end
    if f == 38 then love.graphics.captureScreenshot("selftest_settings_pixel.png") end
    if f == 40 then click(game.sbtn.minus) end
    if f == 41 then check(math.abs(settings.get("volume") - 0.7) < 1e-9, "volume down to 0.7, got " .. settings.get("volume")) end
    if f == 45 then click(game.sbtn.full) end                                       -- fullscreen setting flips (window locked)
    if f == 46 then
      check(settings.get("fullscreen") == false, "fullscreen setting toggled off")
      check(love.window.getFullscreen() == false, "self-test never changes the real window mode")
      local saved = save.read("settings_selftest.lua")
      check(saved and saved.fullscreen == false and math.abs(saved.volume - 0.7) < 1e-9 and saved.scaling == "pixel", "settings saved")
    end
    if f == 50 then click(settings_buttons[#settings_buttons]) end                  -- BACK
    if f == 51 then check(game.scene == "menu", "back to menu") end
    if f == 55 then click(menu_buttons[1]) end                                      -- PLAY
    if f == 56 then check(game.scene == "play", "play opens") end
    if f == 60 then press_button() end
    if f == 61 then press_button() end
    if f == 110 then
      local ok = not selftest.fail and #anim.quads == 2 and #panel.quads == 9 and game.score == 20 and game.seed_roll == love.math.newRandomGenerator(12345):random(1, 100)
      save.write("best.lua", { score = math.max(game.best, game.score) })
      local again = save.read("best.lua")
      ok = ok and again and again.score >= 20
      love.graphics.captureScreenshot("selftest.png")   -- written to the save folder at the end of this frame
      log.info("selftest", ok and "SELFTEST PASS" or ("SELFTEST FAIL " .. (selftest.fail or "") .. " score=" .. game.score))
      selftest.result = ok
    end
    if f == 113 then love.event.quit(selftest.result and 0 or 1) end
  end
end

function love.draw()
  scaler.begin()
  love.graphics.push()
  if game.shake > 0 then love.graphics.translate(love.math.random(-2, 2), love.math.random(-2, 2)) end
  love.graphics.clear(0.08, 0.07, 0.12, 1)
  love.graphics.setColor(1, 1, 1, 1)
  if game.scene == "menu" then
    love.graphics.printf("LOVE TEMPLATE", 0, 80, VW, "center")
    for _, b in ipairs(menu_buttons) do ui.draw(b) end
  elseif game.scene == "settings" then
    love.graphics.printf("SETTINGS", 0, 50, VW, "center")
    for _, b in ipairs(settings_buttons) do ui.draw(b) end
    love.graphics.setColor(1, 1, 1, 0.6)
    love.graphics.printf("Alt+Enter also toggles fullscreen", 0, 210, VW, "center")
    love.graphics.setColor(1, 1, 1, 1)
  else
    sprite.draw_nine(panel, 140, 70, 200, 80)          -- stretched 9-slice panel behind the sprite
    sprite.draw(anim, 240, 108, 0, 2)                   -- animated strip, centred, scaled x2
    local b = game.button
    love.graphics.push()
    love.graphics.translate(b.x + b.w / 2, b.y + b.h / 2)
    love.graphics.scale(b.s)
    love.graphics.setColor(0.85, 0.3, 0.25, 1)
    love.graphics.rectangle("fill", -b.w / 2, -b.h / 2, b.w, b.h, 4, 4)   -- rectangle(mode, x, y, w, h, rx, ry)
    love.graphics.setColor(1, 1, 1, 1)
    love.graphics.printf("+10", -b.w / 2, -5, b.w, "center")
    love.graphics.pop()
    love.graphics.print(string.format("SCORE %d", math.floor(game.shown_score + 0.5)), 8, 8)
    love.graphics.draw(particles)
  end
  love.graphics.pop()
  scaler.finish(crt, function(ww, wh)                  -- borders: the animated background, not black bars
    bg:send("size", { ww, wh })
    love.graphics.setShader(bg)
    love.graphics.rectangle("fill", 0, 0, ww, wh)
    love.graphics.setShader()
  end)
end

function love.mousepressed(x, y, button)
  local vx, vy = scaler.to_virtual(x, y)
  if not vx or button ~= 1 then return end
  if ui.mousepressed(vx, vy, button) then return end
  if game.scene ~= "play" then return end
  local b = game.button
  if vx >= b.x and vx < b.x + b.w and vy >= b.y and vy < b.y + b.h then press_button() end
end

function love.keypressed(key)
  if key == "return" and love.keyboard.isDown("lalt", "ralt") then settings.toggle_fullscreen(); return end
  if key == "escape" then
    if game.scene == "menu" then love.event.quit() else show("menu") end
  end
end
