// Contract test for the repo-local Roblox AI game-dev prompt and architecture
// surface. This prevents future agents from drifting back into chat-only
// workflow memory without docs, handoff contracts, or POC evidence paths.
import assert from "node:assert";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

async function readRequired(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  const text = await fs.readFile(fullPath, "utf8");
  assert.ok(text.trim().length > 0, `${relativePath} must not be empty`);
  return text;
}

function assertIncludes(text, needle, label) {
  assert.ok(text.includes(needle), `${label} must include ${needle}`);
}

const context = await readRequired("CONTEXT.md");
for (const term of [
  "Asset brain",
  "Headless assembly",
  "Coordinator merge",
  "Studio gate",
  "Batch visual gate",
  "Proof bundle",
]) {
  assertIncludes(context, term, "CONTEXT.md");
}

const architecture = await readRequired("docs/roblox-ai-game-dev-architecture.md");
for (const section of [
  "## Executive Shape",
  "## Deep Modules",
  "## Alternatives",
  "## Architecture Decisions",
  "## POC Matrix",
  "## Next Deepening Candidates",
]) {
  assertIncludes(architecture, section, "architecture doc");
}
for (const claim of [
  "Studio remains essential, but it should be treated as the scarce validator.",
  "Rust/rbx-dom coordinator",
  "Docker-wrapped Studio",
  "Studio adapter module",
]) {
  assertIncludes(architecture, claim, "architecture doc");
}

for (const docPath of [
  "docs/batch-studio-visual-gate.md",
  "docs/cross-project-asset-brain.md",
  "docs/headless-roblox-file-pipeline.md",
  "docs/studio-mcp-troubleshooting.md",
]) {
  await readRequired(docPath);
}

const promptsReadme = await readRequired("prompts/README.md");
assertIncludes(promptsReadme, "## Prompt Lanes", "prompts README");
assertIncludes(promptsReadme, "## Shared Stop Rule", "prompts README");

const promptFiles = [
  "prompts/roblox-game-director.md",
  "prompts/roblox-asset-brain.md",
  "prompts/roblox-game-designer.md",
  "prompts/roblox-asset-curator.md",
  "prompts/roblox-studio-inspector.md",
  "prompts/roblox-headless-fragment-builder.md",
  "prompts/roblox-headless-merge-coordinator.md",
  "prompts/roblox-gameplay-implementer.md",
  "prompts/roblox-visual-gate-runner.md",
  "prompts/roblox-release-verifier.md",
];

for (const relativePath of promptFiles) {
  const text = await readRequired(relativePath);
  assertIncludes(text, "## Mission", relativePath);
  assert.ok(
    text.includes("## Handoff Contract") || text.includes("## Output Contract"),
    `${relativePath} must define a handoff or output contract`,
  );
}

console.log(`PROMPT_CONTRACTS_OK prompts=${promptFiles.length}`);
