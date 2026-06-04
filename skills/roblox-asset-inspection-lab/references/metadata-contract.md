# Metadata Contract

Use this shape for asset-search MCP cache mirrors, GitHub Pages metadata shards,
inspection reports, and storyboard inputs.

## Per-Asset Current State

```json
{
  "schema": "roblox-asset-metadata/v1",
  "assetId": 123456789,
  "slot": "nursery.food.fern",
  "query": "low poly fern",
  "name": "Fern Pack",
  "creator": "CreatorName",
  "catalog": {
    "category": "Model",
    "verified": true,
    "voteCount": 42,
    "upVotePercent": 95,
    "score": 123.5,
    "hasScripts": false,
    "triangles": 1200
  },
  "inspection": {
    "source": "StudioMCP asset lab",
    "sizeStuds": { "x": 4, "y": 2, "z": 4 },
    "basePartCount": 8,
    "meshPartCount": 4,
    "scriptCount": 0,
    "localScriptCount": 0,
    "moduleScriptCount": 0,
    "soundCount": 0,
    "anchoredCapable": true,
    "primaryPart": true,
    "issues": []
  },
  "scriptAudit": {
    "verdict": "pass",
    "dangerousPatterns": [],
    "summaries": []
  },
  "visualAudit": {
    "screenshotVerdict": "pass",
    "visualRiskScore": 0,
    "visualRisks": [],
    "screenshotRefs": [
      { "id": "asset_123_front", "path": "proof/assets/123/front.png", "angle": "front" }
    ]
  },
  "storyboard": {
    "suitableRoles": ["food", "ground_cover"],
    "themeTags": ["nursery", "forest"],
    "notes": "Readable at player height."
  },
  "cacheAction": "commit",
  "updatedAt": "2026-06-04T00:00:00Z"
}
```

## Append-Only Enrichment Event

```json
{
  "schema": "roblox-asset-enrichment-event/v1",
  "assetId": 123456789,
  "event": "screenshot_review",
  "agent": "codex",
  "at": "2026-06-04T00:00:00Z",
  "patch": {
    "visualAudit.screenshotVerdict": "fix",
    "visualAudit.visualRiskScore": 4
  },
  "notes": "Good geometry, but floats above sloped terrain in nursery angle."
}
```

## Pages-Friendly Sharding

```text
asset-brain/v1/manifest.json
asset-brain/v1/assets/by-id/123/123456789.json
asset-brain/v1/enrichments/by-asset/123/123456789.ndjson
asset-brain/v1/reviews/by-asset/123/123456789.ndjson
asset-brain/v1/palettes/eggbreakers.json
asset-brain/v1/indexes/assets-lite.ndjson
asset-brain/v1/indexes/rejected-assets.ndjson
```

Shard by the first three digits or a hash prefix. Keep files small. Store
metadata, IDs, paths, URLs, and hashes only.
