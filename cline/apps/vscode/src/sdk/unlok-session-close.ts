/**
 * Tells Unlok when a task is over so curated facts can be extracted from
 * it (POST /v1/sessions/close). "Over" means: the agent used the completion
 * tool, a new task replaced it, or it sat idle for thirty minutes after its
 * last turn. Each session is closed at most once; the backend also caps
 * extraction to one per ten minutes per session, so a duplicate is cheap.
 */

import type { Message as SdkMessage } from "@cline/llms"
import { Logger } from "@/shared/services/Logger"
import { flattenSdkMessages } from "./unlok-compaction"

export const IDLE_CLOSE_MS = 30 * 60 * 1000

export interface UnlokSessionCloserOptions {
	/** The active workspace's key; undefined when the provider is not Unlok or nothing is connected. */
	getApiKey: () => string | undefined
	/** The transcript to extract from, or undefined when the session is gone. */
	readMessages: (sessionId: string) => Promise<SdkMessage[] | undefined>
	postClose: (input: {
		apiKey: string
		sessionId: string
		messages: Array<{ role: string; content: string }>
		reason: string
	}) => Promise<unknown>
	/** Injected for tests. */
	setTimer?: (fn: () => void, ms: number) => unknown
	clearTimer?: (handle: unknown) => void
}

export class UnlokSessionCloser {
	private idleHandle: unknown
	private idleSessionId: string | undefined
	private readonly closed = new Set<string>()

	constructor(private readonly options: UnlokSessionCloserOptions) {}

	/** A turn ended without the completion tool: close after thirty idle minutes unless another turn starts. */
	scheduleIdleClose(sessionId: string): void {
		this.cancelIdleClose()
		this.idleSessionId = sessionId
		const set = this.options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
		this.idleHandle = set(() => {
			this.idleHandle = undefined
			void this.close(sessionId, "idle")
		}, IDLE_CLOSE_MS)
	}

	/** A new turn started, or the task changed: the idle clock no longer applies. */
	cancelIdleClose(): void {
		if (this.idleHandle !== undefined) {
			const clear = this.options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
			clear(this.idleHandle)
			this.idleHandle = undefined
		}
		this.idleSessionId = undefined
	}

	/** Closes now; a session already closed, or one that never spoke to Unlok, is skipped. */
	async close(sessionId: string, reason: "completed" | "replaced" | "idle" | "cleared"): Promise<boolean> {
		if (this.idleSessionId === sessionId) {
			this.cancelIdleClose()
		}
		if (this.closed.has(sessionId)) {
			return false
		}
		const apiKey = this.options.getApiKey()
		if (!apiKey) {
			return false
		}
		let messages: SdkMessage[] | undefined
		try {
			messages = await this.options.readMessages(sessionId)
		} catch (error) {
			Logger.warn(`[UnlokSessionCloser] Could not read session ${sessionId} to close it:`, error)
			return false
		}
		const flattened = messages ? flattenSdkMessages(messages) : []
		if (flattened.length === 0) {
			return false
		}
		this.closed.add(sessionId)
		// The transcript is captured now, while the session still exists; the
		// post runs detached so ending a task never waits on the network. Best
		// effort: a closed session is never retried in a loop, and the backend's
		// own compaction path still extracts on the next fold.
		void Promise.resolve()
			.then(() => this.options.postClose({ apiKey, sessionId, messages: flattened, reason }))
			.catch((error) => {
				Logger.warn(`[UnlokSessionCloser] Closing session ${sessionId} failed:`, error)
			})
		return true
	}

	/** For tests and diagnostics. */
	hasClosed(sessionId: string): boolean {
		return this.closed.has(sessionId)
	}
}
