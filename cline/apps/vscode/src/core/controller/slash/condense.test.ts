import { strict as assert } from "node:assert"
import { StringRequest } from "@shared/proto/cline/common"
import { describe, expect, it, vi } from "vitest"
import type { Controller } from ".."
import { COMPACT_FOCUS_MAX_CHARS, condense, parseCompactFocus } from "./condense"

describe("condense slash handler", () => {
	it("runs controller compaction instead of answering the old condense prompt", async () => {
		const compactTask = vi.fn().mockResolvedValue(undefined)
		const handleWebviewAskResponse = vi.fn()
		const controller = {
			compactTask,
			task: { handleWebviewAskResponse },
		} as unknown as Controller

		await condense(controller, StringRequest.create({ value: "compact" }))

		assert.equal(compactTask.mock.calls.length, 1)
		assert.equal(handleWebviewAskResponse.mock.calls.length, 0)
	})

	it("hands the text after the command to the controller as the focus", async () => {
		const compactTask = vi.fn().mockResolvedValue(undefined)
		const controller = { compactTask } as unknown as Controller

		await condense(controller, StringRequest.create({ value: "compact keep the migration numbers" }))

		expect(compactTask).toHaveBeenCalledWith("keep the migration numbers")
	})
})

describe("parseCompactFocus", () => {
	it("returns nothing for the bare command in any spelling", () => {
		expect(parseCompactFocus("compact")).toBeUndefined()
		expect(parseCompactFocus("/compact")).toBeUndefined()
		expect(parseCompactFocus("/smol ")).toBeUndefined()
		expect(parseCompactFocus("newtask")).toBeUndefined()
		expect(parseCompactFocus(undefined)).toBeUndefined()
		expect(parseCompactFocus("")).toBeUndefined()
	})

	it("returns the text after the command as the focus", () => {
		expect(parseCompactFocus("compact keep the migration numbers")).toBe("keep the migration numbers")
		expect(parseCompactFocus("/compact   the billing bug ")).toBe("the billing bug")
		expect(parseCompactFocus("smol what changed in auth.py")).toBe("what changed in auth.py")
	})

	it("treats a value without a command word as the focus itself", () => {
		expect(parseCompactFocus("just the decisions")).toBe("just the decisions")
	})

	it("caps an oversized focus", () => {
		const focus = parseCompactFocus(`compact ${"x".repeat(COMPACT_FOCUS_MAX_CHARS + 50)}`)
		expect(focus).toHaveLength(COMPACT_FOCUS_MAX_CHARS)
	})
})
