-- Player settings: loaded at start, applied, and saved whenever they change (save folder, settings.lua).
--   settings.load(); settings.apply()           in love.load (after scaler.init)
--   settings.set("fullscreen", false)           from the settings screen: applies and saves at once
--   settings.toggle_fullscreen()                also bound to Alt+Enter
-- Games start fullscreen (borderless "desktop" mode) unless the player chose windowed. Self-tests and --windowed
-- runs never touch the real window mode (settings.window_locked), so agents' test runs don't flash the screen.
local save = require("src.lib.save")
local scaler = require("src.lib.scaler")

local settings = {
  defaults = { fullscreen = true, scaling = "pixel", volume = 0.8, vsync = true },
  values = {}, window_locked = false, file = "settings.lua",
}

function settings.load()
  local saved = save.read(settings.file) or {}
  for k, v in pairs(settings.defaults) do
    if saved[k] == nil then settings.values[k] = v else settings.values[k] = saved[k] end
  end
  return settings.values
end

function settings.get(key) return settings.values[key] end

function settings.apply()
  local v = settings.values
  if not settings.window_locked then
    if love.window.getFullscreen() ~= v.fullscreen then love.window.setFullscreen(v.fullscreen, "desktop") end
    love.window.setVSync(v.vsync and 1 or 0)
  end
  scaler.set_mode(v.scaling)                    -- also recomputes the scale for the current window size
  love.audio.setVolume(v.volume)
end

function settings.set(key, value)
  assert(settings.defaults[key] ~= nil, "settings.set: unknown setting " .. tostring(key))
  settings.values[key] = value
  settings.apply()
  save.write(settings.file, settings.values)
end

function settings.toggle_fullscreen() settings.set("fullscreen", not settings.values.fullscreen) end
function settings.toggle_scaling() settings.set("scaling", settings.values.scaling == "pixel" and "fill" or "pixel") end
function settings.change_volume(delta)
  settings.set("volume", math.max(0, math.min(1, math.floor((settings.values.volume + delta) * 10 + 0.5) / 10)))
end

-- Labels for a settings screen
function settings.label(key)
  local v = settings.values
  if key == "fullscreen" then return v.fullscreen and "DISPLAY: FULLSCREEN" or "DISPLAY: WINDOWED" end
  if key == "scaling" then return v.scaling == "pixel" and "SCALING: PIXEL-PERFECT" or "SCALING: FILL SCREEN" end
  if key == "volume" then return string.format("VOLUME: %d%%", math.floor(v.volume * 100 + 0.5)) end
  return key
end

return settings
