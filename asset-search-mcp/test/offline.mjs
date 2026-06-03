// Offline tests: parsing/ranking/curation/expansion (toolbox) + the shared-brain
// dedup logic (rejections, claims, off-theme filtering). No network.
import assert from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeAsset, scoreAsset, expandQuery } from "../src/toolbox.js";
import { Store, diversify, filterByTerms } from "../src/store.js";

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

// persistence: a fresh Store sees the same state
const store2 = new Store();
await store2.ready();
assert.ok(store2.isRejected(111) && store2.isClaimed(333) === "barrel", "state persisted across instances");

await fs.rm(dir, { recursive: true, force: true });
console.log("OFFLINE OK — parsing, ranking, curation, off-theme filter, rejections, claims, persistence");
