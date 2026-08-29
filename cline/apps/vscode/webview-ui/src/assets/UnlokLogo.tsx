import { SVGProps } from "react"
import type { Environment } from "../../../src/shared/config-types"
import { getEnvironmentColor } from "../utils/environmentColors"

/**
 * The Unlok ring mark, theme-adaptive like the ClineLogoVariable it
 * replaces: fill defaults to the VS Code icon-foreground theme var, or an
 * environment indicator color (local/staging/production) when `environment`
 * is passed. Same path data as assets/icons/icon.svg (the activity-bar
 * icon), just given a 48x48 viewBox here so callers can size it freely via
 * width/height/className without recalculating coordinates.
 */
const UnlokLogo = (props: SVGProps<SVGSVGElement> & { environment?: Environment }) => {
	const { environment, ...svgProps } = props

	const fillColor = environment ? getEnvironmentColor(environment) : "var(--vscode-icon-foreground)"

	return (
		<svg fill="none" height="48" viewBox="0 0 48 48" width="48" xmlns="http://www.w3.org/2000/svg" {...svgProps}>
			<path
				d="M40.85 20.13A17 17 0 1 1 27.87 7.15L25.4 16.36A8 8 0 1 0 31.64 22.6Z"
				fill={fillColor}
			/>
		</svg>
	)
}
export default UnlokLogo
