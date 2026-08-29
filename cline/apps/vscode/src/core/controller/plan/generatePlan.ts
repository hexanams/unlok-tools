import type { GeneratePlanRequest } from "@shared/proto/cline/plan"
import { PlanState } from "@shared/proto/cline/plan"
import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

// Same URL getUnlokWorkspaceInfo.ts uses for /v1/me -- duplicated rather
// than imported for the same reason that file's own comment gives: the
// extension host and the SDK are separate bundles.
const UNLOK_BASE_URL = "https://unlok-backend-xpts.onrender.com/v1"

interface BackendPlanStep {
	id: string
	title: string
	scope: string
	tier: string
	kind: string
	depends_on_step_id: string | null
	estimate: BackendCostEstimate
	status: string
}

interface BackendCostEstimate {
	is_range: boolean
	exact_usd: number | null
	low_usd: number | null
	high_usd: number | null
}

function mapEstimate(e: BackendCostEstimate) {
	return {
		isRange: e.is_range,
		exactUsd: e.exact_usd ?? 0,
		lowUsd: e.low_usd ?? 0,
		highUsd: e.high_usd ?? 0,
	}
}

function mapStep(s: BackendPlanStep) {
	return {
		id: s.id,
		title: s.title,
		scope: s.scope,
		tier: s.tier,
		kind: s.kind,
		dependsOnStepId: s.depends_on_step_id ?? "",
		estimate: mapEstimate(s.estimate),
		status: s.status,
	}
}

/**
 * Calls POST /v1/plan to decompose the goal into a priced, tiered step
 * plan, then stores the result in the controller's PlanCoordinator (the
 * only place plan run-state lives -- this call itself is stateless on the
 * backend). Mirrors getUnlokWorkspaceInfo.ts's exact call shape.
 */
export async function generatePlan(controller: Controller, request: GeneratePlanRequest): Promise<PlanState> {
	const apiConfiguration = controller.stateManager.getApiConfiguration()
	const apiKey = apiConfiguration?.unlokApiKey
	if (!apiKey) {
		throw new Error("Not signed in to Unlok")
	}

	try {
		const response = await axios.post(
			`${UNLOK_BASE_URL}/plan`,
			{ goal: request.goal, routing_policy: request.routingPolicy || "balanced" },
			{ headers: { Authorization: `Bearer ${apiKey}` }, ...getAxiosSettings() },
		)
		const data = response.data ?? {}
		const steps = Array.isArray(data.steps) ? data.steps.map(mapStep) : []
		return await controller.plan.setPlan(steps, mapEstimate(data.total_estimate ?? {}), request.routingPolicy || "balanced")
	} catch (error) {
		Logger.error(`Failed to generate Unlok plan: ${error}`)
		throw error
	}
}
