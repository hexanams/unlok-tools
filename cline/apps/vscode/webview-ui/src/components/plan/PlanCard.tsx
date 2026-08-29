import type { PlanState } from "@shared/proto/cline/plan"
import { PlanStepRow } from "./PlanStepRow"

export const PlanCard: React.FC<{ state: PlanState }> = ({ state }) => {
	return (
		<div className="rounded-lg border border-hairline bg-raised px-4 py-1 dark:border-dark-border dark:bg-dark-card">
			<div className="border-b border-hairline py-2.5 dark:border-dark-border">
				<span className="text-[13px] font-semibold text-ink dark:text-dark-text">Plan</span>
			</div>
			{state.steps.map((step) => (
				<PlanStepRow key={step.id} step={step} />
			))}
		</div>
	)
}
