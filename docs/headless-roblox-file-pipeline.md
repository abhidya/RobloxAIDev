# Headless Roblox File Pipeline Research

Checked on: 2026-06-03

## Executive Recommendation

Headless Roblox place generation is viable for our parallel-agent MCP.

Recommended stack:

1. **Lune for fast scripted file mutation POCs and coordinator glue.**
   Lune's Roblox library can deserialize/serialize `.rbxl` places and `.rbxm`
   models without Studio, and exposes Roblox-like `Instance` APIs.
2. **rbx-dom as the format/spec authority and long-term library base.**
   rbx-dom is the strongest reference for binary/XML semantics, property
   storage, referents, `PRNT`, `UniqueId`, and schema patching.
3. **Rojo build as the deterministic final assembly path when content is
   filesystem-native.**
   Use Rojo for source/project-tree assembly, not arbitrary binary surgery.
4. **Studio remains a validation/editor fallback, not the primary mutation
   engine.**
   Use Studio MCP for screenshots, player-height reviews, and high-fidelity
   visual signoff; do not serialize all asset assembly through one Studio
   instance.

## WS1 - Direct Headless File Editing

| Tool | Role | Language | Maturity | Schema/property handling | License | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| Lune `@lune/roblox` | Scripted read/mutate/write | Luau runtime on Rust | Active; installed POC used `lune 0.10.4` | Bundled reflection database; limited Roblox-like API surface; catches type/schema mismatches during serialization | MPL-2.0 | Primary POC/coordinator scripting tool |
| rbx-dom | DOM + format libraries | Rust | Mature upstream reference used by Rojo ecosystem | `rbx_binary`, `rbx_xml`, reflection database patching; documents property-array invariant | MIT | Primary library for production merge engine |
| Rojo `build` | Project tree to place/model | Rust CLI | Mature | Delegates file output to rbx-dom; excellent for deterministic filesystem assembly | MPL-2.0 | Use as final build step for source-owned trees |
| Roblox-File-Format | DOM alternative | C# | Active community implementation | Full in-memory DOM; tracks Roblox Client Tracker | MIT | Good if we adopt a C# merge service |
| rbxfile / rbxmk | DOM/CLI alternative | Go | Useful but older/mixed | Low-level codecs and Lua-scripted transforms; schema story less clear than rbx-dom | MIT | Secondary option, not first choice |
| Python rbxl/rbxm libraries | Python alternative | Python | Not ready | The notable `pyrxbm` project is explicitly incomplete | MIT | Avoid for production headless mutation |

Primary evidence:

- Lune says its Roblox library manipulates place/model files without Studio and
  has examples for `deserializePlace`, `deserializeModel`, `serializePlace`,
  and `serializeModel`: <https://lune-org.github.io/docs/roblox/1-introduction/>
  and <https://lune-org.github.io/docs/api-reference/roblox/>.
- rbx-dom documents the binary model format and explicitly states `.rbxl`,
  `.rbxm`, and many asset-storage objects use that binary format:
  <https://dom.rojo.space/binary.html>.
- rbx-dom documents how new Roblox properties are handled with a patching
  database and default values so binary property arrays stay valid:
  <https://dom.rojo.space/patching-database.html>.
- Roblox Creator Hub documents `.rbxl`/`.rbxlx` place files:
  <https://create.roblox.com/docs/projects/place-files>.

## Working POC

The repo now contains:

- `scripts/headless_place_insert_poc.luau`
- `scripts/headless_place_verify_poc.luau`

Scratch binary outputs are intentionally ignored under `work/headless-poc/`.

Run:

```bash
mkdir -p work/headless-poc
cp -p Place1.rbxl work/headless-poc/Place1.headless-working.rbxl
lune run scripts/headless_place_insert_poc.luau
lune run scripts/headless_place_verify_poc.luau work/headless-poc/Place1.headless-mutated.rbxl
```

Observed output:

```text
HEADLESS_POC_OK input=work/headless-poc/Place1.headless-working.rbxl model=work/headless-poc/generated-headless-marker.rbxm output=work/headless-poc/Place1.headless-mutated.rbxl insertedRoots=1 workspaceChildren=8
HEADLESS_VERIFY_OK place=work/headless-poc/Place1.headless-mutated.rbxl markerChildren=4 scriptSourceBytes=76
```

What this proves:

- A copied `.rbxl` can be loaded headlessly.
- A model subtree can be generated and serialized as `.rbxm`.
- The `.rbxm` can be deserialized and inserted into `Workspace`.
- A new `.rbxl` can be written without Studio.
- Script `Source` survives as plaintext source through the round trip.

POC caveat:

- A first run failed when setting legacy `TextLabel.Font`; Lune/DOM expected
  modern `FontFace`. This is useful: headless validation must always include a
  reload/serialize check because schema drift surfaces as serializer errors.

## WS2 - Referent-Safe Parallel Merge Spec

The core design is: **agents do not own global identity; the coordinator does**.

rbx-dom's binary spec shows why this matters:

- Files are chunked into `META`, `SSTR`, `INST`, `PROP`, `PRNT`, and `END`.
- Instance IDs are file-local referents.
- `PRNT` is the hierarchy source of truth.
- `Referent` arrays are accumulative on disk.
- `UniqueId` has binary/XML-specific representation.

Source: <https://dom.rojo.space/binary.html>.

### Agent Fragment Contract

Each parallel agent emits:

- One `.rbxm` fragment with exactly one logical root.
- A manifest sidecar, or equivalent `META`, with:
  - `fragment_id`
  - `target_parent`
  - `order_key`
  - `source_digest`
  - `identity_policy`
  - `external_anchors`
  - `asset_rewrite_policy`
- A self-contained tree: all object-reference properties resolve inside the
  fragment unless explicitly declared as an external anchor.
- No reliance on raw referent values outside the fragment.
- No unapproved remote loaders in scripts: reject `require(assetId)`,
  `loadstring`, `InsertService:LoadAsset`, and linked-source patterns unless the
  asset is explicitly approved.
- `UniqueId`/`HistoryId` stripped by default for `.rbxm` model fragments.
- Asset dependencies kept as URI/ID values, not inlined.

### Coordinator Merge Algorithm

1. Parse every fragment with Lune or rbx-dom.
2. Validate single-root tree shape, acyclic parents, schema support, and
   referent closure.
3. Sort fragments by `(target_parent, order_key, fragment_id)`.
4. Allocate coordinator-global referents in deterministic preorder.
5. Rewrite every object reference through the local-to-global map:
   - `PRNT`
   - `Ref`/`Referent` values
   - object-reference `Content` values
   - `ObjectValue.Value` and similar instance-reference properties
6. Attach the root to the declared destination parent.
7. Preserve external asset URI strings verbatim unless an explicit rewrite map
   says otherwise.
8. Generate deterministic `UniqueId`/`HistoryId` only for final place/package
   outputs that require them. Never let insertion-time collision handling decide.
9. Serialize with deterministic sibling ordering.
10. Validate by deserialize -> serialize -> deserialize, plus semantic checks.

### Collision Rules

Hard-fail on:

- Duplicate local referents in a fragment.
- Unresolved object references.
- Cross-fragment references without an explicit external anchor.
- Parent cycles.
- Two fragments claiming the same destination/order without a policy.
- SharedString label collision with different bytes.
- Unsupported class/property schema.
- Non-deterministic reserialization after a no-op validation pass.

### Why Not Merge Raw Files?

Raw `.rbxm` fragments are independent local universes. The file format has no
global referent namespace, and current DOM insertion behavior can regenerate
colliding `UniqueId` values. That means naive append/concat or trust-the-library
insertion produces nondeterminism and possible broken internal references.

Relevant upstream issues/design evidence:

- rbx-dom clone/reference rewrite semantics:
  <https://github.com/rojo-rbx/rbx-dom/issues/282>
- rbx-dom `UniqueId` model-file concern:
  <https://github.com/rojo-rbx/rbx-dom/issues/284>
- Lune model export `UniqueId` collision/diff issue:
  <https://github.com/lune-org/lune/issues/61>

## WS3 - Creator Store Search, Download, Merge Pipeline

Use official Open Cloud surfaces where possible.

### Search

Preferred endpoint:

```text
POST https://apis.roblox.com/toolbox-service/v2/assets:search
```

Official OpenAPI operation: `Toolbox_SearchCreatorStoreAssets`.

Auth:

- anonymous access is listed in the OpenAPI security alternatives,
- legacy cookie is listed,
- API key is listed,
- OAuth 2.0 with `creator-store-product:read` is listed.

Rate limit from official OpenAPI: `1000/min` per API-key owner or OAuth
authorization.

Use filters for:

- query text or image search,
- `userId` / `groupId`,
- page token / page number,
- max page size,
- sort direction/category,
- price in cents,
- tags/facets/category path,
- verified creators,
- audio/model-specific filters.

Source docs:

- Creator Store query guide:
  <https://create.roblox.com/docs/projects/assets/api>
- OpenAPI reference:
  <https://github.com/Roblox/creator-docs/blob/main/content/en-us/reference/cloud/openapi.json>

### Asset Details

```text
GET https://apis.roblox.com/toolbox-service/v2/assets/{id}
```

Official operation: `Toolbox_GetAssetDetails`.

Same auth family and same `1000/min` search/details rate limit.

### Download Asset Bytes

```text
GET https://apis.roblox.com/asset-delivery-api/v1/assetId/{assetId}
GET https://apis.roblox.com/asset-delivery-api/v1/assetId/{assetId}/version/{versionNumber}
```

Official OpenAPI summary: retrieves an asset by ID/version with Open Cloud auth.

Auth:

- API key,
- OAuth 2.0.

Rate limit: `1000/min` per API-key owner or OAuth authorization.

Practical interpretation:

- For model assets, persist the returned bytes and attempt DOM deserialization
  as `.rbxm`/`.rbxmx` based on content/format.
- Meshes, textures, images, audio, and other dependencies usually remain as
  `rbxassetid://...`/content IDs in properties.
- Do not inline dependencies unless we own a separate dependency expansion
  contract.

### Merge Pipeline

1. Storyboard agents request asset coverage slots.
2. Search agents call Creator Store search and record candidate metadata.
3. Acquisition agent downloads selected asset bytes.
4. Inspection agent deserializes, checks scripts, dependencies, size,
   orientation, and unsafe code.
5. Build agents emit sanitized `.rbxm` fragments plus manifests.
6. Coordinator performs referent-safe merge.
7. Rojo/Lune writes a candidate `.rbxl`/`.rbxlx`.
8. Headless validation runs.
9. Studio visual gate only reviews candidate builds that pass headless checks.

## WS4 - Current Pricing, Licensing, Terms

This section is date-sensitive and was checked on 2026-06-03.

Keep these separate:

- **Creator Store/dev assets:** assets used in Studio/development.
- **Marketplace/UGC avatar items:** avatar commerce and user-facing items.

### Creator Store

Current official docs say:

- Creator Store assets include models, decals, audio, videos, meshes, and
  plugins for use on Roblox services.
- Paid Creator Store transactions use fiat/Stripe.
- Purchasing a Creator Store asset grants a license to use it in Roblox Studio
  and experiences on the Roblox services.
- Purchases are final, non-refundable, and non-transferable unless Roblox
  policy/law says otherwise.
- Selling priced Creator Store assets requires government ID verification and a
  seller account.
- Public docs clearly document USD pricing for **models and plugins**.

Pricing:

- Plugins: minimum `$4.99`, maximum `$249.99`.
- Models: minimum `$2.99`, maximum `$249.99` in the current Creator Docs page
  checked. Older/secondary summaries may mention a lower model maximum; use the
  current Creator Docs page as the source of truth.
- Creator Store prices are USD, not Robux.

Sources:

- Creator Store Terms:
  <https://en.help.roblox.com/hc/en-us/articles/21308223046932-Creator-Store-Terms>
- Sell on Creator Store:
  <https://create.roblox.com/docs/production/sell-on-creator-store>
- Account verification:
  <https://create.roblox.com/docs/production/publishing/account-verification>

### Audio

Official docs say:

- Creator Store has free-to-use audio.
- Custom audio imports require legal rights and moderation.
- Audio import limits: ID-verified users can import `2,000` free audio assets
  per 30 days; unverified users can import `100` per 30 days.
- The public docs found did not disclose a current exact audio publish price.

Source: <https://create.roblox.com/docs/audio/assets>.

### Marketplace / UGC Avatar Items

Official docs separate Marketplace/avatar items from Creator Store/dev assets.
Marketplace is Robux-based. The research lane found current public docs for
Robux upload fees, publishing advances, commissions, Limited rules, and
anti-automation limits, but no broad Creator Store-style buyer license for
reusing avatar items as game-development assets.

Design rule for our MCP:

- Do not treat Marketplace/avatar items as Creator Store development assets.
- Do not import paid avatar items into generated game environments unless a
  separate, explicit license/permission path exists.

### Automation / Bulk Use Policy Risks

Roblox's Open Cloud docs publish endpoint-level rate limits and require handling
`429` with backoff. Creator Store asset-safety docs restrict obfuscated code and
remote-loading patterns for public assets.

MCP policy:

- Cache searches and downloads.
- Respect official rate limits and `Retry-After`.
- Avoid scraping web/session endpoints when an Open Cloud API exists.
- Inspect every downloaded model for scripts and remote loaders before merge.
- Record asset IDs, source URLs, creator IDs, license state, acquisition time,
  and whether an asset is free/paid/restricted.

## WS5 - Headless Validate And Publish

### Headless Validate

Minimum validation before Studio:

```bash
lune run scripts/headless_place_verify_poc.luau work/headless-poc/Place1.headless-mutated.rbxl
rojo build default.project.json -o /tmp/RobloxAIDevPropHunt.rbxlx
```

Recommended production validation:

- Deserialize every candidate `.rbxm`/`.rbxl`.
- Validate tree shape and referent closure.
- Validate no unsupported classes/properties were dropped.
- Validate script source round-trips.
- Validate disallowed script patterns are absent.
- Validate external asset URI schemes and permissions.
- Serialize a candidate file, reload it, and compare semantic invariants.
- Optionally serialize XML `.rbxlx` for diff/debug, then binary `.rbxl` for
  publish.
- Use Open Cloud Luau execution / Places APIs for remote place-version checks
  once credentials/scopes exist.

### Publish Without Studio

Official place publish endpoint:

```text
POST https://apis.roblox.com/universes/v1/{universeId}/places/{placeId}/versions?versionType=Published
```

Auth:

- API key.
- Required access permission: `universe-places` with Write on the target
  experience.

Content types:

- `.rbxlx`: `application/xml`
- `.rbxl`: `application/octet-stream`

Rate limit from official OpenAPI: `30/min` per API-key owner.

Limitations:

- Roblox says the place publishing API does not update some instance types,
  including `EditableImage`, `EditableMesh`, `PartOperation`,
  `SurfaceAppearance`, and `BaseWrap`; those changes may need Studio.

Source: <https://create.roblox.com/docs/cloud/guides/usage-place-publishing>.

### Asset Upload Without Studio

Official asset create/update endpoints:

```text
POST https://apis.roblox.com/assets/v1/assets
PATCH https://apis.roblox.com/assets/v1/assets/{assetId}
GET https://apis.roblox.com/assets/v1/operations/{operationId}
```

Auth:

- API key or OAuth 2.0.
- Scopes: `asset:read` and/or `asset:write`.

Rate limits from official OpenAPI:

- create/update: `120/min`,
- operation polling: `300/min`.

Important model caveat:

- Roblox's Assets API supports `.rbxm`/`.rbxmx` model uploads, but its usage
  guide warns files edited outside Studio might not upload or function.

Source: <https://create.roblox.com/docs/cloud/guides/usage-assets>.

## Implementation Plan For The MCP

Phase 1:

- Keep Lune POC scripts as acceptance tests.
- Add a fragment manifest schema.
- Add a download cache keyed by asset ID/version/digest.
- Add a no-Studio asset inspection pass.

Phase 2:

- Implement coordinator merge in Rust on rbx-dom, or in Lune if speed matters
  more than deepest control.
- Add deterministic ID/referent rewriting tests.
- Add script/source/asset URI policy checks.

Phase 3:

- Add Open Cloud search/download/publish adapters.
- Keep credentials out of repo.
- Add rate-limit-aware queues and asset acquisition receipts.

Phase 4:

- Feed candidate places into Studio MCP only for visual/playability validation:
  player-height screenshots, quadrant signoff, multiplayer smoke tests, and UI
  inspection.

## Bottom Line

Yes: headless direct mutation is viable. The winning architecture is not "N
agents all edit one place"; it is "N agents emit isolated model fragments, then
a deterministic coordinator rewrites identities and assembles one candidate
place." Studio becomes a visual QA/runtime compatibility gate rather than the
parallelism bottleneck.
