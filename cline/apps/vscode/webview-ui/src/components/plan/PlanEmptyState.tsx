/**
 * Fills the message column while Plan mode is selected but no plan exists
 * yet -- generating a plan is a single non-streaming RPC (generatePlan.ts)
 * with no progress signal of its own, so without this the screen looked
 * inert the entire time it was in flight, and a failure (no credential,
 * backend error, network) was only ever a console.error, never anything
 * the user could see. See useMessageHandlers.ts's planModeSelected branch
 * for where these two states are actually set.
 */
export const PlanEmptyState: React.FC<{ generating: boolean; error: string | null }> = ({ generating, error }) => {
	return (
		<div className="flex h-full w-full flex-col items-center justify-center gap-3 px-7 text-center">
			{generating ? (
				<>
					<span className="codicon codicon-loading codicon-modifier-spin text-2xl text-cline" />
					<p className="m-0 text-description text-sm">Planning your task…</p>
				</>
			) : error ? (
				<>
					<span className="codicon codicon-error text-2xl text-error-foreground" />
					<p className="m-0 max-w-sm text-description text-sm">Couldn't generate a plan: {error}</p>
					<p className="m-0 text-description/70 text-xs">Try again below, or switch to Auto to send this as a normal message.</p>
				</>
			) : (
				<>
					<h2 className="m-0 text-[1.05em] font-semibold">Describe the task to plan</h2>
					<p className="m-0 max-w-sm text-description text-sm">
						Unlok will break it into priced, tiered steps below before anything runs.
					</p>
				</>
			)}
		</div>
	)
}
