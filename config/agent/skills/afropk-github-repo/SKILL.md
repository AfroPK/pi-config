---
name: afropk-github-repo
description: Create a new GitHub repo, or rebrand an existing one, under AfroPK in Freddy's AfroPK v2 design - branded header banner, social preview card, README layout, description, topics. Use whenever Freddy (AfroPK / AfroPKtv) asks to make, publish, set up, polish or restyle a GitHub repo, or asks for ANY art for a repo (banner, header, social preview, logo, diagram, icon, screenshot frame). All repo art must follow the AfroPK v2 design.
---

# AfroPK GitHub repo

Every AfroPK repo looks like the GitHub profile (github.com/AfroPK): same banner style, same README voice.
**Hard rule: any art made for any repo (new or old, public or private) follows the AfroPK v2 design below.**
No other palettes, no stock gradients, no emoji logos, no AI-image styles. If a design needs something the
script can't render, build it by hand from the same tokens (HTML/SVG + the bundled fonts) and check it
against `assets/reference-header.png`.

`<skill>` below = the folder this SKILL.md is in.

## The design (AfroPK v2)

| Token | Value | Use |
|---|---|---|
| Ink | `#0B0608` | backgrounds, logo disc |
| Magenta | `#D6246E` | right slash panel, tagline chip, base line, accents |
| Hot pink | `#FF4F9A` | links / URLs on ink |
| White | `#FFFFFF` | big title, tag chip |
| Outline | magenta at 42% alpha, 1.5 px stroke | the background `AFROPK AFROPK ...` rows |

- **Display type:** Anton, UPPERCASE, skewed -10° (`transform: skewX(-10deg)`). Never upright, never another display font.
- **Tagline chip:** Barlow Condensed Bold Italic, white on a magenta block, also skewed -10°.
- **Tag chip:** JetBrains Mono ExtraBold, ink on white, written as `{ tag }` (braces = the brand).
- **Body copy on images:** Barlow Condensed Medium, `#E9DDE2`.
- **Layout:** ink field on the left with two outlined AFROPK rows (top + bottom, cut off by the edges), a thin magenta slash, then a slanted magenta panel on the right holding the **Brace Pad** logo (`assets/logo.svg`: `{ }` braces forming a controller, d-pad + 2 buttons) on an ink disc, and a thin magenta line along the bottom.
- **Tagline default:** `play games · make games` (use a repo-specific one when it reads better, lowercase, `·` separators).
- **Voice:** short, plain, first person, no hype words. No social badges/links in repo READMEs (Freddy keeps links on Linktree).

Fonts are in `<skill>/assets/fonts/` (OFL), so rendering works offline. Reference look: `assets/reference-header.png` (banner) and `assets/reference-readme.png` (a full README as GitHub renders it).

## Workflow

### 1. Settle the basics (ask only what's missing)
- **Name**: lowercase-kebab (`tunic-seamless-coop`). **Display title** for art: short, UPPERCASE (`TUNIC CO-OP`).
- **Visibility**: if Freddy didn't say, ask public or private. Never make a repo public without his word.
- **Description**: one sentence, < 160 chars, says what it does (see profile tables for tone).
- **Tag**: one or two words for the `{ }` chip: `mod`, `game`, `tool`, `local ai`, `guide`, `script`, `steam deck`, `linux`, `obs`...
- **Topics**: 3-8 lowercase GitHub topics.

### 2. Make the art
```
node <skill>/scripts/make-banner.mjs --title "TUNIC CO-OP" --tagline "2-8 players · one world" \
  --tag mod --repo AfroPK/<name> --desc "<description>" --out <repo>/.github/assets
```
  (add `--sections "about,features,setup,how it works,notes"` to match the README's sections)
- Writes `header.png` (2560x640, README top), `social-preview.png` (1280x640, GitHub's social card),
  `footer.png` (README bottom strip) and one `section-<name>.png` bar per section (numbered 01, 02...;
  file name = section name lowercased, non-alphanumerics → `-`). `--only header,social,footer,sections` limits output.
- Long titles shrink to fit automatically; still keep them short (≤ ~22 chars).
- Needs Playwright (`npm i -g playwright` + `npx playwright install chromium` if missing).
- **Look at both PNGs** (open/read the image) before using them: text inside its lane, nothing clipped, chips readable.
- Any other art the repo needs (architecture diagram, feature cards, icons) uses the same tokens: ink ground, magenta accents, Anton skewed titles, Barlow body, JetBrains Mono for code/labels.

### 3. README (always the template)
Every README uses `<skill>/templates/README.md`. Its structure, in order:
1. `header.png`, full width, centred.
2. A centred row of `for-the-badge` shields in brand colours: the `{ tag }` badge (magenta), 1-3 stack
   badges (ink), a status badge (magenta). Only tech/status badges, never social/follower badges.
   Shields escapes: `%20` space, `%23` #, `%7B` `{`, `%7D` `}`, `_` space, `--` dash.
3. Sections, each opened by its `section-<name>.png` bar inside `<p>` (not `<h2>`: that adds GitHub's grey rule),
   with the alt text `NN Name`. Default sections: About · Features · Setup · How it works · Notes. Rename,
   add or drop sections to fit the repo, then re-run the script with the matching `--sections` list so
   numbering and images line up. Never use a plain `##` heading in place of a bar.
4. About opens with ``**`{ name }`**: one line``, then 1-3 plain first-person sentences; optional `> [!NOTE]`.
5. Features as a 3-column table (icon · **feature** · one line). Setup = `**Needs:**` line, code block, numbered steps.
6. `footer.png`, full width, centred, last.

Write copy in the profile's voice: short, plain, `·` separators, no hype. Fill every `{{...}}` placeholder
or delete the line; never leave one. Rebranding an existing repo: keep all its real content and move it into
these sections; restyle, don't delete. Diagrams/screenshot frames inside the README also use the v2 tokens.

### 4. Create / update on GitHub (gh CLI, account AfroPK)
New repo, from the project folder:
```
git init -b main   # if needed
git add -A && git commit -m "Initial commit"
gh repo create AfroPK/<name> --private|--public --source . --push --description "<description>"
gh repo edit AfroPK/<name> --add-topic <t1> --add-topic <t2> ...
```
Existing repo: commit the new `.github/assets/*` + README on a branch or main (ask if unsure), push, then
`gh repo edit AfroPK/<name> --description "..." --add-topic ...`.
Check `.gitignore` before the first commit: no `.env`, keys, tokens, model files, build output.

### 5. Social preview (no API for this)
GitHub has no API to upload the social preview. Either:
- tell Freddy: repo **Settings → General → Social preview → Edit → Upload an image** → `.github/assets/social-preview.png`, or
- if you have a browser tool and Freddy is signed in to GitHub there, do it yourself (hidden file input under "Edit").

### 6. Report
Repo URL, visibility, what was created/changed, and whether the social preview is still to upload.

## Don'ts
- Don't invent another style, colour, logo or font for "this repo's vibe". Every repo uses v2.
- Don't put social badges, follow buttons or old handles (FreddyBL, freddybl) in repos. Names: GitHub `AfroPK`, everywhere else `AfroPKtv`.
- Don't push secrets; don't force-push or delete existing history without asking.
- Don't make a repo public, or flip visibility, without Freddy's explicit OK.
