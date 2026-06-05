#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = os.homedir();

const projects = [
  {
    id: "eggbreakers",
    name: "EggBreakers",
    root: path.join(home, "PycharmProjects", "eggBreakers"),
    scanRoots: [
      "src/ReplicatedStorage/Shared",
      "src/ServerScriptService/Services",
      "src/StarterPlayer/StarterPlayerScripts",
      "src/ServerScriptService/Tests",
    ],
  },
  {
    id: "groantubehero",
    name: "GroanTubeHero",
    root: path.join(home, "PycharmProjects", "GroanTubeHero"),
    scanRoots: [
      "ReplicatedStorage/Shared",
      "ServerScriptService/Services",
      "StarterPlayer/StarterPlayerScripts",
    ],
  },
  {
    id: "robloxaidev-prophunt",
    name: "RobloxAIDev Prop Hunt",
    root: repoRoot,
    scanRoots: [
      "src/shared",
      "src/server",
      "src/client",
      "asset-search-mcp/src",
      "scripts",
    ],
  },
];

const outputPath = path.join(repoRoot, "packages", "roblox-game-kit", "inventory", "source-library-inventory.json");

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir, out = []) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".omx" || entry.name === "work") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, out);
    } else if (/\.(lua|luau|mjs|js)$/i.test(entry.name)) {
      out.push(fullPath);
    }
  }
  return out;
}

function classify(projectId, relativePath) {
  const lower = relativePath.toLowerCase();
  const file = path.basename(lower);

  if (lower.includes("/test") || lower.includes("unittest") || lower.includes("testframework") || lower.includes("harness")) {
    return "test-harness";
  }
  if (file.includes("remote") || lower.includes("/remotes")) {
    return "remote-contracts";
  }
  if (file.includes("ratelimit") || file.includes("antiexploit") || file.includes("validationservice")) {
    return "remote-security";
  }
  if (file.includes("data") || file.includes("profile")) {
    return "profile-store";
  }
  if (file.includes("economy") || file.includes("store") || file.includes("upgrade") || file.includes("currency") || file.includes("wallet")) {
    return "economy-wallet";
  }
  if (
    file.includes("scoring")
    || file.includes("chart")
    || file.includes("song")
    || file.includes("rhythm")
    || file.includes("hype")
    || file.includes("buff")
    || file.includes("attack")
  ) {
    return "score-and-timing";
  }
  if (
    file.includes("room")
    || file.includes("queue")
    || file.includes("round")
    || file.includes("venue")
    || file.includes("tourbus")
    || file.includes("portal")
    || file.includes("mission")
  ) {
    return "room-session";
  }
  if (
    file.includes("world")
    || file.includes("terrain")
    || file.includes("layout")
    || file.includes("placement")
    || file.includes("map")
    || file.includes("biome")
    || file.includes("zone")
    || file.includes("polar")
    || file.includes("horde")
    || file.includes("venue")
    || file.includes("vendor")
    || file.includes("atmosphere")
    || file.includes("weather")
  ) {
    return "world-layout";
  }
  if (
    file.includes("asset")
    || file.includes("audit")
    || file.includes("manifest")
    || file.includes("import")
    || file.includes("mesh")
    || file.includes("registry")
    || file.includes("palette")
    || projectId === "robloxaidev-prophunt" && lower.includes("asset-search-mcp")
  ) {
    return "asset-audit";
  }
  if (
    file.includes("npc")
    || file.includes("species")
    || file.includes("survival")
    || file.includes("oxygen")
    || file.includes("food")
    || file.includes("water")
    || file.includes("combat")
    || file.includes("flight")
    || file.includes("swim")
    || file.includes("fish")
    || file.includes("fossil")
    || file.includes("nest")
    || file.includes("prey")
    || file.includes("character")
  ) {
    return "life-sim";
  }
  if (
    lower.includes("starterplayer")
    || file.includes("client")
    || file.includes("hud")
    || file.includes("ui")
    || file.includes("input")
    || file.includes("menu")
    || file.includes("dialogue")
    || file.includes("feedback")
  ) {
    return "client-ui";
  }
  if (
    file.includes("config")
    || file.includes("constant")
    || file.includes("types")
    || file.includes("roster")
    || file.includes("catalog")
    || file.includes("library")
    || file.includes("readme")
  ) {
    return "config-registry";
  }
  return "service-lifecycle";
}

async function summarizeFile(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  const exportedFunctions = [];
  const functionPattern = /(?:function\s+([A-Za-z0-9_:.]+)|([A-Za-z0-9_]+)\s*=\s*function)/g;
  let match;
  while ((match = functionPattern.exec(text)) !== null) {
    exportedFunctions.push(match[1] || match[2]);
  }
  return {
    bytes: Buffer.byteLength(text, "utf8"),
    lines: text.split(/\r?\n/).length,
    exportedFunctions: exportedFunctions.slice(0, 20),
    hasReturn: /\breturn\b/.test(text),
    fallbackSignals: (text.match(/fallback|workaround|temporary|TODO|HACK|pcall|warn\(/gi) || []).length,
  };
}

function countBy(records, field) {
  const counts = {};
  for (const record of records) {
    const key = record[field] || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

async function main() {
  const records = [];
  const sourceProjects = [];

  for (const project of projects) {
    const projectAvailable = await exists(project.root);
    const projectRecord = {
      id: project.id,
      name: project.name,
      rootLabel: project.root.replace(home, "~"),
      available: projectAvailable,
      scanRoots: project.scanRoots,
      files: 0,
    };
    sourceProjects.push(projectRecord);
    if (!projectAvailable) continue;

    for (const scanRoot of project.scanRoots) {
      const root = path.join(project.root, scanRoot);
      const files = await walk(root);
      for (const filePath of files.sort()) {
        const relativePath = path.relative(project.root, filePath).split(path.sep).join("/");
        const summary = await summarizeFile(filePath);
        const family = classify(project.id, relativePath);
        records.push({
          project: project.id,
          projectName: project.name,
          relativePath,
          scanRoot,
          family,
          ...summary,
        });
        projectRecord.files += 1;
      }
    }
  }

  records.sort((a, b) =>
    a.project.localeCompare(b.project)
    || a.family.localeCompare(b.family)
    || a.relativePath.localeCompare(b.relativePath)
  );

  const inventory = {
    schema: "roblox-game-kit-source-library-inventory/v1",
    purpose: "Deterministic source inventory for converting EggBreakers, GroanTubeHero, and RobloxAIDev Prop Hunt libraries into reusable Roblox GameKit modules.",
    sourceProjects,
    counts: {
      files: records.length,
      byProject: countBy(records, "project"),
      byFamily: countBy(records, "family"),
    },
    records,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`);
  console.log(`REUSABLE_LIBRARY_INVENTORY_OK files=${records.length} output=${path.relative(repoRoot, outputPath)}`);
  console.log(`families=${Object.keys(inventory.counts.byFamily).length} projects=${Object.keys(inventory.counts.byProject).length}`);
}

await main();
