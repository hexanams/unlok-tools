import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() },
}))

import { IDLE_CLOSE_MS, UnlokSessionCloser } from "./unlok-session-close"

const history = [
	{ role: "user" as const, content: "Fix the login bug" },
	{ role: "assistant" as const, content: "Done." },
]

function makeCloser(overrides: Partial<ConstructorParameters<typeof UnlokSessionCloser>[0]> = {}) {
	const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = []
	const postClose = vi.fn().mockResolvedValue({ facts_written: 1 })
	const closer = new UnlokSessionCloser({
		getApiKey: () => "unlok_key",
		readMessages: vi.fn().mockResolvedValue(history),
		postClose,
		setTimer: (fn, ms) => {
			const t = { fn, ms, cleared: false }
			timers.push(t)
			return t
		},
		clearTimer: (handle) => {
			;(handle as { cleared: boolean }).cleared = true
		},
		...overrides,
	})
	return { closer, timers, postClose }
}

describe("UnlokSessionCloser", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("posts the flattened transcript once, and never twice for the same session", async () => {
		const { closer, postClose } = makeCloser()
		expect(await closer.close("s1", "completed")).toBe(true)
		await Promise.resolve()
		expect(postClose).toHaveBeenCalledWith({
			apiKey: "unlok_key",
			sessionId: "s1",
			messages: [
				{ role: "user", content: "Fix the login bug" },
				{ role: "assistant", content: "Done." },
			],
			reason: "completed",
		})
		expect(await closer.close("s1", "replaced")).toBe(false)
		expect(postClose).toHaveBeenCalledTimes(1)
	})

	it("does nothing without an Unlok key or with an empty transcript", async () => {
		const noKey = makeCloser({ getApiKey: () => undefined })
		expect(await noKey.closer.close("s1", "completed")).toBe(false)
		expect(noKey.postClose).not.toHaveBeenCalled()
		const empty = makeCloser({ readMessages: vi.fn().mockResolvedValue([]) })
		expect(await empty.closer.close("s1", "completed")).toBe(false)
		expect(empty.closer.hasClosed("s1")).toBe(false)
	})

	it("closes after the idle window unless a new turn cancels it", async () => {
		const { closer, timers, postClose } = makeCloser()
		closer.scheduleIdleClose("s1")
		expect(timers[0].ms).toBe(IDLE_CLOSE_MS)
		closer.cancelIdleClose()
		expect(timers[0].cleared).toBe(true)

		closer.scheduleIdleClose("s2")
		timers[1].fn()
		for (let i = 0; i < 4; i++) {
			await Promise.resolve()
		}
		expect(postClose).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "s2", reason: "idle" }))
	})

	it("replaces a pending idle close when another session schedules one", () => {
		const { closer, timers } = makeCloser()
		closer.scheduleIdleClose("s1")
		closer.scheduleIdleClose("s2")
		expect(timers[0].cleared).toBe(true)
		expect(timers[1].cleared).toBe(false)
	})

	it("swallows a failed post and marks the session closed so it is not retried in a loop", async () => {
		const postClose = vi.fn().mockRejectedValue(new Error("503"))
		const { closer } = makeCloser({ postClose })
		expect(await closer.close("s1", "completed")).toBe(true)
		await Promise.resolve()
		await Promise.resolve()
		expect(closer.hasClosed("s1")).toBe(true)
		expect(postClose).toHaveBeenCalledTimes(1)
		expect(await closer.close("s1", "completed")).toBe(false)
		expect(postClose).toHaveBeenCalledTimes(1)
	})
})
