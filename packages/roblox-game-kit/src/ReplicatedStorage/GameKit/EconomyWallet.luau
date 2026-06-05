--!strict

local EconomyWallet = {}

export type Amounts = { [string]: number }

local function amount(value: any): number
	if type(value) == "number" and value == value then
		return value
	end
	return 0
end

function EconomyWallet.canAfford(profile: { [string]: any }, costs: Amounts): (boolean, string?)
	for currency, cost in pairs(costs or {}) do
		if amount(profile[currency]) < amount(cost) then
			return false, currency
		end
	end
	return true, nil
end

function EconomyWallet.spend(profile: { [string]: any }, costs: Amounts): (boolean, string?)
	local ok, missing = EconomyWallet.canAfford(profile, costs)
	if not ok then
		return false, missing
	end
	for currency, cost in pairs(costs or {}) do
		profile[currency] = math.max(0, amount(profile[currency]) - amount(cost))
	end
	return true, nil
end

function EconomyWallet.grant(profile: { [string]: any }, rewards: Amounts): { [string]: any }
	for currency, reward in pairs(rewards or {}) do
		profile[currency] = math.max(0, amount(profile[currency]) + amount(reward))
	end
	return profile
end

function EconomyWallet.snapshot(profile: { [string]: any }, currencies: { string }): Amounts
	local out = {}
	for _, currency in ipairs(currencies) do
		out[currency] = amount(profile[currency])
	end
	return out
end

return EconomyWallet
