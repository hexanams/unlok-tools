/**
 * Manual compaction through Unlok.
 *
 * When the active provider is Unlok, `/compact` asks the backend to fold the
 * conversation (POST /v1/sessions/compact) instead of running the SDK's
 * local, provider-agnostic summarizer. The backend runs the same fold it
 * runs on tier escalation: same policy, same candidate order, a memory bank
 * row for the dashboard, billed like any other request, and the session's
 * tier and sticky provider stay attached because the client keeps its own
 * session id (also sent as X-Unlok-Session-Id on every chat completion).
 *
 * The returned note replaces the folded prefix in the SDK's compaction
 * sidecar, so the model's working context shrinks exactly the way a local
 * compaction would have shrunk it. When the backend cannot be reached the
 * caller falls back to the local path; a compaction must never fail only
 * because the network did.
 */

import { createSessionCompactionState, type SessionCompactionState } from "@cline/core"
import type { Message as SdkMessage } from "@cline/llms"
import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"

const UNLOK_BASE_URL = "https://unlok-backend-xpts.onrender.com/v1"

/** Mirrors the marker the backend uses when it applies its own rolling summary. */
export const UNLOK_COMPACTION_NOTE_PREFIX = "[Compacted summary of earlier conversation]"

/** Tool inputs and results are flattened for the summarizer; past this they add cost, not signal. */
const MAX_BLOCK_CHARS = 4000

export interface UnlokCompactInput {
	apiKey: string
	sessionId: string
	messages: SdkMessage[]
	focus?: string
}

export type UnlokCompactOutcome =
	| {
			kind: "compacted"
			messages: SdkMessage[]
			compactionState: SessionCompactionState
			summary: string
			messagesFolded: number
			provider?: string
			model?: string
	  }
	/** The backend answered but declined: the history is still short, or the model returned nothing. */
	| { kind: "skipped"; reason: string }
	/** The backend could not be reached or refused (5xx, 401): the caller should compact locally. */
	| { kind: "unavailable"; reason: string }

interface CompactResponseBody {
	compacted?: boolean
	summary?: string | null
	keep_from_index?: number
	messages_folded?: number
	reason?: string | null
	provider?: string | null
	model?: string | null
}

export async function compactThroughUnlok(input: UnlokCompactInput): Promise<UnlokCompactOutcome> {
	const flattened = flattenSdkMessages(input.messages)
	if (flattened.length === 0) {
		return { kind: "skipped", reason: "empty" }
	}
	let body: CompactResponseBody
	try {
		const response = await axios.post<CompactResponseBody>(
			`${UNLOK_BASE_URL}/sessions/compact`,
			{
				messages: flattened,
				session_id: input.sessionId,
				...(input.focus?.trim() ? { focus: input.focus.trim() } : {}),
			},
			{
				headers: { Authorization: `Bearer ${input.apiKey}`, "X-Unlok-Session-Id": input.sessionId },
				timeout: 90_000,
				...getAxiosSettings(),
			},
		)
		body = response.data ?? {}
	} catch (error) {
		const status = axios.isAxiosError(error) ? error.response?.status : undefined
		const detail = axios.isAxiosError(error) ? (error.response?.data as { detail?: unknown } | undefined)?.detail : undefined
		Logger.warn(`[UnlokCompaction] Backend compaction unavailable (${status ?? "no response"}): ${String(detail ?? error)}`)
		return { kind: "unavailable", reason: typeof detail === "string" ? detail : `status ${status ?? "unreachable"}` }
	}

	if (!body.compacted || !body.summary) {
		return { kind: "skipped", reason: body.reason ?? "not_compacted" }
	}
	const keepFrom = clampKeepFrom(body.keep_from_index, input.messages.length)
	const compactedMessages = buildCompactedMessages(input.messages, keepFrom, body.summary)
	return {
		kind: "compacted",
		messages: compactedMessages,
		compactionState: createSessionCompactionState({
			sourceMessages: input.messages,
			compactedMessages,
			conversationId: input.sessionId,
		}),
		summary: body.summary,
		messagesFolded: body.messages_folded ?? keepFrom,
		provider: body.provider ?? undefined,
		model: body.model ?? undefined,
	}
}

/**
 * The note goes in as the first user turn, so the kept tail keeps its
 * user/assistant alternation and no provider sees two system prompts. When
 * the kept tail already starts with a user message the note is merged into
 * it as a leading text block rather than producing two user turns in a row.
 */
export function buildCompactedMessages(source: SdkMessage[], keepFrom: number, summary: string): SdkMessage[] {
	const note = `${UNLOK_COMPACTION_NOTE_PREFIX}\n${summary.trim()}`
	const tail = source.slice(keepFrom)
	const first = tail[0]
	if (first && first.role === "user") {
		const rest = tail.slice(1)
		const firstContent = typeof first.content === "string" ? [{ type: "text" as const, text: first.content }] : first.content
		return [{ ...first, content: [{ type: "text" as const, text: note }, ...firstContent] }, ...rest]
	}
	return [{ role: "user", content: note }, ...tail]
}

function clampKeepFrom(value: number | undefined, length: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return length
	}
	return Math.min(Math.max(Math.trunc(value), 0), length)
}

/**
 * The backend takes OpenAI-shaped `{role, content: string}` messages. Tool
 * calls and results are written out in words so the summarizer keeps what
 * was done; images and media become placeholders; thinking is dropped (it
 * was the model's own scratch work, and the note is provider neutral).
 */
export function flattenSdkMessages(messages: SdkMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
	const out: Array<{ role: "user" | "assistant"; content: string }> = []
	for (const message of messages) {
		if (message.role !== "user" && message.role !== "assistant") {
			continue
		}
		const content = flattenContent(message.content)
		if (!content.trim()) {
			continue
		}
		out.push({ role: message.role, content })
	}
	return out
}

function flattenContent(content: SdkMessage["content"]): string {
	if (typeof content === "string") {
		return content
	}
	const parts: string[] = []
	for (const block of content) {
		switch (block.type) {
			case "text":
				parts.push(block.text)
				break
			case "tool_use":
				parts.push(`[Tool call: ${block.name}]\n${truncate(safeJson(block.input))}`)
				break
			case "tool_result": {
				const label = block.is_error ? `[Tool result (error): ${block.name}]` : `[Tool result: ${block.name}]`
				const body =
					typeof block.content === "string"
						? block.content
						: block.content
								.map((inner) =>
									inner.type === "text"
										? inner.text
										: inner.type === "file"
											? `[File: ${inner.path}]`
											: "[Image]",
								)
								.join("\n")
				parts.push(`${label}\n${truncate(body)}`)
				break
			}
			case "file":
				parts.push(`[File: ${block.path}]\n${truncate(block.content)}`)
				break
			case "image":
				parts.push("[Image]")
				break
			case "media":
				parts.push("[Media]")
				break
			default:
				// thinking / redacted_thinking: intentionally dropped.
				break
		}
	}
	return parts.join("\n\n")
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

function truncate(text: string): string {
	if (text.length <= MAX_BLOCK_CHARS) {
		return text
	}
	return `${text.slice(0, MAX_BLOCK_CHARS)}\n… [${text.length - MAX_BLOCK_CHARS} more characters]`
}
