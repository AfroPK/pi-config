function love.conf(t)
  t.identity = "game-ui-demo"
  t.version = "11.4"
  t.window.title = "Game UI demo"
  t.window.width, t.window.height = 1280, 720
  t.window.resizable = true
  t.window.vsync = 1
  t.modules.joystick = false
  t.modules.physics = false
end
