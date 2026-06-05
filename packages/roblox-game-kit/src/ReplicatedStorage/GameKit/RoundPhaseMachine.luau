--!strict

local RoundPhaseMachine = {}
RoundPhaseMachine.__index = RoundPhaseMachine

export type Phase = {
	name: string,
	duration: number,
}

function RoundPhaseMachine.new(phases: { Phase }, clock: (() -> number)?)
	assert(#phases > 0, "at least one phase is required")
	return setmetatable({
		phases = phases,
		clock = clock or os.clock,
		index = 1,
		startedAt = nil,
		ended = false,
	}, RoundPhaseMachine)
end

function RoundPhaseMachine:start(now: number?)
	self.index = 1
	self.startedAt = now or self.clock()
	self.ended = false
	return self:state(self.startedAt)
end

function RoundPhaseMachine:state(now: number?)
	local current = now or self.clock()
	local phase = self.phases[self.index]
	local startedAt = self.startedAt or current
	local endsAt = startedAt + phase.duration
	return {
		phase = phase.name,
		index = self.index,
		startedAt = startedAt,
		endsAt = endsAt,
		remaining = math.max(0, endsAt - current),
		ended = self.ended,
	}
end

function RoundPhaseMachine:advance(now: number?)
	if self.ended then
		return self:state(now)
	end
	if self.index >= #self.phases then
		self.ended = true
		return self:state(now)
	end
	self.index += 1
	self.startedAt = now or self.clock()
	return self:state(self.startedAt)
end

function RoundPhaseMachine:tick(now: number?)
	local current = now or self.clock()
	local state = self:state(current)
	if not state.ended and state.remaining <= 0 then
		return self:advance(current)
	end
	return state
end

return RoundPhaseMachine
