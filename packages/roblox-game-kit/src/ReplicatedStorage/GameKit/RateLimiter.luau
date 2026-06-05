--!strict

local RateLimiter = {}
RateLimiter.__index = RateLimiter

export type Clock = () -> number

export type RateLimiter = typeof(setmetatable({} :: {
	_clock: Clock,
	_cooldowns: { [string]: { [string]: number } },
	_windows: { [string]: { [string]: { start: number, count: number } } },
}, RateLimiter))

local function defaultClock(): number
	return os.clock()
end

local function keyFor(subject: any): string
	if type(subject) == "table" and subject.UserId ~= nil then
		return tostring(subject.UserId)
	end
	return tostring(subject)
end

function RateLimiter.new(clock: Clock?): RateLimiter
	return setmetatable({
		_clock = clock or defaultClock,
		_cooldowns = {},
		_windows = {},
	}, RateLimiter)
end

function RateLimiter:checkCooldown(subject: any, action: string, cooldownSeconds: number, now: number?): (boolean, number)
	local key = keyFor(subject)
	local current = now or self._clock()
	self._cooldowns[key] = self._cooldowns[key] or {}
	local last = self._cooldowns[key][action]
	if last ~= nil and current - last < cooldownSeconds then
		return false, cooldownSeconds - (current - last)
	end
	self._cooldowns[key][action] = current
	return true, 0
end

function RateLimiter:checkWindow(subject: any, bucketName: string, maxCount: number, windowSeconds: number, now: number?): (boolean, number)
	local key = keyFor(subject)
	local current = now or self._clock()
	self._windows[key] = self._windows[key] or {}
	local record = self._windows[key][bucketName]
	if record == nil or current - record.start >= windowSeconds then
		record = { start = current, count = 0 }
		self._windows[key][bucketName] = record
	end
	record.count += 1
	if record.count > maxCount then
		return false, math.max(0, windowSeconds - (current - record.start))
	end
	return true, 0
end

function RateLimiter:clear(subject: any)
	local key = keyFor(subject)
	self._cooldowns[key] = nil
	self._windows[key] = nil
end

return RateLimiter
