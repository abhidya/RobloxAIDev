--!strict
-- Replayable Studio command script for the 2026-06-03 working-copy visual pass.
--
-- Use with StudioMCP execute_luau or the Studio command bar after opening a
-- copied place. This intentionally edits the open DataModel; it is not a Rojo
-- source file.

local Workspace = game:GetService("Workspace")

local visual = Workspace:FindFirstChild("VisualPolish")
if not visual then
	visual = Instance.new("Folder")
	visual.Name = "VisualPolish"
	visual.Parent = Workspace
end

local fixes = visual:FindFirstChild("WorkingReviewFixes")
if fixes then
	fixes:Destroy()
end
fixes = Instance.new("Folder")
fixes.Name = "WorkingReviewFixes"
fixes.Parent = visual

local function anchorAll(inst: Instance)
	for _, child in ipairs(inst:GetDescendants()) do
		if child:IsA("BasePart") then
			child.Anchored = true
		end
	end
end

local function makePart(
	name: string,
	parent: Instance,
	size: Vector3,
	cframe: CFrame,
	color: Color3,
	material: Enum.Material?,
	transparency: number?,
	canCollide: boolean?
): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Size = size
	part.CFrame = cframe
	part.Anchored = true
	part.CanCollide = canCollide == true
	part.Color = color
	part.Material = material or Enum.Material.SmoothPlastic
	part.Transparency = transparency or 0
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	part.Parent = parent
	return part
end

local function makeBillboard(name: string, text: string, pos: Vector3, color: Color3)
	local anchor = makePart(name .. "_BillboardAnchor", fixes, Vector3.new(1, 1, 1), CFrame.new(pos), color, nil, 1, false)
	local gui = Instance.new("BillboardGui")
	gui.Name = name .. "_Billboard"
	gui.Adornee = anchor
	gui.Size = UDim2.fromOffset(280, 92)
	gui.AlwaysOnTop = true
	gui.LightInfluence = 0
	gui.MaxDistance = 28
	gui.Parent = anchor

	local frame = Instance.new("Frame")
	frame.Name = "Background"
	frame.Size = UDim2.fromScale(1, 1)
	frame.BackgroundColor3 = color
	frame.BackgroundTransparency = 0.05
	frame.BorderSizePixel = 0
	frame.Parent = gui

	local label = Instance.new("TextLabel")
	label.Name = "Title"
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Text = text
	label.TextColor3 = Color3.fromRGB(255, 255, 255)
	label.TextStrokeTransparency = 0.1
	label.TextScaled = true
	label.Font = Enum.Font.GothamBold
	label.Parent = frame
end

local function disableOldLobbyLabels()
	for _, scopePath in ipairs({ "Lobby", "RoomSignoffPolish.LobbyPortalFacades" }) do
		local scope: Instance? = visual
		for piece in string.gmatch(scopePath, "[^%.]+") do
			scope = if scope then scope:FindFirstChild(piece) else nil
		end
		if scope then
			for _, child in ipairs(scope:GetDescendants()) do
				if child:IsA("SurfaceGui") or child:IsA("BillboardGui") then
					child.Enabled = false
				end
			end
		end
	end
end

local function softenRoomWalls()
	local signoff = visual:FindFirstChild("RoomSignoffPolish")
	if not signoff then
		return
	end
	local themes = {
		MedievalMarketBoundaries = { color = Color3.fromRGB(132, 91, 49), material = Enum.Material.Cobblestone },
		SciFiLabBoundaries = { color = Color3.fromRGB(54, 86, 122), material = Enum.Material.Metal },
		CozyCabinBoundaries = { color = Color3.fromRGB(86, 116, 58), material = Enum.Material.WoodPlanks },
	}
	for folderName, style in pairs(themes) do
		local folder = signoff:FindFirstChild(folderName)
		if folder then
			for _, wall in ipairs(folder:GetChildren()) do
				if wall:IsA("BasePart") and string.find(wall.Name, "Wall") then
					wall.Color = style.color
					wall.Material = style.material
					wall.Transparency = if wall.Name == "NorthWall" then 0.35 else 0.12
					if wall.Name == "NorthWall" then
						wall.Size = Vector3.new(wall.Size.X, 12, wall.Size.Z)
						wall.Position = Vector3.new(wall.Position.X, 7, wall.Position.Z)
					end
				end
			end
		end
	end

	local facade = signoff:FindFirstChild("LobbyPortalFacades")
	local back = facade and facade:FindFirstChild("Lobby_BackSightlineWall")
	if back and back:IsA("BasePart") then
		back.Color = Color3.fromRGB(114, 134, 148)
		back.Material = Enum.Material.Concrete
		back.Transparency = 0.7
		back.Size = Vector3.new(back.Size.X, 3, back.Size.Z)
		back.Position = Vector3.new(back.Position.X, 2.4, back.Position.Z)
	end
end

local function addLobbyGuides()
	disableOldLobbyLabels()
	softenRoomWalls()

	local lanes = {
		{ name = "MedievalLane", x = -20, color = Color3.fromRGB(172, 102, 45) },
		{ name = "SciFiLane", x = 0, color = Color3.fromRGB(37, 184, 220) },
		{ name = "CabinLane", x = 20, color = Color3.fromRGB(79, 162, 91) },
	}
	for _, lane in ipairs(lanes) do
		makePart(lane.name .. "_FloorGuide", fixes, Vector3.new(14, 0.08, 24), CFrame.new(lane.x, 1.08, -37), lane.color, Enum.Material.Neon, 0.72, false)
		makePart(lane.name .. "_LowRailLeft", fixes, Vector3.new(0.5, 1.4, 20), CFrame.new(lane.x - 8, 1.8, -36), Color3.fromRGB(34, 34, 40), Enum.Material.Metal, 0.15, false)
		makePart(lane.name .. "_LowRailRight", fixes, Vector3.new(0.5, 1.4, 20), CFrame.new(lane.x + 8, 1.8, -36), Color3.fromRGB(34, 34, 40), Enum.Material.Metal, 0.15, false)
	end

	makePart("Lobby_SpawnArrow", fixes, Vector3.new(8, 0.12, 18), CFrame.new(0, 1.11, -46), Color3.fromRGB(255, 255, 255), Enum.Material.Neon, 0.82, false)
	makeBillboard("Medieval", "MEDIEVAL MARKET\nQUEUE 2-8", Vector3.new(-20, 9.2, -31), Color3.fromRGB(172, 102, 45))
	makeBillboard("SciFi", "SCI-FI LAB\nQUEUE 2-8", Vector3.new(0, 9.2, -31), Color3.fromRGB(37, 184, 220))
	makeBillboard("Cabin", "COZY CABIN\nQUEUE 2-8", Vector3.new(20, 9.2, -31), Color3.fromRGB(79, 162, 91))
	makeBillboard("LobbyHeader", "CHOOSE A ROOM", Vector3.new(0, 13.2, -31), Color3.fromRGB(35, 43, 51))
end

local function cloneFromFolder(folder: Instance?, templateName: string, newName: string, cframe: CFrame): boolean
	if not folder then
		return false
	end
	local template = folder:FindFirstChild(templateName)
	if not template then
		return false
	end
	local old = folder:FindFirstChild(newName)
	if old then
		old:Destroy()
	end
	local clone = template:Clone()
	clone.Name = newName
	clone.Parent = folder
	anchorAll(clone)
	if clone:IsA("Model") then
		clone:PivotTo(cframe)
	elseif clone:IsA("BasePart") then
		clone.CFrame = cframe
	end
	return true
end

local function addAssetDensity()
	local hideables = Workspace:FindFirstChild("HideableProps")
	if hideables then
		for _, child in ipairs(hideables:GetChildren()) do
			if string.find(child.Name, "^Working_")
				or child.Name == "Chair_C_1"
				or child.Name == "Chair_C_2"
			then
				child:Destroy()
			end
		end
	end

	local hideablePlacements = {
		{ "Barrel_M_1", "Working_Barrel_Mid_M1", CFrame.new(-132, 1, -10) * CFrame.Angles(0, math.rad(25), 0) },
		{ "Crate_M_1", "Working_Crate_Mid_M1", CFrame.new(-118, 1, 4) * CFrame.Angles(0, math.rad(-15), 0) },
		{ "HayBale_M_1", "Working_Hay_Mid_M1", CFrame.new(-98, 1, 20) * CFrame.Angles(0, math.rad(40), 0) },
		{ "Basket_M_1", "Working_Basket_Mid_M1", CFrame.new(-78, 1, -8) * CFrame.Angles(0, math.rad(15), 0) },
		{ "GrainSack_M_1", "Working_Sack_Mid_M1", CFrame.new(-66, 1, 16) * CFrame.Angles(0, math.rad(-30), 0) },
		{ "Locker_S_1", "Working_Locker_Cover_S2", CFrame.new(-18, 1, 15) * CFrame.Angles(0, math.rad(90), 0) },
		{ "Monitor_S_1", "Working_Monitor_Cover_S2", CFrame.new(20, 1, 8) * CFrame.Angles(0, math.rad(-20), 0) },
		{ "Monitor_S_2", "Working_Monitor_Cover_S3", CFrame.new(34, 1, 30) * CFrame.Angles(0, math.rad(-35), 0) },
		{ "Crate_C_1", "Working_Crate_Mid_C1", CFrame.new(76, 1, -12) * CFrame.Angles(0, math.rad(22), 0) },
		{ "Firewood_C_1", "Working_Firewood_Mid_C1", CFrame.new(114, 1, -10) * CFrame.Angles(0, math.rad(30), 0) },
		{ "Stump_C_1", "Working_Stump_Mid_C1", CFrame.new(128, 1, 8) * CFrame.Angles(0, math.rad(18), 0) },
		{ "Mushroom_C_1", "Working_Mushroom_Mid_C1", CFrame.new(146, 1, 28) * CFrame.Angles(0, math.rad(-25), 0) },
	}
	for _, item in ipairs(hideablePlacements) do
		cloneFromFolder(hideables, item[1], item[2], item[3])
	end

	local worlds = Workspace:FindFirstChild("Worlds")
	local medieval = worlds and worlds:FindFirstChild("MedievalMarket")
	for _, item in ipairs({
		{ "Cart_1", "WorkingMarket_NearCart_A", CFrame.new(-128, 3, -32) * CFrame.Angles(0, math.rad(-20), 0) },
		{ "OakTree_1", "WorkingMarket_NearTree_A", CFrame.new(-150, 7, -10) * CFrame.Angles(0, math.rad(35), 0) },
		{ "CastleWall_1", "WorkingMarket_NearWall_A", CFrame.new(-114, 5, -26) * CFrame.Angles(0, math.rad(90), 0) },
		{ "LampPost_3", "WorkingMarket_NearLamp_A", CFrame.new(-122, 5, -12) * CFrame.Angles(0, math.rad(20), 0) },
		{ "LampPost_2", "WorkingMarket_Lamp_East", CFrame.new(-70, 5, 12) * CFrame.Angles(0, math.rad(-90), 0) },
	}) do
		cloneFromFolder(medieval, item[1], item[2], item[3])
	end
	if medieval then
		for _, child in ipairs(medieval:GetChildren()) do
			if string.find(child.Name, "WorkingMarket_") and string.find(string.lower(child.Name), "well") then
				child:Destroy()
			end
		end
	end
end

local function removeBadCabinCover()
	local cabinCover = Workspace:FindFirstChild("CabinVerticalCover", true)
	if cabinCover then
		cabinCover:Destroy()
	end
	local npcs = Workspace:FindFirstChild("NPCs")
	local dog = npcs and npcs:FindFirstChild("Dog_1")
	if dog and dog:IsA("Model") then
		pcall(function()
			dog:ScaleTo(0.55)
		end)
		dog:PivotTo(CFrame.new(124, 1.6, 30) * CFrame.Angles(0, math.rad(-35), 0))
		anchorAll(dog)
	end
end

local function recolorProblemAssets()
	local worlds = Workspace:FindFirstChild("Worlds")
	local scifi = worlds and worlds:FindFirstChild("SciFiLab")
	if scifi then
		for _, child in ipairs(scifi:GetDescendants()) do
			if child:IsA("BasePart") and string.find(child:GetFullName(), "Console_") and child.Name == "Part" then
				child.Color = Color3.fromRGB(35, 50, 66)
				child.Material = Enum.Material.Metal
			end
		end
	end

	local cabin = worlds and worlds:FindFirstChild("CozyCabin")
	local shell = cabin and cabin:FindFirstChild("CabinShell_1")
	if shell then
		for _, child in ipairs(shell:GetDescendants()) do
			if child:IsA("BasePart") and child.Color.R + child.Color.G + child.Color.B < 0.35 then
				child.Color = Color3.fromRGB(88, 58, 36)
				child.Material = Enum.Material.WoodPlanks
			end
		end
	end
end

addLobbyGuides()
addAssetDensity()
removeBadCabinCover()
recolorProblemAssets()

print("[VisualReviewFixes] Applied working-copy visual fixes. Run player-height screenshots before promoting to Place1.rbxl.")
