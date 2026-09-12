import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import styled from "styled-components"

// Distinct from QuotedMessagePreview's neutral input-background treatment --
// this needs to read as a mode change, not a quoted-text preview, so it
// takes a real accent color the way VS Code's own inline notifications do.
const BannerContainer = styled.div`
	background-color: color-mix(in srgb, var(--vscode-charts-purple) 15%, var(--vscode-input-background) 85%);
	border: 1px solid color-mix(in srgb, var(--vscode-charts-purple) 40%, transparent);
	padding: 4px 8px;
	margin: 0 15px;
	border-radius: 2px;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
`

const BannerText = styled.span`
	font-size: var(--vscode-editor-font-size);
	opacity: 0.9;
`

const ExitButton = styled(VSCodeButton)`
	shrink: 0;
`

interface OptimusModeBannerProps {
	onExit: () => void
}

/**
 * Shown above the composer while Optimus mode is on (toggled by sending
 * "/optimus" with no question -- see useMessageHandlers.handleSendMessage).
 * The only reminder that plain messages are currently going to Optimus
 * instead of the running task -- without it, typing a real task
 * instruction while the mode is on would silently get misrouted.
 */
const OptimusModeBanner: React.FC<OptimusModeBannerProps> = ({ onExit }) => (
	<BannerContainer>
		<BannerText>Optimus mode: your messages go to Optimus, not to a task.</BannerText>
		<ExitButton appearance="secondary" onClick={onExit}>
			Exit
		</ExitButton>
	</BannerContainer>
)

export default OptimusModeBanner
