// Holds and runs the current Unlok step-plan. POST /v1/plan (see
// getUnlokWorkspaceInfo.ts's sibling generatePlan.ts handler) is stateless --
// this is the only place plan run-state (which step is in progress,
// paused-after, actual per-step status) lives. Persisted to a per-task JSON
// file the same way FocusChain persists its checklist (see
// core/task/focus-chain/file-utils.ts), so a paused plan survives a window
// reload.

import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { TurnPhase } from "@shared/ExtensionMessage"
import type { PlanState, PlanStep } from "@shared/proto/cline/plan"
import { PlanState as PlanStateProto } from "@shared/proto/cline/plan"
import type { StreamingResponseHandler } from "@/core/controller/grpc-handler"
import { ensureTaskDirectoryExists } from "@/core/storage/disk"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"

const PLAN_FILE_PREFIX = "plan_taskid_"

// No push-based "turn just settled" event exists anywhere in this codebase
// (TurnStateTracker, src/sdk/turn-state-tracker.ts, is a plain get/set value
// holder with no subscription API) -- polling its getter is the safe way to
// notice a step's turn has finished without adding new event plumbing to
// code Auto/Manual also depend on. Short enough that a fast step (a few
// seconds) doesn't feel laggy; long enough not to matter for a slow one.
const TURN_POLL_MS = 400
// A single step is one ordinary agentic turn -- if it hasn't settled in this
// long something is genuinely stuck, not just slow, so treat it as a
// failure rather than polling forever.
const TURN_TIMEOUT_MS = 15 * 60 * 1000
const TERMINAL_PHASES: TurnPhase[] = ["completed", "error", "resumable"]

export interface PlanCoordinatorOptions {
	stateManager: StateManager
	getTaskId: () => string | undefined
	getTurnPhase: () => TurnPhase
	/**
	 * Runs one step's turn: pins actModeUnlokModelId to the step's tier
	 * (already set by the caller) and sends `prompt` as an auto-continued,
	 * auto-approved act-mode turn via the existing
	 * SdkModeCoordinator.rebuildSessionForMode("act", ...) -- the same
	 * public entrypoint the classic Plan/Act toggle uses, called here with
	 * the mode unchanged (already "act") so it only ever rebuilds the
	 * session for the new model, never touches the mode-switch-notice path
	 * (recordModeSwitchNotice no-ops when from === to). Resolves once the
	 * turn has been HANDED OFF (fire-and-forget send), not once it
	 * completes -- callers must await turn settlement separately.
	 */
	rebuildSessionForStep: (tier: string, prompt: string) => Promise<boolean>
}

export class PlanCoordinator {
	private state: PlanState | undefined
	private handlers = new Set<StreamingResponseHandler<PlanState>>()

	constructor(private options: PlanCoordinatorOptions) {}

	getState(): PlanState | undefined {
		return this.state
	}

	async setPlan(steps: PlanStep[], totalEstimate: PlanState["totalEstimate"], routingPolicy: string): Promise<PlanState> {
		this.state = PlanStateProto.create({
			steps,
			totalEstimate,
			routingPolicy,
			doneCount: 0,
			runStatus: "idle",
			pausedAfterStepId: "",
		})
		await this.persist()
		await this.broadcast()
		return this.state
	}

	async editStep(input: {
		stepId: string
		title?: string
		scope?: string
		tier?: string
		remove?: boolean
	}): Promise<PlanState> {
		if (!this.state) {
			throw new Error("No active plan to edit")
		}
		if (input.remove) {
			this.state.steps = this.state.steps.filter((s) => s.id !== input.stepId)
		} else {
			const step = this.state.steps.find((s) => s.id === input.stepId)
			if (step) {
				if (input.title) step.title = input.title
				if (input.scope) step.scope = input.scope
				if (input.tier) step.tier = input.tier
			}
		}
		await this.persist()
		await this.broadcast()
		return this.state
	}

	/**
	 * Runs the next pending step ("step") or every remaining pending step in
	 * order ("run_remaining"), pausing between steps either way -- "step"
	 * always stops after exactly one; "run_remaining" keeps going until
	 * nothing pending is left or a step errors. Never runs more than one
	 * step concurrently (this whole method is one sequential loop), matching
	 * the mockup's "nothing runs until you approve" guarantee -- each step
	 * still requires this call, which only ever fires from an explicit
	 * "Run remaining"/"Step through" click.
	 */
	async runSteps(mode: "run_remaining" | "step"): Promise<void> {
		if (!this.state) {
			return
		}
		this.state.runStatus = "running"
		this.state.pausedAfterStepId = ""
		await this.broadcast()

		for (;;) {
			const next = this.state.steps.find((s) => s.status === "pending")
			if (!next) {
				this.state.runStatus = "completed"
				break
			}

			next.status = "in_progress"
			await this.broadcast()

			this.options.stateManager.setGlobalState("actModeUnlokModelId", next.tier)
			const prompt = `Do exactly this step, and only this step: ${next.title}. Scope: ${next.scope}. When it's done, stop -- do not continue to any further work.`
			const sent = await this.options.rebuildSessionForStep(next.tier, prompt)
			if (!sent) {
				next.status = "pending"
				this.state.runStatus = "failed"
				await this.persist()
				await this.broadcast()
				return
			}

			const outcome = await this.awaitTurnSettled()
			if (outcome !== "completed") {
				// A step that errored, or one that's still waiting on a
				// follow-up question the auto-approved turn couldn't answer
				// itself ("resumable"), needs a human -- surfaced as paused
				// on this same step, not silently retried or skipped.
				this.state.runStatus = "paused"
				this.state.pausedAfterStepId = next.id
				next.status = "pending"
				await this.persist()
				await this.broadcast()
				return
			}

			next.status = "done"
			this.state.doneCount += 1
			await this.persist()
			await this.broadcast()

			if (mode === "step") {
				this.state.runStatus = "paused"
				this.state.pausedAfterStepId = next.id
				await this.broadcast()
				return
			}
		}

		await this.persist()
		await this.broadcast()
	}

	private async awaitTurnSettled(): Promise<TurnPhase> {
		const started = Date.now()
		while (Date.now() - started < TURN_TIMEOUT_MS) {
			const phase = this.options.getTurnPhase()
			if (TERMINAL_PHASES.includes(phase)) {
				return phase
			}
			await new Promise((resolve) => setTimeout(resolve, TURN_POLL_MS))
		}
		Logger.warn("[PlanCoordinator] Step turn did not settle within the timeout -- treating as an error")
		return "error"
	}

	clear(): void {
		this.state = undefined
		void this.persist()
		void this.broadcast()
	}

	async subscribe(handler: StreamingResponseHandler<PlanState>): Promise<void> {
		this.handlers.add(handler)
		if (this.state) {
			await handler(this.state, false)
		}
	}

	unsubscribe(handler: StreamingResponseHandler<PlanState>): void {
		this.handlers.delete(handler)
	}

	private async broadcast(): Promise<void> {
		if (!this.state) return
		const current = this.state
		await Promise.all(
			[...this.handlers].map(async (handler) => {
				try {
					await handler(current, false)
				} catch (error) {
					Logger.warn("[PlanCoordinator] Dropping a plan-state subscriber after a send failure:", error)
					this.handlers.delete(handler)
				}
			}),
		)
	}

	private planFilePath(taskId: string): Promise<string> {
		return ensureTaskDirectoryExists(taskId).then((dir) => path.join(dir, `${PLAN_FILE_PREFIX}${taskId}.json`))
	}

	private async persist(): Promise<void> {
		const taskId = this.options.getTaskId()
		if (!taskId) return
		try {
			const filePath = await this.planFilePath(taskId)
			if (!this.state) {
				await fs.rm(filePath, { force: true })
				return
			}
			await fs.writeFile(filePath, JSON.stringify(this.state), "utf8")
		} catch (error) {
			Logger.warn("[PlanCoordinator] Failed to persist plan state:", error)
		}
	}

	/** Restores a paused plan for the given task, if one was saved. Call once when a task becomes active. */
	async loadForTask(taskId: string): Promise<void> {
		try {
			const filePath = await this.planFilePath(taskId)
			const raw = await fs.readFile(filePath, "utf8")
			this.state = PlanStateProto.fromJSON(JSON.parse(raw))
		} catch {
			this.state = undefined
		}
	}
}
