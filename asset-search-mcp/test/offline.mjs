// Offline test: validate parsing/ranking/curation against a realistic Toolbox
// v2 payload shape — no network. This is the logic that runs against the live
// API, exercised deterministically.
import assert from "node:assert";
import { normalizeAsset, scoreAsset, expandQuery } from "../src/toolbox.js";
import { diversify } from "../src/store.js";

// A representative `creatorStoreAssets[]` entry (camelCase, as the API returns).
const sample = {
  asset: {
    id: 5585023058,
    name: "Crate with Tarp",
    description: "A nicely textured wooden crate covered with a tarp.",
    assetTypeId: 10,
    categoryPath: "Models/Environment",
    createTime: "2021-01-01T00:00:00Z",
    updateTime: "2022-01-01T00:00:00Z",
    hasScripts: false,
    instanceCounts: { meshPart: 2, animation: 0, decal: 1, audio: 0, tool: 0, script: 0 },
    objectMeshSummary: { triangles: 1200, vertices: 800 },
  },
  creator: { name: "PartyInABox2", verified: true },
  creatorStoreProduct: { purchasable: true },
  voting: { voteCount: 42, upVotePercent: 95, upVotes: 40, downVotes: 2 },
};

const a = normalizeAsset("Model", sample);
assert.equal(a.id, 5585023058, "id parsed");
assert.equal(a.name, "Crate with Tarp", "name parsed");
assert.equal(a.creator, "PartyInABox2", "creator parsed");
assert.equal(a.verified, true, "verified parsed");
assert.equal(a.purchasable, true, "purchasable parsed");
assert.equal(a.meshParts, 2, "meshParts parsed");
assert.equal(a.decals, 1, "decals parsed");
assert.equal(a.triangles, 1200, "triangles parsed");
assert.equal(a.voteCount, 42, "voteCount parsed");
assert.equal(a.hasScripts, false, "hasScripts parsed");

// Score: ln(42)*10 + 95*0.45 + 20(verified) + 5(purchasable) + 5(desc>20)
const expected = Math.log(42) * 10 + 95 * 0.45 + 20 + 5 + 5;
assert.ok(Math.abs(a.score - expected) < 1e-6, `score ${a.score} ~= ${expected}`);

// A scripted, unverified asset should score lower (script penalty, no bonuses).
const scripted = scoreAsset({
  voteCount: 0,
  upVotePercent: 0,
  verified: false,
  purchasable: false,
  description: "",
  hasScripts: true,
});
assert.ok(scripted < a.score, "scripted/unverified ranks below a clean verified asset");

// Diversity: cap picks per creator.
const ranked = [
  { id: 1, creator: "X", score: 9 },
  { id: 2, creator: "X", score: 8 },
  { id: 3, creator: "X", score: 7 },
  { id: 4, creator: "Y", score: 6 },
];
const curated = diversify(ranked, 5, 2);
assert.deepEqual(curated.map((c) => c.id), [1, 2, 4], "max 2 per creator enforced");

// Extensive expansion produces distinct variants.
const variants = expandQuery("medieval barrel");
assert.ok(variants.includes("medieval barrel"), "base query kept");
assert.ok(variants.length >= 5, "expands to several variants");
assert.equal(new Set(variants).size, variants.length, "variants are unique");

console.log("OFFLINE OK — parsing, scoring, curation, expansion all correct");
