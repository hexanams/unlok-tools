import { describe, expect, it } from "vitest"
import {
	addOrReplaceUnlokWorkspace,
	backfillUnlokWorkspaceEmail,
	clearUnlokWorkspaceError,
	loadUnlokWorkspaces,
	markUnlokWorkspaceError,
	removeUnlokWorkspace,
	setActiveUnlokWorkspace,
	summarizeUnlokWorkspaces,
	type UnlokWorkspaceStore,
} from "./unlokWorkspaces"

function fakeStore(initial: { unlokApiKey?: string; unlokWorkspaces?: string } = {}) {
	const secrets: Record<string, string | undefined> = { unlokWorkspaces: initial.unlokWorkspaces }
	let apiConfiguration: Record<string, unknown> = { unlokApiKey: initial.unlokApiKey }
	const store: UnlokWorkspaceStore = {
		getSecretKey: (key) => secrets[key],
		setSecret: (key, value) => {
			secrets[key] = value
		},
		getApiConfiguration: () => apiConfiguration as never,
		setApiConfiguration: (config) => {
			apiConfiguration = config as Record<string, unknown>
		},
	}
	return { store, secrets, config: () => apiConfiguration }
}

const personal = { apiKey: "unlok_sk_personal", email: "me@acme.dev", workspaceName: "Personal", teamId: "" }
const team = { apiKey: "unlok_sk_team", email: "me@acme.dev", workspaceName: "Acme Engineering", teamId: "team-1" }

describe("unlokWorkspaces", () => {
	it("adds a workspace, makes it active, and mirrors its key into unlokApiKey with the unlok provider", () => {
		const { store, config } = fakeStore()
		const entry = addOrReplaceUnlokWorkspace(store, personal)
		expect(summarizeUnlokWorkspaces(store)).toEqual([
			expect.objectContaining({ id: entry.id, workspaceName: "Personal", email: "me@acme.dev", active: true }),
		])
		expect(config().unlokApiKey).toBe("unlok_sk_personal")
		expect(config().planModeApiProvider).toBe("unlok")
		expect(config().actModeApiProvider).toBe("unlok")
	})

	it("keeps both workspaces and switches the mirrored key when the active one changes", () => {
		const { store, config } = fakeStore()
		const first = addOrReplaceUnlokWorkspace(store, personal)
		const second = addOrReplaceUnlokWorkspace(store, team)
		expect(summarizeUnlokWorkspaces(store).map((w) => [w.workspaceName, w.active])).toEqual([
			["Personal", false],
			["Acme Engineering", true],
		])
		expect(config().unlokApiKey).toBe("unlok_sk_team")

		expect(setActiveUnlokWorkspace(store, first.id)).toBe(true)
		expect(config().unlokApiKey).toBe("unlok_sk_personal")
		expect(summarizeUnlokWorkspaces(store).find((w) => w.id === second.id)?.active).toBe(false)
	})

	it("re-authorizing the same account and workspace replaces the key in place instead of adding a row", () => {
		const { store, config } = fakeStore()
		addOrReplaceUnlokWorkspace(store, team)
		markUnlokWorkspaceError(store, "No OpenAI key is connected to this workspace yet.")
		addOrReplaceUnlokWorkspace(store, { ...team, apiKey: "unlok_sk_team_v2" })
		const summaries = summarizeUnlokWorkspaces(store)
		expect(summaries).toHaveLength(1)
		expect(summaries[0].lastError).toBe("")
		expect(config().unlokApiKey).toBe("unlok_sk_team_v2")
	})

	it("removing the active workspace promotes the next one; removing the last clears the mirrored key", () => {
		const { store, config } = fakeStore()
		const first = addOrReplaceUnlokWorkspace(store, personal)
		const second = addOrReplaceUnlokWorkspace(store, team)
		expect(removeUnlokWorkspace(store, second.id)).toBe(true)
		expect(config().unlokApiKey).toBe("unlok_sk_personal")
		expect(summarizeUnlokWorkspaces(store)[0].active).toBe(true)
		expect(removeUnlokWorkspace(store, first.id)).toBe(true)
		expect(config().unlokApiKey).toBe("")
		expect(summarizeUnlokWorkspaces(store)).toEqual([])
	})

	it("adopts a key that predates the list (or was pasted by hand) as the active entry", () => {
		const { store } = fakeStore({ unlokApiKey: "unlok_sk_pasted" })
		const data = loadUnlokWorkspaces(store)
		expect(data.workspaces).toHaveLength(1)
		expect(data.workspaces[0].apiKey).toBe("unlok_sk_pasted")
		expect(data.activeId).toBe(data.workspaces[0].id)
		backfillUnlokWorkspaceEmail(store, "me@acme.dev")
		expect(summarizeUnlokWorkspaces(store)[0].email).toBe("me@acme.dev")
	})

	it("records a failure on the active workspace and clears it on success, never exposing keys to the webview", () => {
		const { store } = fakeStore()
		addOrReplaceUnlokWorkspace(store, personal)
		markUnlokWorkspaceError(store, "  Request failed with status 401  ")
		const [failing] = summarizeUnlokWorkspaces(store)
		expect(failing.lastError).toBe("Request failed with status 401")
		expect(JSON.stringify(failing)).not.toContain("unlok_sk_")
		clearUnlokWorkspaceError(store)
		expect(summarizeUnlokWorkspaces(store)[0].lastError).toBe("")
	})

	it("tolerates a corrupt secret by starting over", () => {
		const { store } = fakeStore({ unlokWorkspaces: "{not json" })
		expect(summarizeUnlokWorkspaces(store)).toEqual([])
	})
})
