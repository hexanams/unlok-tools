import type { SVGProps } from "react"
import type { Environment } from "../../../src/shared/config-types"
import { getEnvironmentColor } from "../utils/environmentColors"

/**
 * Unlok's brand mark: a simple rounded square in the ochre accent used
 * throughout the app (sign-in gate, badges, mode toggle). Keeps the same
 * environment-color-coding the old Cline mascot mark had -- useful for
 * telling a dev/staging build apart from production at a glance -- but
 * falls back to the ochre brand color rather than the theme's icon color
 * when no environment is given.
 */
const UnlokMark = (props: SVGProps<SVGSVGElement> & { environment?: Environment }) => {
	const { environment, ...svgProps } = props
	const fillColor = environment ? getEnvironmentColor(environment) : "var(--color-cline)"

	return (
		<svg fill="none" height="50" viewBox="0 0 50 50" width="50" xmlns="http://www.w3.org/2000/svg" {...svgProps}>
			<rect fill={fillColor} height="50" rx="14" width="50" />
		</svg>
	)
}

export default UnlokMark
