--!strict

local RoomQueue = {}
RoomQueue.__index = RoomQueue

local function playerKey(player: any): number
	return tonumber(player.UserId) or 0
end

function RoomQueue.new(room: any, clock: (() -> number)?)
	return setmetatable({
		room = room,
		clock = clock or os.clock,
		players = {},
		startedAt = nil,
	}, RoomQueue)
end

function RoomQueue:join(player: any): (boolean, string?)
	local userId = playerKey(player)
	if self.players[userId] then
		return false, "already_queued"
	end
	local maxPlayers = self.room.maxPlayers or self.room.max_players or 8
	if self:count() >= maxPlayers then
		return false, "room_full"
	end
	self.players[userId] = player
	if self.startedAt == nil then
		self.startedAt = self.clock()
	end
	return true, nil
end

function RoomQueue:leave(player: any): boolean
	local userId = playerKey(player)
	if self.players[userId] == nil then
		return false
	end
	self.players[userId] = nil
	if self:count() == 0 then
		self.startedAt = nil
	end
	return true
end

function RoomQueue:count(): number
	local total = 0
	for _ in pairs(self.players) do
		total += 1
	end
	return total
end

function RoomQueue:isReady(now: number?): boolean
	local minPlayers = self.room.minPlayers or self.room.min_players or 2
	local fillSeconds = self.room.fillSeconds or self.room.fill_seconds or 8
	if self:count() < minPlayers or self.startedAt == nil then
		return false
	end
	return (now or self.clock()) - self.startedAt >= fillSeconds
end

function RoomQueue:list(): { any }
	local out = {}
	for _, player in pairs(self.players) do
		table.insert(out, player)
	end
	table.sort(out, function(a, b)
		return playerKey(a) < playerKey(b)
	end)
	return out
end

return RoomQueue
