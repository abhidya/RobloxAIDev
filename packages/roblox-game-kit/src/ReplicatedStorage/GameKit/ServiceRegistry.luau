--!strict

local ServiceRegistry = {}
ServiceRegistry.__index = ServiceRegistry

export type Service = {
	Init: ((any, any) -> ())?,
	Start: ((any, any) -> ())?,
	Stop: ((any, any) -> ())?,
}

function ServiceRegistry.new(context: any?)
	return setmetatable({
		context = context or {},
		_services = {},
		_order = {},
		_started = false,
	}, ServiceRegistry)
end

function ServiceRegistry:register(name: string, service: Service)
	assert(type(name) == "string" and name ~= "", "service name required")
	assert(type(service) == "table", "service table required")
	if self._services[name] == nil then
		table.insert(self._order, name)
	end
	self._services[name] = service
	return service
end

function ServiceRegistry:get(name: string): Service?
	return self._services[name]
end

function ServiceRegistry:initAll()
	for _, name in ipairs(self._order) do
		local service = self._services[name]
		if service and service.Init then
			service:Init(self.context)
		end
	end
end

function ServiceRegistry:startAll()
	if self._started then
		return
	end
	self._started = true
	for _, name in ipairs(self._order) do
		local service = self._services[name]
		if service and service.Start then
			service:Start(self.context)
		end
	end
end

function ServiceRegistry:stopAll()
	for index = #self._order, 1, -1 do
		local service = self._services[self._order[index]]
		if service and service.Stop then
			service:Stop(self.context)
		end
	end
	self._started = false
end

return ServiceRegistry
