--!strict

local PlacementRules = {}

local function abs(value: number): number
	if value < 0 then
		return -value
	end
	return value
end

function PlacementRules.insideRect(position: Vector3, center: Vector3, size: Vector3, clearance: number?): boolean
	local extra = clearance or 0
	return abs(position.X - center.X) <= (size.X / 2 + extra)
		and abs(position.Z - center.Z) <= (size.Z / 2 + extra)
end

function PlacementRules.nearRectEdge(position: Vector3, center: Vector3, size: Vector3, edgeDistance: number?): boolean
	local distance = edgeDistance or 110
	local xOffset = abs(position.X - center.X)
	local zOffset = abs(position.Z - center.Z)
	return xOffset >= (size.X / 2 - distance) or zOffset >= (size.Z / 2 - distance)
end

function PlacementRules.validate(plan: { any }, profile: any)
	local failures = {}
	local seen = {}
	local byZone = {}
	local categoryCoverage = {}
	local zones = profile.zones or {}
	local routes = profile.routes or {}
	local rules = profile.categoryRules or {}
	local requiredCategories = profile.requiredCategories or {}
	local routeClearance = profile.routeClearanceStuds or 0

	for _, record in ipairs(plan or {}) do
		local id = tostring(record.id or "")
		if id == "" or seen[id] then
			table.insert(failures, "placement id missing or duplicated")
		else
			seen[id] = true
		end

		local zone = zones[record.zone or record.biome]
		if not zone then
			table.insert(failures, id .. " unknown zone " .. tostring(record.zone or record.biome))
		elseif typeof(record.position) ~= "Vector3" then
			table.insert(failures, id .. " missing Vector3 position")
		elseif not PlacementRules.insideRect(record.position, zone.center, zone.size, 0) then
			table.insert(failures, id .. " outside zone " .. tostring(record.zone or record.biome))
		else
			for _, route in ipairs(routes) do
				if PlacementRules.insideRect(record.position, route.center, route.size, routeClearance) then
					table.insert(failures, id .. " blocks route corridor " .. tostring(route.name))
				end
			end
		end

		local categoryRules = rules[record.zone or record.biome]
		if categoryRules then
			if categoryRules.forbidden and categoryRules.forbidden[record.category] then
				table.insert(failures, id .. " forbidden category " .. tostring(record.category))
			end
			if categoryRules.allowed and not categoryRules.allowed[record.category] then
				table.insert(failures, id .. " category not allowed " .. tostring(record.category))
			end
			if categoryRules.edgeCategories and categoryRules.edgeCategories[record.category] and zone and typeof(record.position) == "Vector3" then
				if not PlacementRules.nearRectEdge(record.position, zone.center, zone.size, profile.edgeDistanceStuds) then
					table.insert(failures, id .. " should be an edge placement")
				end
			end
		end

		local zoneId = record.zone or record.biome
		byZone[zoneId] = byZone[zoneId] or {}
		table.insert(byZone[zoneId], record)
		categoryCoverage[zoneId] = categoryCoverage[zoneId] or {}
		categoryCoverage[zoneId][record.category] = true
	end

	for zoneId, categories in pairs(requiredCategories) do
		for _, category in ipairs(categories) do
			if not categoryCoverage[zoneId] or not categoryCoverage[zoneId][category] then
				table.insert(failures, tostring(zoneId) .. " missing required category " .. tostring(category))
			end
		end
	end

	return {
		passed = #failures == 0,
		failures = failures,
		total = #(plan or {}),
		byZone = byZone,
	}
end

return PlacementRules
