import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { unlokWorkspaceLabel } from "@/components/account/UnlokAccountView"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import PreferredLanguageSetting from "../PreferredLanguageSetting"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface GeneralSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
	/** Jumps to the Account tab, where the full workspace list lives. */
	onOpenAccountTab?: () => void
}

const GeneralSettingsSection = ({ renderSectionHeader, onOpenAccountTab }: GeneralSettingsSectionProps) => {
	const { telemetrySetting, remoteConfigSettings, unlokWorkspaces } = useExtensionState()
	const activeWorkspace = unlokWorkspaces?.find((w) => w.active)

	return (
		<div>
			{renderSectionHeader("general")}
			<Section>
				{activeWorkspace && (
					<div className="mb-5 flex items-center justify-between gap-3 rounded-md border border-editor-widget-border/50 p-3">
						<div className="flex min-w-0 flex-col">
							<span className="text-xs font-medium uppercase tracking-wider text-foreground/80">Active workspace</span>
							<span className="truncate text-sm">{unlokWorkspaceLabel(activeWorkspace)}</span>
							{activeWorkspace.email && (
								<span className="truncate text-description text-xs">{activeWorkspace.email}</span>
							)}
						</div>
						<VSCodeButton appearance="secondary" onClick={onOpenAccountTab}>
							Manage workspaces
						</VSCodeButton>
					</div>
				)}
				<PreferredLanguageSetting />

				<div className="mb-[5px]">
					<Tooltip>
						<TooltipContent hidden={remoteConfigSettings?.telemetrySetting === undefined}>
							This setting is managed by your organization's remote configuration
						</TooltipContent>
						<TooltipTrigger asChild>
							<div className="flex items-center gap-2 mb-[5px]">
								<VSCodeCheckbox
									checked={telemetrySetting !== "disabled"}
									disabled={remoteConfigSettings?.telemetrySetting === "disabled"}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										updateSetting("telemetrySetting", checked ? "enabled" : "disabled")
									}}>
									Allow error and usage reporting
								</VSCodeCheckbox>
								{!!remoteConfigSettings?.telemetrySetting && (
									<i className="codicon codicon-lock text-description text-sm" />
								)}
							</div>
						</TooltipTrigger>
					</Tooltip>

					<p className="text-sm mt-[5px] text-description">
						Help improve Unlok by sending usage data and error reports. No code, prompts, or personal information are
						ever sent.
					</p>
				</div>
			</Section>
		</div>
	)
}

export default GeneralSettingsSection
