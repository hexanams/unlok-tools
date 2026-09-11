import { randomUUID } from "node:crypto"
import type { ApiConfiguration } from "@shared/api"
import type { UnlokWorkspaceSummary } from "@shared/ExtensionMessage"

/**
 * Several Unlok workspaces stay connected in one editor; exactly one is
 * active. The list lives in the `unlokWorkspaces` secret as JSON, and the
 * pre-existing `unlokApiKey` secret always mirrors the active entry's key so
 * every reader that predates the list (the API handler, the sign in gate,
 * getUnlokWorkspaceInfo) keeps working untouched.
 *
 * Every function here goes through load() first, which reconciles the list
 * with `unlokApiKey`: a key pasted by hand into the provider settings, or one
 * present from before this list existed, becomes an entry instead of being
 * silently lost. Reads can therefore write, which is deliberate.
 */

export interface StoredUnlokWorkspace {
	id: string
	apiKey: string
	email: string
	workspaceName: string
	/** "" for the personal workspace. */
	teamId: string
	addedAt: number
	/** Most recent failure while this workspace was active, "" when healthy. */
	lastError: string
}

interface StoredUnlokWorkspaces {
	activeId: string
	workspaces: StoredUnlokWorkspace[]
}

/** The slice of StateManager this module needs, so tests can pass a fake. */
export interface UnlokWorkspaceStore {
	getSecretKey(key: "unlokWorkspaces"): string | undefined
	setSecret(key: "unlokWorkspaces", value: string | undefined): void
	getApiConfiguration(): ApiConfiguration
	setApiConfiguration(config: ApiConfiguration): void
}

export interface NewUnlokWorkspace {
	apiKey: string
	email: string
	workspaceName: string
	teamId: string
}

const MAX_ERROR_LENGTH = 300
const FALLBACK_WORKSPACE_NAME = "Workspace"

function parse(raw: string | undefined): StoredUnlokWorkspaces {
	if (!raw) {
		return { activeId: "", workspaces: [] }
	}
	try {
		const parsed = JSON.parse(raw) as Partial<StoredUnlokWorkspaces>
		const workspaces = Array.isArray(parsed.workspaces)
			? parsed.workspaces.filter((w): w is StoredUnlokWorkspace => Boolean(w && typeof w.apiKey === "string" && w.id))
			: []
		return { activeId: typeof parsed.activeId === "string" ? parsed.activeId : "", workspaces }
	} catch {
		return { activeId: "", workspaces: [] }
	}
}

function persist(store: UnlokWorkspaceStore, data: StoredUnlokWorkspaces): void {
	store.setSecret("unlokWorkspaces", data.workspaces.length > 0 ? JSON.stringify(data) : undefined)
	const active = data.workspaces.find((w) => w.id === data.activeId)
	const mirroredKey = active?.apiKey ?? ""
	const config = store.getApiConfiguration()
	if ((config.unlokApiKey ?? "") !== mirroredKey) {
		store.setApiConfiguration(
			mirroredKey
				? { ...config, unlokApiKey: mirroredKey, planModeApiProvider: "unlok", actModeApiProvider: "unlok" }
				: { ...config, unlokApiKey: "" },
		)
	}
}

/**
 * Reads the list and reconciles it with `unlokApiKey`. A key the list does
 * not know becomes a new active entry (labelled generically until
 * getUnlokWorkspaceInfo backfills the email); a key the list does know but
 * that isn't marked active becomes the active one; an emptied key means no
 * entry is active.
 */
export function loadUnlokWorkspaces(store: UnlokWorkspaceStore): StoredUnlokWorkspaces {
	const data = parse(store.getSecretKey("unlokWorkspaces"))
	const mirroredKey = store.getApiConfiguration().unlokApiKey ?? ""
	const active = data.workspaces.find((w) => w.id === data.activeId)

	if (mirroredKey && active?.apiKey === mirroredKey) {
		return data
	}
	if (mirroredKey) {
		const known = data.workspaces.find((w) => w.apiKey === mirroredKey)
		if (known) {
			data.activeId = known.id
		} else {
			const entry: StoredUnlokWorkspace = {
				id: randomUUID(),
				apiKey: mirroredKey,
				email: "",
				workspaceName: FALLBACK_WORKSPACE_NAME,
				teamId: "",
				addedAt: Date.now(),
				lastError: "",
			}
			data.workspaces.push(entry)
			data.activeId = entry.id
		}
		store.setSecret("unlokWorkspaces", JSON.stringify(data))
		return data
	}
	if (active) {
		data.activeId = ""
		store.setSecret("unlokWorkspaces", JSON.stringify(data))
	}
	return data
}

/**
 * Adds a freshly authorized workspace and makes it active. The same account
 * and workspace already in the list gets its key replaced in place (that is
 * also how "Reconnect" works), so re-authorizing never duplicates a row.
 */
export function addOrReplaceUnlokWorkspace(store: UnlokWorkspaceStore, fresh: NewUnlokWorkspace): StoredUnlokWorkspace {
	const data = loadUnlokWorkspaces(store)
	const workspaceName = fresh.workspaceName.trim() || (fresh.teamId ? FALLBACK_WORKSPACE_NAME : "Personal")
	const existing = data.workspaces.find(
		(w) => w.teamId === fresh.teamId && (fresh.email ? w.email === fresh.email : w.email === ""),
	)
	let entry: StoredUnlokWorkspace
	if (existing) {
		existing.apiKey = fresh.apiKey
		existing.email = fresh.email || existing.email
		existing.workspaceName = workspaceName
		existing.lastError = ""
		entry = existing
	} else {
		entry = {
			id: randomUUID(),
			apiKey: fresh.apiKey,
			email: fresh.email,
			workspaceName,
			teamId: fresh.teamId,
			addedAt: Date.now(),
			lastError: "",
		}
		data.workspaces.push(entry)
	}
	data.activeId = entry.id
	persist(store, data)
	return entry
}

export function setActiveUnlokWorkspace(store: UnlokWorkspaceStore, id: string): boolean {
	const data = loadUnlokWorkspaces(store)
	if (!data.workspaces.some((w) => w.id === id)) {
		return false
	}
	data.activeId = id
	persist(store, data)
	return true
}

/** Removing the active workspace promotes the next one so chat keeps working. */
export function removeUnlokWorkspace(store: UnlokWorkspaceStore, id: string): boolean {
	const data = loadUnlokWorkspaces(store)
	const before = data.workspaces.length
	data.workspaces = data.workspaces.filter((w) => w.id !== id)
	if (data.workspaces.length === before) {
		return false
	}
	if (data.activeId === id) {
		data.activeId = data.workspaces[0]?.id ?? ""
	}
	persist(store, data)
	return true
}

export function markUnlokWorkspaceError(store: UnlokWorkspaceStore, message: string): void {
	const data = loadUnlokWorkspaces(store)
	const active = data.workspaces.find((w) => w.id === data.activeId)
	if (!active) {
		return
	}
	active.lastError = message.trim().slice(0, MAX_ERROR_LENGTH)
	persist(store, data)
}

export function clearUnlokWorkspaceError(store: UnlokWorkspaceStore): void {
	const data = loadUnlokWorkspaces(store)
	const active = data.workspaces.find((w) => w.id === data.activeId)
	if (!active || !active.lastError) {
		return
	}
	active.lastError = ""
	persist(store, data)
}

/** Fills in the email of the active entry once GET /v1/me has answered. */
export function backfillUnlokWorkspaceEmail(store: UnlokWorkspaceStore, email: string): void {
	if (!email) {
		return
	}
	const data = loadUnlokWorkspaces(store)
	const active = data.workspaces.find((w) => w.id === data.activeId)
	if (!active || active.email === email) {
		return
	}
	active.email = email
	persist(store, data)
}

/** What the webview gets: every field except the key. */
export function summarizeUnlokWorkspaces(store: UnlokWorkspaceStore): UnlokWorkspaceSummary[] {
	const data = loadUnlokWorkspaces(store)
	return data.workspaces.map((w) => ({
		id: w.id,
		email: w.email,
		workspaceName: w.workspaceName,
		teamId: w.teamId,
		active: w.id === data.activeId,
		lastError: w.lastError,
		addedAt: w.addedAt,
	}))
}
