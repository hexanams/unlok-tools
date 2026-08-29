import type { UnlokWorkspaceInfo } from "@shared/proto/cline/account"

interface UnlokWorkspaceInfoCardProps {
	info: UnlokWorkspaceInfo
}

/**
 * "On success, do not drop the user straight into an empty chat with no
 * information. Show what the workspace allows... This is the moment to
 * teach the constraints, because every one of them will otherwise first
 * appear as a refusal." Rendered inline as the connected state of
 * UnlokSignInGate.tsx, matching the design mockup's "WHAT YOUR WORKSPACE
 * ALLOWS" box -- not a separate dismissible card on the welcome screen
 * (that placement was a working constraint from an earlier round, before
 * the sign-in flow was restructured to keep the connected state mounted).
 * `info` is fetched once by the parent (ConnectedPanel) and passed down --
 * ConnectedPanel also needs the same response's userName/userEmail for the
 * greeting above this card, so fetching here too would just duplicate the
 * `GET /v1/me` round trip.
 */
export const UnlokWorkspaceInfoCard: React.FC<UnlokWorkspaceInfoCardProps> = ({ info }) => {
	const isManaged = info.accessMode === "unlok"

	return (
		<div className="rounded-xs border border-editor-group-border bg-code px-3 py-2.5 text-xs">
			<div className="text-description uppercase tracking-wide text-[10px] mb-2">What your workspace allows</div>
			<div className="flex flex-col gap-1.5">
				<div className="flex items-center justify-between">
					<span className="text-description">Models</span>
					<span className="font-mono tabular-nums">
						{info.models.length} of {info.totalSelectableModels}
					</span>
				</div>
				{isManaged && (
					<div className="flex items-center justify-between">
						<span className="text-description">Your budget, this month</span>
						<span className="font-mono tabular-nums">
							<span className="text-success">${info.budget?.spentUsd.toFixed(2)}</span> of $
							{info.budget?.capUsd.toFixed(2)}
						</span>
					</div>
				)}
				{info.disabledModelCount > 0 && (
					<div className="flex items-center justify-between">
						<span className="text-description">Restricted by your organization</span>
						<span className="font-mono tabular-nums text-warning">{info.disabledModelCount}</span>
					</div>
				)}
			</div>
		</div>
	)
}
