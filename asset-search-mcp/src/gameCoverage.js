// Generic Roblox game asset coverage for the skill. This is not a builder; it
// creates searchable slots so lobby/session systems and future themed rooms are
// discovered through Creator Store assets instead of improvised from parts.

export const DEFAULT_ROOM_THEMES = [
  "underwater reef",
  "space station",
  "haunted mansion",
  "jungle temple",
];

const LOBBY_SLOTS = [
  ["lobby.spawn.plaza", "Roblox lobby spawn plaza"],
  ["lobby.portal.room_queue", "Roblox portal doorway matchmaking lobby"],
  ["lobby.npc.guide", "Roblox friendly guide NPC"],
  ["lobby.shop.upgrades", "Roblox upgrade shop kiosk"],
  ["lobby.board.leaderboard", "Roblox leaderboard board"],
  ["lobby.cosmetics.display", "Roblox avatar display stand"],
];

const SYSTEMS = [
  "Spawn at a lobby SpawnLocation before entering any round.",
  "NPCs use ProximityPrompt or ClickDetector to explain play, upgrades, and rooms.",
  "Room portals enqueue players into capacity-limited sessions instead of teleporting everyone globally.",
  "Each room has min players, max players, fill timer, team assignment, and return-to-lobby behavior.",
  "Upgrades/cosmetics are purchased or previewed in the lobby, not inside active rounds.",
  "New rooms start as asset coverage plans, then are curated, inspected, committed, built, and playtested.",
];

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "room";
}

function unique(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = String(value || "").trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(String(value).trim());
    }
  }
  return out;
}

function themeHints(theme) {
  const t = theme.toLowerCase();
  if (t.includes("underwater") || t.includes("reef") || t.includes("ocean")) {
    return {
      hideable: "coral reef seaweed shell rock prop pack",
      avatar: "fish character morph",
      setpiece: "underwater reef coral cave",
      ambience: "underwater ambient audio",
    };
  }
  if (t.includes("space") || t.includes("station") || t.includes("ship")) {
    return {
      hideable: "space station crate console vent prop pack",
      avatar: "astronaut character morph",
      setpiece: "space station reactor control room",
      ambience: "space station ambient audio",
    };
  }
  if (t.includes("haunted") || t.includes("mansion") || t.includes("ghost")) {
    return {
      hideable: "haunted mansion furniture prop pack",
      avatar: "ghost character morph",
      setpiece: "haunted mansion interior",
      ambience: "spooky ambient audio",
    };
  }
  if (t.includes("jungle") || t.includes("temple")) {
    return {
      hideable: "jungle temple ruins plant prop pack",
      avatar: "explorer character morph",
      setpiece: "jungle temple ruins",
      ambience: "jungle ambient audio",
    };
  }
  return {
    hideable: `${theme} hideable prop pack`,
    avatar: `${theme} character morph`,
    setpiece: `${theme} setpiece landmark`,
    ambience: `${theme} ambient audio`,
  };
}

function roomSlots(theme) {
  const slug = slugify(theme);
  const hints = themeHints(theme);
  return [
    [`${slug}.room.arena_shell`, `${theme} Roblox map environment room`],
    [`${slug}.portal.door`, `${theme} portal doorway Roblox`],
    [`${slug}.npc.host`, `${theme} NPC character`],
    [`${slug}.setpiece.anchor`, hints.setpiece],
    [`${slug}.hideable.prop_pack`, hints.hideable],
    [`${slug}.hideable.small_props`, `${theme} small props crate barrel rock coral furniture`],
    [`${slug}.avatar.form`, hints.avatar],
    [`${slug}.ambience.audio`, hints.ambience],
  ];
}

export function buildGameAssetCoverage({
  game = "Roblox game",
  themes = [],
  includeDefaults = true,
  includeLobby = true,
  maxThemes = 6,
} = {}) {
  const roomThemes = unique([
    ...(themes || []),
    ...(includeDefaults ? DEFAULT_ROOM_THEMES : []),
  ]).slice(0, maxThemes);

  const slots = [];
  if (includeLobby) {
    for (const [slot, query] of LOBBY_SLOTS) {
      slots.push({ group: "lobby", slot, query, purpose: "persistent social/gameplay shell" });
    }
  }
  for (const theme of roomThemes) {
    for (const [slot, query] of roomSlots(theme)) {
      slots.push({ group: "room", theme, slot, query, purpose: "capacity-limited themed room pack" });
    }
  }

  return {
    game,
    systems: SYSTEMS,
    roomThemes,
    slots,
    next: [
      "Run curate_assets on these slots with extensive=true.",
      "Claim shortlists before Studio inspection.",
      "Inspect only committed candidates in StudioMCP and record inspections.",
      "Build lobby queue/portal/team logic with code; build visible worlds from committed assets.",
    ],
  };
}

export function formatGameAssetCoverage(coverage) {
  const lines = [`Roblox asset coverage for '${coverage.game}'`, "", "Generic game systems to build:"];
  for (const system of coverage.systems) lines.push(`- ${system}`);
  lines.push("", "Search slots:");
  let currentGroup = "";
  for (const item of coverage.slots) {
    const group = item.theme ? `${item.group}: ${item.theme}` : item.group;
    if (group !== currentGroup) {
      currentGroup = group;
      lines.push("", `## ${group}`);
    }
    lines.push(`- ${item.slot}: ${item.query}`);
  }
  lines.push("", "Next:");
  for (const step of coverage.next) lines.push(`- ${step}`);
  return lines.join("\n");
}
