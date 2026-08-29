import type { PlanState } from "@shared/proto/cline/plan"
import { PlanCard } from "./PlanCard"
import { PlanFooter } from "./PlanFooter"

/**
 * Renders in place of the normal task/message column when the composer's
 * Plan pill is selected and a plan has been generated -- same "replace, not
 * layer" pattern UnlokSignInGate uses in place of the chat layout's message
 * area. The composer below (still ChatTextArea, via InputSection) stays
 * mounted for "Change a step, or add one".
 */
export const PlanView: React.FC<{ state: PlanState }> = ({ state }) => {
	const doneCount = state.steps.filter((s) => s.status === "done").length
	const spentUsd = state.steps.filter((s) => s.status === "done").reduce((sum, s) => sum + (s.estimate?.exactUsd ?? 0), 0)

	return (
		<div className="flex h-full w-full flex-col overflow-y-auto px-4 py-4">
			<div className="mb-3 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span className="size-2 rounded-[3px] bg-cline" />
					<span className="text-[11px] font-semibold tracking-wide text-ink dark:text-dark-text">UNLOK / PLAN</span>
				</div>
				<span className="font-mono text-[11px] text-faint dark:text-dark-body">
					{state.steps.length} steps · {doneCount} done · ${spentUsd.toFixed(2)}
				</span>
			</div>

			<PlanCard state={state} />

			<div className="mt-3">
				<PlanFooter state={state} />
			</div>
		</div>
	)
}
