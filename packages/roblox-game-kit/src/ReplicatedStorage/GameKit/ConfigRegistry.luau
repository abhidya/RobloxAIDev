--!strict

local deepCopy = require(script.Parent.DeepCopy)

local ConfigRegistry = {}
ConfigRegistry.__index = ConfigRegistry

function ConfigRegistry.new()
	return setmetatable({
		_configs = {},
	}, ConfigRegistry)
end

function ConfigRegistry:register(name: string, config: any)
	assert(type(name) == "string" and name ~= "", "config name required")
	self._configs[name] = deepCopy(config)
	return self
end

function ConfigRegistry:get(name: string): any
	local config = self._configs[name]
	assert(config ~= nil, "unknown config: " .. tostring(name))
	return deepCopy(config)
end

function ConfigRegistry:merge(name: string, overrides: any): any
	local config = self:get(name)
	for key, value in pairs(overrides or {}) do
		config[key] = deepCopy(value)
	end
	return config
end

return ConfigRegistry
