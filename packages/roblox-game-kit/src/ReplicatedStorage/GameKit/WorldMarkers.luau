--!strict

local WorldMarkers = {}

function WorldMarkers.getOrCreateFolder(parent: Instance, name: string): Folder
	local existing = parent:FindFirstChild(name)
	if existing and existing:IsA("Folder") then
		return existing
	end
	if existing then
		existing:Destroy()
	end
	local folder = Instance.new("Folder")
	folder.Name = name
	folder.Parent = parent
	return folder
end

function WorldMarkers.ensureMarkerPart(parent: Instance, name: string, position: Vector3, size: Vector3): BasePart
	local existing = parent:FindFirstChild(name)
	if existing and existing:IsA("BasePart") then
		existing.Position = position
		existing.Size = size
		existing.Transparency = 1
		existing.CanCollide = false
		existing.Anchored = true
		return existing
	end
	if existing then
		existing:Destroy()
	end
	local part = Instance.new("Part")
	part.Name = name
	part.Position = position
	part.Size = size
	part.Transparency = 1
	part.CanCollide = false
	part.Anchored = true
	part.Parent = parent
	return part
end

function WorldMarkers.ensureTeam(teams: Instance, name: string, colorName: string): Team
	local existing = teams:FindFirstChild(name)
	if existing and existing:IsA("Team") then
		existing.AutoAssignable = false
		return existing
	end
	if existing then
		existing:Destroy()
	end
	local team = Instance.new("Team")
	team.Name = name
	team.TeamColor = BrickColor.new(colorName)
	team.AutoAssignable = false
	team.Parent = teams
	return team
end

return WorldMarkers
