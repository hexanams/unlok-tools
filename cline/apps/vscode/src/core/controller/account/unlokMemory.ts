/**
 * The extension's side of curated memory and workspace rules: the index a
 * task loads on its first turn, "remember this", the close call that lets
 * Unlok extract facts from a finished task, and the workspace's rules.
 * Every call is best effort and returns empty on failure; nothing here may
 * block a task from starting.
 */

import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"

const UNLOK_BASE_URL = "https://unlok-backend-xpts.onrender.com/v1"

export interface UnlokMemoryIndexEntry {
	id: string
	kind: string
	title: string
	description: string
}

export interface UnlokWorkspaceRuleRow {
	id: string
	kind: "instruction" | "policy"
	title: string
	body: string
	enforced: boolean
	/** Set when a product enforces the policy in code (allowed_domains, blocked_actions, spend_cap_per_task, model_allowlist). */
	policyType: string | null
}

/** The workspace's typed policies merged per type, as the backend renders them under "policies". */
export interface UnlokWorkspacePolicyEntry {
	enforced: boolean
	titles: string[]
	domains?: string[]
	actions?: string[]
	usd?: number
	models?: string[]
}
export type UnlokWorkspacePolicies = Record<string, UnlokWorkspacePolicyEntry>

function headers(apiKey: string): Record<string, string> {
	return { Authorization: `Bearer ${apiKey}` }
}

export async function fetchUnlokMemoryIndex(apiKey: string): Promise<UnlokMemoryIndexEntry[]> {
	try {
		const response = await axios.get(`${UNLOK_BASE_URL}/memory/index`, {
			headers: headers(apiKey),
			timeout: 8_000,
			...getAxiosSettings(),
		})
		const entries = (response.data as { entries?: unknown[] } | undefined)?.entries
		return Array.isArray(entries)
			? entries.map((e) => {
					const r = e as Record<string, unknown>
					return {
						id: String(r.id ?? ""),
						kind: String(r.kind ?? ""),
						title: String(r.title ?? ""),
						description: String(r.description ?? ""),
					}
				})
			: []
	} catch (error) {
		Logger.warn("[UnlokMemory] Could not load the memory index:", error)
		return []
	}
}

export interface UnlokWorkspaceRulesResult {
	rules: UnlokWorkspaceRuleRow[]
	/** A short hash of the rules that apply to the extension; "0" when there are none. */
	version: string
	/** False on a personal key: rules are a Team plan feature. */
	available: boolean
	/** Typed policies the extension enforces itself: allowed_domains gates the web fetch tool. */
	policies: UnlokWorkspacePolicies
}

const EMPTY_RULES: UnlokWorkspaceRulesResult = { rules: [], version: "0", available: false, policies: {} }

// One entry per key: the last answer and its ETag, so the minute by minute
// refresh is a conditional request the backend answers with a 304.
const rulesCache = new Map<string, { etag: string; result: UnlokWorkspaceRulesResult }>()

/** The rules that apply to the extension, via the one contract every product uses. */
export async function fetchUnlokWorkspaceRules(apiKey: string): Promise<UnlokWorkspaceRulesResult> {
	const cached = rulesCache.get(apiKey)
	try {
		const response = await axios.get(`${UNLOK_BASE_URL}/rules`, {
			headers: { ...headers(apiKey), ...(cached ? { "If-None-Match": cached.etag } : {}) },
			params: { surface: "extension" },
			timeout: 8_000,
			validateStatus: (status) => status === 200 || status === 304,
			...getAxiosSettings(),
		})
		if (response.status === 304 && cached) {
			return cached.result
		}
		const data = (response.data ?? {}) as Record<string, unknown>
		const rules = Array.isArray(data.rules)
			? (data.rules as unknown[]).map((e) => {
					const r = e as Record<string, unknown>
					return {
						id: String(r.id ?? ""),
						kind: r.kind === "policy" ? ("policy" as const) : ("instruction" as const),
						title: String(r.title ?? ""),
						body: String(r.body ?? ""),
						enforced: Boolean(r.enforced),
						policyType: typeof r.policy_type === "string" ? r.policy_type : null,
					}
				})
			: []
		const result: UnlokWorkspaceRulesResult = {
			rules,
			version: typeof data.version === "string" && data.version ? data.version : "0",
			available: data.available !== false,
			policies: parseWorkspacePolicies(data.policies),
		}
		const etag = String(response.headers?.etag ?? "").trim()
		if (etag) {
			rulesCache.set(apiKey, { etag, result })
		}
		return result
	} catch (error) {
		Logger.warn("[UnlokMemory] Could not load workspace rules:", error)
		return cached?.result ?? EMPTY_RULES
	}
}

function parseWorkspacePolicies(raw: unknown): UnlokWorkspacePolicies {
	if (!raw || typeof raw !== "object") {
		return {}
	}
	const out: UnlokWorkspacePolicies = {}
	for (const [type, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!value || typeof value !== "object") {
			continue
		}
		const entry = value as Record<string, unknown>
		const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : undefined)
		out[type] = {
			enforced: Boolean(entry.enforced),
			titles: strings(entry.titles) ?? [],
			domains: strings(entry.domains),
			actions: strings(entry.actions),
			models: strings(entry.models),
			usd: typeof entry.usd === "number" ? entry.usd : undefined,
		}
	}
	return out
}

export async function rememberUnlokFact(
	apiKey: string,
	text: string,
	kind?: string,
): Promise<{ id: string; title: string; kind: string }> {
	const response = await axios.post(
		`${UNLOK_BASE_URL}/memory/facts`,
		{ text, ...(kind ? { kind } : {}) },
		{ headers: headers(apiKey), timeout: 15_000, ...getAxiosSettings() },
	)
	const data = (response.data ?? {}) as Record<string, unknown>
	return { id: String(data.id ?? ""), title: String(data.title ?? ""), kind: String(data.kind ?? "") }
}

export async function closeUnlokSession(input: {
	apiKey: string
	sessionId: string
	messages: Array<{ role: string; content: string }>
	reason: string
}): Promise<{ factsWritten: number; titles: string[] }> {
	const response = await axios.post(
		`${UNLOK_BASE_URL}/sessions/close`,
		{ session_id: input.sessionId, messages: input.messages, reason: input.reason },
		{ headers: { ...headers(input.apiKey), "X-Unlok-Session-Id": input.sessionId }, timeout: 90_000, ...getAxiosSettings() },
	)
	const data = (response.data ?? {}) as Record<string, unknown>
	return {
		factsWritten: Number(data.facts_written ?? 0),
		titles: Array.isArray(data.titles) ? data.titles.map(String) : [],
	}
}
