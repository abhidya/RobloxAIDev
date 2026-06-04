#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const mcpRoot = path.resolve(import.meta.dirname, '..');

function readText(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`missing ${path.relative(repoRoot, file)}`);
  }
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const fixturePath = path.join(mcpRoot, 'fixtures', 'place1-prop-hunt-gate.json');
const fixture = JSON.parse(readText(fixturePath));
const entries = fixture.entries ?? [];
const areaNames = new Set(entries.map((entry) => entry.slot.split('.')[0]));
const hideables = entries.filter((entry) => entry.slot.includes('.hideable.'));
const setpieces = entries.filter((entry) => entry.slot.includes('.setpiece.'));
const scriptFree = entries.filter((entry) => entry.has_scripts === false && entry.script_count === 0);

const configText = readText(path.join(repoRoot, 'src', 'shared', 'Config.luau'));
const roomIds = [...configText.matchAll(/id\s*=\s*"([^"]+)"/g)].map((match) => match[1]);
const roomNames = [...configText.matchAll(/name\s*=\s*"([^"]+)"/g)].map((match) => match[1]);

assert(areaNames.size >= 3, `expected at least 3 audited areas, found ${areaNames.size}`);
assert(hideables.length >= 20, `expected at least 20 hideable props, found ${hideables.length}`);
assert(setpieces.length >= 4, `expected at least 4 set pieces, found ${setpieces.length}`);
assert(scriptFree.length === entries.length, 'fixture contains assets with scripts');
assert(roomIds.length >= 3, `expected at least 3 configured rooms, found ${roomIds.length}`);

console.log('OFFLINE PROP HUNT DEMO OK');
console.log(`rooms=${roomNames.join(', ')}`);
console.log(`audited_areas=${[...areaNames].sort().join(', ')}`);
console.log(`assets=${entries.length} hideables=${hideables.length} setpieces=${setpieces.length}`);
console.log('demo_path=Open Place1.rbxl in Roblox Studio, or run npm run seed:prop-hunt-place1 && npm run gate:prop-hunt');
