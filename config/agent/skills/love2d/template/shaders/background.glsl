// Slow animated swirl background, quantised to a few bands so it reads as pixel art.
// Use: bg = love.graphics.newShader("shaders/background.glsl"); each frame bg:send("time", t);
// send colours once: bg:send("col_a", {r,g,b}); bg:send("col_b", ...); bg:send("col_c", ...)
// Draw: love.graphics.setShader(bg); love.graphics.rectangle("fill", 0, 0, VW, VH); love.graphics.setShader()
extern number time;
extern vec3 col_a;   // darkest
extern vec3 col_b;
extern vec3 col_c;   // lightest
extern vec2 size;    // virtual resolution, e.g. {480, 270}

vec4 effect(vec4 color, Image tex, vec2 uv, vec2 px)
{
    vec2 p = (px / size - 0.5) * vec2(size.x / size.y, 1.0);
    float r = length(p);
    float a = atan(p.y, p.x);
    float swirl = sin(a * 3.0 + r * 9.0 - time * 0.6) + 0.6 * sin(r * 14.0 - time * 0.9 + a);
    float v = 0.5 + 0.25 * swirl - r * 0.35;
    v = floor(clamp(v, 0.0, 0.999) * 4.0) / 3.0;          // 4 colour bands, no smooth gradients
    vec3 c = v < 0.34 ? col_a : (v < 0.67 ? mix(col_a, col_b, 0.85) : (v < 0.99 ? col_b : col_c));
    return vec4(c, 1.0) * color;
}
