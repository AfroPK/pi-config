---
name: node-project
description: Conventions for JavaScript/TypeScript projects on this PC - Node CLIs, servers/APIs, and front-end apps that need a build step (Vite, React). Use when creating or extending a Node or npm project.
---

# Node / JS / TS projects on this PC

## Facts (checked)
- Node 26 and npm 12 are on PATH in bash (`node`, `npm`, `npx`). TypeScript (`tsc`) and `ts-node` are installed globally.
- Ports 3000-3003, 3080, 8080, 8384, 8889, 9222 are taken. Use 5173 (Vite default) or a free port in 7000-7999; check with `netstat -ano | grep :PORT` first.

## Choose the smallest thing that works
| Need | Use |
|---|---|
| A page or UI with no build step | single `index.html` (see the web-design skill) |
| Interactive app with several views / components | Vite: `npm create vite@latest app -- --template vanilla-ts` (or `react-ts` when React is asked for or clearly helps) |
| CLI tool | plain Node ESM (`"type": "module"`), `node:util` `parseArgs`, no framework |
| HTTP API / server | `node:http` for small ones; Express or Fastify only when routing/middleware grows |
| Tests | built-in `node --test` + `node:assert/strict` (no Jest unless the project has it) |

## Conventions
- `package.json` with `scripts`: `dev`, `build`, `start`, `test` as applicable; dependencies installed locally (`npm i`), never `-g`.
- ESM everywhere; `const`/`let`; async/await with try/catch at boundaries; no unhandled promise rejections.
- TypeScript: `strict: true`; no `any` unless unavoidable; types for public functions.
- Read config from env vars with defaults; never hard-code secrets.
- Front end: follow the web-design skill for every visible element; keep components small; state in one place.

## Verify before saying done
- `npm test 2>&1 | tail -30` passes; `npm run build 2>&1 | tail -20` succeeds when there is a build.
- Servers: start in the background with `timeout`, hit it with `curl -s -m 5`, check the response, then stop the process you started.
- Vite apps: `npm run build`, then check the built page with
  `timeout 30 "/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --dump-dom "file:///<abs path>/dist/index.html"`
  (if assets 404 under file://, set `base: "./"` in vite.config).
