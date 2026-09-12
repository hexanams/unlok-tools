import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() },
}))
vi.mock("@/core/controller/account/unlokMemory", () => ({
	fetchUnlokWorkspaceRules: vi.fn().mockResolvedValue({ rules: [], version: "0", available: false }),
	rememberUnlokFact: vi.fn().mockResolvedValue({ id: "f1", title: "Use bun", kind: "feedback" }),
}))
const setupPrefs = { never: [] as string[] }
vi.mock("@/core/project/unlok-project-context", () => ({
	isSetupDismissedForever: async (root: string) => setupPrefs.never.includes(root),
	dismissSetupForever: async (root: string) => {
		setupPrefs.never.push(root)
	},
}))

import { UNLOK_INIT_COMMAND, UnlokProjectCoordinator, type UnlokProjectCoordinatorOptions } from "./unlok-project-coordinator"

let root: string

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "unlok-coordinator-"))
	setupPrefs.never.length = 0
	vi.clearAllMocks()
})

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true })
})

function makeCoordinator(input: { teamId?: string; provider?: string } = {}) {
	const workspaces = {
		activeId: "w1",
		workspaces: [
			{ id: "w1", apiKey: "unlok_key", email: "a@b.c", workspaceName: "Acme", teamId: input.teamId ?? "", addedAt: 1 },
		],
	}
	const stateManager = {
		getApiConfiguration: () => ({
			unlokApiKey: "unlok_key",
			actModeApiProvider: input.provider ?? "unlok",
			planModeApiProvider: "unlok",
		}),
		getGlobalSettingsKey: () => "act",
		getSecretKey: () => JSON.stringify(workspaces),
	} as unknown as StateManager
	const options = {
		stateManager,
		sessions: { getActiveSession: vi.fn(() => ({ sessionId: "s1" })) },
		messages: { appendAndEmit: vi.fn() },
		getWorkspaceRoot: vi.fn().mockResolvedValue(root),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		sendFollowup: vi.fn().mockResolvedValue(undefined),
	} as unknown as UnlokProjectCoordinatorOptions & {
		messages: { appendAndEmit: ReturnType<typeof vi.fn> }
		sendFollowup: ReturnType<typeof vi.fn>
	}
	return { coordinator: new UnlokProjectCoordinator(options), options }
}

function cards(options: { messages: { appendAndEmit: ReturnType<typeof vi.fn> } }) {
	return options.messages.appendAndEmit.mock.calls
		.flatMap((call) => call[0] as Array<{ say?: string; text?: string }>)
		.filter((m) => m.say === "unlok_project")
		.map((m) => JSON.parse(m.text ?? "{}"))
}

describe("UnlokProjectCoordinator", () => {
	it("shows the setup card once for a folder with no layout, and not after Not now", async () => {
		const { coordinator, options } = makeCoordinator()
		await coordinator.afterTaskStarted("s1")
		await coordinator.afterTaskStarted("s2")
		expect(cards(options)).toEqual([expect.objectContaining({ kind: "init", workspaceName: "Acme", hasLegacyRules: false })])

		await coordinator.dismiss("now")
		const again = makeCoordinator()
		await again.coordinator.dismiss("now")
		await again.coordinator.afterTaskStarted("s3")
		expect(cards(again.options)).toEqual([])
	})

	it("never shows the card again for a folder dismissed forever", async () => {
		const first = makeCoordinator()
		await first.coordinator.dismiss("never")
		const second = makeCoordinator()
		await second.coordinator.afterTaskStarted("s1")
		expect(cards(second.options)).toEqual([])
	})

	it("stays quiet when the provider is not Unlok", async () => {
		const { coordinator, options } = makeCoordinator({ provider: "anthropic" })
		await coordinator.afterTaskStarted("s1")
		expect(cards(options)).toEqual([])
	})

	it("Initialize scaffolds with the team binding, moves legacy rules, and sends /init", async () => {
		await fs.mkdir(path.join(root, ".unlokrules"), { recursive: true })
		await fs.writeFile(path.join(root, ".unlokrules", "style.md"), "# Style\nTabs.")
		const { coordinator, options } = makeCoordinator({ teamId: "team-1" })

		const status = await coordinator.initialize()

		expect(status.initialized).toBe(true)
		expect(status.settings?.workspace).toEqual({ teamId: "team-1", name: "Acme" })
		expect(await fs.readFile(path.join(root, ".unlok", "rules", "style.md"), "utf8")).toBe("# Style\nTabs.")
		expect(options.sendFollowup).toHaveBeenCalledWith(UNLOK_INIT_COMMAND)
		expect(cards(options)).toEqual([expect.objectContaining({ kind: "initialized", movedLegacy: 1 })])
	})

	it("shows the binding card when the repo names another workspace", async () => {
		await fs.mkdir(path.join(root, ".unlok"), { recursive: true })
		await fs.writeFile(
			path.join(root, ".unlok", "settings.json"),
			JSON.stringify({ version: 1, workspace: { teamId: "other", name: "Globex" } }),
		)
		await fs.writeFile(path.join(root, "UNLOK.md"), "# x")
		const { coordinator, options } = makeCoordinator({ teamId: "team-1" })
		await coordinator.afterTaskStarted("s1")
		expect(cards(options)).toEqual([
			expect.objectContaining({ kind: "binding", teamId: "other", workspaceName: "Globex", activeWorkspaceName: "Acme" }),
		])
	})

	it("remember saves the fact and confirms in chat", async () => {
		const { coordinator, options } = makeCoordinator()
		expect(await coordinator.remember("Use bun")).toBe("Use bun")
		const infos = options.messages.appendAndEmit.mock.calls
			.flatMap((call) => call[0] as Array<{ say?: string; text?: string }>)
			.filter((m) => m.say === "info")
		expect(infos[0]?.text).toContain("Remembered for this workspace: Use bun")
	})
})
