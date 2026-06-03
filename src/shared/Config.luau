--!strict
-- Shared Prop Hunt configuration and types.
-- World content comes from inspected Creator Store assets, not this logic layer.

export type Phase = "Intermission" | "Hiding" | "Hunting" | "RoundEnd"

export type RoundState = {
	phase: Phase,
	endsAt: number,
	seekers: { number },
	hiders: { number },
	taggedHiders: { number },
}

local Config = {
	HIDEABLE_PROPS_FOLDER = "HideableProps",

	INTERMISSION_TIME = 15,
	HIDING_TIME = 30,
	HUNTING_TIME = 120,
	ROUND_END_TIME = 8,

	-- Keep production default at 2. Set to true for one-window Studio smoke tests.
	DEBUG_SOLO = false,
	MIN_PLAYERS = 2,
	SEEKER_RATIO = 0.25,

	DISGUISE_RANGE = 16,
	TAG_RANGE = 8,

	POINTS_PER_SURVIVED_HIDER = 10,
	POINTS_PER_TAG = 25,
}

return Config
