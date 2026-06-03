# asset-search-mcp

A standalone, **search-only** MCP for asset-driven Roblox game design — fully
decoupled from the Roblox Studio MCP. It discovers, ranks, curates, reviews, and
remembers Creator Store assets so an AI can storyboard a game grounded in assets
that actually exist, with parallel agents exploring cheaply.

Building and placing assets, and measuring their real geometry, are the official
**StudioMCP**'s job. This server never touches Studio. The
`asset-driven-game-design` skill orchestrates the two together.

## Why it exists

The official Studio MCP can *insert* a Creator Store asset but has no ranked
**discovery**. This server adds exactly that, plus the shared state parallel
agents need:

- **`search_assets`** — ranked, multi-category Toolbox v2 search with vote/creator/
  script/mesh metadata and ids. `extensive=true` expands the query into variants
  for broader exploration.
- **Cache + single-flight** — results are cached (24h) and identical concurrent
  searches collapse to one network call, so N parallel agents are cheap.
- **`curate_assets`** — a storyboard's slots → a diversity-capped shortlist per
  slot (no single creator's pack dominating).
- **`review_asset` / `get_reviews`** — persist an agent's keep/reject verdict so
  other agents reuse it instead of re-vetting.
- **`commit_palette` / `get_palette`** — freeze the chosen asset per slot for the
  build phase.

State persists as plain JSON under `~/.roblox-asset-brain/` — no native deps, no
build step.

## Install & run (on your Mac)

```bash
cd asset-search-mcp
npm install
npm test            # offline logic test + live MCP smoke test
```

Register it with Claude Code (alongside the official StudioMCP):

```bash
claude mcp add --transport stdio asset-search -- node "$(pwd)/src/index.js"
claude mcp list     # confirm asset-search + StudioMCP both connected
```

Or run it directly: `node src/index.js` (speaks MCP over stdio).

## Tools

| Tool | Purpose |
|------|---------|
| `search_assets(query, max_results?, categories?, verified_only?, extensive?)` | Ranked Creator Store search across categories. |
| `curate_assets(slots[], per_slot?, verified_only?, extensive?)` | Diverse shortlist per storyboard slot. |
| `review_asset(asset_id, verdict, slot?, rating?, notes?, reviewer?)` | Persist a shared agent verdict. |
| `get_reviews(asset_id)` | Read all verdicts for an asset. |
| `commit_palette(project, slot, asset_id, name?)` | Freeze a chosen asset per slot. |
| `get_palette(project)` | Read the committed palette for the build phase. |

## Tiers of metadata

| Tier | Source | Examples |
|------|--------|----------|
| Catalog (this server) | Toolbox v2 API | votes, creator, verified, script/mesh counts, triangles |
| Geometric (StudioMCP) | load + measure in Studio | bounding-box size, orientation, anchored?, issues |

Catalog search is cheap; narrow to a shortlist here, then measure only the
shortlist in Studio before placing.

## Config

- `ASSET_BRAIN_DIR` — override the persistence directory (default
  `~/.roblox-asset-brain`).

## Layout

```
src/index.js     MCP server + tool registrations
src/toolbox.js   Toolbox v2 search, ranking, extensive query expansion
src/store.js     JSON persistence, TTL cache, single-flight, reviews, palette
test/offline.mjs deterministic parsing/scoring/curation test (no network)
test/smoke.mjs   spins up the server as an MCP client end-to-end
```
