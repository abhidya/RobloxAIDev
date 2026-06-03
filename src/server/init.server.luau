--!strict
-- Prop Hunt server round loop. This logic reads disguise props from
-- Workspace.HideableProps; world assets are discovered, inspected, and placed
-- by the asset-driven workflow rather than hand-modeled here.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local Config = require(ReplicatedStorage:WaitForChild("PropHunt"):WaitForChild("Config"))
local Remotes = require(ReplicatedStorage.PropHunt.Remotes)

Remotes.setup()
local stateChanged = Remotes.get("StateChanged") :: RemoteEvent
local requestDisguise = Remotes.get("RequestDisguise") :: RemoteEvent
local notify = Remotes.get("Notify") :: RemoteEvent

local scores: { [number]: number } = {}
local disguises: { [number]: Model } = {}
local currentHiders: { [number]: boolean } = {}
local currentPhase: string = "Intermission"

local function getMinPlayers(): number
	return Config.DEBUG_SOLO and 1 or Config.MIN_PLAYERS
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

local function broadcast(state)
	currentPhase = tostring(state.phase)
	stateChanged:FireAllClients(state)
	print("[PropHunt] phase -> " .. currentPhase)
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

requestDisguise.OnServerEvent:Connect(function(player, propName)
	if typeof(propName) ~= "string" then
		return
	end
	if currentPhase ~= "Hiding" and currentPhase ~= "Hunting" then
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

local function runRound()
	currentHiders = {}
	broadcast({ phase = "Intermission", endsAt = os.clock() + Config.INTERMISSION_TIME })
	task.wait(Config.INTERMISSION_TIME)

	local participants = Players:GetPlayers()
	if #participants < getMinPlayers() then
		notify:FireAllClients("Need at least " .. getMinPlayers() .. " players")
		return
	end

	local props = getHideableProps()
	if #props == 0 then
		notify:FireAllClients("No hideable props in world - run the asset-driven build first")
		return
	end

	local seekers, hiders = pickSeekers(participants)
	local tagged: { [number]: boolean } = {}
	currentHiders = {}
	for _, userId in hiders do
		currentHiders[userId] = true
	end

	broadcast({
		phase = "Hiding",
		endsAt = os.clock() + Config.HIDING_TIME,
		seekers = seekers,
		hiders = hiders,
	})
	for _, userId in seekers do
		local p = Players:GetPlayerByUserId(userId)
		if p then
			notify:FireClient(p, "You are a SEEKER. Wait for hunt to begin.")
		end
	end
	task.wait(Config.HIDING_TIME)

	local huntEnd = os.clock() + Config.HUNTING_TIME
	broadcast({ phase = "Hunting", endsAt = huntEnd, seekers = seekers, hiders = hiders })

	local connection
	connection = RunService.Heartbeat:Connect(function()
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
	currentHiders = {}
	for _, player in Players:GetPlayers() do
		clearDisguise(player)
	end
	broadcast({ phase = "RoundEnd", endsAt = os.clock() + Config.ROUND_END_TIME })
	task.wait(Config.ROUND_END_TIME)
end

Players.PlayerRemoving:Connect(function(player)
	scores[player.UserId] = nil
	disguises[player.UserId] = nil
	currentHiders[player.UserId] = nil
end)

print("[PropHunt] Server logic started. Waiting for asset-built world...")
while true do
	local ok, err = pcall(runRound)
	if not ok then
		warn("[PropHunt] round error: " .. tostring(err))
		task.wait(3)
	end
end
