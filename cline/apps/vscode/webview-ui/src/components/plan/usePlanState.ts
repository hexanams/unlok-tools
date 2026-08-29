import { EmptyRequest } from "@shared/proto/cline/common"
import type { PlanState } from "@shared/proto/cline/plan"
import { useEffect, useState } from "react"
import { PlanServiceClient } from "@/services/grpc-client"

/**
 * Live subscription to the extension host's PlanCoordinator -- same shape as
 * ClineAuthContext's subscribeToAuthStatusUpdate usage. Returns null until
 * the first push arrives (no plan generated yet, or the subscription hasn't
 * connected) and again once the plan is cleared.
 */
export function usePlanState(): PlanState | null {
	const [state, setState] = useState<PlanState | null>(null)

	useEffect(() => {
		const cancel = PlanServiceClient.subscribeToPlanState(EmptyRequest.create({}), {
			onResponse: (response: PlanState) => {
				setState(response.steps.length > 0 || response.runStatus !== "idle" ? response : null)
			},
			onError: (error: Error) => {
				console.error("Error in plan state subscription:", error)
			},
			onComplete: () => {},
		})
		return () => cancel()
	}, [])

	return state
}
