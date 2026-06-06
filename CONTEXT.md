# RobloxAIDev Context

This file names the domain concepts that future architecture reviews and agent
prompts should use consistently.

## Domain Terms

- **Roblox AI game-dev loop** — the full workflow from a one-line game idea to a
  playable Roblox place: asset-brain planning, asset curation, headless file
  generation, Studio validation, repair, and release proof.
- **Asset brain** — the repo-visible and local-MCP memory of Creator Store asset
  ids, project slots, search history, claims, rejections, inspections,
  permissions, visual risks, and proof blockers.
- **Cross-project asset brain** — `asset-brain/v1`, the compact RobloxAIDev merge
  of local/shared Roblox asset memory from RobloxAIDev, EggBreakers,
  GroanTubeHero, and previous RobloxAIGameDev copies.
- **Dream queue** — an asset-search-ready list of desired game content families
  before Studio proof exists.
- **Asset family** — all live instances and clean validation clones that share a
  source asset id, staged model path, mesh id, palette slot, or import root.
- **Family inspection** — one-family-at-a-time orientation, scale, grounding,
  script, and player-height review before a family is reused broadly.
- **World asset-family sweep** — the MCP-gated family inspection pass that
  requires clean-clone before/after screenshots, live in-world player-height
  proof, propagated fixes, recorded inspection metadata, and temporary clone
  cleanup before visual signoff.
- **Asset delivery receipt** — the redacted proof that an authenticated Open
  Cloud Asset Delivery request wrote candidate bytes to quarantine with a
  sha256 digest; it records credential presence, not credential values.
- **Headless assembly** — creating or mutating `.rbxm`, `.rbxl`, or `.rbxlx`
  files outside Studio using Lune, rbx-dom, Rojo, or equivalent Roblox file
  writers.
- **Fragment** — one worker-produced Roblox model subtree plus a manifest that
  declares its target parent, identity policy, asset ids, digest, and anchors.
- **Coordinator merge** — the owner-controlled process that validates fragments,
  remaps identity/referents, assigns parents, writes the candidate place, and
  reload-validates it before Studio opens.
- **Coordinator adapter** — a replaceable merge implementation. The current
  adapter set is Lune for the proven path and an external rbx-dom command seam
  for the production Rust path.
- **Studio gate** — the small set of tasks Studio must still own: active-place
  confirmation, Creator Store insertion when direct download is unavailable,
  geometry measurement, playtesting, screenshots, and final visual signoff.
- **Batch visual gate** — a single StudioMCP job packet that performs active-place
  preflight, deterministic camera movement, serial screenshots, contact-sheet
  collation, and validation against the playable-space gate.
- **Proof bundle** — the collated output of a validation pass: manifest, image
  paths, alt text, findings, fixes, verdict, command output, and links to any
  generated reports. Proof bundles are metadata paths, not committed screenshots.
- **Release palette** — the committed set of asset slots allowed into a build,
  with inspection and publish-permission proof appropriate to the release target.
- **Reusable GameKit** — `packages/roblox-game-kit`, the source-first Roblox
  module pack distilled from EggBreakers, GroanTubeHero, and RobloxAIDev Prop
  Hunt libraries for faster future game development.
- **Project template** — a generated Roblox AI game skeleton with metadata-only
  asset brain, prompt lanes, Rojo source stubs, POC script, and validation gates
  prewired.
- **Source library inventory** — the generated metadata file that maps every
  scanned source library from the three games to a reusable GameKit module
  family before any migration rewrites begin.

## Architecture Vocabulary

- **Module** — anything with an interface and an implementation.
- **Interface** — everything a caller must know to use a module: input shape,
  invariants, ordering, errors, side effects, and proof requirements.
- **Implementation** — the code inside a module.
- **Depth** — leverage at the interface. A deep module hides a lot of behavior
  behind a small interface.
- **Seam** — where an interface lives and behavior can be altered without editing
  callers in place.
- **Adapter** — a concrete implementation at a seam, such as a StudioMCP adapter
  or a Lune file-writer adapter.
- **Leverage** — what callers gain from a deep module.
- **Locality** — what maintainers gain when behavior, tests, and bugs are
  concentrated in one module instead of scattered across agents.

## Non-Negotiables

- Studio is a validator and importer of last resort, not the default construction
  surface.
- The asset brain stores metadata only. Do not commit `.rbxl`, `.rbxm`,
  screenshots, meshes, thumbnails, cookies, API keys, or local Studio state into
  `asset-brain/v1`.
- Agents do not own global Roblox file identity. The coordinator owns referent
  remapping, `UniqueId`/`HistoryId` policy, parent assignment, and final writes.
- Search metadata is not visual proof. Visual proof requires player-height
  screenshots from the correct active Studio place.
- A family fix is incomplete until it is propagated to all live instances or
  skipped explicitly as non-visual helper geometry.
