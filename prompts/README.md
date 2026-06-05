# RobloxAIDev Agent Prompts

These prompts divide the Roblox AI game-dev loop into narrow lanes. The game
director owns orchestration; other prompts own one module or adapter and hand
back structured proof.

Use these prompts with the vocabulary in `CONTEXT.md`:

- asset brain
- dream queue
- asset family
- headless assembly
- fragment
- coordinator merge
- Studio gate
- batch visual gate
- proof bundle
- release palette

## Prompt Lanes

| Prompt | Owns | Must Not Own |
| --- | --- | --- |
| `roblox-game-director.md` | Full workflow, lane assignment, final integration | Blindly trust subagent proof |
| `roblox-asset-brain.md` | Asset memory, merge snapshots, claims, rejections, readiness | Studio insertion or visual signoff |
| `roblox-game-designer.md` | Asset-grounded game coverage and room/story beats | Invented placeholder worlds |
| `roblox-asset-curator.md` | Search, curation, claims, review candidates | Building files or final palettes without proof |
| `roblox-studio-inspector.md` | Serial Studio asset measurement and inspection memory | Broad discovery or final release signoff |
| `roblox-headless-fragment-builder.md` | One fragment plus manifest | Global identity or final place writes |
| `roblox-headless-merge-coordinator.md` | Manifest validation and candidate place assembly | Choosing assets or visual signoff |
| `roblox-gameplay-implementer.md` | Source-controlled Roblox gameplay logic | Imported asset authority scripts |
| `roblox-game-kit-librarian.md` | Reusable module inventory, catalog, and migration order | Blindly copying project-specific services |
| `roblox-visual-gate-runner.md` | Batch screenshot proof and visual validator reports | Asset choice or code architecture |
| `roblox-release-verifier.md` | Final evidence audit and claim wording | Waiving missing gates |

## Shared Stop Rule

No prompt may claim a game, asset family, or release is done unless the relevant
proof bundle exists and the validator/gate for that lane passes. If evidence is
missing, the prompt reports the blocker and next proof action.
