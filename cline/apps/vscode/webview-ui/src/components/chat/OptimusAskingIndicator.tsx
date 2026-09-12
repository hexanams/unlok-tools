import React from "react"
import styled from "styled-components"

// Same treatment as OptimusModeBanner (bordered, tinted container) rather
// than a bare spinner + text -- a plain inline row next to the composer was
// too easy to miss entirely while waiting on a real network round trip,
// which is exactly the "is this even doing anything?" report this replaces.
const IndicatorContainer = styled.div`
	background-color: color-mix(in srgb, var(--vscode-charts-purple) 15%, var(--vscode-input-background) 85%);
	border: 1px solid color-mix(in srgb, var(--vscode-charts-purple) 40%, transparent);
	padding: 6px 10px;
	margin: 10px 15px 6px 15px;
	border-radius: 2px;
	display: flex;
	align-items: center;
	gap: 8px;
`

const IndicatorText = styled.span`
	font-size: var(--vscode-editor-font-size);
`

/**
 * Shown for the duration of an /optimus round trip (see askOptimusQuestion
 * in useMessageHandlers.ts). The backend digest a fresh question reads from
 * is rebuilt at most once every 20 minutes -- several LLM calls deep when it
 * does -- so the very first ask in a while can take real seconds with
 * nothing else on screen to show for it. Styled like OptimusModeBanner
 * rather than a bare spinner so it reads as a real status, not decoration.
 */
const OptimusAskingIndicator: React.FC = () => (
	<IndicatorContainer>
		<span className="codicon codicon-loading codicon-modifier-spin" />
		<IndicatorText>Asking Optimus… the first question in a while can take a few seconds.</IndicatorText>
	</IndicatorContainer>
)

export default OptimusAskingIndicator
