import type { AskOptimusRequest } from "@shared/proto/cline/optimus"
import { OptimusAnswer } from "@shared/proto/cline/optimus"
import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

// Same URL getUnlokWorkspaceInfo.ts and generatePlan.ts use -- duplicated
// rather than imported for the same reason those files' own comments give:
// the extension host and the SDK are separate bundles.
const UNLOK_BASE_URL = "https://unlok-backend-xpts.onrender.com/v1"

// Keyed by API key, not a single value: several Unlok workspaces can stay
// connected at once (see account/unlokWorkspaces.ts) and the active one can
// change mid-session, so one cached id would silently answer for the wrong
// account after a switch. Resolved at most once per key per extension host
// lifetime -- POST /v1/optimus/{user_id} needs it in the path and this
// flow has no other reason to already know it.
const userIdByApiKey = new Map<string, string>()

async function resolveUserId(apiKey: string): Promise<string> {
	const cached = userIdByApiKey.get(apiKey)
	if (cached) {
		return cached
	}

	const response = await axios.get(`${UNLOK_BASE_URL}/me`, {
		headers: { Authorization: `Bearer ${apiKey}` },
		...getAxiosSettings(),
	})
	const userId = String(response.data?.user_id ?? "")
	if (!userId) {
		throw new Error("Could not identify your Unlok account.")
	}
	userIdByApiKey.set(apiKey, userId)
	return userId
}

/**
 * Calls POST /v1/optimus/{user_id} with the question and answers from
 * the account's (or pooled team's, per the backend's own role-based grant)
 * already-digested Optimus memory. Mirrors generatePlan.ts's call shape.
 *
 * If a task is actively running (controller.isTaskLiveSessionActive()), the
 * answer is fed into that task's own live conversation via
 * handleWebviewAskResponse -- the same path a real typed follow-up goes
 * through, including one sent mid-stream (see useMessageHandlers.ts's
 * "queued/steering feedback" handling) -- so the agent's own next step
 * actually reflects what was just learned, not just a note left for the
 * human. `controller.task` alone isn't enough to gate on: it stays truthy
 * long after a task finishes, aborts, or errors (only clearTask() resets
 * it), and delivering into a task with no live backing session forces a
 * reconstruction from history that can land as a near-fresh session instead
 * of a real continuation -- see isTaskLiveSessionActive's own comment.
 * With no genuinely active task, this falls back to postInfoMessage, the
 * same display-only path a compaction result or a hook status update uses.
 * Either way the proto response is still returned for the caller/tests.
 */
export async function askOptimus(controller: Controller, request: AskOptimusRequest): Promise<OptimusAnswer> {
	const apiConfiguration = controller.stateManager.getApiConfiguration()
	const apiKey = apiConfiguration?.unlokApiKey
	if (!apiKey) {
		controller.postInfoMessage("Connect your Unlok account first (Unlok sign-in) to ask Optimus a question.")
		throw new Error("Not signed in to Unlok")
	}

	const question = request.question?.trim()
	if (!question) {
		controller.postInfoMessage("Usage: /optimus <question>")
		return OptimusAnswer.create({ answer: "", memoriesConsidered: 0, fromCachedDigest: false })
	}

	try {
		const userId = await resolveUserId(apiKey)
		const response = await axios.post(
			`${UNLOK_BASE_URL}/optimus/${userId}`,
			{ question },
			{ headers: { Authorization: `Bearer ${apiKey}` }, ...getAxiosSettings() },
		)
		const data = response.data ?? {}
		const answer = OptimusAnswer.create({
			answer: String(data.answer ?? ""),
			memoriesConsidered: Number(data.memories_considered ?? 0),
			fromCachedDigest: Boolean(data.from_cached_digest ?? false),
		})

		if (controller.task && controller.isTaskLiveSessionActive()) {
			// A real turn in the live conversation, not a display-only note --
			// this is deliberately NOT also calling postInfoMessage, since
			// messageResponse already renders as a normal chat turn (the same
			// way a typed follow-up would), and showing both would double it.
			await controller.task.handleWebviewAskResponse(
				"messageResponse",
				`[Optimus] Q: ${question}\nA: ${answer.answer}\n\nContinue with what you were doing.`,
			)
		} else {
			controller.postInfoMessage(`Q: ${question}\n\n${answer.answer}`)
		}
		return answer
	} catch (error) {
		Logger.error(`Failed to ask Optimus: ${error}`)
		const message = error instanceof Error ? error.message : String(error)
		controller.postInfoMessage(`Optimus couldn't answer that: ${message}`)
		throw error
	}
}
