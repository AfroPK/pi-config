-- Named log lines to stdout (visible with lovec.exe) and to logs/run.log in the save folder.
-- Use one tag per feature so tests and Verify steps can grep for proof: log.info("capture", "pit 3 took 6").
local log = {}
local started = false

function log.info(tag, msg)
  local line = string.format("[%s] %s", tag, tostring(msg))
  print(line)
  if not started then
    love.filesystem.createDirectory("logs")
    love.filesystem.write("logs/run.log", "")
    started = true
  end
  love.filesystem.append("logs/run.log", line .. "\n")
end

return log
