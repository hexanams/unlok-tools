import { beforeEach, describe, expect, it, vi } from "vitest"

const post = vi.fn()
vi.mock("axios", () => ({
	default: {
		post: (...args: unknown[]) => post(...args),
		isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
	},
}))
vi.mock("@/shared/net", () => ({ getAxiosSettings: () => ({}) }))
vi.mock("@/shared/services/Logger", () => ({
	Logger: { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() },
}))
const createSessionCompactionState = vi.fn((input: { compactedMessages: unknown[]; conversationId?: string }) => ({
	version: 1,
	messages: input.compactedMessages,
	conversation_id: input.conversationId,
}))
vi.mock("@cline/core", () => ({
	createSessionCompactionState: (input: { compactedMessages: unknown[] }) => createSessionCompactionState(input),
}))

import { buildCompactedMessages, compactThroughUnlok, flattenSdkMessages, UNLOK_COMPACTION_NOTE_PREFIX } from "./unlok-compaction"

const history = [
	{ role: "user" as const, content: "Fix the login bug" },
	{
		role: "assistant" as const,
		content: [
			{ type: "text" as const, text: "Looking at it." },
			{ type: "tool_use" as const, id: "t1", name: "read_file", input: { path: "src/auth.ts" } },
		],
	},
	{
		role: "user" as const,
		content: [
			{ type: "tool_result" as const, tool_use_id: "t1", name: "read_file", content: "export const login = () => {}" },
		],
	},
	{ role: "assistant" as const, content: "Found it." },
	{ role: "user" as const, content: "Great, ship it" },
]

describe("flattenSdkMessages", () => {
	it("writes tool calls and results out in words and drops thinking", () => {
		const flat = flattenSdkMessages([...history, { role: "assistant", content: [{ type: "thinking", thinking: "private" }] }])
		expect(flat.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"])
		expect(flat[1].content).toContain("Looking at it.")
		expect(flat[1].content).toContain("[Tool call: read_file]")
		expect(flat[1].content).toContain('"path":"src/auth.ts"')
		expect(flat[2].content).toContain("[Tool result: read_file]")
		expect(flat[2].content).toContain("export const login")
		expect(JSON.stringify(flat)).not.toContain("private")
	})
})

describe("buildCompactedMessages", () => {
	it("puts the note first and keeps the tail verbatim", () => {
		const result = buildCompactedMessages(history, 3, "Task\nfix login")
		expect(result).toHaveLength(3)
		expect(result[0]).toEqual({ role: "user", content: `${UNLOK_COMPACTION_NOTE_PREFIX}\nTask\nfix login` })
		expect(result.slice(1)).toEqual(history.slice(3))
	})

	it("merges the note into a kept tail that already starts with a user turn", () => {
		const result = buildCompactedMessages(history, 4, "note")
		expect(result).toHaveLength(1)
		expect(result[0].role).toBe("user")
		expect(result[0].content).toEqual([
			{ type: "text", text: `${UNLOK_COMPACTION_NOTE_PREFIX}\nnote` },
			{ type: "text", text: "Great, ship it" },
		])
	})
})

describe("compactThroughUnlok", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("posts the flattened history with the session id and focus, and builds the sidecar from the note", async () => {
		post.mockResolvedValueOnce({
			data: {
				compacted: true,
				summary: "Task\nfix login\nNext steps\nship",
				keep_from_index: 3,
				messages_folded: 3,
				provider: "gemini",
				model: "gemini-flash-latest",
			},
		})

		const outcome = await compactThroughUnlok({
			apiKey: "unlok_key",
			sessionId: "task-1",
			messages: history,
			focus: "the login bug",
		})

		expect(post).toHaveBeenCalledTimes(1)
		const [url, body, options] = post.mock.calls[0] as [string, Record<string, unknown>, { headers: Record<string, string> }]
		expect(url).toMatch(/\/v1\/sessions\/compact$/)
		expect(body.session_id).toBe("task-1")
		expect(body.focus).toBe("the login bug")
		expect((body.messages as Array<{ role: string; content: string }>).every((m) => typeof m.content === "string")).toBe(true)
		expect(options.headers.Authorization).toBe("Bearer unlok_key")
		expect(options.headers["X-Unlok-Session-Id"]).toBe("task-1")

		expect(outcome.kind).toBe("compacted")
		if (outcome.kind !== "compacted") {
			throw new Error("expected compacted")
		}
		expect(outcome.messages[0]).toEqual({
			role: "user",
			content: `${UNLOK_COMPACTION_NOTE_PREFIX}\nTask\nfix login\nNext steps\nship`,
		})
		expect(outcome.messages).toHaveLength(3)
		expect(outcome.messagesFolded).toBe(3)
		expect(outcome.provider).toBe("gemini")
		expect(createSessionCompactionState).toHaveBeenCalledWith(
			expect.objectContaining({ sourceMessages: history, compactedMessages: outcome.messages, conversationId: "task-1" }),
		)
	})

	it("reports a skip with the backend's reason when nothing was folded", async () => {
		post.mockResolvedValueOnce({ data: { compacted: false, reason: "too_short", keep_from_index: 5 } })
		const outcome = await compactThroughUnlok({ apiKey: "k", sessionId: "s", messages: history })
		expect(outcome).toEqual({ kind: "skipped", reason: "too_short" })
		expect(createSessionCompactionState).not.toHaveBeenCalled()
	})

	it("reports unavailable, never throws, when the backend cannot be reached", async () => {
		post.mockRejectedValueOnce(Object.assign(new Error("ECONNRESET"), { isAxiosError: true }))
		const outcome = await compactThroughUnlok({ apiKey: "k", sessionId: "s", messages: history })
		expect(outcome.kind).toBe("unavailable")
	})

	it("surfaces the backend's own explanation when it refuses", async () => {
		post.mockRejectedValueOnce(
			Object.assign(new Error("503"), {
				isAxiosError: true,
				response: { status: 503, data: { detail: "No model is available to compact this conversation right now." } },
			}),
		)
		const outcome = await compactThroughUnlok({ apiKey: "k", sessionId: "s", messages: history })
		expect(outcome).toEqual({ kind: "unavailable", reason: "No model is available to compact this conversation right now." })
	})

	it("skips without a request when the history has nothing to send", async () => {
		const outcome = await compactThroughUnlok({
			apiKey: "k",
			sessionId: "s",
			messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "x" }] }],
		})
		expect(outcome).toEqual({ kind: "skipped", reason: "empty" })
		expect(post).not.toHaveBeenCalled()
	})
})
