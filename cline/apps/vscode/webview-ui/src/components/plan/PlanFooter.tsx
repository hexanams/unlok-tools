import type { PlanState } from "@shared/proto/cline/plan"
import { RunPlanStepsRequest } from "@shared/proto/cline/plan"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { PlanServiceClient } from "@/services/grpc-client"

function totalEstimateText(state: PlanState): string {
	const total = state.totalEstimate
	if (!total) return ""
	if (!total.isRange) return `$${total.exactUsd.toFixed(2)}`
	return `$${total.lowUsd.toFixed(2)} – $${total.highUsd.toFixed(2)}`
}

/**
 * Explains the range, when there is one -- generated client-side from the
 * structured plan (which step is a range, and why) rather than sent as free
 * text from the backend, so app/plan.py's response stays purely structured.
 */
function rangeExplanation(state: PlanState): string | undefined {
	const index = state.steps.findIndex((s) => s.estimate?.isRange)
	if (index === -1) return undefined
	const step = state.steps[index]
	const dependsOnIndex = state.steps.findIndex((s) => s.id === step.dependsOnStepId)
	const stepNumber = index + 1
	const dependsOnNumber = dependsOnIndex === -1 ? undefined : dependsOnIndex + 1
	const tierNote = step.tier === "smart" ? ` Step ${stepNumber} escalates to the smart tier.` : ""
	const dependsNote =
		dependsOnNumber !== undefined
			? `Priced as a range because ${step.scope} is not known until step ${dependsOnNumber} runs.`
			: `Priced as a range because ${step.scope} isn't fully known yet.`
	return `${tierNote} ${dependsNote}`.trim()
}

export const PlanFooter: React.FC<{ state: PlanState }> = ({ state }) => {
	const [running, setRunning] = useState<"run_remaining" | "step" | null>(null)
	const explanation = rangeExplanation(state)
	const isRunning = state.runStatus === "running"
	const isCompleted = state.runStatus === "completed"
	const hasPendingSteps = state.steps.some((s) => s.status === "pending")

	async function run(mode: "run_remaining" | "step") {
		setRunning(mode)
		try {
			await PlanServiceClient.runPlanSteps(RunPlanStepsRequest.create({ mode }))
		} catch (err) {
			console.error("Failed to run plan steps:", err)
		} finally {
			setRunning(null)
		}
	}

	return (
		<div className="flex flex-col gap-3 border-t border-hairline pt-3 dark:border-dark-border">
			<div>
				<div className="font-mono text-[13px]">
					<span className="text-secondary dark:text-dark-body">Estimated to finish</span>{" "}
					<b className="text-ink dark:text-dark-text">{totalEstimateText(state)}</b>
				</div>
				{explanation && (
					<p className="mt-1 text-[11.5px] leading-relaxed text-faint dark:text-dark-body">{explanation}</p>
				)}
			</div>

			{state.pausedAfterStepId && (
				<p className="text-[12px] italic text-accent-deep dark:text-accent">
					Paused after {state.steps.find((s) => s.id === state.pausedAfterStepId)?.title ?? "the last step"}, waiting on
					you.
				</p>
			)}

			{hasPendingSteps && !isCompleted && (
				<div className="flex gap-2">
					<VSCodeButton
						appearance="primary"
						className="flex-1"
						disabled={isRunning}
						onClick={() => run("run_remaining")}>
						{running === "run_remaining" ? "Running…" : "Run remaining"}
					</VSCodeButton>
					<VSCodeButton appearance="secondary" className="flex-1" disabled={isRunning} onClick={() => run("step")}>
						{running === "step" ? "Running…" : "Step through"}
					</VSCodeButton>
				</div>
			)}

			<p className="text-[11px] leading-relaxed text-faint dark:text-dark-body">
				Nothing runs until you approve. Each step is priced before it executes and stops if it overruns.
			</p>
		</div>
	)
}
