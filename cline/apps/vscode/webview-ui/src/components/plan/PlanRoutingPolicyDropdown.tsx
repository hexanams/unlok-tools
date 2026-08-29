const POLICIES = [
	{ value: "balanced", label: "Balanced" },
	{ value: "fast", label: "Fast" },
	{ value: "cost_first", label: "Cost first" },
	{ value: "quality_first", label: "Quality first" },
] as const

/**
 * Local UI state only (see ChatState.planRoutingPolicy) -- shapes how
 * generatePlan tiers steps, sent fresh on every call. Not a persisted
 * account setting: routing_policy is only writable via the Clerk-gated
 * dashboard endpoint today, not reachable with the extension's API-key auth.
 */
export const PlanRoutingPolicyDropdown: React.FC<{ value: string; onChange: (value: string) => void }> = ({
	value,
	onChange,
}) => {
	return (
		<select
			className="h-6 shrink-0 cursor-pointer rounded-full border border-input-border bg-input-background/40 px-2 text-xs font-medium text-input-foreground hover:bg-input-background/70"
			onChange={(e) => onChange(e.target.value)}
			value={value}>
			{POLICIES.map((p) => (
				<option key={p.value} value={p.value}>
					{p.label}
				</option>
			))}
		</select>
	)
}
