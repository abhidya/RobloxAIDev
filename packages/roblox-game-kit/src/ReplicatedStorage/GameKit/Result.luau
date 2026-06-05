--!strict

local Result = {}

function Result.ok(value: any?): { ok: boolean, value: any? }
	return {
		ok = true,
		value = value,
	}
end

function Result.err(code: string, message: string?, details: any?): { ok: boolean, code: string, message: string?, details: any? }
	return {
		ok = false,
		code = code,
		message = message,
		details = details,
	}
end

function Result.isOk(result: any): boolean
	return type(result) == "table" and result.ok == true
end

return Result
