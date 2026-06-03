--!strict
-- Prop Hunt server round loop. The game is lobby-first: players queue from
-- portal prompts into themed rooms, then each room runs its own hider/seeker
-- round with scoped HUD state and return-to-lobby cleanup.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Teams = game:GetService("Teams")
local Workspace = game:GetService("Workspace")

local Config = require(ReplicatedStorage:WaitForChild("PropHunt"):WaitForChild("Config"))
local Remotes = require(ReplicatedStorage.PropHunt.Remotes)

Remotes.setup()
local stateChanged = Remotes.get("StateChanged") :: RemoteEvent
local requestDisguise = Remotes.get("RequestDisguise") :: RemoteEvent
local notify = Remotes.get("Notify") :: RemoteEvent

type QueueState = {
	room: any,
	players: { [number]: Player },
}

local scores: { [number]: number } = {}
local disguises: { [number]: Model } = {}
local currentHiders: { [number]: boolean } = {}
local currentSeekers: { [number]: boolean } = {}
local currentPhaseByUserId: { [number]: string } = {}
local currentStateByUserId: { [number]: any } = {}
local playerQueueRoom: { [number]: string } = {}
local playerActiveRoom: { [number]: string } = {}
local queues: { [string]: QueueState } = {}
local roomsById: { [string]: any } = {}
local boundPromptNames: { [string]: boolean } = {}
local portalTouchDebounce: { [number]: number } = {}
local portalPadParts: { [string]: BasePart } = {}

local lobbyTeam: Team
local hiderTeam: Team
local seekerTeam: Team

local function ensureTeam(name: string, color: string): Team
	local existing = Teams:FindFirstChild(name)
	if existing and existing:IsA("Team") then
		existing.AutoAssignable = false
		return existing
	end

	local team = Instance.new("Team")
	team.Name = name
	team.TeamColor = BrickColor.new(color)
	team.AutoAssignable = false
	team.Parent = Teams
	return team
end

local function setupTeams()
	lobbyTeam = ensureTeam("Lobby", "Institutional white")
	hiderTeam = ensureTeam("Hiders", "Bright green")
	seekerTeam = ensureTeam("Seekers", "Really red")
end

local function setPlayerTeam(player: Player, team: Team)
	player.Team = team
	player.Neutral = false
end

local function minPlayersForRoom(room: any): number
	if Config.DEBUG_SOLO then
		return 1
	end
	return room.minPlayers or Config.MIN_PLAYERS
end

local function phaseDuration(name: string): number
	if Config.DEBUG_FAST_TIMINGS then
		if name == "Queue" then
			return 2
		elseif name == "Intermission" then
			return 2
		elseif name == "Hiding" then
			return 2
		elseif name == "Hunting" then
			return 4
		elseif name == "RoundEnd" then
			return 2
		end
	end
	if name == "Queue" then
		return Config.ROOM_QUEUE_COUNTDOWN
	elseif name == "Intermission" then
		return Config.INTERMISSION_TIME
	elseif name == "Hiding" then
		return Config.HIDING_TIME
	elseif name == "Hunting" then
		return Config.HUNTING_TIME
	elseif name == "RoundEnd" then
		return Config.ROUND_END_TIME
	end
	return 1
end

local function getHideableProps(): { Model }
	local folder = Workspace:FindFirstChild(Config.HIDEABLE_PROPS_FOLDER)
	local props: { Model } = {}
	if folder then
		for _, child in folder:GetChildren() do
			if child:IsA("Model") and child.PrimaryPart then
				table.insert(props, child)
			end
		end
	end
	return props
end

local function scoresSnapshot(): { [number]: number }
	local out: { [number]: number } = {}
	for userId, score in scores do
		out[userId] = score
	end
	return out
end

local function stateForPlayer(player: Player, state: any)
	local enriched = table.clone(state)
	enriched.scores = scoresSnapshot()
	currentStateByUserId[player.UserId] = enriched
	currentPhaseByUserId[player.UserId] = tostring(enriched.phase)
	stateChanged:FireClient(player, enriched)
end

local function broadcastTo(players: { Player }, state: any)
	for _, player in players do
		if player.Parent == Players then
			stateForPlayer(player, state)
		end
	end
	print("[PropHunt] " .. tostring(state.roomName or "Lobby") .. " -> " .. tostring(state.phase))
end

local function sendLobbyState(player: Player)
	stateForPlayer(player, {
		phase = "Lobby",
		endsAt = 0,
		seekers = {},
		hiders = {},
		taggedHiders = {},
		roomId = "lobby",
		roomName = "Lobby",
		queueCount = 0,
		minPlayers = Config.MIN_PLAYERS,
		maxPlayers = 0,
	})
end

local function tableFromIds(ids: { number }): { [number]: boolean }
	local out: { [number]: boolean } = {}
	for _, userId in ids do
		out[userId] = true
	end
	return out
end

local function setPlayerFrozen(player: Player, frozen: boolean)
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		if frozen then
			if humanoid:GetAttribute("PropHuntWalkSpeed") == nil then
				humanoid:SetAttribute("PropHuntWalkSpeed", humanoid.WalkSpeed)
				humanoid:SetAttribute("PropHuntJumpPower", humanoid.JumpPower)
			end
			humanoid.WalkSpeed = 0
			humanoid.JumpPower = 0
		else
			humanoid.WalkSpeed = humanoid:GetAttribute("PropHuntWalkSpeed") or 16
			humanoid.JumpPower = humanoid:GetAttribute("PropHuntJumpPower") or 50
			humanoid:SetAttribute("PropHuntWalkSpeed", nil)
			humanoid:SetAttribute("PropHuntJumpPower", nil)
		end
	end
end

local function setPlayersFrozen(userIds: { number }, frozen: boolean)
	for _, userId in userIds do
		local player = Players:GetPlayerByUserId(userId)
		if player then
			setPlayerFrozen(player, frozen)
		end
	end
end

local function clearDisguise(player: Player)
	local existing = disguises[player.UserId]
	if existing then
		existing:Destroy()
		disguises[player.UserId] = nil
	end
	local character = player.Character
	if character then
		for _, part in character:GetDescendants() do
			if part:IsA("BasePart") then
				part.Transparency = 0
				part.CanCollide = part.Name ~= "HumanoidRootPart"
			end
		end
	end
end

local function applyDisguise(player: Player, prop: Model)
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not character or not root or not prop.PrimaryPart then
		return
	end

	clearDisguise(player)

	local clone = prop:Clone()
	clone.Name = "Disguise"
	for _, part in clone:GetDescendants() do
		if part:IsA("BasePart") then
			part.Anchored = false
			part.CanCollide = false
			part.Massless = true
		end
	end

	for _, part in character:GetDescendants() do
		if part:IsA("BasePart") and part.Name ~= "HumanoidRootPart" then
			part.Transparency = 1
		end
	end

	clone.Parent = character
	clone:PivotTo(root.CFrame)
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = root
	weld.Part1 = clone.PrimaryPart
	weld.Parent = root
	disguises[player.UserId] = clone
end

local function teleportPlayer(player: Player, position: Vector3)
	local character = player.Character or player.CharacterAdded:Wait()
	local root = character:WaitForChild("HumanoidRootPart", 5) :: BasePart?
	if root then
		root.CFrame = CFrame.new(position)
	end
end

local function cleanupPlayerFromRound(player: Player)
	clearDisguise(player)
	currentHiders[player.UserId] = nil
	currentSeekers[player.UserId] = nil
	playerActiveRoom[player.UserId] = nil
	setPlayerFrozen(player, false)
	if lobbyTeam then
		setPlayerTeam(player, lobbyTeam)
	end
end

local function playersInQueue(queue: QueueState): { Player }
	local out: { Player } = {}
	for userId, player in queue.players do
		if player.Parent == Players then
			table.insert(out, player)
		else
			queue.players[userId] = nil
			playerQueueRoom[userId] = nil
		end
	end
	return out
end

local function queueCount(queue: QueueState): number
	local count = 0
	for userId, player in queue.players do
		if player.Parent == Players then
			count += 1
		else
			queue.players[userId] = nil
			playerQueueRoom[userId] = nil
		end
	end
	return count
end

local function broadcastQueueState(queue: QueueState, endsAt: number?)
	local room = queue.room
	local count = queueCount(queue)
	local players = playersInQueue(queue)
	broadcastTo(players, {
		phase = "Queue",
		endsAt = endsAt or 0,
		seekers = {},
		hiders = {},
		taggedHiders = {},
		roomId = room.id,
		roomName = room.name,
		queueCount = count,
		minPlayers = minPlayersForRoom(room),
		maxPlayers = room.maxPlayers,
	})
end

local function leaveQueue(player: Player, shouldNotify: boolean)
	local roomId = playerQueueRoom[player.UserId]
	if not roomId then
		return
	end
	local queue = queues[roomId]
	if queue then
		queue.players[player.UserId] = nil
		broadcastQueueState(queue)
	end
	playerQueueRoom[player.UserId] = nil
	sendLobbyState(player)
	if shouldNotify then
		notify:FireClient(player, "Left queue")
	end
end

local function enterQueue(player: Player, room: any, toggleSame: boolean)
	if playerActiveRoom[player.UserId] then
		notify:FireClient(player, "Finish your current room before queueing again")
		return
	end
	if playerQueueRoom[player.UserId] == room.id then
		if toggleSame then
			leaveQueue(player, true)
		end
		return
	end

	leaveQueue(player, false)
	local queue = queues[room.id]
	if not queue then
		return
	end
	if queueCount(queue) >= room.maxPlayers then
		notify:FireClient(player, room.name .. " is full")
		return
	end

	queue.players[player.UserId] = player
	playerQueueRoom[player.UserId] = room.id
	setPlayerTeam(player, lobbyTeam)
	notify:FireClient(player, "Queued for " .. room.name)
	broadcastQueueState(queue)
end

local function takeQueuedPlayers(queue: QueueState, limit: number): { Player }
	local participants: { Player } = {}
	for userId, player in queue.players do
		if #participants >= limit then
			break
		end
		if player.Parent == Players then
			table.insert(participants, player)
		end
		queue.players[userId] = nil
		playerQueueRoom[userId] = nil
	end
	broadcastQueueState(queue)
	return participants
end

local function pickSeekers(participants: { Player }): ({ number }, { number })
	if Config.DEBUG_SOLO and #participants == 1 then
		return {}, { participants[1].UserId }
	end

	local seekerCount = math.max(1, math.floor(#participants * Config.SEEKER_RATIO))
	local shuffled = table.clone(participants)
	for i = #shuffled, 2, -1 do
		local j = math.random(i)
		shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
	end

	local seekers: { number } = {}
	local hiders: { number } = {}
	for index, player in shuffled do
		if index <= seekerCount then
			table.insert(seekers, player.UserId)
		else
			table.insert(hiders, player.UserId)
		end
	end
	return seekers, hiders
end

local function awardSurvivors(hiders: { number }, tagged: { [number]: boolean })
	for _, userId in hiders do
		if not tagged[userId] then
			scores[userId] = (scores[userId] or 0) + Config.POINTS_PER_SURVIVED_HIDER
		end
	end
end

local function roomState(room: any, phase: string, endsAt: number, seekers: { number }, hiders: { number }, taggedHiders: { number })
	return {
		phase = phase,
		endsAt = endsAt,
		seekers = seekers,
		hiders = hiders,
		taggedHiders = taggedHiders,
		roomId = room.id,
		roomName = room.name,
		queueCount = 0,
		minPlayers = minPlayersForRoom(room),
		maxPlayers = room.maxPlayers,
	}
end

local function idsToPlayers(ids: { number }): { Player }
	local out: { Player } = {}
	for _, userId in ids do
		local player = Players:GetPlayerByUserId(userId)
		if player then
			table.insert(out, player)
		end
	end
	return out
end

local function taggedList(tagged: { [number]: boolean }): { number }
	local out: { number } = {}
	for userId in tagged do
		table.insert(out, userId)
	end
	return out
end

local function runRoomRound(room: any, participants: { Player })
	local props = getHideableProps()
	if #props == 0 then
		for _, player in participants do
			notify:FireClient(player, "No hideable props in world - run the asset-driven build first")
			sendLobbyState(player)
		end
		return
	end

	for _, player in participants do
		playerActiveRoom[player.UserId] = room.id
		setPlayerTeam(player, lobbyTeam)
		teleportPlayer(player, room.hiderSpawn)
	end

	local intermissionDuration = phaseDuration("Intermission")
	broadcastTo(participants, roomState(room, "Intermission", os.clock() + intermissionDuration, {}, {}, {}))
	task.wait(intermissionDuration)

	local liveParticipants: { Player } = {}
	for _, player in participants do
		if player.Parent == Players and playerActiveRoom[player.UserId] == room.id then
			table.insert(liveParticipants, player)
		end
	end
	if #liveParticipants < minPlayersForRoom(room) then
		for _, player in liveParticipants do
			notify:FireClient(player, "Not enough players stayed in " .. room.name)
			cleanupPlayerFromRound(player)
			teleportPlayer(player, room.returnSpawn)
			sendLobbyState(player)
		end
		return
	end

	local seekers, hiders = pickSeekers(liveParticipants)
	local tagged: { [number]: boolean } = {}
	currentHiders = tableFromIds(hiders)
	currentSeekers = tableFromIds(seekers)

	for _, userId in seekers do
		local player = Players:GetPlayerByUserId(userId)
		if player then
			setPlayerTeam(player, seekerTeam)
			teleportPlayer(player, room.seekerSpawn)
			notify:FireClient(player, "You are a SEEKER. Wait for hunt to begin.")
		end
	end
	for _, userId in hiders do
		local player = Players:GetPlayerByUserId(userId)
		if player then
			setPlayerTeam(player, hiderTeam)
			teleportPlayer(player, room.hiderSpawn)
			notify:FireClient(player, "You are a HIDER. Press E near a prop.")
		end
	end

	local activePlayers = idsToPlayers(seekers)
	for _, player in idsToPlayers(hiders) do
		table.insert(activePlayers, player)
	end

	local hidingDuration = phaseDuration("Hiding")
	local hidingEnd = os.clock() + hidingDuration
	setPlayersFrozen(seekers, true)
	broadcastTo(activePlayers, roomState(room, "Hiding", hidingEnd, seekers, hiders, {}))
	task.wait(hidingDuration)
	setPlayersFrozen(seekers, false)

	local huntingDuration = phaseDuration("Hunting")
	local huntEnd = os.clock() + huntingDuration
	broadcastTo(activePlayers, roomState(room, "Hunting", huntEnd, seekers, hiders, {}))

	local connection = RunService.Heartbeat:Connect(function()
		for _, seekerId in seekers do
			local seeker = Players:GetPlayerByUserId(seekerId)
			local sRoot = seeker
				and seeker.Character
				and seeker.Character:FindFirstChild("HumanoidRootPart") :: BasePart?
			if sRoot then
				for _, hiderId in hiders do
					if not tagged[hiderId] then
						local hider = Players:GetPlayerByUserId(hiderId)
						local hRoot = hider
							and hider.Character
							and hider.Character:FindFirstChild("HumanoidRootPart") :: BasePart?
						if hRoot and (hRoot.Position - sRoot.Position).Magnitude <= Config.TAG_RANGE then
							tagged[hiderId] = true
							currentHiders[hiderId] = nil
							scores[seekerId] = (scores[seekerId] or 0) + Config.POINTS_PER_TAG
							if hider then
								clearDisguise(hider)
								notify:FireClient(hider, "You were tagged!")
							end
							if seeker then
								notify:FireClient(seeker, "Tagged " .. (hider and hider.Name or "?"))
							end
							broadcastTo(activePlayers, roomState(room, "Hunting", huntEnd, seekers, hiders, taggedList(tagged)))
						end
					end
				end
			end
		end
	end)

	while os.clock() < huntEnd do
		local remaining = 0
		for _, hiderId in hiders do
			if not tagged[hiderId] then
				remaining += 1
			end
		end
		if remaining == 0 and #seekers > 0 then
			break
		end
		task.wait(0.5)
	end
	connection:Disconnect()

	awardSurvivors(hiders, tagged)
	local roundEndDuration = phaseDuration("RoundEnd")
	local endedPlayers = idsToPlayers(seekers)
	for _, player in idsToPlayers(hiders) do
		table.insert(endedPlayers, player)
	end
	broadcastTo(endedPlayers, roomState(room, "RoundEnd", os.clock() + roundEndDuration, seekers, hiders, taggedList(tagged)))
	task.wait(roundEndDuration)

	for _, player in endedPlayers do
		if player.Parent == Players then
			cleanupPlayerFromRound(player)
			teleportPlayer(player, room.returnSpawn)
			sendLobbyState(player)
		end
	end
end

local function runQueueLoop(queue: QueueState)
	while true do
		while queueCount(queue) < minPlayersForRoom(queue.room) do
			task.wait(1)
		end

		local countdown = phaseDuration("Queue")
		local endsAt = os.clock() + countdown
		while os.clock() < endsAt do
			if queueCount(queue) < minPlayersForRoom(queue.room) then
				broadcastQueueState(queue)
				break
			end
			broadcastQueueState(queue, endsAt)
			if queueCount(queue) >= queue.room.maxPlayers then
				break
			end
			task.wait(1)
		end

		if queueCount(queue) >= minPlayersForRoom(queue.room) then
			local participants = takeQueuedPlayers(queue, queue.room.maxPlayers)
			if #participants > 0 then
				runRoomRound(queue.room, participants)
			end
		end
		task.wait(1)
	end
end

local function findDescendantByName(root: Instance, name: string): Instance?
	if root.Name == name then
		return root
	end
	for _, child in root:GetChildren() do
		local found = findDescendantByName(child, name)
		if found then
			return found
		end
	end
	return nil
end

local function bindRoomPortal(room: any): boolean
	if boundPromptNames[room.portalPromptPart] then
		return true
	end

	local promptPart = findDescendantByName(Workspace, room.portalPromptPart)
	local padPart = findDescendantByName(Workspace, room.portalPadPart)
	if (not promptPart or not promptPart:IsA("BasePart")) and (not padPart or not padPart:IsA("BasePart")) then
		return false
	end

	if promptPart and promptPart:IsA("BasePart") then
		local prompt = promptPart:FindFirstChildOfClass("ProximityPrompt")
		if not prompt then
			prompt = Instance.new("ProximityPrompt")
			prompt.Name = "QueuePrompt"
			prompt.Parent = promptPart
		end
		prompt.ActionText = "Queue"
		prompt.ObjectText = room.name
		prompt.HoldDuration = 0.2
		prompt.MaxActivationDistance = 14
		prompt.Triggered:Connect(function(player)
			enterQueue(player, room, true)
		end)
	end

	local touchPart = padPart
	if touchPart and touchPart:IsA("BasePart") then
		portalPadParts[room.id] = touchPart
		touchPart.Touched:Connect(function(hit)
			local character = hit:FindFirstAncestorOfClass("Model")
			local player = character and Players:GetPlayerFromCharacter(character)
			if not player then
				return
			end
			local now = os.clock()
			if (portalTouchDebounce[player.UserId] or 0) + 1 > now then
				return
			end
			portalTouchDebounce[player.UserId] = now
			enterQueue(player, room, false)
		end)
	end

	boundPromptNames[room.portalPromptPart] = true
	print("[PropHunt] Bound queue portal for " .. room.name)
	return true
end

local function runPortalScanLoop()
	while true do
		for _, player in Players:GetPlayers() do
			if not playerActiveRoom[player.UserId] then
				local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart") :: BasePart?
				if root then
					for roomId, pad in portalPadParts do
						local room = roomsById[roomId]
						local delta = root.Position - pad.Position
						local horizontalDistance = Vector3.new(delta.X, 0, delta.Z).Magnitude
						if room and horizontalDistance <= math.max(pad.Size.X, pad.Size.Z) * 0.55 and math.abs(delta.Y) <= 9 then
							local now = os.clock()
							if (portalTouchDebounce[player.UserId] or 0) + 1 <= now then
								portalTouchDebounce[player.UserId] = now
								enterQueue(player, room, false)
							end
							break
						end
					end
				end
			end
		end
		task.wait(0.5)
	end
end

local function bindPromptsWhenReady()
	for _, room in Config.ROOMS do
		for _ = 1, 20 do
			if bindRoomPortal(room) then
				break
			end
			task.wait(0.5)
		end
		if not boundPromptNames[room.portalPromptPart] then
			warn("[PropHunt] Missing queue portal parts for: " .. room.name)
		end
	end
end

requestDisguise.OnServerEvent:Connect(function(player, propName)
	if typeof(propName) ~= "string" then
		return
	end
	local phase = currentPhaseByUserId[player.UserId]
	if phase ~= "Hiding" and phase ~= "Hunting" then
		notify:FireClient(player, "Wait for the hiding phase")
		return
	end
	if not currentHiders[player.UserId] then
		notify:FireClient(player, "Only hiders can disguise")
		return
	end

	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not root then
		return
	end

	for _, prop in getHideableProps() do
		if prop.Name == propName and prop.PrimaryPart then
			local dist = (prop.PrimaryPart.Position - root.Position).Magnitude
			if dist <= Config.DISGUISE_RANGE then
				applyDisguise(player, prop)
				notify:FireClient(player, "Disguised as " .. propName)
			else
				notify:FireClient(player, "Move closer to " .. propName)
			end
			return
		end
	end
end)

Players.PlayerAdded:Connect(function(player)
	scores[player.UserId] = scores[player.UserId] or 0
	setPlayerTeam(player, lobbyTeam)
	player.CharacterAdded:Connect(function()
		local activeRoomId = playerActiveRoom[player.UserId]
		if activeRoomId then
			local room = roomsById[activeRoomId]
			if room then
				task.defer(function()
					if currentSeekers[player.UserId] then
						teleportPlayer(player, room.seekerSpawn)
					elseif currentHiders[player.UserId] then
						teleportPlayer(player, room.hiderSpawn)
					end
					if currentSeekers[player.UserId] and currentPhaseByUserId[player.UserId] == "Hiding" then
						setPlayerFrozen(player, true)
					end
				end)
			end
		end
	end)
	task.defer(function()
		sendLobbyState(player)
	end)
end)

Players.PlayerRemoving:Connect(function(player)
	leaveQueue(player, false)
	scores[player.UserId] = nil
	disguises[player.UserId] = nil
	currentHiders[player.UserId] = nil
	currentSeekers[player.UserId] = nil
	currentPhaseByUserId[player.UserId] = nil
	currentStateByUserId[player.UserId] = nil
	playerActiveRoom[player.UserId] = nil
end)

setupTeams()
for _, room in Config.ROOMS do
	roomsById[room.id] = room
	queues[room.id] = {
		room = room,
		players = {},
	}
	task.spawn(runQueueLoop, queues[room.id])
end
task.spawn(bindPromptsWhenReady)
task.spawn(runPortalScanLoop)

print("[PropHunt] Room queue server started. Waiting for players at lobby portals...")
for _, player in Players:GetPlayers() do
	scores[player.UserId] = scores[player.UserId] or 0
	setPlayerTeam(player, lobbyTeam)
	sendLobbyState(player)
end
