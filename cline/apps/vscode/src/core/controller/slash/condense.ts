import { Empty, StringRequest } from "@shared/proto/cline/common"
import type { Controller } from ".."

/**
 * Condense / compact slash command logic.
 *
 * Runs a real manual compaction over the active task's conversation (the
 * same effect as the CLI's `/compact` / `/smol` command), instead of sending
 * the literal text `/compact` to the model. The model does not treat
 * `/compact` as a command, so the old behavior produced an improvised fake
 * summary without actually compacting the context (CLINE-2503).
 *
 * The request value is the command word, optionally followed by a focus:
 * "compact" or "compact keep the migration numbers". The focus tells the
 * summarizer what to pay particular attention to; it never replaces the
 * fixed sections of the note.
 */
export async function condense(controller: Controller, request: StringRequest): Promise<Empty> {
	await controller.compactTask(parseCompactFocus(request.value))
	return Empty.create()
}

export const COMPACT_FOCUS_MAX_CHARS = 500

/** "compact keep X" -> "keep X"; "/smol" -> undefined. */
export function parseCompactFocus(value: string | undefined): string | undefined {
	const text = (value ?? "").trim()
	const match = /^\/?(?:compact|smol|newtask)(?:\s+([\s\S]*))?$/i.exec(text)
	const focus = (match ? (match[1] ?? "") : text).trim()
	if (!focus) {
		return undefined
	}
	return focus.slice(0, COMPACT_FOCUS_MAX_CHARS)
}
