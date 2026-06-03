--!strict
-- Headless Roblox place mutation POC.
--
-- This script intentionally uses Lune's Roblox DOM APIs, not Roblox Studio:
-- 1. Load a copied .rbxl place.
-- 2. Create and serialize a standalone .rbxm model subtree.
-- 3. Read/deserialze the model subtree back from disk.
-- 4. Insert the subtree into Workspace.
-- 5. Write a new .rbxl place that Studio can open.

local fs = require("@lune/fs")
local process = require("@lune/process")
local roblox = require("@lune/roblox")

local Instance = roblox.Instance
local Color3 = roblox.Color3
local CFrame = roblox.CFrame
local Vector3 = roblox.Vector3
local Enum = roblox.Enum

local args = process.args
local inputPlace = args[1] or "work/headless-poc/Place1.headless-working.rbxl"
local outputModel = args[2] or "work/headless-poc/generated-headless-marker.rbxm"
local outputPlace = args[3] or "work/headless-poc/Place1.headless-mutated.rbxl"

local function makePart(name: string, size: Vector3, cframe: CFrame, color: Color3, material)
	local part = Instance.new("Part")
	part.Name = name
	part.Anchored = true
	part.Size = size
	part.CFrame = cframe
	part.Color = color
	part.Material = material
	return part
end

local function makeModelSubtree()
	local model = Instance.new("Model")
	model.Name = "HeadlessGeneratedMarker"

	local base = makePart(
		"Base",
		Vector3.new(12, 1, 12),
		CFrame.new(0, 8, -72),
		Color3.fromRGB(42, 62, 92),
		Enum.Material.Metal
	)
	base.Parent = model

	local pillar = makePart(
		"Pillar",
		Vector3.new(3, 10, 3),
		CFrame.new(0, 13.5, -72),
		Color3.fromRGB(85, 180, 255),
		Enum.Material.Neon
	)
	pillar.Parent = model

	local label = makePart(
		"LabelPanel",
		Vector3.new(14, 4, 0.4),
		CFrame.new(0, 18, -66) * CFrame.Angles(0, math.rad(180), 0),
		Color3.fromRGB(20, 22, 28),
		Enum.Material.SmoothPlastic
	)
	label.Parent = model

	local gui = Instance.new("SurfaceGui")
	gui.Name = "HeadlessPocLabel"
	gui.Face = Enum.NormalId.Back
	gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	gui.PixelsPerStud = 40
	gui.Parent = label

	local text = Instance.new("TextLabel")
	text.Name = "Text"
	text.BackgroundTransparency = 1
	text.Size = roblox.UDim2.fromScale(1, 1)
	text.Text = "Inserted headlessly\\nLune + Roblox DOM"
	text.TextColor3 = Color3.fromRGB(255, 255, 255)
	text.TextScaled = true
	text.Parent = gui

	local scriptObject = Instance.new("Script")
	scriptObject.Name = "PlaintextSourceProof"
	scriptObject.Source = "print('[HeadlessGeneratedMarker] Script Source survived file serialization')"
	scriptObject.Parent = model

	return model
end

fs.writeDir("work")
fs.writeDir("work/headless-poc")

local model = makeModelSubtree()
fs.writeFile(outputModel, roblox.serializeModel({ model }))

local placeContents = fs.readFile(inputPlace)
local game = roblox.deserializePlace(placeContents)
local workspace = game:GetService("Workspace")

local existing = workspace:FindFirstChild("HeadlessGeneratedMarker")
if existing then
	existing:Destroy()
end

local modelContents = fs.readFile(outputModel)
local instances = roblox.deserializeModel(modelContents)
for _, instance in instances do
	instance.Parent = workspace
end

fs.writeFile(outputPlace, roblox.serializePlace(game))

local summary = {
	inputPlace = inputPlace,
	outputModel = outputModel,
	outputPlace = outputPlace,
	insertedRoots = #instances,
	workspaceChildren = #workspace:GetChildren(),
}

print(string.format(
	"HEADLESS_POC_OK input=%s model=%s output=%s insertedRoots=%d workspaceChildren=%d",
	summary.inputPlace,
	summary.outputModel,
	summary.outputPlace,
	summary.insertedRoots,
	summary.workspaceChildren
))
