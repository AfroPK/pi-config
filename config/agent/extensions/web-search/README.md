# web-search (local fork)

From [amosblomqvist/pi-config](https://github.com/amosblomqvist/pi-config), with one
change: it is no longer Google-only.

## Backends

`web_search` picks a backend per call:

1. **Google Custom Search** — used when `GOOGLE_SEARCH_API_KEY` + `GOOGLE_CSE_ID` are
   set (or `auth.json` exists, see `auth.example.json`). Free tier is 100 queries/day.
2. **Firecrawl** — used otherwise. Defaults to `http://192.168.0.117:3002`; override
   with `PI_FIRECRAWL_URL` or `FIRECRAWL_API_URL`.

Google wins when configured, so adding keys later needs no code change.

## Tool args

| Arg | Notes |
|---|---|
| `query` | Base search string |
| `exactPhrases` | Each becomes a quoted phrase in the final query |
| `excludeTerms` | Prefixed with `-`; multi-word terms get quoted |
| `site` | Domain restriction, becomes `site:example.com` |
| `count` | 1-10, default 5 |

## Differences from upstream

- Added `firecrawlSearch()` hitting `POST /v1/search` with `{query, limit}`.
- `loadCredentials()` replaced by `resolveBackend()` returning a `SearchBackend`
  union; `details.backend` reports which one ran.
