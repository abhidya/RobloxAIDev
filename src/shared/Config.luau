--!strict
-- Shared Prop Hunt configuration and types.
-- World content comes from inspected Creator Store assets, not this logic layer.

export type Phase = "Lobby" | "Queue" | "Intermission" | "Hiding" | "Hunting" | "RoundEnd"

export type RoomConfig = {
	id: string,
	name: string,
	theme: string,
	worldFolder: string,
	lobbyPortal: string,
	portalPromptPart: string,
	portalPadPart: string,
	minPlayers: number,
	maxPlayers: number,
	fillSeconds: number,
	teams: { string },
	roomSpawnFolder: string,
	hideableFolder: string,
	paletteProject: string,
	boundsCenter: Vector3,
	boundsSize: Vector3,
	hiderSpawn: Vector3,
	seekerSpawn: Vector3,
	returnSpawn: Vector3,
}

export type RoundState = {
	phase: Phase,
	endsAt: number,
	seekers: { number },
	hiders: { number },
	taggedHiders: { number },
	roomId: string?,
	roomName: string?,
	queueCount: number?,
	minPlayers: number?,
	maxPlayers: number?,
}

local Config = {
	HIDEABLE_PROPS_FOLDER = "HideableProps",

	INTERMISSION_TIME = 15,
	HIDING_TIME = 30,
	HUNTING_TIME = 120,
	ROUND_END_TIME = 8,

	-- Keep production default at 2. Set to true for one-window Studio smoke tests.
	DEBUG_SOLO = false,
	DEBUG_FAST_TIMINGS = false,
	MIN_PLAYERS = 2,
	SEEKER_RATIO = 0.25,
	WAIT_FOR_PLAYERS_RETRY_TIME = 3,
	ROOM_QUEUE_COUNTDOWN = 8,

	DISGUISE_RANGE = 16,
	TAG_RANGE = 8,

	POINTS_PER_SURVIVED_HIDER = 10,
	POINTS_PER_TAG = 25,

	ROOMS = {
		{
			id = "medieval",
			name = "Medieval Market",
			theme = "medieval market",
			worldFolder = "MedievalMarket",
			lobbyPortal = "MedievalPortalPad",
			portalPromptPart = "MedievalPortalPrompt",
			portalPadPart = "MedievalPortalPad",
			minPlayers = 2,
			maxPlayers = 8,
			fillSeconds = 8,
			teams = { "Hiders", "Seekers" },
			roomSpawnFolder = "MedievalMarket",
			hideableFolder = "HideableProps",
			paletteProject = "prophunt",
			boundsCenter = Vector3.new(-107, 0.2, 20),
			boundsSize = Vector3.new(116, 0.2, 77),
			hiderSpawn = Vector3.new(-130, 5, 8),
			seekerSpawn = Vector3.new(-64, 5, 42),
			returnSpawn = Vector3.new(0, 5, -40),
		},
		{
			id = "scifi",
			name = "Sci-Fi Lab",
			theme = "sci-fi lab",
			worldFolder = "SciFiLab",
			lobbyPortal = "SciFiPortalPad",
			portalPromptPart = "SciFiPortalPrompt",
			portalPadPart = "SciFiPortalPad",
			minPlayers = 2,
			maxPlayers = 8,
			fillSeconds = 8,
			teams = { "Hiders", "Seekers" },
			roomSpawnFolder = "SciFiLab",
			hideableFolder = "HideableProps",
			paletteProject = "prophunt",
			boundsCenter = Vector3.new(0, 0.2, 20),
			boundsSize = Vector3.new(92, 0.2, 77),
			hiderSpawn = Vector3.new(-10, 5, 28),
			seekerSpawn = Vector3.new(42, 5, 48),
			returnSpawn = Vector3.new(0, 5, -40),
		},
		{
			id = "cabin",
			name = "Cozy Cabin",
			theme = "cozy cabin",
			worldFolder = "CozyCabin",
			lobbyPortal = "CabinPortalPad",
			portalPromptPart = "CabinPortalPrompt",
			portalPadPart = "CabinPortalPad",
			minPlayers = 2,
			maxPlayers = 8,
			fillSeconds = 8,
			teams = { "Hiders", "Seekers" },
			roomSpawnFolder = "CozyCabin",
			hideableFolder = "HideableProps",
			paletteProject = "prophunt",
			boundsCenter = Vector3.new(108, 0.2, 8),
			boundsSize = Vector3.new(106, 0.2, 77),
			hiderSpawn = Vector3.new(102, 5, -8),
			seekerSpawn = Vector3.new(136, 5, 18),
			returnSpawn = Vector3.new(0, 5, -40),
		},
	},
}

return Config
