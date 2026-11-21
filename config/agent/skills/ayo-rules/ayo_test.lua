-- Reference tests for ayo.lua. Run: luajit ayo_test.lua   (from this folder; prints "ayo tests: N passed").
-- Cases 1-4 are the worked examples from raganwald.com/2019/02/03/ayoayo.html, which match the rules on
-- johnpratt.com/items/mancala/ayoayo.html and Wikipedia's Ayoayo page. Keep these passing when you change the rules
-- module; add cases for every rule variant or roguelike modifier that touches sowing or capture.
package.path = (arg and arg[0] and arg[0]:match("^(.*[/\\])") or "") .. "?.lua;" .. package.path
local ayo = require("ayo")

local passed = 0
local function board(t) local b = {}; for i = 0, 11 do b[i] = t[i + 1] end; return b end
local function str(b) local t = {}; for i = 0, 11 do t[#t + 1] = b[i] end; return "[" .. table.concat(t, ",") .. "]" end
local function eq(name, got, want)
  if got ~= want then error(name .. ": got " .. tostring(got) .. ", want " .. tostring(want), 2) end
  passed = passed + 1
end

-- 1. Relay sowing from pit 0 on the opening board
do
  local b = ayo.new_board()
  local last = ayo.sow(b, 0)
  eq("relay board", str(b), "[0,6,6,0,1,6,6,6,6,1,5,5]")
  eq("relay last pit", last, 9)          -- laps end at 4, 9, 3, then 9 (empty): the article's sow() calls
end

-- 2. Capture: pit 3 on the opening board relays round to land in empty pit 0, capturing pit 11 (6 seeds)
do
  local b, s = ayo.new_board(), { [0] = 0, [1] = 0 }
  local r = ayo.play(b, s, 0, 3)
  eq("capture last pit", r.last, 0)
  eq("capture amount", r.captured, 6)
  eq("capture board", str(b), "[1,5,5,0,6,6,0,1,6,6,6,0]")
  eq("capture score", s[0], 6)
end

-- 3. Feeding: the opponent's row is empty, so only moves that give them seeds are legal
do
  local moves = ayo.legal_moves(board({ 1, 0, 2, 0, 1, 0, 0, 0, 0, 0, 0, 0 }), 0)
  eq("feeding count", #moves, 1)
  eq("feeding move", moves[1], 2)
end

-- 4. Game end: player 1 can't move after this, so player 0 keeps the seeds on their row
do
  local b, s = board({ 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0 }), { [0] = 40, [1] = 5 }
  ayo.play(b, s, 0, 2)
  eq("over", ayo.is_over(b, 1), true)
  ayo.finish(b, s)
  eq("end board", str(b), "[0,0,0,0,0,0,0,0,0,0,0,0]")
  eq("end score p0", s[0], 43)
  eq("end score p1", s[1], 5)
end

-- 5. No capture when the last seed lands on the opponent's row (pit 5 with 1 seed -> pit 6, empty)
do
  local b, s = board({ 0, 0, 0, 0, 0, 1, 0, 3, 0, 0, 0, 0 }), { [0] = 0, [1] = 0 }
  local r = ayo.play(b, s, 0, 5)
  eq("no capture last", r.last, 6)
  eq("no capture amount", r.captured, 0)
end

-- 6. 12+ seeds lap the board and skip the pit they came from, so it stays empty
do
  local b = board({ 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 })
  local last = ayo.sow(b, 0)
  -- 11 seeds fill pits 1..11, the 12th skips pit 0 and lands in pit 1 (now occupied), so relay sowing goes on
  eq("lap origin stays empty", b[0], 0)
  local total = 0
  for i = 0, 11 do total = total + b[i] end
  eq("lap seeds conserved", total, 12)
  eq("lap ends in an empty-before pit", b[last], 1)
end

-- 7. House rule: a relay that would cycle forever stops when a position repeats, with no capture
do
  local b, s = board({ 11, 1, 0, 2, 1, 0, 1, 1, 1, 2, 1, 6 }), { [0] = 0, [1] = 0 }
  local r = ayo.play(b, s, 1, 7)
  eq("loop detected", r.looped, true)
  eq("loop no capture", r.captured, 0)
  local total = 0
  for i = 0, 11 do total = total + b[i] end
  eq("loop seeds conserved", total, 27)
end

-- 8. Seeds are conserved over a whole random game, and every move is legal
do
  math.randomseed(7)
  local b, s, p = ayo.new_board(), { [0] = 0, [1] = 0 }, 0
  for _ = 1, 500 do
    if ayo.is_over(b, p) then break end
    local moves = ayo.legal_moves(b, p)
    ayo.play(b, s, p, moves[math.random(#moves)])
    local total = s[0] + s[1]
    for i = 0, 11 do total = total + b[i] end
    eq("conservation", total, 48)
    p = 1 - p
  end
  ayo.finish(b, s)
  eq("final total", s[0] + s[1], 48)
end

print("ayo tests: " .. passed .. " passed")
