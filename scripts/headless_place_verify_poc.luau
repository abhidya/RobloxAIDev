--!strict
-- Verifies the output from headless_place_insert_poc.luau reloads without Studio.

local fs = require("@lune/fs")
local process = require("@lune/process")
local roblox = require("@lune/roblox")

local args = process.args
local placePath = args[1] or "work/headless-poc/Place1.headless-mutated.rbxl"

local game = roblox.deserializePlace(fs.readFile(placePath))
local workspace = game:GetService("Workspace")
local marker = workspace:FindFirstChild("HeadlessGeneratedMarker")
assert(marker ~= nil, "HeadlessGeneratedMarker missing from Workspace")

local scriptObject = marker:FindFirstChild("PlaintextSourceProof")
assert(scriptObject ~= nil and scriptObject:IsA("Script"), "PlaintextSourceProof script missing")
assert(
	string.find(scriptObject.Source, "Script Source survived", 1, true) ~= nil,
	"script Source did not survive serialization"
)

print(string.format(
	"HEADLESS_VERIFY_OK place=%s markerChildren=%d scriptSourceBytes=%d",
	placePath,
	#marker:GetChildren(),
	#scriptObject.Source
))
