import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState } from "react"
import { AccountServiceClient } from "@/services/grpc-client"
import Section from "../Section"

interface RulesSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

type EffectiveRule = { title: string; source: string; enforced: boolean; excerpt: string; origin: string; kind: string }
type Loaded = {
	rules: EffectiveRule[]
	initialized: boolean
	root: string
	boundWorkspaceName: string
	problems: string[]
	overridden: string[]
	workspaceRulesVersion: string
	workspaceRulesAvailable: boolean
}

const SOURCE_LABEL: Record<string, string> = {
	"workspace-enforced": "Workspace, enforced",
	workspace: "Workspace",
	repo: "Repository",
	personal: "Personal",
}

/**
 * Every rule the next task in this folder will load, with where it came
 * from. Precedence is personal over repository over workspace; enforced
 * workspace rules sit above all three and cannot be overridden.
 */
const RulesSection = ({ renderSectionHeader }: RulesSectionProps) => {
	const [data, setData] = useState<Loaded | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)

	const load = useCallback(async () => {
		setError(null)
		try {
			const result = await AccountServiceClient.getUnlokEffectiveRules(EmptyRequest.create())
			setData({
				rules: result.rules ?? [],
				initialized: result.initialized,
				root: result.root,
				boundWorkspaceName: result.boundWorkspaceName,
				problems: result.problems ?? [],
				overridden: result.overridden ?? [],
				workspaceRulesVersion: result.workspaceRulesVersion ?? "0",
				workspaceRulesAvailable: Boolean(result.workspaceRulesAvailable),
			})
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		}
	}, [])

	useEffect(() => {
		void load()
	}, [load])

	const initialize = async () => {
		setBusy(true)
		try {
			await AccountServiceClient.initializeUnlokProject(EmptyRequest.create())
			await load()
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setBusy(false)
		}
	}

	return (
		<div>
			{renderSectionHeader("rules")}
			<Section>
				<div className="flex flex-col gap-3 px-4">
					<p className="m-0 text-sm text-description">
						What every task in this folder loads before it starts. Personal rules win over the repository's, which win
						over the workspace's. A workspace rule marked enforced sits above all of them and cannot be overridden.
					</p>
					{error && <p className="m-0 text-error text-sm">{error}</p>}
					{data && (
						<div className="flex flex-col gap-1 text-xs text-description">
							<span>
								Folder: <span className="font-mono">{data.root || "none open"}</span>
							</span>
							<span>
								{data.initialized
									? `Set up for Unlok${data.boundWorkspaceName ? `, bound to ${data.boundWorkspaceName}` : ""}.`
									: "Not set up for Unlok yet: no UNLOK.md in this folder."}
							</span>
							{data.problems.map((p) => (
								<span className="text-error" key={p}>
									{p}
								</span>
							))}
							<span>
								{data.workspaceRulesAvailable
									? `Workspace rules version ${data.workspaceRulesVersion}, sent with every request.`
									: "Workspace rules are part of the Team plan. This key is on a personal workspace, so only repository and personal rules apply here."}
							</span>
						</div>
					)}
					{data && !data.initialized && (
						<span>
							<VSCodeButton disabled={busy} onClick={initialize}>
								{busy ? "Setting up…" : "Initialize this repository"}
							</VSCodeButton>
						</span>
					)}
					{data && data.rules.length === 0 && (
						<p className="m-0 text-sm text-description">
							No rules yet. Add UNLOK.md at the repository root (every &quot;##&quot; section is a rule),
							UNLOK.local.md for this machine, or ~/.unlok/UNLOK.md for yourself everywhere.
						</p>
					)}
					{data && data.rules.length > 0 && (
						<ul className="m-0 flex list-none flex-col gap-2 p-0">
							{data.rules.map((rule) => (
								<li
									className="flex flex-col gap-1 rounded border border-[var(--vscode-widget-border)] px-3 py-2"
									key={`${rule.source}:${rule.origin}:${rule.title}`}>
									<span className="flex items-center gap-2">
										<span className="font-medium">{rule.title}</span>
										<span className="rounded bg-[var(--vscode-badge-background)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--vscode-badge-foreground)]">
											{SOURCE_LABEL[rule.source] ?? rule.source}
										</span>
										{rule.enforced && (
											<span
												className="codicon codicon-lock text-description"
												title="Enforced by the workspace"
											/>
										)}
									</span>
									<span className="whitespace-pre-wrap text-xs text-description">{rule.excerpt}</span>
									<span className="font-mono text-[10px] text-description">{rule.origin}</span>
								</li>
							))}
						</ul>
					)}
					{data && data.overridden.length > 0 && (
						<div className="flex flex-col gap-1 text-xs text-description">
							<span className="font-medium">Overridden</span>
							{data.overridden.map((line) => (
								<span key={line}>{line}</span>
							))}
						</div>
					)}
					<span>
						<VSCodeButton appearance="secondary" disabled={busy} onClick={() => void load()}>
							Refresh
						</VSCodeButton>
					</span>
				</div>
			</Section>
		</div>
	)
}

export default RulesSection
