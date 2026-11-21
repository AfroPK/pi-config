---
name: roguelike-design
description: How to structure a scoring roguelike (runs, rounds with rising targets, shop, stacking modifiers, seeded RNG, balance simulation, game feel) with a tested pure-Lua scoring/modifier engine. Use when designing or building the run structure, scoring, economy, items or difficulty of a roguelike or deckbuilder-style game, e.g. the Ayo roguelike.
---

# Scoring roguelike structure

The genre pattern: short **rounds** with a **score target**; scoring comes from the core game (here: Ayo moves and
captures) multiplied through **modifiers** the player collects; between rounds a **shop** sells modifiers and
upgrades; targets rise until the run ends. Build an original game on this pattern - own names, art, items, rules
twists - never copy another game's content.

`scoring.lua` next to this file is a tested engine for the scoring part (`luajit scoring_test.lua`: 115 checks).
Copy it to `src/run/scoring.lua` and extend it with tests.

## Run structure (build in this order, one slice each)
1. **Core round:** the base game (Ayo, via the ayo-rules skill) with a score that turns game events into points.
   Win condition per round: reach `target(round)` within a limited budget (e.g. N moves). Fun without any items?
   Only then continue.
2. **Scoring breakdown:** every scoring event = `points x mult`, built step by step, and the UI replays each step
   (`ctx.steps`). Players must see why they scored.
3. **Modifiers** (data-driven, see below), max 5 slots, evaluated in slot order (left to right) - order is a
   strategic choice, so let the player reorder them.
4. **Shop between rounds:** money from the round (base + bonus for unused moves + interest capped at e.g. +5),
   3-4 offers, reroll cost rising +1 each reroll, sell for half price.
5. **Escalation:** every 3rd round is a **boss round** with one rule twist (e.g. a pit is sealed, captures halved,
   sowing direction reversed) shown before it starts.
6. **Run end and meta:** lose on a missed target; win after round 8 (endless afterwards). Save the run between
   rounds (seed, round, money, modifiers, stats). Unlock new items through achievements, not stat power.

## Modifiers as data
```lua
-- src/run/modifiers.lua - every effect is data + a small apply() using only ctx.add_points / add_mult / mul_mult
return {
  { id = "harvest", name = "...", rarity = "common", cost = 4, trigger = "capture",
    text = "+2 points per seed captured",
    apply = function(ctx, ev, state, id) ctx.add_points(ev.seeds * 2, id) end },
}
```
- Triggers are the core game's events: `capture`, `sow_end`, `relay`, `move`, `round_start`, `round_end`, or `any`.
  Emit them from one place (the round controller) with the details modifiers need (`seeds`, `pit`, `relays`, `looped`).
- Effects in three tiers: **+points** (common), **+mult** (uncommon), **x mult** (rare). Scaling modifiers keep
  per-instance `state` (e.g. "+1 mult per capture this run").
- Every modifier gets a test: event in, expected `points`, `mult`, `total` out.
- Tooltip text lives next to the effect; when you change one, change the other in the same edit.

## Randomness
- One seed per run, shown on the run screen; separate streams per system (`rng(seed + 1)` shop,
  `rng(seed + 2)` opponent, `rng(seed + 3)` events), so a shop reroll never changes the opponent's moves.
- Never `math.random` in game logic. A replayed seed with the same inputs must give the same run (test it).

## Balance by simulation, not by feel
Write `tools/sim.lua` (pure Lua, run with luajit): play thousands of rounds with a simple bot (greedy: move with the
most points now) for each round number and item set, and print the score distribution vs. `target(round)`. Aim for
a greedy bot without items to clear rounds 1-2 almost always and fail by round 4-5; items should be what carries a
run further. Re-run the sim after every scoring or item change and keep its output in `docs/balance.md`.

## Game feel (the part that makes it addictive)
- Score counts up; each modifier that fires **pops** (scale 1 -> 1.25 -> 1, outBack) in slot order with a rising
  sound pitch per step; the final total shakes the screen in proportion to its size.
- Seeds move in arcs one at a time when sown (short tween each, faster as the hand empties), captured seeds fly to
  the score.
- Hover: items and pits wobble/tilt slightly and show a tooltip; everything clickable reacts within 1 frame.
- Big moments (boss beaten, x mult) get a short slow-down or freeze-frame and a particle burst.
- All of it via tweens/timers in an animation queue; logic never waits (see love2d skill).

## For the Ayo roguelike specifically
**This is Freddy's own game, not a version of any existing game.** Its identity comes from Ayo itself - sowing,
relays, captures, the board - and from Freddy's design decisions. Don't describe it as a clone of anything, and
don't borrow other games' names, item concepts, card/hand systems, screen layouts or art style. When a design
question isn't decided yet, propose options that grow out of Ayo's mechanics and ask; don't fill gaps by copying
what a well-known game does.

**Decided (Freddy, 2026-11-02): single-player.** One human player per run; never build hot-seat or online 2-player.
**Decided: each round is the player against a computer opponent** whose strength rises over the run (random moves
early, greedy captures next, 2-3 ply look-ahead for bosses). Opponent moves come from `ayo.legal_moves` + search
with `ayo.copy`/`ayo.play`, using its own seeded RNG stream; keep the AI in its own pure-Lua module with tests
(it must only ever pick legal moves, and a stronger level must beat a weaker one over many seeded games).
Still open, decide with Freddy:
- What scores: seeds captured, relay length, captures from specific pits, emptying the opponent's row.
- Special seeds (gold, cursed, splitting) and pit upgrades as the "deck" the player builds between rounds.
