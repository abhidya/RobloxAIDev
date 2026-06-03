import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlayableSpaceReviewPlan } from "../src/playableSpaceReview.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const reviewScript = path.join(root, "scripts", "validate-playable-space-review.mjs");
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "playable-review-cli-"));

const plan = buildPlayableSpaceReviewPlan({ project: "prophunt" });
const goodReport = {
  project: "prophunt",
  spaces_reviewed: plan.spaces.map((space) => space.id),
  screenshots: plan.captures.map((capture) => ({
    capture_id: capture.capture_id,
    space_id: capture.space_id,
    kind: capture.kind,
    quadrant: capture.quadrant,
    ui_state: capture.ui_state,
    passed: true,
  })),
  findings: [],
  fixes: [],
  verdict: "signed_off",
};
const goodFile = path.join(tempDir, "good-review.json");
await fs.writeFile(goodFile, JSON.stringify({ report: goodReport, plan }, null, 2));

const pass = spawnSync("node", [reviewScript, "--file", goodFile, "--json"], { cwd: root, encoding: "utf8" });
assert.equal(pass.status, 0, pass.stderr || pass.stdout);
const passResult = JSON.parse(pass.stdout);
assert.equal(passResult.passed, true, "complete playable-space review passes");
assert.equal(passResult.counts.spaces_required, 4);
assert.equal(passResult.counts.screenshots, plan.captures.length);

const badReport = {
  project: "prophunt",
  spaces_reviewed: ["lobby"],
  screenshots: [
    {
      capture_id: "prophunt_lobby_overhead",
      space_id: "lobby",
      kind: "overhead",
      passed: true,
    },
  ],
  findings: [
    {
      id: "sparse-medieval",
      space_id: "medieval_market",
      severity: "blocker",
      status: "open",
      description: "Medieval Market has empty flat lanes at player height.",
      screenshot_id: "prophunt_lobby_overhead",
    },
  ],
  fixes: [],
  verdict: "signed_off",
};
const badFile = path.join(tempDir, "bad-review.json");
await fs.writeFile(badFile, JSON.stringify(badReport, null, 2));

const fail = spawnSync("node", [reviewScript, "--file", badFile], { cwd: root, encoding: "utf8" });
assert.equal(fail.status, 1, "CLI exits nonzero for incomplete visual review");
assert.ok(fail.stdout.includes("FAIL playable-space review"), "CLI prints failure report");
assert.ok(fail.stdout.includes("medieval_market"), "failure names missing room coverage");
assert.ok(fail.stdout.includes("unresolved blocker"), "failure names unresolved blocker");

await fs.rm(tempDir, { recursive: true, force: true });
console.log("PLAYABLE REVIEW CLI OK - screenshot coverage and blocker gate validated");
