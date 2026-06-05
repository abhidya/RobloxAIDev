--!strict

local function deepCopy(value: any, seen: { [any]: any }?): any
	if type(value) ~= "table" then
		return value
	end

	local visited = seen or {}
	if visited[value] then
		return visited[value]
	end

	local copy = {}
	visited[value] = copy
	for key, child in pairs(value) do
		copy[deepCopy(key, visited)] = deepCopy(child, visited)
	end
	return copy
end

return deepCopy
