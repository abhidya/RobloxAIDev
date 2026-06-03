// Offline tests: parsing/ranking/curation/expansion (toolbox) + the shared-brain
// dedup logic (rejections, claims, off-theme filtering). No network.
import assert from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeAsset, scoreAsset, expandQuery } from "../src/toolbox.js";
import { Store, diversify, filterByTerms } from "../src/store.js";
import { buildGameAssetCoverage } from "../src/gameCoverage.js";
import { formatPropHuntGateReport, validatePropHuntGate } from "../src/propHuntGate.js";

// ---- toolbox parsing/ranking ----
const sample = {
  asset: { id: 5585023058, name: "Crate with Tarp", description: "A nicely textured wooden crate.", assetTypeId: 10,
    instanceCounts: { meshPart: 2, decal: 1, script: 0 }, objectMeshSummary: { triangles: 1200, vertices: 800 }, hasScripts: false },
  creator: { name: "PartyInABox2", verified: true },
  creatorStoreProduct: { purchasable: true },
  voting: { voteCount: 42, upVotePercent: 95 },
};
const a = normalizeAsset("Model", sample);
assert.equal(a.id, 5585023058); assert.equal(a.verified, true); assert.equal(a.triangles, 1200);
const expected = Math.log(42) * 10 + 95 * 0.45 + 20 + 5 + 5;
assert.ok(Math.abs(a.score - expected) < 1e-6, "score formula");

const curated = diversify([{id:1,creator:"X",score:9},{id:2,creator:"X",score:8},{id:3,creator:"X",score:7},{id:4,creator:"Y",score:6}], 5, 2);
assert.deepEqual(curated.map((c)=>c.id), [1,2,4], "max 2 per creator");
assert.ok(expandQuery("medieval barrel").length >= 5, "extensive expansion");

// ---- off-theme filtering ----
const themed = filterByTerms(
  [{name:"Medieval Barrel"},{name:"Low Poly Palm Tree"},{name:"Sci-Fi Neon Crate"},{name:"Wooden Cart"}],
  ["palm","sci-fi","neon"]
);
assert.deepEqual(themed.map((x)=>x.name), ["Medieval Barrel","Wooden Cart"], "off-theme names dropped");

// ---- skill asset coverage planner ----
const coverage = buildGameAssetCoverage({
  game: "party prop hunt",
  themes: ["underwater reef", "space station"],
  includeDefaults: false,
});
const coverageSlots = coverage.slots.map((slot) => slot.slot);
assert.ok(coverage.systems.some((system) => system.includes("Spawn")), "generic Roblox spawn system covered");
assert.ok(coverage.systems.some((system) => system.includes("capacity-limited")), "room matchmaking covered");
assert.ok(coverageSlots.includes("lobby.portal.room_queue"), "lobby portal slot covered");
assert.ok(coverageSlots.includes("underwater_reef.hideable.prop_pack"), "underwater hideable slot covered");
assert.ok(coverageSlots.includes("underwater_reef.avatar.form"), "underwater fish/morph slot covered");
assert.ok(coverageSlots.includes("space_station.room.arena_shell"), "space room slot covered");

// ---- shared-brain: rejections + claims + annotation ----
const dir = path.join(os.tmpdir(), "brain-offline-" + Date.now());
process.env.ASSET_BRAIN_DIR = dir;
const store = new Store();
await store.ready();

await store.addReview(111, { verdict: "reject", notes: "oversized" });
assert.ok(store.isRejected(111), "reject recorded");
assert.ok(store.rejectedIdSet().has(111), "rejected set includes 111");
assert.ok(!store.isRejected(222), "222 not rejected");

const r1 = await store.claimAssets("game", "barrel", [222, 333], "agentA");
assert.deepEqual(r1.claimed.sort(), [222,333], "agentA claims 222,333");
const r2 = await store.claimAssets("game", "crate", [333, 444], "agentB");
assert.deepEqual(r2.claimed, [444], "agentB only gets 444 (333 taken)");
assert.equal(r2.skipped[0].id, 333, "333 skipped as claimed");
assert.equal(store.isClaimed(333), "barrel", "333 claimed by barrel slot");
assert.ok(store.claimedIdSet().has(222) && store.claimedIdSet().has(444), "claimed set");

const ann = store.annotate(111);
assert.equal(ann.rejected, true, "annotate shows rejected");
assert.equal(store.annotate(222).claimedBy, "barrel", "annotate shows claimer");

// commit implies claim
await store.commitPalette("game", "well", 555, "Stone Well");
assert.equal(store.isClaimed(555), "well", "commit auto-claims");
assert.equal(store.getPalette("game").well.assetId, 555, "palette stored");

// Studio inspection facts persist separately from reviews and are used by gates.
await store.recordInspection(555, {
  slot: "well",
  sizeStuds: { x: 10, y: 8, z: 10 },
  hasScripts: false,
  scriptCount: 0,
  basePartCount: 4,
  anchoredCapable: true,
  primaryPart: true,
  issues: [],
  source: "offline",
});
assert.equal(store.getInspection(555).sizeStuds.x, 10, "inspection stored");
await store.recordInspection(556, {
  slot: "batch-a",
  sizeStuds: { x: 2, y: 2, z: 2 },
  hasScripts: false,
  scriptCount: 0,
  basePartCount: 1,
  anchoredCapable: true,
  primaryPart: true,
  source: "offline-batch-shape",
});
assert.equal(store.getInspection(556).primaryPart, true, "second inspection stored");

// persistence: a fresh Store sees the same state
const store2 = new Store();
await store2.ready();
assert.ok(store2.isRejected(111) && store2.isClaimed(333) === "barrel", "state persisted across instances");
assert.equal(store2.getInspection(555).basePartCount, 4, "inspection persisted");

// ---- Prop Hunt asset gate: palette + StudioMCP inspection facts ----
const areas = ["medieval_market", "sci_fi_lab", "cozy_cabin"];
let nextAsset = 1000;
for (let i = 0; i < 20; i += 1) {
  const area = areas[i % areas.length];
  const assetId = nextAsset++;
  const slot = `${area}.hideable.prop_${i + 1}`;
  await store.commitPalette("prophunt", slot, assetId, `Prop ${i + 1}`);
  await store.recordInspection(assetId, {
    slot,
    sizeStuds: { x: 2 + (i % 3), y: 3, z: 2 },
    hasScripts: false,
    scriptCount: 0,
    basePartCount: 1,
    anchoredCapable: true,
    primaryPart: true,
    issues: [],
    source: "offline",
  });
}
for (let i = 0; i < 4; i += 1) {
  const area = areas[i % areas.length];
  const assetId = nextAsset++;
  const slot = `${area}.setpiece.anchor_${i + 1}`;
  await store.commitPalette("prophunt", slot, assetId, `Set Piece ${i + 1}`);
  await store.recordInspection(assetId, {
    slot,
    sizeStuds: { x: 16, y: 10, z: 12 },
    hasScripts: false,
    scriptCount: 0,
    basePartCount: 3,
    anchoredCapable: true,
    primaryPart: true,
    issues: [],
    source: "offline",
  });
}

const gate = validatePropHuntGate({
  project: "prophunt",
  palette: store.getPalette("prophunt"),
  getInspection: (id) => store.getInspection(id),
  getReviews: (id) => store.getReviews(id),
});
assert.equal(gate.passed, true, formatPropHuntGateReport(gate));
assert.deepEqual(gate.counts, { palette_assets: 24, areas: 3, hideable_total: 20, setpiece_total: 4 }, "default Prop Hunt counts");

const badId = nextAsset++;
await store.commitPalette("bad-prophunt", "medieval_market.hideable.bad_barrel", badId, "Bad Barrel");
await store.recordInspection(badId, {
  slot: "medieval_market.hideable.bad_barrel",
  sizeStuds: { x: 12, y: 2, z: 2 },
  hasScripts: true,
  scriptCount: 1,
  basePartCount: 1,
  anchoredCapable: true,
  primaryPart: true,
});
const badGate = validatePropHuntGate({
  project: "bad-prophunt",
  palette: store.getPalette("bad-prophunt"),
  getInspection: (id) => store.getInspection(id),
  getReviews: (id) => store.getReviews(id),
  options: { min_areas: 1, min_hideable_total: 1, min_setpiece_total: 0 },
});
assert.equal(badGate.passed, false, "bad gate fails");
assert.ok(badGate.errors.some((e) => e.includes("outside 1-8 studs")), "oversized hideable rejected");
assert.ok(badGate.errors.some((e) => e.includes("has scripts")), "scripted hideable rejected");

await store.commitPalette("unclassified-prophunt", "medieval_market.ambience.song", nextAsset++, "Song");
const unclassifiedGate = validatePropHuntGate({
  project: "unclassified-prophunt",
  palette: store.getPalette("unclassified-prophunt"),
  getInspection: (id) => store.getInspection(id),
  getReviews: (id) => store.getReviews(id),
  options: { min_areas: 1, min_hideable_total: 0, min_setpiece_total: 0, require_inspections: false },
});
assert.equal(unclassifiedGate.counts.areas, 0, "unclassified slots do not satisfy area count");
assert.equal(unclassifiedGate.passed, false, "unclassified-only palette fails area gate");

await fs.rm(dir, { recursive: true, force: true });
console.log("OFFLINE OK — parsing, ranking, curation, game coverage, off-theme filter, rejections, claims, inspections, Prop Hunt gate, persistence");
