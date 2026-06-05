--!strict

local StatRules = {}

local function clamp(value: number, minValue: number, maxValue: number): number
	return math.max(minValue, math.min(maxValue, value))
end

function StatRules.applyDelta(state: { [string]: any }, statName: string, delta: number, minValue: number?, maxValue: number?): number
	local current = tonumber(state[statName]) or 0
	local nextValue = current + delta
	if minValue ~= nil or maxValue ~= nil then
		nextValue = clamp(nextValue, minValue or -math.huge, maxValue or math.huge)
	end
	state[statName] = nextValue
	return nextValue
end

function StatRules.consume(state: { [string]: any }, statName: string, amount: number): boolean
	local current = tonumber(state[statName]) or 0
	if amount < 0 or current < amount then
		return false
	end
	state[statName] = current - amount
	return true
end

function StatRules.isAlive(state: { [string]: any }, healthName: string?): boolean
	local key = healthName or "Health"
	return (tonumber(state[key]) or 0) > 0 and state.Dead ~= true
end

return StatRules
