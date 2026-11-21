-- Save/load plain Lua tables (numbers, strings, booleans, nested tables) to the game's save folder
-- (%APPDATA%/LOVE/<identity>/ when fused builds are not used). The file is a Lua chunk; loading uses an empty env.
local save = {}

local function ser(v, indent)
  local t = type(v)
  if t == "number" or t == "boolean" then return tostring(v) end
  if t == "string" then return string.format("%q", v) end
  assert(t == "table", "save: cannot serialise " .. t)
  local pad, out = indent .. "  ", { "{\n" }
  for k, val in pairs(v) do
    local key = type(k) == "string" and k:match("^[%a_][%w_]*$") and k or "[" .. ser(k, pad) .. "]"
    out[#out + 1] = pad .. key .. " = " .. ser(val, pad) .. ",\n"
  end
  out[#out + 1] = indent .. "}"
  return table.concat(out)
end

function save.write(name, tbl)
  local ok, err = love.filesystem.write(name, "return " .. ser(tbl, "") .. "\n")
  if not ok then error("save.write " .. name .. ": " .. tostring(err)) end
end

function save.read(name)
  if not love.filesystem.getInfo(name) then return nil end
  local chunk, err = love.filesystem.load(name)
  if not chunk then return nil, err end
  setfenv(chunk, {})                 -- LuaJIT (Lua 5.1): no access to globals from the save file
  local ok, data = pcall(chunk)
  if not ok then return nil, data end
  return data
end

return save
