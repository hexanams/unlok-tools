import type { EditPlanStepRequest, PlanState } from "@shared/proto/cline/plan"
import type { Controller } from "../index"

export async function editPlanStep(controller: Controller, request: EditPlanStepRequest): Promise<PlanState> {
	return controller.plan.editStep({
		stepId: request.stepId,
		title: request.title || undefined,
		scope: request.scope || undefined,
		tier: request.tier || undefined,
		remove: request.remove,
	})
}
