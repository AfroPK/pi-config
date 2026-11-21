// Light CRT look for the final upscaled frame: scanlines, slight vignette, small chromatic offset.
// Use: local crt = love.graphics.newShader("shaders/crt.glsl"); crt:send("resolution", {w, h}) with the VIRTUAL size.
extern vec2 resolution;
extern number strength;   // 0 = off, 1 = full

vec4 effect(vec4 color, Image tex, vec2 uv, vec2 screen_coords)
{
    vec2 px = 1.0 / resolution;
    float r = Texel(tex, uv + vec2(px.x * 0.25 * strength, 0.0)).r;
    float g = Texel(tex, uv).g;
    float b = Texel(tex, uv - vec2(px.x * 0.25 * strength, 0.0)).b;
    vec3 c = vec3(r, g, b);
    float scan = 0.92 + 0.08 * sin(uv.y * resolution.y * 6.28318);   // one dark line per virtual pixel row
    c *= mix(1.0, scan, strength);
    vec2 d = uv - 0.5;
    c *= mix(1.0, 1.0 - dot(d, d) * 0.6, strength);                  // vignette
    return vec4(c, 1.0) * color;
}
