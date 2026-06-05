--!strict

local ProfileStore = {}
ProfileStore.__index = ProfileStore

export type StoreAdapter = {
	GetAsync: (StoreAdapter, string) -> any,
	SetAsync: (StoreAdapter, string, any) -> (),
}

export type Options = {
	store: StoreAdapter?,
	defaultData: (() -> any)?,
	migrate: ((any) -> any)?,
	sessionOnly: boolean?,
	keyForPlayer: ((any) -> string)?,
	onChanged: ((any, any) -> ())?,
}

local function clone(value: any): any
	if type(value) ~= "table" then
		return value
	end
	local out = {}
	for key, child in pairs(value) do
		out[key] = clone(child)
	end
	return out
end

local function defaultData()
	return {
		SchemaVersion = 1,
	}
end

local function defaultKey(player: any): string
	return tostring(player.UserId)
end

function ProfileStore.new(options: Options)
	return setmetatable({
		store = options.store,
		defaultData = options.defaultData or defaultData,
		migrate = options.migrate,
		sessionOnly = options.sessionOnly == true,
		keyForPlayer = options.keyForPlayer or defaultKey,
		onChanged = options.onChanged,
		profiles = {},
	}, ProfileStore)
end

function ProfileStore:_normalize(data: any): any
	local profile = self.defaultData()
	if type(data) == "table" then
		for key, value in pairs(data) do
			profile[key] = clone(value)
		end
	end
	if self.migrate then
		profile = self.migrate(profile)
	end
	return profile
end

function ProfileStore:load(player: any): (any, boolean)
	local key = self.keyForPlayer(player)
	local raw = nil
	local loaded = false
	if not self.sessionOnly and self.store then
		local ok, result = pcall(function()
			return self.store:GetAsync(key)
		end)
		if ok then
			raw = result
			loaded = raw ~= nil
		else
			warn("[ProfileStore] load failed for " .. tostring(key) .. ": " .. tostring(result))
		end
	end
	local profile = self:_normalize(raw)
	self.profiles[key] = profile
	if self.onChanged then
		self.onChanged(player, self:snapshot(player))
	end
	return profile, loaded
end

function ProfileStore:get(player: any): any
	local key = self.keyForPlayer(player)
	if self.profiles[key] == nil then
		self.profiles[key] = self:_normalize(nil)
	end
	return self.profiles[key]
end

function ProfileStore:update(player: any, mutator: (any) -> any): any
	local profile = self:get(player)
	local nextProfile = mutator(profile) or profile
	self.profiles[self.keyForPlayer(player)] = nextProfile
	if self.onChanged then
		self.onChanged(player, self:snapshot(player))
	end
	return nextProfile
end

function ProfileStore:snapshot(player: any): any
	return clone(self:get(player))
end

function ProfileStore:save(player: any): (boolean, any?)
	local key = self.keyForPlayer(player)
	local profile = self.profiles[key]
	if profile == nil then
		return false, "no_profile"
	end
	if self.sessionOnly or not self.store then
		return true, nil
	end
	local ok, err = pcall(function()
		self.store:SetAsync(key, clone(profile))
	end)
	if not ok then
		warn("[ProfileStore] save failed for " .. tostring(key) .. ": " .. tostring(err))
		return false, err
	end
	return true, nil
end

function ProfileStore:clear(player: any)
	self.profiles[self.keyForPlayer(player)] = nil
end

return ProfileStore
