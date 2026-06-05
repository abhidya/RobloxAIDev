--!strict

local AssetAudit = {}

local DEFAULT_CLASSES = {
	Script = "scripts",
	LocalScript = "scripts",
	ModuleScript = "scripts",
	MeshPart = "meshParts",
	Part = "parts",
	WedgePart = "parts",
	CornerWedgePart = "parts",
	Sound = "sounds",
	ParticleEmitter = "emitters",
	PointLight = "lights",
	SpotLight = "lights",
	SurfaceLight = "lights",
	Decal = "decals",
	SurfaceAppearance = "surfaceAppearances",
	ProximityPrompt = "prompts",
}

function AssetAudit.audit(root: Instance?, classBuckets: { [string]: string }?)
	local buckets = classBuckets or DEFAULT_CLASSES
	local counts = {}
	local scripts = {}
	for _, bucket in pairs(buckets) do
		counts[bucket] = counts[bucket] or 0
	end
	if not root then
		return counts, scripts
	end
	for _, desc in ipairs(root:GetDescendants()) do
		local bucket = buckets[desc.ClassName]
		if bucket then
			counts[bucket] = (counts[bucket] or 0) + 1
			if bucket == "scripts" then
				table.insert(scripts, desc)
			end
		end
	end
	return counts, scripts
end

function AssetAudit.quarantineScripts(root: Instance?, quarantineFolder: Instance?)
	local counts, scripts = AssetAudit.audit(root)
	if quarantineFolder then
		for _, scriptInstance in ipairs(scripts) do
			if scriptInstance:IsA("BaseScript") then
				scriptInstance.Disabled = true
			end
			scriptInstance.Parent = quarantineFolder
		end
	end
	return counts, #scripts
end

return AssetAudit
