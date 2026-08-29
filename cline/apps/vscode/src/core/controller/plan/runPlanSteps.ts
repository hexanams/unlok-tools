import { Empty } from "@shared/proto/cline/common"
import type { RunPlanStepsRequest } from "@shared/proto/cline/plan"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Kicks off the run and returns immediately -- a step (let alone "every
 * remaining step") can take minutes, and this is a unary RPC, not a stream,
 * so awaiting full completion here would hang the webview's call. Progress
 * is observed separately via subscribeToPlanState's live broadcasts.
 */
export async function runPlanSteps(controller: Controller, request: RunPlanStepsRequest): Promise<Empty> {
	const mode = request.mode === "step" ? "step" : "run_remaining"
	controller.plan.runSteps(mode).catch((error) => {
		Logger.error(`[runPlanSteps] Run failed: ${error}`)
	})
	return Empty.create({})
}
