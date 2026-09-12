import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"

/** Mirrors UnlokProjectCard in src/sdk/unlok-project-coordinator.ts. */
type Card =
	| { kind: "init"; root: string; folderName: string; hasLegacyRules: boolean; workspaceName: string }
	| { kind: "binding"; root: string; teamId: string; workspaceName: string; activeWorkspaceName: string }
	| { kind: "initialized"; root: string; created: string[]; movedLegacy: number }

function parseCard(text: string | undefined): Card | undefined {
	if (!text) {
		return undefined
	}
	try {
		const parsed = JSON.parse(text) as Card
		return parsed && typeof parsed === "object" && "kind" in parsed ? parsed : undefined
	} catch {
		return undefined
	}
}

/**
 * The .unlok folder in chat: "this repo isn't set up yet" with Initialize
 * and Not now, "this repo belongs to another workspace" with Switch, and
 * the receipt after Initialize ran.
 */
export const UnlokProjectCard = ({ text }: { text?: string }) => {
	const card = parseCard(text)
	const { unlokWorkspaces } = useExtensionState()
	const [state, setState] = useState<"idle" | "working" | "done" | "dismissed">("idle")
	const [error, setError] = useState<string | null>(null)
	if (!card) {
		return null
	}

	const run = async (action: () => Promise<unknown>, next: "done" | "dismissed") => {
		setState("working")
		setError(null)
		try {
			await action()
			setState(next)
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
			setState("idle")
		}
	}

	if (card.kind === "initialized") {
		return (
			<div className="flex flex-col gap-1 rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editorWidget-background)] px-3 py-2 text-sm">
				<span className="font-medium">Unlok is set up in this repository.</span>
				<span className="text-description text-xs">
					{card.created.length > 0
						? `Created ${card.created.join(", ")}.`
						: "The layout was already there; nothing was overwritten."}
					{card.movedLegacy > 0
						? ` Moved ${card.movedLegacy} rule file${card.movedLegacy === 1 ? "" : "s"} from .unlokrules into .unlok/rules.`
						: ""}{" "}
					The agent is drafting UNLOK.md now; the write goes through the usual file approval.
				</span>
			</div>
		)
	}

	if (card.kind === "binding") {
		const match = unlokWorkspaces?.find((w) => w.teamId && w.teamId === card.teamId && !w.active)
		if (state === "done") {
			return null
		}
		return (
			<div className="flex flex-col gap-2 rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editorWidget-background)] px-3 py-2 text-sm">
				<span className="font-medium">This repository belongs to the {card.workspaceName} workspace.</span>
				<span className="text-description text-xs">
					You are working in {card.activeWorkspaceName}. Its keys, models and budget will be used unless you switch.
					Switching ends this session and starts fresh.
				</span>
				<span className="flex flex-wrap gap-2">
					{match ? (
						<VSCodeButton
							disabled={state === "working"}
							onClick={() =>
								run(
									() => AccountServiceClient.setActiveUnlokWorkspace(StringRequest.create({ value: match.id })),
									"done",
								)
							}>
							Switch to {card.workspaceName}
						</VSCodeButton>
					) : (
						<VSCodeButton
							disabled={state === "working"}
							onClick={() => run(() => AccountServiceClient.unlokAuthClicked(EmptyRequest.create()), "done")}>
							Connect {card.workspaceName}
						</VSCodeButton>
					)}
					<VSCodeButton appearance="secondary" disabled={state === "working"} onClick={() => setState("done")}>
						Stay in {card.activeWorkspaceName}
					</VSCodeButton>
				</span>
				{error && <span className="text-error text-xs">{error}</span>}
			</div>
		)
	}

	if (state === "dismissed") {
		return null
	}
	if (state === "done") {
		return null
	}
	return (
		<div className="flex flex-col gap-2 rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editorWidget-background)] px-3 py-2 text-sm">
			<span className="font-medium">This repository isn't set up for Unlok yet.</span>
			<span className="text-description text-xs">
				Initialize creates UNLOK.md and a .unlok folder for rules, workflows, hooks and skills
				{card.workspaceName ? `, binds the repository to ${card.workspaceName}` : ""}
				{card.hasLegacyRules ? ", moves your .unlokrules files into .unlok/rules" : ""}, then has the agent draft UNLOK.md
				from what it finds here. Every task in this folder loads it from then on.
			</span>
			<span className="flex flex-wrap items-center gap-2">
				<VSCodeButton
					disabled={state === "working"}
					onClick={() => run(() => AccountServiceClient.initializeUnlokProject(EmptyRequest.create()), "done")}>
					{state === "working" ? "Setting up…" : "Initialize"}
				</VSCodeButton>
				<VSCodeButton
					appearance="secondary"
					disabled={state === "working"}
					onClick={() =>
						run(
							() => AccountServiceClient.dismissUnlokProjectSetup(StringRequest.create({ value: "now" })),
							"dismissed",
						)
					}>
					Not now
				</VSCodeButton>
				<VSCodeButton
					appearance="icon"
					disabled={state === "working"}
					onClick={() =>
						run(
							() => AccountServiceClient.dismissUnlokProjectSetup(StringRequest.create({ value: "never" })),
							"dismissed",
						)
					}>
					<span className="text-description text-xs underline">Never for this repository</span>
				</VSCodeButton>
			</span>
			{error && <span className="text-error text-xs">{error}</span>}
		</div>
	)
}

export default UnlokProjectCard
