--!strict
-- Prop Hunt client HUD and disguise input.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")

local Config = require(ReplicatedStorage:WaitForChild("PropHunt"):WaitForChild("Config"))
local Remotes = require(ReplicatedStorage.PropHunt.Remotes)

local player = Players.LocalPlayer
local stateChanged = Remotes.get("StateChanged") :: RemoteEvent
local requestDisguise = Remotes.get("RequestDisguise") :: RemoteEvent
local leaveQueueRequested = Remotes.get("LeaveQueueRequested") :: RemoteEvent
local notify = Remotes.get("Notify") :: RemoteEvent
local latestState: any = nil

local gui = Instance.new("ScreenGui")
gui.Name = "PropHuntHUD"
gui.ResetOnSpawn = false
gui.Parent = player:WaitForChild("PlayerGui")

local phaseLabel = Instance.new("TextLabel")
phaseLabel.AnchorPoint = Vector2.new(0.5, 0)
phaseLabel.Position = UDim2.new(0.5, 0, 0.02, 0)
phaseLabel.Size = UDim2.new(0.4, 0, 0.06, 0)
phaseLabel.BackgroundTransparency = 0.4
phaseLabel.BackgroundColor3 = Color3.new(0, 0, 0)
phaseLabel.TextColor3 = Color3.new(1, 1, 1)
phaseLabel.TextScaled = true
phaseLabel.Font = Enum.Font.GothamBold
phaseLabel.Text = "Waiting..."
phaseLabel.Parent = gui

local roleLabel = Instance.new("TextLabel")
roleLabel.AnchorPoint = Vector2.new(0.5, 0)
roleLabel.Position = UDim2.new(0.5, 0, 0.085, 0)
roleLabel.Size = UDim2.new(0.34, 0, 0.04, 0)
roleLabel.BackgroundTransparency = 0.55
roleLabel.BackgroundColor3 = Color3.new(0, 0, 0)
roleLabel.TextColor3 = Color3.fromRGB(210, 235, 255)
roleLabel.TextScaled = true
roleLabel.Font = Enum.Font.GothamMedium
roleLabel.Text = "Waiting for round"
roleLabel.Parent = gui

local scoreLabel = Instance.new("TextLabel")
scoreLabel.AnchorPoint = Vector2.new(1, 0)
scoreLabel.Position = UDim2.new(0.98, 0, 0.02, 0)
scoreLabel.Size = UDim2.new(0.16, 0, 0.045, 0)
scoreLabel.BackgroundTransparency = 0.45
scoreLabel.BackgroundColor3 = Color3.new(0, 0, 0)
scoreLabel.TextColor3 = Color3.fromRGB(255, 255, 255)
scoreLabel.TextScaled = true
scoreLabel.Font = Enum.Font.GothamBold
scoreLabel.Text = "Score 0"
scoreLabel.Parent = gui

local roomLabel = Instance.new("TextLabel")
roomLabel.AnchorPoint = Vector2.new(0, 0)
roomLabel.Position = UDim2.new(0.02, 0, 0.02, 0)
roomLabel.Size = UDim2.new(0.22, 0, 0.045, 0)
roomLabel.BackgroundTransparency = 0.45
roomLabel.BackgroundColor3 = Color3.new(0, 0, 0)
roomLabel.TextColor3 = Color3.fromRGB(255, 255, 255)
roomLabel.TextScaled = true
roomLabel.Font = Enum.Font.GothamBold
roomLabel.Text = "Lobby"
roomLabel.Parent = gui

local queueLabel = Instance.new("TextLabel")
queueLabel.AnchorPoint = Vector2.new(0, 0)
queueLabel.Position = UDim2.new(0.02, 0, 0.07, 0)
queueLabel.Size = UDim2.new(0.26, 0, 0.04, 0)
queueLabel.BackgroundTransparency = 0.55
queueLabel.BackgroundColor3 = Color3.new(0, 0, 0)
queueLabel.TextColor3 = Color3.fromRGB(210, 235, 255)
queueLabel.TextScaled = true
queueLabel.Font = Enum.Font.GothamMedium
queueLabel.Text = "Choose a portal"
queueLabel.Parent = gui

local leaveQueueButton = Instance.new("TextButton")
leaveQueueButton.AnchorPoint = Vector2.new(0, 0)
leaveQueueButton.Position = UDim2.new(0.02, 0, 0.115, 0)
leaveQueueButton.Size = UDim2.new(0.14, 0, 0.04, 0)
leaveQueueButton.BackgroundTransparency = 0.25
leaveQueueButton.BackgroundColor3 = Color3.fromRGB(38, 43, 48)
leaveQueueButton.TextColor3 = Color3.fromRGB(255, 255, 255)
leaveQueueButton.TextScaled = true
leaveQueueButton.Font = Enum.Font.GothamBold
leaveQueueButton.Text = "Leave Queue"
leaveQueueButton.Visible = false
leaveQueueButton.Parent = gui

local toast = Instance.new("TextLabel")
toast.AnchorPoint = Vector2.new(0.5, 1)
toast.Position = UDim2.new(0.5, 0, 0.9, 0)
toast.Size = UDim2.new(0.4, 0, 0.05, 0)
toast.BackgroundTransparency = 0.5
toast.BackgroundColor3 = Color3.new(0, 0, 0)
toast.TextColor3 = Color3.fromRGB(255, 230, 120)
toast.TextScaled = true
toast.Font = Enum.Font.Gotham
toast.Text = ""
toast.Visible = false
toast.Parent = gui

local hint = Instance.new("TextLabel")
hint.AnchorPoint = Vector2.new(0.5, 1)
hint.Position = UDim2.new(0.5, 0, 0.82, 0)
hint.Size = UDim2.new(0.3, 0, 0.04, 0)
hint.BackgroundTransparency = 1
hint.TextColor3 = Color3.new(1, 1, 1)
hint.TextStrokeTransparency = 0.4
hint.TextScaled = true
hint.Font = Enum.Font.Gotham
hint.Text = ""
hint.Visible = false
hint.Parent = gui

local function showToast(message: string)
	toast.Text = message
	toast.Visible = true
	task.delay(3, function()
		if toast.Text == message then
			toast.Visible = false
		end
	end)
end

local function includesUserId(list: { any }?, userId: number): boolean
	if not list then
		return false
	end
	for _, id in list do
		if id == userId then
			return true
		end
	end
	return false
end

local function currentRole(): string
	if not latestState then
		return "Waiting"
	end
	if includesUserId(latestState.seekers, player.UserId) then
		return "Seeker"
	elseif includesUserId(latestState.hiders, player.UserId) then
		return "Hider"
	end
	return "Waiting"
end

local function isHiderActive(): boolean
	local phase = latestState and latestState.phase
	return currentRole() == "Hider" and (phase == "Hiding" or phase == "Hunting")
end

local function scoreForLocalPlayer(): number
	local scores = latestState and latestState.scores
	if type(scores) ~= "table" then
		return 0
	end
	return scores[player.UserId] or scores[tostring(player.UserId)] or 0
end

local function updateRoomText(state)
	local phase = tostring(state.phase)
	local roomName = tostring(state.roomName or "Lobby")
	roomLabel.Text = roomName

	if phase == "Lobby" then
		queueLabel.Text = "Choose a portal"
		leaveQueueButton.Visible = false
	elseif phase == "Queue" then
		local count = tonumber(state.queueCount) or 0
		local maxPlayers = tonumber(state.maxPlayers) or 0
		local minPlayers = tonumber(state.minPlayers) or 0
		queueLabel.Text = "Queue " .. tostring(count) .. "/" .. tostring(maxPlayers) .. "  Min " .. tostring(minPlayers)
		leaveQueueButton.Visible = true
	else
		leaveQueueButton.Visible = false
		local role = currentRole()
		if role == "Waiting" then
			queueLabel.Text = "Spectating"
		else
			queueLabel.Text = role .. " in " .. roomName
		end
	end
end

stateChanged.OnClientEvent:Connect(function(state)
	latestState = state
	phaseLabel.Text = tostring(state.phase)
	roleLabel.Text = currentRole()
	scoreLabel.Text = "Score " .. tostring(scoreForLocalPlayer())
	updateRoomText(state)
end)
notify.OnClientEvent:Connect(showToast)
leaveQueueButton.Activated:Connect(function()
	leaveQueueRequested:FireServer()
end)

local function nearestProp(): Model?
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	local folder = Workspace:FindFirstChild(Config.HIDEABLE_PROPS_FOLDER)
	if not root or not folder then
		return nil
	end

	local best: Model? = nil
	local bestDist = Config.DISGUISE_RANGE
	for _, prop in folder:GetChildren() do
		if prop:IsA("Model") and prop.PrimaryPart then
			local dist = (prop.PrimaryPart.Position - root.Position).Magnitude
			if dist <= bestDist then
				best = prop
				bestDist = dist
			end
		end
	end
	return best
end

RunService.RenderStepped:Connect(function()
	if latestState and latestState.endsAt then
		local remaining = math.max(0, math.ceil(latestState.endsAt - os.clock()))
		if remaining > 0 then
			phaseLabel.Text = tostring(latestState.phase) .. "  " .. tostring(remaining)
		else
			phaseLabel.Text = tostring(latestState.phase)
		end
	end
	roleLabel.Text = currentRole()
	scoreLabel.Text = "Score " .. tostring(scoreForLocalPlayer())
	if latestState then
		updateRoomText(latestState)
	end

	local prop = nearestProp()
	if prop and isHiderActive() then
		hint.Text = "Press E to hide as " .. prop.Name
		hint.Visible = true
	else
		hint.Visible = false
	end
end)

UserInputService.InputBegan:Connect(function(input, processed)
	if processed then
		return
	end
	if input.KeyCode == Enum.KeyCode.E then
		local prop = nearestProp()
		if prop and isHiderActive() then
			requestDisguise:FireServer(prop.Name)
		end
	elseif input.KeyCode == Enum.KeyCode.Q and latestState and latestState.phase == "Queue" then
		leaveQueueRequested:FireServer()
	end
end)
