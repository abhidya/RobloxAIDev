--!strict
-- Headless Roblox fragment coordinator.
--
-- Merges validated .rbxm fragment roots into a copied .rbxl place without
-- opening Roblox Studio. Studio remains the visual/player-angle validation gate.

local fs = require("@lune/fs")
local process = require("@lune/process")
local roblox = require("@lune/roblox")
local serde = require("@lune/serde")

local Instance = roblox.Instance

type FragmentRecord = {
	manifestPath: string,
	manifest: any,
	modelPath: string,
	root: Instance,
	targetParent: Instance,
}

local DANGEROUS_SCRIPT_PATTERNS = {
	{
		id = "numeric_require",
		label = "require(assetId)",
		patterns = { "require%s*%(%s*%d%d%d%d%d+%s*%)" },
		reason = "loads opaque third-party module code at runtime",
	},
	{
		id = "insert_service_load_asset",
		label = "InsertService:LoadAsset",
		patterns = { "insertservice%s*:%s*loadasset%s*%(" },
		reason = "pulls new assets during runtime instead of from the reviewed fragment",
	},
	{
		id = "loadstring",
		label = "loadstring",
		patterns = { "loadstring%s*%(" },
		reason = "executes dynamic code that cannot be reviewed in the fragment",
	},
	{
		id = "http_get_post",
		label = "HttpService request",
		patterns = {
			"httpservice%s*:%s*getasync%s*%(",
			"httpservice%s*:%s*postasync%s*%(",
			"httpservice%s*:%s*requestasync%s*%(",
		},
		reason = "performs external network calls from imported content",
	},
}

local function fail(message: string): never
	error("HEADLESS_FRAGMENT_MERGE_FAIL " .. message, 0)
end

local function usage(): never
	print([[
Usage:
  lune run scripts/headless_fragment_merge.luau --place input.rbxl --out output.rbxl --fragment fragment.manifest.json [--fragment ...]

Options:
  --create-missing-targets  Create missing target folders below Roblox services.
  --replace-existing        Replace existing roots with the same fragment id or root name.
  --json                    Print a JSON summary instead of a text summary.

Fragment manifest essentials:
  model_path or output_model
  fragment_id, target_parent, order_key, single_root=true or roots[1]
  source_digest (sha1:, sha256:, or sha512:)
  asset_ids
  identity_policy.referents="coordinator_remap"
  identity_policy.unique_ids="strip" or "coordinator_generate"
]])
	process.exit(1)
end

local function parseArgs(args: { string })
	local options = {
		place = "",
		out = "",
		fragments = {},
		createMissingTargets = false,
		replaceExisting = false,
		json = false,
	}

	local i = 1
	while i <= #args do
		local arg = args[i]
		if arg == "--place" then
			i += 1
			options.place = args[i] or ""
		elseif arg == "--out" then
			i += 1
			options.out = args[i] or ""
		elseif arg == "--fragment" then
			i += 1
			table.insert(options.fragments, args[i] or "")
		elseif arg == "--create-missing-targets" then
			options.createMissingTargets = true
		elseif arg == "--replace-existing" then
			options.replaceExisting = true
		elseif arg == "--json" then
			options.json = true
		elseif arg == "--help" or arg == "-h" then
			usage()
		else
			fail("unknown argument: " .. tostring(arg))
		end
		i += 1
	end

	if options.place == "" or options.out == "" or #options.fragments == 0 then
		usage()
	end

	return options
end

local function readJson(path: string)
	local ok, value = pcall(function()
		return serde.decode("json", fs.readFile(path))
	end)
	if not ok then
		fail("could not parse JSON manifest " .. path .. ": " .. tostring(value))
	end
	if typeof(value) ~= "table" then
		fail("manifest must be a JSON object: " .. path)
	end
	return value
end

local function stringField(value: any): string
	if typeof(value) == "string" then
		return string.gsub(value, "^%s*(.-)%s*$", "%1")
	end
	return ""
end

local function isArray(value: any): boolean
	if typeof(value) ~= "table" then
		return false
	end
	for key in value do
		if typeof(key) ~= "number" then
			return false
		end
	end
	return true
end

local function basename(path: string): string
	return string.match(path, "([^/\\]+)$") or path
end

local function dirname(path: string): string
	return string.match(path, "^(.*[/\\])") or ""
end

local function isAbsolutePath(path: string): boolean
	return string.sub(path, 1, 1) == "/" or string.match(path, "^%a:[/\\]") ~= nil
end

local function resolveRelative(anchorPath: string, path: string): string
	if isAbsolutePath(path) then
		return path
	end
	if fs.isFile(path) then
		return path
	end
	return dirname(anchorPath) .. path
end

local function splitPath(path: string): { string }
	local normalized = string.gsub(path, "^game[%.\\/]", "")
	local parts = {}
	for part in string.gmatch(normalized, "[^%.\\/]+") do
		if part ~= "" then
			table.insert(parts, part)
		end
	end
	return parts
end

local function getService(game: any, serviceName: string): Instance?
	local ok, service = pcall(function()
		return game:GetService(serviceName)
	end)
	if ok then
		return service
	end
	return nil
end

local function resolveTargetParent(game: any, path: string, createMissingTargets: boolean): Instance
	local parts = splitPath(path)
	if #parts == 0 then
		fail("target_parent is empty")
	end

	local current = getService(game, parts[1])
	if current == nil then
		fail("target_parent service not found: " .. parts[1])
	end

	for index = 2, #parts do
		local name = parts[index]
		local child = current:FindFirstChild(name)
		if child == nil then
			if not createMissingTargets then
				fail("target_parent path missing '" .. name .. "' in " .. path)
			end
			child = Instance.new("Folder")
			child.Name = name
			child.Parent = current
		end
		current = child
	end

	return current
end

local function normalizeIdentityPolicy(manifest: any)
	local raw = manifest.identity_policy or manifest.identityPolicy or {}
	if typeof(raw) ~= "table" then
		raw = {}
	end
	return {
		referents = stringField(raw.referents or raw.referent_policy or manifest.referents_remapped_by),
		unique_ids = stringField(raw.unique_ids or raw.unique_id_policy or manifest.unique_id_policy),
		history_ids = stringField(raw.history_ids or raw.history_id_policy or manifest.history_id_policy),
	}
end

local function getAssetIds(manifest: any): any
	return manifest.asset_ids or manifest.assetIds
end

local function getRoots(manifest: any): { any }
	if isArray(manifest.roots) then
		return manifest.roots
	end
	return {}
end

local function getExternalAnchors(manifest: any): { any }
	if isArray(manifest.external_anchors) then
		return manifest.external_anchors
	end
	if isArray(manifest.external_references) then
		return manifest.external_references
	end
	return {}
end

local function buildApprovedPatternSet(manifest: any): { [string]: boolean }
	local approved = {}
	local function addList(list: any)
		if isArray(list) then
			for _, id in list do
				approved[tostring(id)] = true
			end
		end
	end
	addList(manifest.approved_dangerous_patterns)
	if typeof(manifest.safety) == "table" then
		addList(manifest.safety.approved_dangerous_patterns)
	end
	return approved
end

local function checkDigest(manifestPath: string, manifest: any, modelBytes: string)
	local digest = stringField(manifest.source_digest or manifest.sourceDigest)
	local algorithm, expected = string.match(digest, "^(sha%d+):([0-9a-fA-F]+)$")
	if algorithm == nil or expected == nil then
		fail("source_digest must use sha1:, sha256:, or sha512: in " .. basename(manifestPath))
	end
	if algorithm ~= "sha1" and algorithm ~= "sha256" and algorithm ~= "sha512" then
		fail("unsupported source_digest algorithm " .. algorithm .. " in " .. basename(manifestPath))
	end

	local ok, actual = pcall(function()
		return serde.hash(algorithm, modelBytes)
	end)
	if not ok then
		fail("could not hash " .. basename(manifestPath) .. ": " .. tostring(actual))
	end
	if string.lower(actual) ~= string.lower(expected) then
		fail(
			"source_digest mismatch for "
				.. basename(manifestPath)
				.. ": expected "
				.. string.lower(expected)
				.. " got "
				.. string.lower(actual)
		)
	end
end

local function collectManifestScriptSources(manifest: any): { any }
	local sources = {}
	if isArray(manifest.scripts) then
		for _, scriptValue in manifest.scripts do
			if typeof(scriptValue) == "string" then
				table.insert(sources, { label = "manifest.scripts[]", source = scriptValue })
			elseif typeof(scriptValue) == "table" and typeof(scriptValue.source) == "string" then
				local label = stringField(scriptValue.path or scriptValue.name)
				table.insert(sources, {
					label = if label ~= "" then label else "manifest.scripts[].source",
					source = scriptValue.source,
				})
			end
		end
	end
	local scriptSources = manifest.script_sources or manifest.scriptSources
	if typeof(scriptSources) == "table" then
		for label, source in scriptSources do
			if typeof(source) == "string" then
				table.insert(sources, { label = tostring(label), source = source })
			end
		end
	end
	return sources
end

local function isScriptInstance(instance: Instance): boolean
	return instance:IsA("Script") or instance:IsA("LocalScript") or instance:IsA("ModuleScript")
end

local function collectInstanceScriptSources(root: Instance): { any }
	local sources = {}
	local function visit(instance: Instance)
		if isScriptInstance(instance) then
			local ok, source = pcall(function()
				return (instance :: any).Source
			end)
			if ok and typeof(source) == "string" then
				table.insert(sources, { label = instance:GetFullName(), source = source })
			end
		end
	end
	visit(root)
	for _, descendant in root:GetDescendants() do
		visit(descendant)
	end
	return sources
end

local function checkDangerousScripts(manifestPath: string, manifest: any, sources: { any }): { string }
	local warnings = {}
	local approved = buildApprovedPatternSet(manifest)

	for _, scriptSource in sources do
		local lower = string.lower(scriptSource.source)
		for _, pattern in DANGEROUS_SCRIPT_PATTERNS do
			for _, luaPattern in pattern.patterns do
				if string.find(lower, luaPattern) ~= nil then
					local message = tostring(scriptSource.label) .. " matches " .. pattern.label .. ": " .. pattern.reason
					if approved[pattern.id] then
						table.insert(warnings, "approved dangerous script pattern in " .. basename(manifestPath) .. ": " .. message)
					else
						fail("dangerous script in " .. basename(manifestPath) .. ": " .. message)
					end
				end
			end
		end
	end

	return warnings
end

local function validateManifestShape(manifestPath: string, manifest: any)
	local fragmentId = stringField(manifest.fragment_id or manifest.fragmentId)
	local targetParent = stringField(manifest.target_parent or manifest.targetParent)
	local orderKey = stringField(manifest.order_key or manifest.orderKey)
	local sourceDigest = stringField(manifest.source_digest or manifest.sourceDigest)
	local roots = getRoots(manifest)
	local singleRoot = manifest.single_root == true or manifest.singleRoot == true or #roots == 1
	local assetIds = getAssetIds(manifest)
	local identityPolicy = normalizeIdentityPolicy(manifest)
	local modelPath = stringField(manifest.model_path or manifest.modelPath or manifest.output_model or manifest.outputModel)

	if fragmentId == "" then
		fail("fragment_id is required in " .. basename(manifestPath))
	end
	if targetParent == "" then
		fail("target_parent is required in " .. basename(manifestPath))
	end
	if orderKey == "" then
		fail("order_key is required in " .. basename(manifestPath))
	end
	if sourceDigest == "" then
		fail("source_digest is required in " .. basename(manifestPath))
	end
	if modelPath == "" then
		fail("model_path or output_model is required in " .. basename(manifestPath))
	end
	if not singleRoot then
		fail("fragment must declare single_root=true or exactly one root in " .. basename(manifestPath))
	end
	if not isArray(assetIds) then
		fail("asset_ids array is required in " .. basename(manifestPath))
	end
	for _, assetId in assetIds do
		local value = tostring(assetId)
		if typeof(assetId) ~= "number" and not string.match(value, "^%d+$") then
			fail("asset_ids must contain numeric ids only in " .. basename(manifestPath) .. ": " .. value)
		end
	end
	if identityPolicy.referents ~= "coordinator_remap" and identityPolicy.referents ~= "coordinator" then
		fail("identity_policy.referents must be coordinator_remap in " .. basename(manifestPath))
	end
	if identityPolicy.unique_ids ~= "strip" and identityPolicy.unique_ids ~= "coordinator_generate" then
		fail("identity_policy.unique_ids must be strip or coordinator_generate in " .. basename(manifestPath))
	end
	if identityPolicy.history_ids ~= "" and identityPolicy.history_ids ~= "strip" and identityPolicy.history_ids ~= "coordinator_generate" then
		fail("identity_policy.history_ids must be strip or coordinator_generate in " .. basename(manifestPath))
	end
	if manifest.preserve_referents == true or manifest.raw_referents ~= nil or manifest.referent_map ~= nil or manifest.referents ~= nil then
		fail("raw referents/referent maps must not be preserved in " .. basename(manifestPath))
	end
	if (manifest.uses_external_refs == true or manifest.usesExternalRefs == true) and #getExternalAnchors(manifest) == 0 then
		fail("external references must be declared in external_anchors/external_references in " .. basename(manifestPath))
	end
end

local function getFragmentSortKey(record: FragmentRecord): string
	local manifest = record.manifest
	return stringField(manifest.target_parent or manifest.targetParent)
		.. "\t"
		.. stringField(manifest.order_key or manifest.orderKey)
		.. "\t"
		.. stringField(manifest.fragment_id or manifest.fragmentId)
end

local function getRootNameManifest(manifest: any): string
	local rootName = stringField(manifest.root_name or manifest.rootName)
	if rootName ~= "" then
		return rootName
	end
	local roots = getRoots(manifest)
	if #roots == 1 and typeof(roots[1]) == "string" then
		return stringField(roots[1])
	end
	return ""
end

local function decodeModel(manifestPath: string, modelBytes: string): { Instance }
	local ok, instances = pcall(function()
		return roblox.deserializeModel(modelBytes)
	end)
	if not ok then
		fail("could not deserialize model for " .. basename(manifestPath) .. ": " .. tostring(instances))
	end
	if #instances ~= 1 then
		fail("fragment must deserialize to exactly one root in " .. basename(manifestPath) .. "; got " .. tostring(#instances))
	end
	return instances
end

local function setAttributeIfAvailable(instance: Instance, name: string, value: any)
	pcall(function()
		instance:SetAttribute(name, value)
	end)
end

local function stringifyAssetIds(assetIds: any): string
	if not isArray(assetIds) then
		return ""
	end
	local values = {}
	for _, id in assetIds do
		table.insert(values, tostring(id))
	end
	return table.concat(values, ",")
end

local function getAttribute(instance: Instance, name: string): any
	local ok, value = pcall(function()
		return instance:GetAttribute(name)
	end)
	if ok then
		return value
	end
	return nil
end

local function findExistingRoot(parent: Instance, fragmentId: string, rootName: string): Instance?
	for _, child in parent:GetChildren() do
		if getAttribute(child, "HeadlessFragmentId") == fragmentId or child.Name == rootName then
			return child
		end
	end
	return nil
end

local options = parseArgs(process.args)

if not fs.isFile(options.place) then
	fail("input place not found: " .. options.place)
end

local game = roblox.deserializePlace(fs.readFile(options.place))
local records: { FragmentRecord } = {}
local allWarnings = {}

for _, manifestPath in options.fragments do
	if manifestPath == "" then
		fail("empty --fragment path")
	end
	if not fs.isFile(manifestPath) then
		fail("fragment manifest not found: " .. manifestPath)
	end

	local manifest = readJson(manifestPath)
	validateManifestShape(manifestPath, manifest)

	local modelPath = resolveRelative(manifestPath, stringField(manifest.model_path or manifest.modelPath or manifest.output_model or manifest.outputModel))
	if not fs.isFile(modelPath) then
		fail("fragment model not found for " .. basename(manifestPath) .. ": " .. modelPath)
	end

	local modelBytes = fs.readFile(modelPath)
	checkDigest(manifestPath, manifest, modelBytes)

	local instances = decodeModel(manifestPath, modelBytes)
	local root = instances[1]
	local expectedRootName = getRootNameManifest(manifest)
	if expectedRootName ~= "" and root.Name ~= expectedRootName then
		fail("root name mismatch in " .. basename(manifestPath) .. ": expected " .. expectedRootName .. " got " .. root.Name)
	end

	for _, warning in checkDangerousScripts(manifestPath, manifest, collectManifestScriptSources(manifest)) do
		table.insert(allWarnings, warning)
	end
	for _, warning in checkDangerousScripts(manifestPath, manifest, collectInstanceScriptSources(root)) do
		table.insert(allWarnings, warning)
	end

	table.insert(records, {
		manifestPath = manifestPath,
		manifest = manifest,
		modelPath = modelPath,
		root = root,
		targetParent = resolveTargetParent(game, stringField(manifest.target_parent or manifest.targetParent), options.createMissingTargets),
	})
end

table.sort(records, function(a, b)
	return getFragmentSortKey(a) < getFragmentSortKey(b)
end)

local orderClaims = {}
for _, record in records do
	local manifest = record.manifest
	local claimKey = stringField(manifest.target_parent or manifest.targetParent) .. "\t" .. stringField(manifest.order_key or manifest.orderKey)
	local previousFragmentId = orderClaims[claimKey]
	if previousFragmentId ~= nil and manifest.allow_same_order ~= true and manifest.allowSameOrder ~= true then
		fail(
			"duplicate target_parent/order_key claim between "
				.. previousFragmentId
				.. " and "
				.. stringField(manifest.fragment_id or manifest.fragmentId)
		)
	end
	orderClaims[claimKey] = stringField(manifest.fragment_id or manifest.fragmentId)
end

local inserted = {}
for _, record in records do
	local manifest = record.manifest
	local fragmentId = stringField(manifest.fragment_id or manifest.fragmentId)
	local root = record.root
	local replaceExisting = options.replaceExisting or manifest.replace_existing == true or manifest.replaceExisting == true
	local existing = findExistingRoot(record.targetParent, fragmentId, root.Name)
	if existing ~= nil then
		if not replaceExisting then
			fail("target already contains root for " .. fragmentId .. " (" .. root.Name .. "); pass --replace-existing or set replace_existing=true")
		end
		existing:Destroy()
	end

	setAttributeIfAvailable(root, "HeadlessFragmentId", fragmentId)
	setAttributeIfAvailable(root, "HeadlessOrderKey", stringField(manifest.order_key or manifest.orderKey))
	setAttributeIfAvailable(root, "HeadlessSourceDigest", stringField(manifest.source_digest or manifest.sourceDigest))
	setAttributeIfAvailable(root, "HeadlessAssetIds", stringifyAssetIds(getAssetIds(manifest)))
	setAttributeIfAvailable(root, "HeadlessMergedBy", "scripts/headless_fragment_merge.luau")
	root.Parent = record.targetParent

	table.insert(inserted, {
		fragment_id = fragmentId,
		root_name = root.Name,
		target_parent = stringField(manifest.target_parent or manifest.targetParent),
		order_key = stringField(manifest.order_key or manifest.orderKey),
		model_path = record.modelPath,
	})
end

fs.writeFile(options.out, roblox.serializePlace(game))

local reloadOk, reloadResult = pcall(function()
	roblox.deserializePlace(fs.readFile(options.out))
end)
if not reloadOk then
	fail("output place failed reload validation: " .. tostring(reloadResult))
end

local summary = {
	input_place = options.place,
	output_place = options.out,
	fragments = inserted,
	warnings = allWarnings,
}

if options.json then
	print(serde.encode("json", summary))
else
	print(string.format(
		"HEADLESS_FRAGMENT_MERGE_OK input=%s output=%s fragments=%d warnings=%d",
		options.place,
		options.out,
		#inserted,
		#allWarnings
	))
	for _, insertedFragment in inserted do
		print(string.format(
			"- %s -> %s/%s (%s)",
			insertedFragment.fragment_id,
			insertedFragment.target_parent,
			insertedFragment.root_name,
			insertedFragment.order_key
		))
	end
	for _, warning in allWarnings do
		print("WARN: " .. warning)
	end
end
