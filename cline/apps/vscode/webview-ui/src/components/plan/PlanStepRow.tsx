import type { PlanCostEstimate, PlanStep } from "@shared/proto/cline/plan"
import { Badge } from "@/components/ui/badge"

function tierLabel(tier: string): string {
	return tier.charAt(0).toUpperCase() + tier.slice(1)
}

function formatCost(estimate: PlanCostEstimate | undefined, status: string): string {
	if (!estimate) return ""
	// A tool-only step (estimate is always exact $0, see plan_generation.py's
	// _estimate_step) reads as "no model cost", not "$0.00" -- the point is
	// there's genuinely nothing to price, not that pricing rounded to zero.
	if (!estimate.isRange && estimate.exactUsd === 0) {
		return "no model cost"
	}
	const known = status === "done"
	if (estimate.isRange) {
		return known ? `$${estimate.exactUsd.toFixed(3)}` : `est $${estimate.lowUsd.toFixed(2)}–$${estimate.highUsd.toFixed(2)}`
	}
	return known || status === "in_progress" ? `$${estimate.exactUsd.toFixed(3)}` : `est $${estimate.exactUsd.toFixed(2)}`
}

export const PlanStepRow: React.FC<{ step: PlanStep }> = ({ step }) => {
	const isDone = step.status === "done"
	const isActive = step.status === "in_progress"

	return (
		<div className="grid grid-cols-[16px_1fr_auto_auto] items-center gap-3 border-b border-hairline py-2.5 last:border-0 dark:border-dark-border">
			<span
				className={`text-center text-[13px] ${
					isDone ? "text-good dark:text-[#5fb37f]" : isActive ? "text-accent-deep dark:text-accent" : "text-faint"
				}`}>
				{isDone ? "✓" : isActive ? "▶" : "○"}
			</span>
			<div className="min-w-0">
				<div
					className={`truncate text-[13px] font-medium ${
						isDone
							? "text-faint line-through decoration-hairline dark:text-dark-body"
							: "text-ink dark:text-dark-text"
					}`}>
					{step.title}
				</div>
				<div className="truncate font-mono text-[11px] text-faint dark:text-dark-body">{step.scope}</div>
			</div>
			<Badge className="border-cline/30 bg-cline/10 font-mono text-cline" type="default">
				{tierLabel(step.tier)}
			</Badge>
			<span className="whitespace-nowrap font-mono text-[12.5px] tabular-nums text-secondary dark:text-dark-body">
				{formatCost(step.estimate, step.status)}
			</span>
		</div>
	)
}
