import type { EmptyRequest } from "@shared/proto/cline/common"
import type { PlanState } from "@shared/proto/cline/plan"
import { getRequestRegistry, type StreamingResponseHandler } from "@/core/controller/grpc-handler"
import type { Controller } from "../index"

/** Streams live plan state -- same registerRequest/cleanup shape as AccountService's subscribeToAuthStatusUpdate. */
export async function subscribeToPlanState(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<PlanState>,
	requestId?: string,
): Promise<void> {
	await controller.plan.subscribe(responseStream)

	if (requestId) {
		getRequestRegistry().registerRequest(
			requestId,
			() => controller.plan.unsubscribe(responseStream),
			{ type: "planState_subscription" },
			responseStream,
		)
	}
}
