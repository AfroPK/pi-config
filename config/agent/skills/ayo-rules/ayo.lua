-- Reference implementation of Ayo (Ayoayo, Yoruba relay-sowing rules). Pure Lua: no LOVE calls, runs under LuaJIT.
-- Board: 12 pits, indices 0..11. Player 0 owns 0..5, player 1 owns 6..11. Sowing goes up the indices
-- (counter-clockwise): 0 -> 1 -> ... -> 11 -> 0. The pit opposite p is 11 - p.
-- Copy this file into the game (e.g. src/rules/ayo.lua) and build the roguelike layer on top of it; don't rewrite it.
local M = {}

M.PITS, M.SEEDS_PER_PIT = 12, 4

function M.new_board(seeds)
  local b = {}
  for i = 0, M.PITS - 1 do b[i] = seeds or M.SEEDS_PER_PIT end
  return b
end

function M.copy(b)
  local c = {}
  for i = 0, M.PITS - 1 do c[i] = b[i] end
  return c
end

function M.owner(p) return p < 6 and 0 or 1 end
function M.opposite(p) return M.PITS - 1 - p end

function M.row_total(b, player)
  local s = 0
  for i = player * 6, player * 6 + 5 do s = s + b[i] end
  return s
end

-- Sow from pit `from` with relay: drop seeds one by one counter-clockwise. The pit the MOVE started from is skipped
-- for the whole turn, relays included, so it is always empty after the move. If the last seed lands in a pit that
-- was occupied, pick that whole pit up and keep sowing from there. Stops when the last seed lands in a pit that was
-- empty. Returns the pit where the last seed landed, and true if the relay looped.
-- HOUSE RULE (no source covers it): a relay can cycle forever (found by random play, e.g. pit 7 on
-- 11,1,0,2,1,0,1,1,1,2,1,6 repeats after 3421 laps). When a lap starts from a position seen before in this turn,
-- sowing stops there: the turn ends at that pit and play() captures nothing.
local function key(b, pit)
  local t = { pit }
  for i = 0, M.PITS - 1 do t[#t + 1] = b[i] end
  return table.concat(t, ",")
end

function M.sow(b, from)
  local pit, origin, seen = from, from, {}
  while true do
    local k = key(b, pit)
    if seen[k] then return pit, true end
    seen[k] = true
    local hand = b[pit]
    b[pit] = 0
    local pos = pit
    while hand > 0 do
      pos = (pos + 1) % M.PITS
      if pos ~= origin then
        b[pos] = b[pos] + 1
        hand = hand - 1
      end
    end
    if b[pos] == 1 then return pos, false end   -- landed in an empty pit: the turn's sowing ends here
    pit = pos                                   -- landed in an occupied pit: relay
  end
end

-- A move is legal if the pit is the mover's and not empty. Feeding rule: if the opponent's row is empty, the
-- mover must pick a move that leaves at least one seed on the opponent's row, when such a move exists.
function M.legal_moves(b, player)
  local moves = {}
  for i = player * 6, player * 6 + 5 do
    if b[i] > 0 then moves[#moves + 1] = i end
  end
  local opp = 1 - player
  if M.row_total(b, opp) == 0 then
    local feeding = {}
    for _, m in ipairs(moves) do
      local c = M.copy(b)
      M.sow(c, m)
      if M.row_total(c, opp) > 0 then feeding[#feeding + 1] = m end
    end
    if #feeding > 0 then return feeding end
  end
  return moves
end

-- Plays `pit` for `player` on board b with scores s ({[0]=n, [1]=n}). Capture: if the last seed lands in an empty
-- pit on the mover's own row, the mover takes all seeds in the opposite pit (the last seed itself stays).
-- Returns { last = pit, captured = n, looped = bool } (looped: the house rule in sow() ended the relay).
function M.play(b, s, player, pit)
  assert(M.owner(pit) == player and b[pit] > 0, "illegal move " .. tostring(pit))
  local last, looped = M.sow(b, pit)
  local captured = 0
  if not looped and M.owner(last) == player then
    local o = M.opposite(last)
    captured = b[o]
    b[o] = 0
    s[player] = s[player] + captured
  end
  return { last = last, captured = captured, looped = looped }
end

-- The game ends when the player to move has no legal move. Each player then keeps the seeds on their own row.
function M.is_over(b, player_to_move) return #M.legal_moves(b, player_to_move) == 0 end

function M.finish(b, s)
  for p = 0, 1 do
    s[p] = s[p] + M.row_total(b, p)
    for i = p * 6, p * 6 + 5 do b[i] = 0 end
  end
end

return M
