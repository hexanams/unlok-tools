import type { UnlokWorkspaceInfo } from "@shared/proto/cline/account"
import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { UnlokWorkspaceInfoCard } from "@/components/welcome/UnlokWorkspaceInfoCard"
import { AccountServiceClient } from "@/services/grpc-client"

interface UnlokSignInGateProps {
	/** Whether an Unlok API key is already present (sign-in succeeded). */
	isConnected: boolean
	/** Called when the user clicks "Start a chat" on the connected screen. */
	onProceed: () => void
}

/**
 * Blocks the entire chat area until the user has both signed in AND clicked
 * through the connected screen. Rendered in place of ChatLayout, not layered
 * on top of it -- nothing underneath (input, buttons, task view) mounts until
 * this clears. Fills the whole panel edge to edge (a real VS Code sidebar is
 * narrow and tall) rather than floating as a small centered card in a sea of
 * empty space -- the header bar and content both span the full width, and
 * content sits near the top rather than dead-centered in what can be a very
 * tall panel. Two branches, matching the design mockup's own two states of
 * the same screen: not-connected (sign-in) and connected (what the workspace
 * allows, before proceeding to chat).
 */
export const UnlokSignInGate: React.FC<UnlokSignInGateProps> = ({ isConnected, onProceed }) => {
	return (
		<div className="flex h-full w-full flex-col bg-code">
			<div className="flex shrink-0 items-center justify-between border-b border-editor-group-border px-4 py-3">
				<div className="flex items-center gap-2">
					<span className="size-2.5 rounded-[3px] bg-cline" />
					<span className="text-[11px] font-semibold tracking-wide">UNLOK</span>
				</div>
				<span className="flex items-center gap-1.5 text-[11px] text-description">
					<span className={`size-1.5 rounded-full ${isConnected ? "bg-cline" : "animate-pulse bg-cline/60"}`} />
					{isConnected ? "Connected" : "Not connected"}
				</span>
			</div>
			<div className="flex-1 overflow-y-auto px-7 py-10">
				{isConnected ? <ConnectedPanel onProceed={onProceed} /> : <ConnectPanel />}
			</div>
		</div>
	)
}

const ConnectPanel: React.FC = () => {
	const { handleFieldChange } = useApiConfigurationHandlers()
	const [keyInput, setKeyInput] = useState("")

	return (
		<div className="flex flex-col gap-7 text-center">
			<div className="flex flex-col gap-2">
				<h2 className="m-0 text-[1.15em] font-semibold">Welcome to Unlok</h2>
				<p className="m-0 text-description text-xs leading-relaxed">
					Sign in once and this editor starts routing through your workspace, using the same models and
					budget you already have.
				</p>
			</div>

			<div className="flex flex-col gap-2">
				<VSCodeButton
					className="w-full"
					onClick={async () => {
						try {
							await AccountServiceClient.unlokAuthClicked(EmptyRequest.create())
						} catch (error) {
							console.error("Failed to open Unlok auth:", error)
						}
					}}>
					Sign in with Unlok
				</VSCodeButton>
				<p className="m-0 text-description text-[11px]">
					Opens Unlok, you press Authorize, the key comes straight back. Nothing to copy.
				</p>
			</div>

			<div className="flex items-center gap-2 text-description text-[11px]">
				<span className="h-px flex-1 bg-editor-group-border" />
				or
				<span className="h-px flex-1 bg-editor-group-border" />
			</div>

			<div className="flex flex-col gap-3">
				<div className="flex flex-col gap-1.5 text-left">
					<label className="text-[11px] text-description" htmlFor="unlok-workspace-key">
						Already have a workspace key?
					</label>
					<VSCodeTextField
						aria-label="Workspace API key"
						className="w-full"
						id="unlok-workspace-key"
						onInput={(e) => setKeyInput((e.target as HTMLInputElement | null)?.value ?? "")}
						placeholder="unlok_sk_..."
						style={{ width: "100%" }}
						type="password"
						value={keyInput}
					/>
				</div>
				<VSCodeButton
					appearance="secondary"
					className="w-full"
					disabled={!keyInput.trim()}
					onClick={() => {
						const trimmed = keyInput.trim()
						if (trimmed) {
							handleFieldChange("unlokApiKey", trimmed)
						}
					}}>
					Connect with key
				</VSCodeButton>
			</div>
		</div>
	)
}

const ConnectedPanel: React.FC<{ onProceed: () => void }> = ({ onProceed }) => {
	const [info, setInfo] = useState<UnlokWorkspaceInfo | null>(null)

	useEffect(() => {
		let cancelled = false
		AccountServiceClient.getUnlokWorkspaceInfo(EmptyRequest.create({}))
			.then((result) => {
				if (!cancelled) {
					setInfo(result)
				}
			})
			.catch((error) => {
				console.error("Failed to fetch Unlok workspace info:", error)
			})
		return () => {
			cancelled = true
		}
	}, [])

	// Falls back to the generic greeting when the name wasn't captured at
	// sign-in (a pasted workspace key, or a reload since the last OAuth
	// sign-in -- see AuthService's _unlokUserName) or the fetch hasn't
	// resolved yet.
	const greeting = info?.userName ? `Welcome back, ${info.userName}.` : "Welcome to Unlok."

	return (
		<div className="flex flex-col gap-5 text-center">
			<div className="flex flex-col items-center gap-2">
				<span className="flex size-7 items-center justify-center rounded-[5px] bg-cline/15 text-cline">
					<span className="codicon codicon-check text-base" />
				</span>
				<h2 className="m-0 text-[1.15em] font-semibold">You're all set</h2>
				<p className="m-0 text-description text-xs leading-relaxed">
					{greeting} Your workspace is connected and ready to go.
				</p>
				{info?.userEmail && <p className="m-0 text-description/70 text-[11px]">Signed in as {info.userEmail}</p>}
			</div>

			{info && <UnlokWorkspaceInfoCard info={info} />}

			<VSCodeButton className="w-full" onClick={onProceed}>
				Start a chat
			</VSCodeButton>
		</div>
	)
}
