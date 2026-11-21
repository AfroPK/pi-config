-- Minimal tweens: tween.to(obj, seconds, {x = 10, scale = 1.2}, "outBack", on_done). Call tween.update(dt) once per frame.
local tween = { list = {} }

tween.ease = {
  linear = function(t) return t end,
  outQuad = function(t) return 1 - (1 - t) * (1 - t) end,
  outCubic = function(t) return 1 - (1 - t) ^ 3 end,
  inOutQuad = function(t) return t < 0.5 and 2 * t * t or 1 - (-2 * t + 2) ^ 2 / 2 end,
  outBack = function(t) local c1 = 1.70158; local c3 = c1 + 1; return 1 + c3 * (t - 1) ^ 3 + c1 * (t - 1) ^ 2 end,
  outElastic = function(t)
    if t == 0 or t == 1 then return t end
    return 2 ^ (-10 * t) * math.sin((t * 10 - 0.75) * (2 * math.pi) / 3) + 1
  end,
}

function tween.to(obj, duration, target, easing, on_done)
  local tw = { obj = obj, d = duration, t = 0, from = {}, to = target, ease = tween.ease[easing or "outQuad"], done = on_done }
  for k, v in pairs(target) do tw.from[k] = obj[k] end
  tween.list[#tween.list + 1] = tw
  return tw
end

function tween.update(dt)
  for i = #tween.list, 1, -1 do
    local tw = tween.list[i]
    tw.t = math.min(tw.d, tw.t + dt)
    local p = tw.ease(tw.d > 0 and tw.t / tw.d or 1)
    for k, v in pairs(tw.to) do tw.obj[k] = tw.from[k] + (v - tw.from[k]) * p end
    if tw.t >= tw.d then
      table.remove(tween.list, i)
      if tw.done then tw.done(tw.obj) end
    end
  end
end

function tween.clear() tween.list = {} end

return tween
