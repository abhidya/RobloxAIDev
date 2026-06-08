// DAL/DAO regression tests: SQLite-backed brain, cross-connection claim race
// safety, legacy JSON migration, stale-claim release, and cache pruning.
import assert from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-dal-"));
process.env.ASSET_BRAIN_DIR = dir;

// Seed legacy JSON files BEFORE first open to prove one-time migration.
await fs.writeFile(path.join(dir, "reviews.json"), JSON.stringify({
  111: [{ verdict: "reject", notes: "oversized", createdAt: 1000 }],
  222: [{ verdict: "keep", notes: "great barrel", createdAt: 2000 }],
}));
await fs.writeFile(path.join(dir, "claims.json"), JSON.stringify({
  333: { slot: "lobby.prop", reviewer: "agentA", project: "prophunt", at: Date.now() },
}));
await fs.writeFile(path.join(dir, "palette.json"), JSON.stringify({
  prophunt: { "lobby.prop": { assetId: 333, name: "Crate" } },
}));

const { Store, SEARCH_TTL_MS } = await import("../src/store.js");

// --- legacy migration ---
const store = new Store();
await store.ready();
assert.equal(store.isRejected(111), true, "legacy rejection migrated");
assert.equal(store.getReviews(222)[0].notes, "great barrel", "legacy review migrated");
assert.equal(store.isClaimed(333), "lobby.prop", "legacy claim migrated");
assert.equal(store.getPalette("prophunt")["lobby.prop"].assetId, 333, "legacy palette migrated");

// Re-open: migration must NOT duplicate (reviews are append-only).
const store2 = new Store();
await store2.ready();
assert.equal(store2.getReviews(111).length, 1, "no duplicate import on reopen");

// --- cross-connection claim race safety ---
// Two independent connections (simulating two agent MCP processes) try to
// claim the same asset for different slots; exactly one slot must own it.
const [resA, resB] = await Promise.all([
  store.claimAssets("prophunt", "roomA.prop", [9001], "agentA"),
  store2.claimAssets("prophunt", "roomB.prop", [9001], "agentB"),
]);
const wins = [resA, resB].filter((r) => r.claimed.includes(9001)).length;
const skips = [resA, resB].filter((r) => r.skipped.some((s) => s.id === 9001)).length;
assert.equal(wins, 1, `exactly one connection wins the claim (got ${wins})`);
assert.equal(skips, 1, "the loser is told who owns it");
assert.ok(store.isClaimed(9001), "claim visible to connection A");
assert.ok(store2.isClaimed(9001), "claim visible to connection B");

// Same-slot re-claim stays idempotent.
const winnerSlot = store.isClaimed(9001);
const winner = resA.claimed.includes(9001) ? store : store2;
const again = await winner.claimAssets("prophunt", winnerSlot, [9001], "again");
assert.ok(again.claimed.includes(9001), "same-slot re-claim allowed");

// --- release + stale release ---
assert.equal(await store.releaseClaim(9001), true, "release returns true");
assert.equal(store2.isClaimed(9001), null, "release visible cross-connection");
await store.claimAssets("prophunt", "old.slot", [9100], "ghost");
store.dal.db.prepare("UPDATE claims SET at = ? WHERE asset_id = ?").run(Date.now() - 30 * 24 * 36e5, 9100);
const released = await store.releaseStaleClaims(7 * 24 * 36e5);
assert.ok(released.some((c) => c.assetId === 9100), "stale claim released");
assert.equal(store.isClaimed(333), "lobby.prop", "fresh-enough claims survive");

// --- search cache TTL + prune ---
await store.putCachedSearch("q=test", [{ id: 1, name: "x" }]);
assert.ok(store.getCachedSearch("q=test"), "cache hit");
store.dal.db.prepare("UPDATE search_cache SET created_at = ? WHERE key = ?").run(Date.now() - 2 * SEARCH_TTL_MS, "q=test");
assert.equal(store.getCachedSearch("q=test"), null, "expired entry misses");
const prune = await store.pruneSearchCache(SEARCH_TTL_MS);
assert.equal(prune.removed, 1, "expired entry pruned");

// --- brain status sanity ---
const status = store.brainStatus();
assert.equal(status.backend, "sqlite");
assert.ok(status.counts.reviews >= 2);

console.log("DAL OK (sqlite migration, race-safe claims, stale release, prune)");
