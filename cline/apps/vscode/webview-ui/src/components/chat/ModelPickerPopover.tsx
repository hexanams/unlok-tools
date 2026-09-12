import { EmptyRequest } from "@shared/proto/cline/common"
import type { UnlokWorkspaceModel } from "@shared/proto/cline/account"
import { CheckIcon, SparklesIcon } from "lucide-react"
import { useCallback, useState } from "react"
import { unlokWorkspaceLabel } from "@/components/account/UnlokAccountView"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { AccountServiceClient } from "@/services/grpc-client"

interface ModelPickerPopoverProps {
	/** The current planMode/actModeUnlokModelId value -- "auto", empty, or a
	 * pinned "provider/model" string. */
	currentModelId: string
	/** Label already computed by the caller for the trigger button (e.g.
	 * "unlok:auto") -- this component only needs to render it, not know how
	 * it's derived. */
	triggerLabel: string
	onSelect: (modelId: string) => void
}

/**
 * Lets the user stay on Auto or pin to any model they're actually entitled
 * to right now -- via their own BYOK key or Unlok+'s pooled credentials.
 * Fetched on every open (never on mount): nothing else on this screen needs
 * the list, and what the workspace allows changes underneath us (a key added
 * or the payment mode switched in the dashboard, or another workspace made
 * active), so a one time fetch went stale. Only ever shows models the backend reports as both
 * `pinnable` and `credentialed`, so nothing in this list can ever 422 when
 * picked -- see app/me.py and app/routing.py's resolve_model_alias on the
 * backend for where that honesty is actually enforced.
 */
export const ModelPickerPopover = ({ currentModelId, triggerLabel, onSelect }: ModelPickerPopoverProps) => {
	const [open, setOpen] = useState(false)
	const [loading, setLoading] = useState(false)
	const [loaded, setLoaded] = useState(false)
	const [accessMode, setAccessMode] = useState<string | undefined>(undefined)
	const [models, setModels] = useState<UnlokWorkspaceModel[]>([])
	const [error, setError] = useState<string | undefined>(undefined)
	// Which workspace the pick applies to. Models and keys are per workspace,
	// so a person choosing or pinning one must see which workspace they are
	// choosing for; Switch jumps to the Account tab where the list lives.
	const { unlokWorkspaces, navigateToSettings } = useExtensionState()
	const activeWorkspace = unlokWorkspaces?.find((w) => w.active)

	const handleOpenChange = useCallback(
		(next: boolean) => {
			setOpen(next)
			if (next && !loading) {
				setLoading(true)
				setError(undefined)
				AccountServiceClient.getUnlokWorkspaceInfo(EmptyRequest.create({}))
					.then((info) => {
						setAccessMode(info.accessMode)
						setModels(info.models.filter((m) => m.pinnable && m.credentialed))
						setLoaded(true)
					})
					.catch((err) => {
						console.error("Failed to fetch available models:", err)
						setError("Couldn't load your available models. Try again in a moment.")
					})
					.finally(() => setLoading(false))
			}
		},
		[loading],
	)

	const isAuto = currentModelId === "auto" || !currentModelId
	const accessBadgeLabel = accessMode === "unlok" ? "Unlok+" : "BYOK"

	return (
		<Popover onOpenChange={handleOpenChange} open={open}>
			<PopoverTrigger asChild>
				<button
					className="flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-input-border bg-input-background/40 px-2.5 text-xs font-medium text-input-foreground cursor-pointer hover:bg-input-background/70"
					data-testid="model-picker-trigger"
					type="button">
					{triggerLabel}
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-72 p-1" showArrow={false} side="top">
				<div className="px-2 pt-1 pb-1.5 text-xs font-semibold text-foreground">Model</div>
				{activeWorkspace && (
					<div
						className="mx-1 mb-1.5 flex items-center gap-2 rounded-xs border border-input-border bg-input-background/40 px-2 py-1.5"
						data-testid="model-picker-workspace">
						<span className="size-1.5 shrink-0 rounded-full bg-cline" />
						<span className="min-w-0 flex-1 truncate text-[11px] text-description">
							Workspace: <span className="font-medium text-foreground">{unlokWorkspaceLabel(activeWorkspace)}</span>
							{activeWorkspace.email ? ` · ${activeWorkspace.email}` : ""}
						</span>
						{unlokWorkspaces && unlokWorkspaces.length > 1 && (
							<button
								className="shrink-0 cursor-pointer text-[11px] text-cline hover:underline"
								onClick={() => {
									setOpen(false)
									navigateToSettings("account")
								}}
								type="button">
								Switch
							</button>
						)}
					</div>
				)}

				<button
					className={cn(
						"flex w-full items-center gap-2.5 rounded-xs px-2 py-1.5 text-left cursor-pointer transition-colors",
						isAuto ? "bg-cline/10" : "hover:bg-input-background/60",
					)}
					onClick={() => {
						onSelect("auto")
						setOpen(false)
					}}
					type="button">
					<span
						className={cn(
							"flex size-6 shrink-0 items-center justify-center rounded-full",
							isAuto ? "bg-cline text-badge-foreground" : "bg-input-background text-description",
						)}>
						<SparklesIcon className="size-3.5" />
					</span>
					<div className="min-w-0 flex-1">
						<div className="text-xs font-medium text-foreground">Auto</div>
						<div className="text-[11px] leading-snug text-description/70">
							Unlok picks the best model for each turn
						</div>
					</div>
					{isAuto && <CheckIcon className="size-3.5 shrink-0 text-cline" />}
				</button>

				<div className="my-1 h-px bg-input-border" />

				{loading && <div className="px-2 py-3 text-xs text-description/70">Loading your models…</div>}
				{error && <div className="px-2 py-3 text-xs text-error">{error}</div>}
				{loaded && !error && models.length === 0 && (
					<div className="px-2 py-3 text-xs text-description/70">
						{accessMode === "unlok"
							? "Unlok+ has no models available for this workspace right now."
							: "This workspace has no provider keys yet. Add one under BYOK on the Models page in the Unlok dashboard, or have the workspace owner switch it to Unlok+."}
					</div>
				)}

				{models.length > 0 && (
					<div className="max-h-64 overflow-y-auto">
						{models.map((m) => {
							const value = `${m.provider}/${m.model}`
							const isActive = currentModelId === value
							return (
								<button
									className={cn(
										"flex w-full items-center gap-2.5 rounded-xs px-2 py-1.5 text-left cursor-pointer transition-colors",
										isActive ? "bg-cline/10" : "hover:bg-input-background/60",
									)}
									key={value}
									onClick={() => {
										onSelect(value)
										setOpen(false)
									}}
									type="button">
									<div className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
										{m.label || value}
									</div>
									<Badge className="shrink-0" variant={accessMode === "unlok" ? "cline" : "outline"}>
										{accessBadgeLabel}
									</Badge>
									{isActive && <CheckIcon className="size-3.5 shrink-0 text-cline" />}
								</button>
							)
						})}
					</div>
				)}
			</PopoverContent>
		</Popover>
	)
}
