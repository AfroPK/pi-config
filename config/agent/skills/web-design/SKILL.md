---
name: web-design
description: Rules for building good-looking HTML/CSS/JS user interfaces. Use for ANY task that produces a web page or browser UI - landing pages, dashboards, tools, forms, docs, decks, resumes, browser games' menus and HUDs - so the result looks modern and deliberate, not like default browser styling.
---

# Web design rules

Small models produce "stale" pages because they fall back to browser defaults. Every page you build follows the
rules below. They are concrete on purpose: apply them, do not reinterpret them.

## 1. Start from a design reference when the page type matches
Designed templates live in `__PI_HOME__/html-anything/next/src/lib/templates/skills/<id>/` (each has `SKILL.md`
= the design spec, `example.html` = the reference). Read the spec, skim the example's `<style>`, then build.

| Asked for | Template id |
|---|---|
| Landing / product / SaaS page | `saas-landing` |
| Pricing | `pricing-page` |
| Dashboard / admin / stats | `dashboard` |
| Docs / help page | `docs-page` |
| Blog post / article | `blog-post` |
| Resume / CV | `resume-modern` |
| Slide deck | `deck-swiss-international` |
| Mobile app screen | `mobile-app` |

For anything else (`ls` that folder for 80 more), or no match, use the defaults in section 2.

## 2. Design tokens: always define these in `:root` first
```css
:root {
  --font-sans: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, Consolas, monospace;
  --bg: #0b0d12; --surface: #141821; --surface-2: #1c2230; --border: #2a3142;
  --text: #e8ebf2; --muted: #9aa3b5; --accent: #7c5cff; --accent-2: #22d3ee;
  --ok: #22c55e; --warn: #f59e0b; --err: #ef4444;
  --radius: 12px; --radius-sm: 8px;
  --shadow: 0 1px 2px rgb(0 0 0 / .3), 0 8px 24px rgb(0 0 0 / .25);
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px; --s8: 72px;
}
@media (prefers-color-scheme: light) {
  :root { --bg: #f7f8fb; --surface: #ffffff; --surface-2: #f0f2f7; --border: #e2e6ef; --text: #12151c; --muted: #5b6475; }
}
```
Pick ONE accent colour that fits the subject (the example's violet is only a default). Use colour only through these
variables; no other hex codes in the rest of the CSS.

## 3. Layout and type
- `*, *::before, *::after { box-sizing: border-box }`, `body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 var(--font-sans); -webkit-font-smoothing: antialiased }`.
- Content width: `max-width: 1100px; margin-inline: auto; padding-inline: var(--s5)`. Text columns max `68ch`.
- Type scale with `clamp()`: h1 `clamp(2.2rem, 5vw, 3.6rem)` weight 700, letter-spacing `-0.02em`, line-height 1.1; h2 `clamp(1.5rem, 3vw, 2.2rem)`; small/meta text `0.875rem` in `--muted`.
- Layout with CSS grid / flex and `gap`, never tables or `<br>` for layout. Cards: `background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--s5); box-shadow: var(--shadow)`.
- Generous whitespace: sections `padding-block: var(--s8)`; never cram elements edge to edge.
- Responsive: test the widths 375px and 1280px; grids use `repeat(auto-fit, minmax(min(240px, 100%), 1fr))`, and single/stacked columns use `minmax(0, 1fr)`, never bare `1fr` (a `1fr` column can't shrink below its content and pushes the page wider than a phone). Never hide overflow with `overflow-x: hidden` on html/body; fix the element.

## 4. Components look finished
- Buttons: padding `var(--s3) var(--s5)`, `border-radius: var(--radius-sm)`, accent background, `font-weight: 600`, `transition: transform .15s, background .15s`, `:hover` (slightly lighter / `translateY(-1px)`), `:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px }`, `:disabled` dimmed.
- Inputs: full width, `background: var(--surface-2)`, 1px border, radius, focus ring like buttons. Every input has a `<label>`.
- Links: accent colour, no default underline-blue; underline on hover only.
- Tables (only for real data): sticky header, zebra rows via `--surface-2`, right-aligned numbers with `font-variant-numeric: tabular-nums`.
- Icons: inline SVG (simple strokes, `currentColor`), never emoji as UI icons, never external icon fonts.
- Empty, loading and error states are designed too (muted text + icon), not blank.

## 5. Never ship these (the "stale" look)
Times New Roman / default serif · default blue underlined links · grey `<button>` with system styling · `<hr>` as
decoration · centred walls of text · pure `#000` on `#fff` · `<center>`, `<font>`, inline `style=` on many elements ·
lorem ipsum · broken image links (use CSS gradients or inline SVG instead of images you don't have) · external CDN
dependencies for basics (fonts: fall back to the system stack if offline).

## 6. Structure and code
- One self-contained `index.html` (inline `<style>` and `<script>`) unless the task asks for a project; for a project: `index.html`, `styles.css`, `app.js`.
- Semantic HTML: `header`, `nav`, `main`, `section`, `footer`, one `h1`, headings in order, `alt` on images, `lang` on `<html>`, `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- JS: no frameworks unless asked; `const`/`let`, `addEventListener`, no inline `onclick`. Keep state in one object; render from it.
- Motion: subtle only (`transition` 150-250 ms, `@media (prefers-reduced-motion: reduce)` turns it off).

## 7. Check before you say done
1. Re-read your CSS against sections 2-5; fix any default-looking element.
2. Validate the file loads and scripts run without errors:
   `timeout 30 "/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --dump-dom "file:///C:/path/to/index.html" | head -40`
   (JS-rendered content must appear in the dumped DOM; an empty `<body>` means the script failed.)
3. `grep -nE "lorem|TODO|#000[^0-9a-f]|font-family: *serif|<center>|<font" index.html` must find nothing.
4. If the `look` tool is available, call it with `page=` the file and ask: "Is anything overlapping, cut off, unstyled, misaligned or unreadable?" Fix every problem in its **Measured** section (overflow, console errors). Treat the vision answers as hints: confirm them in the code.
5. In your final message, list the template or defaults you used and the accent colour.
