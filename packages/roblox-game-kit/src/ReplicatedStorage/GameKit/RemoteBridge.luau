--!strict

local RemoteBridge = {}

export type RemoteDefinitions = { [string]: string }

local DEFAULT_FOLDER = "GameKitRemotes"

function RemoteBridge.ensureFolder(parent: Instance, folderName: string?): Folder
	local name = folderName or DEFAULT_FOLDER
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

function RemoteBridge.setup(parent: Instance, definitions: RemoteDefinitions, folderName: string?): Folder
	local folder = RemoteBridge.ensureFolder(parent, folderName)
	for name, className in pairs(definitions) do
		local existing = folder:FindFirstChild(name)
		if existing and existing.ClassName ~= className then
			existing:Destroy()
			existing = nil
		end
		if not existing then
			local remote = Instance.new(className)
			remote.Name = name
			remote.Parent = folder
		end
	end
	return folder
end

function RemoteBridge.get(parent: Instance, name: string, folderName: string?, timeout: number?): Instance
	local folder = parent:WaitForChild(folderName or DEFAULT_FOLDER, timeout or 30)
	assert(folder ~= nil, "remote folder missing: " .. tostring(folderName or DEFAULT_FOLDER))
	local remote = folder:WaitForChild(name, timeout or 30)
	assert(remote ~= nil, "remote missing: " .. tostring(name))
	return remote
end

return RemoteBridge
