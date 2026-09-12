import { describe, expect, it } from "vitest"
import {
	addOrReplaceUnlokWorkspace,
	backfillUnlokWorkspaceIdentity,
	clearUnlokWorkspaceError,
	loadUnlokWorkspaces,
	markUnlokWorkspaceError,
	markUnlokWorkspaceRevoked,
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
		backfillUnlokWorkspaceIdentity(store, { email: "me@acme.dev", teamId: "", workspaceName: "Personal" })
		expect(summarizeUnlokWorkspaces(store)[0]).toEqual(
			expect.objectContaining({ email: "me@acme.dev", workspaceName: "Personal", teamId: "" }),
		)
	})

	it("does not duplicate a key the mirror already carries when the named entry arrives a moment later", () => {
		// The old callback order: provider mirror written first, then the list.
		const { store } = fakeStore({ unlokApiKey: "unlok_sk_team" })
		addOrReplaceUnlokWorkspace(store, team)
		const summaries = summarizeUnlokWorkspaces(store)
		expect(summaries).toHaveLength(1)
		expect(summaries[0]).toEqual(expect.objectContaining({ workspaceName: "Acme Engineering", active: true }))
	})

	it("collapses legacy duplicates that share a key, keeping the named entry and the active pointer", () => {
		const legacy = {
			activeId: "generic-2",
			workspaces: [
				{
					id: "generic-1",
					apiKey: "k-old",
					email: "",
					workspaceName: "Workspace",
					teamId: "",
					addedAt: 1,
					lastError: "",
				},
				{
					id: "generic-2",
					apiKey: "k-team",
					email: "",
					workspaceName: "Workspace",
					teamId: "",
					addedAt: 2,
					lastError: "",
				},
				{
					id: "named",
					apiKey: "k-team",
					email: "me@acme.dev",
					workspaceName: "Acme Engineering",
					teamId: "t1",
					addedAt: 3,
					lastError: "",
				},
			],
		}
		const { store, config } = fakeStore({ unlokApiKey: "k-team", unlokWorkspaces: JSON.stringify(legacy) })
		const summaries = summarizeUnlokWorkspaces(store)
		expect(summaries.map((w) => [w.workspaceName, w.active])).toEqual([
			["Workspace", false],
			["Acme Engineering", true],
		])
		expect(config().unlokApiKey).toBe("k-team")
	})

	it("labels an adopted entry from what /v1/me reports, and keeps following the backend's answer", () => {
		const { store } = fakeStore({ unlokApiKey: "k-adopted" })
		backfillUnlokWorkspaceIdentity(store, { email: "me@acme.dev", teamId: "t9", workspaceName: "Ops" })
		expect(summarizeUnlokWorkspaces(store)[0]).toEqual(expect.objectContaining({ workspaceName: "Ops", teamId: "t9" }))
		// The backend is authoritative about which workspace a key belongs to.
		backfillUnlokWorkspaceIdentity(store, { email: "me@acme.dev", teamId: "", workspaceName: "Personal" })
		expect(summarizeUnlokWorkspaces(store)[0]).toEqual(expect.objectContaining({ workspaceName: "Personal", teamId: "" }))
	})

	it("merges a generic row into the named row for the same workspace once /v1/me identifies it, keeping the working key", () => {
		// The exact leftover seen live: "Workspace" (no email) holding the live
		// team key and active, next to "My+team" holding a stale key.
		const legacy = {
			activeId: "generic",
			workspaces: [
				{
					id: "personal",
					apiKey: "k-personal",
					email: "me@acme.dev",
					workspaceName: "Personal",
					teamId: "",
					addedAt: 1,
					lastError: "",
				},
				{
					id: "named",
					apiKey: "k-team-stale",
					email: "me@acme.dev",
					workspaceName: "My+team",
					teamId: "t1",
					addedAt: 2,
					lastError: "",
				},
				{
					id: "generic",
					apiKey: "k-team-live",
					email: "",
					workspaceName: "Workspace",
					teamId: "",
					addedAt: 3,
					lastError: "x",
				},
			],
		}
		const { store, config } = fakeStore({ unlokApiKey: "k-team-live", unlokWorkspaces: JSON.stringify(legacy) })
		backfillUnlokWorkspaceIdentity(store, { email: "me@acme.dev", teamId: "t1", workspaceName: "My+team" })
		const summaries = summarizeUnlokWorkspaces(store)
		expect(summaries.map((w) => [w.workspaceName, w.active])).toEqual([
			["Personal", false],
			["My+team", true],
		])
		expect(config().unlokApiKey).toBe("k-team-live")
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

	it("drops a generic entry whose key is revoked and moves to the next healthy one; keeps a named one for reconnecting", () => {
		const { store, config } = fakeStore()
		const named = addOrReplaceUnlokWorkspace(store, team)
		// A generic leftover holding a dead key, made active (mirror = its key).
		const legacy = loadUnlokWorkspaces(store)
		legacy.workspaces.push({ id: "generic", apiKey: "k-dead", email: "", workspaceName: "Workspace", teamId: "", addedAt: 9, lastError: "" })
		legacy.activeId = "generic"
		store.setSecret("unlokWorkspaces", JSON.stringify(legacy))
		store.setApiConfiguration({ ...store.getApiConfiguration(), unlokApiKey: "k-dead" })

		expect(markUnlokWorkspaceRevoked(store)).toBe(true)
		expect(summarizeUnlokWorkspaces(store)).toEqual([expect.objectContaining({ id: named.id, active: true })])
		expect(config().unlokApiKey).toBe("unlok_sk_team")

		expect(markUnlokWorkspaceRevoked(store)).toBe(false)
		expect(summarizeUnlokWorkspaces(store)[0].lastError).toContain("revoked")
	})

	it("tolerates a corrupt secret by starting over", () => {
		const { store } = fakeStore({ unlokWorkspaces: "{not json" })
		expect(summarizeUnlokWorkspaces(store)).toEqual([])
	})
})
