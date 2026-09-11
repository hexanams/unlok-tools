import type { UnlokWorkspaceInfo } from "@shared/proto/cline/account"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import type { UnlokWorkspaceSummary } from "@shared/ExtensionMessage"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { UnlokWorkspaceInfoCard } from "@/components/welcome/UnlokWorkspaceInfoCard"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"

// Same origin unlokAuthClicked.ts opens for sign in, so the dashboard link
// and the connect flow can never point at two different deployments.
const UNLOK_DASHBOARD_URL = "https://unlok-frontend-app.onrender.com"

export function unlokWorkspaceLabel(workspace: Pick<UnlokWorkspaceSummary, "workspaceName" | "teamId">): string {
	return workspace.workspaceName || (workspace.teamId ? "Workspace" : "Personal")
}

async function openUnlokSignIn() {
	try {
		await AccountServiceClient.unlokAuthClicked(EmptyRequest.create())
	} catch (error) {
		console.error("Failed to open Unlok auth:", error)
	}
}

/**
 * The Account tab once at least one Unlok workspace is connected. Every
 * connected workspace is listed; one is active and chat runs through it.
 * Adding or reconnecting goes through the same browser sign in, and the
 * callback appends to (or replaces in) the list instead of overwriting the
 * single key, so "personal plus my team" both stay connected.
 *
 * Before this existed the tab fell through to Cline's own welcome view, whose
 * button started Cline's OAuth flow and ended in a vscode://saoudrizwan.claude-dev
 * deep link that made VS Code offer to install upstream Cline.
 */
export const UnlokAccountView = () => {
	const { unlokWorkspaces = [] } = useExtensionState()
	const active = unlokWorkspaces.find((w) => w.active)
	const [info, setInfo] = useState<UnlokWorkspaceInfo | null>(null)
	const [infoFailed, setInfoFailed] = useState(false)

	useEffect(() => {
		setInfo(null)
		setInfoFailed(false)
		if (!active) {
			return
		}
		let cancelled = false
		AccountServiceClient.getUnlokWorkspaceInfo(EmptyRequest.create({}))
			.then((result) => {
				if (!cancelled) {
					setInfo(result)
				}
			})
			.catch((error) => {
				console.error("Failed to fetch Unlok workspace info:", error)
				if (!cancelled) {
					setInfoFailed(true)
				}
			})
		return () => {
			cancelled = true
		}
	}, [active?.id])

	const switchTo = (id: string) =>
		AccountServiceClient.setActiveUnlokWorkspace(StringRequest.create({ value: id })).catch((error) =>
			console.error("Failed to switch Unlok workspace:", error),
		)
	const remove = (id: string) =>
		AccountServiceClient.removeUnlokWorkspace(StringRequest.create({ value: id })).catch((error) =>
			console.error("Failed to remove Unlok workspace:", error),
		)

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<span className="flex items-center gap-1.5 text-xs">
					<span className={`size-1.5 rounded-full ${active ? "bg-cline" : "bg-description"}`} />
					{active ? "Connected to Unlok" : "No active workspace"}
				</span>
				<span className="text-description text-[11px]">
					{unlokWorkspaces.length === 1 ? "1 workspace" : `${unlokWorkspaces.length} workspaces`}
				</span>
			</div>

			<ul className="m-0 flex list-none flex-col gap-1.5 p-0">
				{unlokWorkspaces.map((workspace) => {
					const label = unlokWorkspaceLabel(workspace)
					const failing = Boolean(workspace.lastError)
					return (
						<li
							className={`flex items-center gap-2.5 rounded-xs border px-3 py-2 text-xs ${
								workspace.active ? "border-cline/40 bg-cline/5" : "border-editor-group-border"
							}`}
							key={workspace.id}>
							<span
								aria-label={failing ? "Failing" : workspace.active ? "Active" : "Connected"}
								className={`size-1.5 shrink-0 rounded-full ${
									failing ? "bg-error" : workspace.active ? "bg-cline" : "bg-description/60"
								}`}
							/>
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="truncate font-medium">{label}</span>
								{workspace.email && <span className="truncate text-description text-[11px]">{workspace.email}</span>}
								{failing && (
									<span className="text-error text-[11px]" title={workspace.lastError}>
										Not working right now
									</span>
								)}
							</span>
							{workspace.active ? (
								<span className="shrink-0 text-[10px] uppercase tracking-wide text-cline">Active</span>
							) : (
								<VSCodeButton appearance="secondary" onClick={() => switchTo(workspace.id)}>
									Use this workspace
								</VSCodeButton>
							)}
							{failing && (
								<VSCodeButton appearance="secondary" onClick={openUnlokSignIn}>
									Reconnect
								</VSCodeButton>
							)}
							<VSCodeButton appearance="icon" aria-label={`Remove ${label}`} onClick={() => remove(workspace.id)}>
								<span className="codicon codicon-trash" />
							</VSCodeButton>
						</li>
					)
				})}
			</ul>

			{active &&
				(info ? (
					<UnlokWorkspaceInfoCard info={info} />
				) : infoFailed ? (
					<p className="m-0 text-description text-xs">
						Connected, but the workspace details could not be loaded right now. If it keeps failing, reconnect
						it or switch to another workspace.
					</p>
				) : (
					<p className="m-0 text-description text-xs">Loading workspace details…</p>
				))}

			<VSCodeButton className="w-full" onClick={openUnlokSignIn}>
				Add another workspace
			</VSCodeButton>

			<p className="m-0 text-description text-[11px]">
				Adding opens Unlok in your browser so you can pick an account and workspace. It joins this list and
				becomes active. Usage, models and billing live in the{" "}
				<VSCodeLink className="text-inherit" href={UNLOK_DASHBOARD_URL} style={{ fontSize: "inherit" }}>
					Unlok dashboard
				</VSCodeLink>
				.
			</p>
		</div>
	)
}
