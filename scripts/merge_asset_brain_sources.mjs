#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const home = os.homedir();

const sources = {
  sharedMcpBrain: path.join(home, ".roblox-asset-brain"),
  eggBreakersBrain: path.join(home, "PycharmProjects", "eggBreakers", "asset-brain", "v1"),
  groanTubeHero: path.join(home, "PycharmProjects", "GroanTubeHero"),
  robloxAIDevInstalled: repoRoot,
  robloxAIGameDevClaude: path.join(home, "Documents", "Claude", "Projects", "RobloxAIGameDev"),
  robloxAIDevPublic: path.join(home, "abhidya-public-repos", "RobloxAIDev"),
};

const outputRoot = path.join(repoRoot, "asset-brain", "v1");
const mergedDir = path.join(outputRoot, "merged");
const indexesDir = path.join(outputRoot, "indexes");

function tildePath(filePath) {
  if (!filePath) return null;
  return filePath.replace(home, "~");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function readText(filePath, fallback = "") {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

async function readNdjson(filePath) {
  const text = await readText(filePath);
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      out.push({ parseError: true, raw: line });
    }
  }
  return out;
}

function addToSet(record, field, values) {
  const list = Array.isArray(values) ? values : [values];
  const set = new Set(record[field] || []);
  for (const value of list) {
    if (value != null && value !== "") set.add(value);
  }
  record[field] = [...set].sort();
}

function mergeRecord(records, input) {
  const assetId = Number(input.assetId ?? input.asset_id);
  if (!Number.isFinite(assetId)) return null;
  const project = input.project || "unknown";
  const slot = input.slot || null;
  const key = `${project}|${assetId}|${slot || ""}`;
  const record = records.get(key) || {
    project,
    assetId,
    name: input.name || null,
    slot,
    family: input.family || null,
    query: input.query || null,
    hasScripts: input.hasScripts ?? input.has_scripts ?? null,
    visualVerdict: input.visualVerdict || input.visual || input.screenshot_verdict || null,
    sizeStuds: null,
    statuses: [],
    sourceLayers: [],
    sourceAreas: [],
    evidence: [],
    risks: [],
    nextActions: [],
    blockers: [],
  };

  record.name = record.name || input.name || null;
  record.family = record.family || input.family || null;
  record.query = record.query || input.query || null;
  record.hasScripts = record.hasScripts ?? input.hasScripts ?? input.has_scripts ?? null;
  record.visualVerdict = record.visualVerdict || input.visualVerdict || input.visual || input.screenshot_verdict || null;
  record.sizeStuds = record.sizeStuds || input.sizeStuds || input.size_studs || null;

  addToSet(record, "statuses", input.status || input.statuses || "observed");
  addToSet(record, "sourceLayers", input.sourceLayers || input.source_layers || []);
  addToSet(record, "sourceAreas", input.sourceArea || input.sourceAreas || []);
  addToSet(record, "evidence", input.evidence || []);
  addToSet(record, "risks", input.risk || input.risks || []);
  addToSet(record, "nextActions", input.nextAction || input.nextActions || []);
  addToSet(record, "blockers", input.blockedBy || input.blockers || []);

  records.set(key, record);
  return record;
}

function countBy(records, field) {
  const counts = {};
  for (const record of records) {
    const values = Array.isArray(record[field]) ? record[field] : [record[field]];
    for (const value of values) {
      if (!value) continue;
      counts[value] = (counts[value] || 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

async function collectSharedMcpBrain(records, sourceSummaries) {
  const root = sources.sharedMcpBrain;
  const claims = await readJson(path.join(root, "claims.json"), {});
  const inspections = await readJson(path.join(root, "inspections.json"), {});
  const palette = await readJson(path.join(root, "palette.json"), {});
  const reviews = await readJson(path.join(root, "reviews.json"), {});
  const permissions = await readJson(path.join(root, "publish-permissions.json"), {});

  sourceSummaries.push({
    id: "shared_mcp_brain",
    path: tildePath(root),
    role: "Live local asset-search MCP memory shared across projects.",
    available: await exists(root),
    counts: {
      claims: Object.keys(claims).length,
      inspections: Object.keys(inspections).length,
      paletteProjects: Object.keys(palette).length,
      reviews: Object.values(reviews).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0),
      publishPermissions: Object.keys(permissions).length,
    },
  });

  for (const [project, slots] of Object.entries(palette || {})) {
    for (const [slot, entry] of Object.entries(slots || {})) {
      mergeRecord(records, {
        project,
        assetId: entry.assetId,
        name: entry.name,
        slot,
        status: "committed_palette",
        sourceArea: "shared_mcp_brain",
        evidence: "palette.json",
      });
    }
  }

  for (const [assetId, inspection] of Object.entries(inspections || {})) {
    mergeRecord(records, {
      project: claims[assetId]?.project || "shared",
      assetId,
      slot: inspection.slot || claims[assetId]?.slot || null,
      status: "studio_inspection",
      sourceArea: "shared_mcp_brain",
      evidence: inspection.source || "inspections.json",
      risks: inspection.issues || inspection.visualRisks || inspection.visual_risks || [],
      sizeStuds: inspection.size_studs,
      hasScripts: inspection.has_scripts,
      visualVerdict: inspection.screenshot_verdict,
    });
  }

  for (const [assetId, claim] of Object.entries(claims || {})) {
    mergeRecord(records, {
      project: claim.project || "shared",
      assetId,
      slot: claim.slot,
      status: "claim",
      sourceArea: "shared_mcp_brain",
      evidence: `claimed by ${claim.reviewer || "unknown"}`,
    });
  }
}

async function collectEggBreakers(records, sourceSummaries, queues) {
  const root = sources.eggBreakersBrain;
  const manifest = await readJson(path.join(root, "manifest.json"), {});
  const inventory = await readJson(path.join(root, "inventory", "eggbreakers-existing-assets.json"), {});
  const queue = await readJson(path.join(root, "queues", "eggbreakers-family-inspection-queue.json"), {});
  const dreams = await readJson(path.join(root, "dreams", "eggbreakers-asset-pump-2026-06-05.json"), {});
  const assetsLite = await readNdjson(path.join(root, "indexes", "assets-lite.ndjson"));
  const pumpReadiness = await readNdjson(path.join(root, "indexes", "pump-readiness.ndjson"));

  sourceSummaries.push({
    id: "eggbreakers_asset_brain",
    path: tildePath(root),
    role: "Egg Breakers world asset inventory, dream queue, and family inspection queue.",
    available: await exists(root),
    counts: {
      assetEntries: manifest?.counts?.assetEntries ?? assetsLite.length,
      queryRecords: manifest?.counts?.searchQueries ?? null,
      pumpReadinessRecords: pumpReadiness.length,
      queueItems: Array.isArray(queue.items) ? queue.items.length : 0,
      projectManifestCatalogedSourceIds: inventory?.counts?.projectManifestCatalogedSourceIds ?? null,
    },
    warnings: manifest?.warnings || [],
  });

  for (const asset of assetsLite) {
    mergeRecord(records, {
      ...asset,
      project: "eggbreakers",
      status: "catalog_candidate",
      sourceArea: "eggbreakers_asset_brain",
      evidence: "asset-brain/v1/indexes/assets-lite.ndjson",
    });
  }

  for (const item of queue.items || []) {
    mergeRecord(records, {
      project: "eggbreakers",
      assetId: item.candidate?.assetId,
      name: item.candidate?.name,
      slot: item.slot,
      family: item.family,
      query: item.candidate?.query,
      hasScripts: item.candidate?.hasScripts,
      status: "family_inspection_queue",
      sourceLayers: item.candidate?.sourceLayers || [],
      sourceArea: "eggbreakers_asset_brain",
      evidence: `${item.queueId}: ${item.problem}`,
      risks: item.missingEvidence || [],
      nextAction: item.nextAction,
      blockers: item.missingEvidence || [],
    });
  }

  for (const item of pumpReadiness) {
    mergeRecord(records, {
      project: "eggbreakers",
      assetId: item.assetId,
      slot: item.slot,
      family: item.family,
      status: "pump_readiness",
      sourceArea: "eggbreakers_asset_brain",
      evidence: item.queueId,
      blockers: item.blockedBy || [],
    });
  }

  for (const group of dreams.dreamGroups || []) {
    queues.push({
      project: "eggbreakers",
      id: group.id,
      priority: group.priority,
      kind: "dream_group",
      seedAssetIds: group.seedAssetIds || [],
      why: group.why,
      acceptanceChecks: group.acceptanceChecks || [],
    });
    for (const assetId of group.seedAssetIds || []) {
      mergeRecord(records, {
        project: "eggbreakers",
        assetId,
        family: group.id,
        status: "dream_seed",
        sourceArea: "eggbreakers_asset_brain",
        evidence: group.why,
        nextActions: group.acceptanceChecks || [],
      });
    }
  }
}

function parseGroanPaletteDoc(markdown, records) {
  const paletteLines = [...markdown.matchAll(/- `([^`]+)` -> `?(\d+)`?/g)];
  for (const match of paletteLines) {
    mergeRecord(records, {
      project: "groan-tube-hero",
      assetId: Number(match[2]),
      slot: match[1],
      status: "committed_palette",
      sourceArea: "groantubehero_docs",
      evidence: "docs/asset_search_mcp_headless_run_2026_06_04.md",
    });
  }
  const rejected = markdown.match(/Rejected[\s\S]*?- `?(\d+)`? because ([^\n]+)/i);
  if (rejected) {
    mergeRecord(records, {
      project: "groan-tube-hero",
      assetId: Number(rejected[1]),
      status: "rejected_visual_audit",
      sourceArea: "groantubehero_docs",
      evidence: rejected[2].trim(),
      risks: "oversized/off-theme visual audit failure",
    });
  }
}

function parseGroanAssetManifest(markdown, records) {
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/Creator Store `(\d+)`(?: from (?:prior audited import |query )?`([^`]+)`)?.*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/);
    if (!match) continue;
    const assetId = Number(match[1]);
    const query = match[2] || null;
    const cleanPath = match[3].trim();
    const usedPath = match[4].trim();
    const scripts = match[5].trim();
    const purpose = match[6].trim();
    mergeRecord(records, {
      project: "groan-tube-hero",
      assetId,
      query,
      status: usedPath.includes("hidden") || purpose.includes("rejected") ? "rejected_visual_audit" : "audited_artassets_source",
      sourceArea: "groantubehero_docs",
      evidence: `clean=${cleanPath}; used=${usedPath}; purpose=${purpose}`,
      risks: scripts === "0" ? [] : [`scripts quarantined or reviewed: ${scripts}`],
      nextAction: "Keep source-path bucket, active placement counts, and screenshot proof aligned.",
    });
  }
}

async function collectGroanTubeHero(records, sourceSummaries, queues) {
  const root = sources.groanTubeHero;
  const headlessRun = await readText(path.join(root, "docs", "asset_search_mcp_headless_run_2026_06_04.md"));
  const assetManifest = await readText(path.join(root, "docs", "asset_manifest_real.md"));
  const studioAudit = await readText(path.join(root, "docs", "studio_tree_audit.md"));
  const dreamboard = await readText(path.join(root, "docs", "themed_room_dreamboard_2026_06_04.md"));
  const fragmentDir = path.join(root, "fragments");
  let fragmentFiles = [];
  try {
    fragmentFiles = (await fs.readdir(fragmentDir)).filter((name) => name.endsWith(".manifest.json"));
  } catch {
    fragmentFiles = [];
  }

  sourceSummaries.push({
    id: "groantubehero_project",
    path: tildePath(root),
    role: "Concert-defense WorldV2 asset audit, headless run, room dreamboard, and committed-palette fragments.",
    available: await exists(root),
    counts: {
      committedPaletteLines: [...headlessRun.matchAll(/- `([^`]+)` -> `?(\d+)`?/g)].length,
      fragmentManifests: fragmentFiles.length,
      creatorStoreMentions: [...assetManifest.matchAll(/Creator Store `(\d+)`/g)].length,
    },
  });

  parseGroanPaletteDoc(headlessRun, records);
  parseGroanAssetManifest(assetManifest, records);

  for (const fileName of fragmentFiles) {
    const manifest = await readJson(path.join(fragmentDir, fileName), {});
    const assetIds = Array.isArray(manifest.asset_ids) ? manifest.asset_ids : [];
    for (const assetId of assetIds) {
      mergeRecord(records, {
        project: "groan-tube-hero",
        assetId,
        slot: manifest.fragment_id,
        status: "fragment_palette_candidate",
        sourceArea: "groantubehero_fragments",
        evidence: `${fileName}; target=${manifest.target_parent}; root=${manifest.root_name}`,
        risks: [
          manifest.safety?.publish_permission_status ? `publish_permission_status=${manifest.safety.publish_permission_status}` : null,
          manifest.safety?.asset_delivery_status ? `asset_delivery_status=${manifest.safety.asset_delivery_status}` : null,
        ].filter(Boolean),
        blockers: manifest.safety?.publish_permission_status === "missing" ? ["publish_permission_proof"] : [],
      });
    }
  }

  const roomMatches = [...dreamboard.matchAll(/^\| ([^|]+) \| ([^|]+) \| ([^|]+) \|/gm)]
    .slice(2, 14)
    .map((match) => ({
      room: match[1].trim(),
      difficulty: match[2].trim(),
      multiplayerHook: match[3].trim(),
    }));
  queues.push({
    project: "groan-tube-hero",
    id: "launch_expansion_shortlist",
    kind: "room_dreamboard",
    priority: 1,
    rooms: roomMatches,
    why: "Prior GroanTubeHero work translated room dreams into asset-search-ready multiplayer expansion lanes.",
  });

  const activePlaceMismatch = /Studio MCP continued to report only the\s+old `([^`]+)` instance/i.exec(headlessRun);
  const artGate = /activePlacedArtInstances >= 500` \| PASS \| Latest direct Studio `WorldValidation.Run\(\)` count: ([^( \n]+)/.exec(await readText(path.join(root, "docs", "worldv2_missing_assets.md")));
  return {
    activePlaceMismatch: activePlaceMismatch?.[1] || null,
    latestArtGateCount: artGate?.[1] || null,
    studioAuditMentioned: studioAudit.includes("Active Studio"),
  };
}

async function collectRepoAreas(sourceSummaries) {
  for (const [id, areaPath] of [
    ["robloxaidev_installed_repo", sources.robloxAIDevInstalled],
    ["robloxaigamedev_claude_project", sources.robloxAIGameDevClaude],
    ["robloxaidev_public_clone", sources.robloxAIDevPublic],
  ]) {
    sourceSummaries.push({
      id,
      path: tildePath(areaPath),
      role: id === "robloxaidev_installed_repo"
        ? "Canonical installed MCP and implementation target."
        : "Prior/parallel copy used for history comparison.",
      available: await exists(areaPath),
      counts: {
        hasHeadlessDoc: await exists(path.join(areaPath, "docs", "headless-roblox-file-pipeline.md")),
        hasAssetSearchMcp: await exists(path.join(areaPath, "asset-search-mcp", "src", "index.js")),
        hasPocPlace: await exists(path.join(areaPath, "Place1.rbxl")),
      },
    });
  }
}

function buildManifest(records, sourceSummaries, queues, groanFacts) {
  const assetRecords = [...records.values()].sort((a, b) => {
    if (a.project !== b.project) return a.project.localeCompare(b.project);
    if (a.assetId !== b.assetId) return a.assetId - b.assetId;
    return String(a.slot || "").localeCompare(String(b.slot || ""));
  });
  const uniqueAssetIds = new Set(assetRecords.map((record) => record.assetId));
  const visualNotReviewed = assetRecords.filter((record) => record.visualVerdict === "not_reviewed").length;
  const scriptRisk = assetRecords.filter((record) => record.hasScripts === true).length;

  return {
    schema: "robloxaidev-cross-project-asset-brain/v1",
    project: "RobloxAIDev",
    generatedAt: new Date().toISOString(),
    purpose: "Canonical merged metadata brain for asset-driven Roblox AI game development across RobloxAIDev, EggBreakers, GroanTubeHero, and the shared local MCP store.",
    policy: {
      trackedData: "metadata only: asset ids, slots, statuses, inspections, queues, risks, and learnings",
      excludedData: "no .rbxl/.rbxm binaries, screenshots, meshes, thumbnails, cookies, or Roblox auth state",
      sourceOfTruth: "RobloxAIDev owns the cross-project merge; individual projects can keep richer local proof artifacts",
      validationRule: "Search metadata and offline file validation do not sign off visible game content without player-height screenshots from the correct active Studio place.",
    },
    counts: {
      sourceAreas: sourceSummaries.filter((source) => source.available).length,
      assetRecords: assetRecords.length,
      uniqueAssetIds: uniqueAssetIds.size,
      visualNotReviewed,
      scriptRisk,
      queues: queues.length,
    },
    rollups: {
      byProject: countBy(assetRecords, "project"),
      byStatus: countBy(assetRecords, "statuses"),
      bySourceArea: countBy(assetRecords, "sourceAreas"),
    },
    sources: sourceSummaries,
    queues,
    hardLearnings: [
      {
        id: "headless_first_studio_later",
        confidence: "high",
        lesson: "Generate and merge Roblox files headlessly for speed; reserve Studio for load, runtime, screenshot, and visual/player proof.",
        evidence: [
          "RobloxAIDev docs/headless-roblox-file-pipeline.md POC",
          "GroanTubeHero headless run validated manifest merge and Rojo build before Studio",
        ],
      },
      {
        id: "studio_is_serial_and_active_place_gated",
        confidence: "high",
        lesson: "A single Studio MCP/plugin must be leader-gated; batch tools should verify the active place before running screenshots or tests.",
        evidence: [
          groanFacts.activePlaceMismatch ? `GroanTubeHero headless run saw Studio MCP report old ${groanFacts.activePlaceMismatch}` : "GroanTubeHero headless run blocked on active-place mismatch",
          "EggBreakers swarm handoff documents one shared Studio plugin/port and leader-only Studio use",
        ],
      },
      {
        id: "asset_family_not_single_clone",
        confidence: "high",
        lesson: "Orientation/scale fixes must be applied at asset-family scope and proven with clean-spot plus in-world player-height captures.",
        evidence: [
          "EggBreakers family inspection queue blocks ferns/dinos on clean-spot screenshots, propagation counts, and live player-angle proof",
        ],
      },
      {
        id: "sanitize_before_palette",
        confidence: "high",
        lesson: "Creator Store assets enter quarantine/inbox, scripts are stripped or quarantined, clean ArtAssets sources are promoted, and only those sources are cloned into active worlds.",
        evidence: [
          "GroanTubeHero asset_manifest_real.md records script quarantine and clean ReplicatedStorage.ArtAssets promotion",
        ],
      },
      {
        id: "permission_proof_remains_gap",
        confidence: "medium",
        lesson: "Committed palette fragments can be structurally valid while publish permission remains missing; release gates must keep permission proof separate from visual proof.",
        evidence: [
          "GroanTubeHero committed-palette fragment manifests mark publish_permission_status=missing",
        ],
      },
    ],
    outputs: {
      manifest: "asset-brain/v1/manifest.json",
      merged: "asset-brain/v1/merged/cross-project-asset-brain.json",
      assetsIndex: "asset-brain/v1/indexes/merged-project-assets.ndjson",
      docs: "docs/cross-project-asset-brain.md",
    },
    assetRecords,
  };
}

function toNdjson(records) {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function toMarkdown(snapshot) {
  const topStatuses = Object.entries(snapshot.rollups.byStatus).slice(0, 12)
    .map(([status, count]) => `- ${status}: ${count}`)
    .join("\n");
  const sourceLines = snapshot.sources
    .map((source) => `- ${source.id}: ${source.available ? "available" : "missing"} at \`${source.path}\` - ${source.role}`)
    .join("\n");
  const lessonLines = snapshot.hardLearnings
    .map((lesson) => `- ${lesson.id} (${lesson.confidence}): ${lesson.lesson}`)
    .join("\n");
  const queueLines = snapshot.queues
    .map((queue) => `- ${queue.project}/${queue.id}: ${queue.kind}${queue.seedAssetIds ? `, seeds=${queue.seedAssetIds.length}` : ""}${queue.rooms ? `, rooms=${queue.rooms.length}` : ""}`)
    .join("\n");

  return `# Cross-Project Asset Brain

Generated by \`scripts/merge_asset_brain_sources.mjs\`.

## Purpose

This repo is the canonical merge point for Roblox AI game-dev asset memory.
Project-specific brains can stay richer locally, but RobloxAIDev should carry
the compact cross-project metadata needed by future agents: what was searched,
what was committed, what was rejected, what still needs Studio proof, and which
workflow lessons prevent repeated churn.

## Counts

- Source areas available: ${snapshot.counts.sourceAreas}
- Asset records: ${snapshot.counts.assetRecords}
- Unique asset IDs: ${snapshot.counts.uniqueAssetIds}
- Visual-not-reviewed records: ${snapshot.counts.visualNotReviewed}
- Script-risk records: ${snapshot.counts.scriptRisk}
- Queue/dream artifacts: ${snapshot.counts.queues}

## Sources

${sourceLines}

## Status Rollup

${topStatuses}

## Hard Learnings

${lessonLines}

## Active Queues

${queueLines}

## Use

Use \`asset-brain/v1/indexes/merged-project-assets.ndjson\` for fast agent
filtering and \`asset-brain/v1/merged/cross-project-asset-brain.json\` for the
full normalized snapshot. Keep binaries, screenshots, cookies, and local Studio
state out of this tree.
`;
}

async function main() {
  const records = new Map();
  const sourceSummaries = [];
  const queues = [];

  await collectRepoAreas(sourceSummaries);
  await collectSharedMcpBrain(records, sourceSummaries);
  await collectEggBreakers(records, sourceSummaries, queues);
  const groanFacts = await collectGroanTubeHero(records, sourceSummaries, queues);

  const snapshot = buildManifest(records, sourceSummaries, queues, groanFacts);
  const assetRecords = snapshot.assetRecords;
  const manifest = { ...snapshot };
  delete manifest.assetRecords;

  await fs.mkdir(mergedDir, { recursive: true });
  await fs.mkdir(indexesDir, { recursive: true });
  await fs.mkdir(path.join(repoRoot, "docs"), { recursive: true });

  await fs.writeFile(path.join(outputRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await fs.writeFile(path.join(mergedDir, "cross-project-asset-brain.json"), JSON.stringify(snapshot, null, 2) + "\n");
  await fs.writeFile(path.join(indexesDir, "merged-project-assets.ndjson"), toNdjson(assetRecords));
  await fs.writeFile(path.join(repoRoot, "docs", "cross-project-asset-brain.md"), toMarkdown(snapshot));

  console.log(`MERGED_ASSET_BRAIN_OK records=${assetRecords.length} unique=${snapshot.counts.uniqueAssetIds} sources=${snapshot.counts.sourceAreas}`);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
