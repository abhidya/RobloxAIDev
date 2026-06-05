--!strict

local TestHarness = {}

export type TestCase = {
	name: string,
	run: (any) -> (),
}

function TestHarness.run(tests: { TestCase }, context: any?)
	local failures = {}
	for _, test in ipairs(tests or {}) do
		local ok, err = pcall(test.run, context or {})
		if not ok then
			table.insert(failures, {
				name = test.name,
				message = tostring(err),
			})
		end
	end
	return {
		passed = #failures == 0,
		total = #(tests or {}),
		failed = #failures,
		failures = failures,
	}
end

return TestHarness
