// Failure-signaling tests: an API/network outage must surface as an explicit
// error (never a fake empty result), while partial failures return results
// plus failure metadata.
import assert from "node:assert";
import { searchAssets, ToolboxSearchError } from "../src/toolbox.js";

const sampleItem = {
  asset: { id: 42, name: "Test Crate", description: "A crate.", instanceCounts: { script: 0 } },
  creator: { name: "Tester", verified: true },
  voting: { voteCount: 10, upVotePercent: 90 },
};

const okResponse = (assets) => ({ ok: true, status: 200, json: async () => ({ creatorStoreAssets: assets }) });
const failResponse = { ok: false, status: 429, json: async () => ({}) };

// 1. Total outage → ToolboxSearchError, not [].
await assert.rejects(
  () => searchAssets({ query: "barrel", categories: ["Model", "Decal"], fetchImpl: async () => failResponse }),
  (error) => {
    assert.ok(error instanceof ToolboxSearchError, "throws ToolboxSearchError");
    assert.match(error.message, /all 2 fetches failed/i);
    assert.match(error.message, /NOT an empty result/i);
    assert.equal(error.failures.length, 2);
    return true;
  }
);

// 2. Network exception path (fetch throws) → also ToolboxSearchError.
await assert.rejects(
  () => searchAssets({ query: "barrel", categories: ["Model"], fetchImpl: async () => { throw new Error("ECONNRESET"); } }),
  ToolboxSearchError
);

// 3. Partial failure → results + failure metadata, no throw.
let call = 0;
const partial = await searchAssets({
  query: "barrel",
  categories: ["Model", "Decal"],
  fetchImpl: async () => (call++ === 0 ? okResponse([sampleItem]) : failResponse),
});
assert.equal(partial.assets.length, 1, "partial success returns assets");
assert.equal(partial.meta.failures.length, 1, "partial failure recorded");
assert.equal(partial.meta.attempts, 2);

// 4. Genuinely empty (API ok, zero results) → empty assets, zero failures.
const empty = await searchAssets({ query: "zzz", categories: ["Model"], fetchImpl: async () => okResponse([]) });
assert.equal(empty.assets.length, 0);
assert.equal(empty.meta.failures.length, 0, "empty result is NOT a failure");

console.log("TOOLBOX FAILURES OK (outage throws, partial warns, empty is empty)");
