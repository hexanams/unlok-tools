import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import UnlokMark from "../../assets/UnlokMark"

/**
 * The Account tab with no Unlok key yet. Starts Unlok's own browser sign in
 * (unlokAuthClicked), never Cline's account login: that flow ends in a
 * vscode://saoudrizwan.claude-dev deep link, which makes VS Code offer to
 * install upstream Cline on top of this extension.
 */
export const AccountWelcomeView = () => {
	const { environment } = useExtensionState()
	const [isOpening, setIsOpening] = useState(false)
	const [statusMessage, setStatusMessage] = useState<string | null>(null)

	const handleSignIn = async () => {
		setIsOpening(true)
		setStatusMessage(null)
		try {
			await AccountServiceClient.unlokAuthClicked(EmptyRequest.create())
			setStatusMessage("Finish connecting in your browser. You will be brought straight back here.")
		} catch (error) {
			console.error("Failed to open Unlok auth:", error)
			setStatusMessage("Unable to open Unlok. Please try again.")
		} finally {
			setIsOpening(false)
		}
	}

	return (
		<div className="flex flex-col items-center gap-2.5">
			<UnlokMark className="size-16 mb-4" environment={environment} />

			<p>Connect Unlok to use your workspace's models and budget here, and to see usage in the Unlok dashboard.</p>

			<VSCodeButton className="w-full mb-1" disabled={isOpening} onClick={handleSignIn}>
				Sign in with Unlok
				{isOpening && (
					<span className="ml-1 animate-spin">
						<span className="codicon codicon-refresh" />
					</span>
				)}
			</VSCodeButton>

			{statusMessage && <p className="text-(--vscode-descriptionForeground) text-xs text-center m-0">{statusMessage}</p>}

			<p className="text-(--vscode-descriptionForeground) text-xs text-center m-0">
				Opens Unlok in your browser, you confirm the connection, and you are brought straight back. Nothing to copy.
			</p>
		</div>
	)
}
