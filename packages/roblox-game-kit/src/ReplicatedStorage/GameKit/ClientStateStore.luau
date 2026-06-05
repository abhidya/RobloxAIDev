--!strict

local ClientStateStore = {}
ClientStateStore.__index = ClientStateStore

function ClientStateStore.new(initialState: any?)
	return setmetatable({
		_state = initialState or {},
		_subscribers = {},
	}, ClientStateStore)
end

function ClientStateStore:get(): any
	return self._state
end

function ClientStateStore:set(nextState: any)
	self._state = nextState
	for _, callback in ipairs(self._subscribers) do
		callback(nextState)
	end
end

function ClientStateStore:update(mutator: (any) -> any)
	self:set(mutator(self._state) or self._state)
end

function ClientStateStore:subscribe(callback: (any) -> ())
	table.insert(self._subscribers, callback)
	callback(self._state)
	return function()
		for index, existing in ipairs(self._subscribers) do
			if existing == callback then
				table.remove(self._subscribers, index)
				break
			end
		end
	end
end

return ClientStateStore
