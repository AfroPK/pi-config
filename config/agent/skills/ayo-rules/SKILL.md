---
name: ayo-rules
description: The exact rules of Ayo (Ayoayo, the Yoruba mancala game from Nigeria) plus a tested pure-Lua reference implementation. Use for any task that implements, changes, tests or balances Ayo gameplay - including the Ayo roguelike - so the core game is never improvised.
---

# Ayo rules (Ayoayo, relay sowing)

The rules below are implemented in `ayo.lua` next to this file and proven by `ayo_test.lua` (63 checks, including the
worked examples from the sources). **Never re-implement Ayo from memory.** Copy `ayo.lua` into the game
(e.g. `src/rules/ayo.lua`) and `ayo_test.lua` into `tests/`, run the tests, and build everything else on top.

```
cp __PI_HOME__/.pi/agent/skills/ayo-rules/ayo.lua src/rules/ayo.lua
cp __PI_HOME__/.pi/agent/skills/ayo-rules/ayo_test.lua tests/ayo_test.lua   # fix its package.path / require line
timeout 60 luajit tests/ayo_test.lua    # must print "ayo tests: 63 passed"
```

## The rules
1. **Board:** 2 rows of 6 pits, 4 seeds in each (48 seeds). Player 0 owns pits 0-5, player 1 owns 6-11. Pit `p` faces
   pit `11 - p`.
2. **Move:** pick one of your non-empty pits, take all its seeds, and sow them one per pit **counter-clockwise**
   (index +1, 11 wraps to 0).
3. **Origin skipped:** the pit the move started from is skipped for the **whole turn** (relays included), so it is
   always empty after the move. This matters with 12+ seeds.
4. **Relay sowing:** if the last seed lands in a pit that already had seeds (either row), pick up that whole pit and
   keep sowing from it. Repeat until the last seed lands in an **empty** pit.
5. **Capture:** if that empty pit is on **your own row**, take every seed in the **opposite** pit (the last seed stays
   where it is). If it is on the opponent's row, or the opposite pit is empty, nothing is captured.
6. **Feeding:** if the opponent's row is empty, you must choose a move that puts at least one seed on their row,
   if any move does. If none does, any legal move is allowed.
7. **End:** the game ends when the player to move has no legal move (their row is empty). Each player then adds the
   seeds still on their own row to their score. Most seeds wins (25+ guarantees a win; 24-24 is a draw).
8. **House rule (endless relay):** relay sowing can cycle forever (about 1 move in 700 in random play). When a lap
   would start from a position already seen this turn, sowing stops there and the move captures nothing
   (`play()` returns `looped = true`). The sources don't cover this case.

## API (`local ayo = require("rules.ayo")`)
| Function | Does |
|---|---|
| `ayo.new_board([seeds])` | board table indexed 0..11 |
| `ayo.copy(b)` | copy (use for previews, AI search, undo) |
| `ayo.legal_moves(b, player)` | list of pits, feeding rule applied |
| `ayo.play(b, scores, player, pit)` | mutates board and `scores` (`{[0]=n,[1]=n}`); returns `{last, captured, looped}` |
| `ayo.sow(b, pit)` | sowing only (no capture); returns `last, looped` |
| `ayo.is_over(b, player_to_move)` / `ayo.finish(b, scores)` | end check / give each player their row |
| `ayo.owner(p)`, `ayo.opposite(p)`, `ayo.row_total(b, player)` | helpers |

## Building the roguelike on top
- Keep `ayo.lua` free of LOVE calls and of roguelike logic. Modifiers (relics, boosts, special seeds) live in their
  own module and hook in at clear points: before a move (change seeds or pits), after sowing (react to `last` /
  `looped`), on capture (change `captured` or score it differently). Pass the result of `play()` through them.
- For animation, don't sow twice: record each seed drop. Extend with an optional `on_drop(pit)` callback in
  `sow()` (add a test that the drop sequence matches the board change), then animate from that list.
- Any rule change or modifier that touches sowing or capture needs a new case in `ayo_test.lua` first.
- The opponent AI can search with `ayo.copy` + `ayo.play` (greedy: maximise `captured`; harder: 2-3 ply minimax).

## Variants
**Confirmed by Freddy (2026-11-02): the relay rules above are the ones the game uses.** Don't switch to another
variant unless he asks. (The endless-relay house rule in rule 8 is still a game-design choice he may revisit.)

Rules differ between regions and families. The version above follows Wikipedia's
Ayoayo page, johnpratt.com/items/mancala/ayoayo.html and raganwald.com/2019/02/03/ayoayo.html (whose worked
examples are the first tests). If Freddy plays differently (for example Oware-style captures of 2-3 seeds on the
opponent's row), change `ayo.lua` and its tests together, and record the chosen rules here.
