--!strict

local ScoringRules = {}

local function clamp(value: number, minValue: number, maxValue: number): number
	return math.max(minValue, math.min(maxValue, value))
end

function ScoringRules.resolveJudgement(offsetSeconds: number, windows: { [string]: number }): string
	local absValue = math.abs(offsetSeconds)
	if absValue <= (windows.Perfect or 0.05) then
		return "Perfect"
	end
	if absValue <= (windows.Good or 0.12) then
		return "Good"
	end
	if absValue <= (windows.Accept or 0.25) then
		return "Miss"
	end
	return "Reject"
end

function ScoringRules.scoreValue(judgement: string, values: { [string]: number }): number
	if judgement == "Perfect" then
		return values.Perfect or 100
	end
	if judgement == "Good" then
		return values.Good or 60
	end
	return values.Miss or 0
end

function ScoringRules.multiplier(combo: number, step: number, increase: number, maxValue: number): number
	local tier = math.floor(math.max(0, combo) / math.max(1, step))
	return clamp(1 + tier * increase, 1, maxValue)
end

function ScoringRules.grade(percent: number, grades: { [string]: number }): string
	if percent >= (grades.S or 95) then
		return "S"
	end
	if percent >= (grades.A or 85) then
		return "A"
	end
	if percent >= (grades.B or 70) then
		return "B"
	end
	if percent >= (grades.C or 55) then
		return "C"
	end
	return "D"
end

function ScoringRules.accuracyPercent(points: number, totalNotes: number, perfectScore: number): number
	local possible = math.max(1, totalNotes * perfectScore)
	return clamp((points / possible) * 100, 0, 100)
end

return ScoringRules
