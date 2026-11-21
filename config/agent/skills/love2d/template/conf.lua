function love.conf(t)
  -- Players get fullscreen (borderless desktop mode) from the first frame; settings.lua then applies their saved
  -- choice. Self-test and --windowed runs (agents, development) open a normal window so they never flash the screen.
  local windowed = false
  for _, a in ipairs(arg or {}) do if a == "--selftest" or a == "--windowed" then windowed = true end end

  t.identity = "love-template"        -- save folder name under %APPDATA%/LOVE/; change per game
  t.version = "11.4"
  t.window.title = "LOVE Template"
  t.window.width, t.window.height = 1280, 720
  t.window.fullscreen = not windowed
  t.window.fullscreentype = "desktop"
  t.window.resizable = true
  t.window.minwidth, t.window.minheight = 640, 360
  t.window.vsync = 1
  t.window.highdpi = false
  t.modules.joystick = false
  t.modules.physics = false
end
