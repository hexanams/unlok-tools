import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { unlokWorkspaceLabel } from "@/components/account/UnlokAccountView"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"

const MAX_SWITCH_TARGETS = 3

/**
 * Shown under a failed request when chat runs through Unlok: the way out is
 * another connected workspace, reconnecting this one, or adding one. Renders
 * nothing for other providers or when no workspace is connected, so ErrorRow
 * can include it unconditionally.
 */
export const UnlokWorkspaceErrorActions = () => {
	const { unlokWorkspaces, apiConfiguration, mode } = useExtensionState()
	const provider = mode === "plan" ? apiConfiguration?.planModeApiProvider : apiConfiguration?.actModeApiProvider
	if (provider !== "unlok" || !unlokWorkspaces || unlokWorkspaces.length === 0) {
		return null
	}
	const active = unlokWorkspaces.find((w) => w.active)
	const alternatives = unlokWorkspaces.filter((w) => !w.active && !w.lastError).slice(0, MAX_SWITCH_TARGETS)

	const signIn = () =>
		AccountServiceClient.unlokAuthClicked(EmptyRequest.create()).catch((error) =>
			console.error("Failed to open Unlok auth:", error),
		)
	const switchTo = (id: string) =>
		AccountServiceClient.setActiveUnlokWorkspace(StringRequest.create({ value: id })).catch((error) =>
			console.error("Failed to switch Unlok workspace:", error),
		)

	return (
		<span className="flex flex-col gap-2 text-foreground">
			{active && (
				<span className="text-description text-xs">
					This happened on {unlokWorkspaceLabel(active)}
					{active.email ? ` (${active.email})` : ""}.
					{alternatives.length > 0 ? " Switching ends this session and starts fresh in the other workspace." : ""}
				</span>
			)}
			<span className="flex flex-wrap gap-2">
				{alternatives.map((workspace) => (
					<VSCodeButton appearance="secondary" key={workspace.id} onClick={() => switchTo(workspace.id)}>
						Switch to {unlokWorkspaceLabel(workspace)}
					</VSCodeButton>
				))}
				{active && (
					<VSCodeButton appearance="secondary" onClick={signIn}>
						Reconnect {unlokWorkspaceLabel(active)}
					</VSCodeButton>
				)}
				{alternatives.length === 0 && (
					<VSCodeButton appearance="secondary" onClick={signIn}>
						Add another workspace
					</VSCodeButton>
				)}
			</span>
		</span>
	)
}
