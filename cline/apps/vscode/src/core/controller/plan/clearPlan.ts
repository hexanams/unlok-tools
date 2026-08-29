import { Empty, type EmptyRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

export async function clearPlan(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	controller.plan.clear()
	return Empty.create({})
}
