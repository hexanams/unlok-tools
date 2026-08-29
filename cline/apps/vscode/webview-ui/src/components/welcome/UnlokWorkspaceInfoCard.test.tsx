import type { UnlokWorkspaceInfo } from "@shared/proto/cline/account"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { UnlokWorkspaceInfoCard } from "./UnlokWorkspaceInfoCard"

function makeInfo(overrides: Partial<UnlokWorkspaceInfo>): UnlokWorkspaceInfo {
	return {
		accessMode: "byok",
		models: [],
		totalSelectableModels: 0,
		budget: { spentUsd: 0, capUsd: 5 },
		disabledModelCount: 0,
		userName: "",
		userEmail: "",
		...overrides,
	} as UnlokWorkspaceInfo
}

describe("UnlokWorkspaceInfoCard", () => {
	it('shows the model count as "N of M" and Unlok+ budget for a managed (unlok) workspace', () => {
		render(
			<UnlokWorkspaceInfoCard
				info={makeInfo({
					accessMode: "unlok",
					models: [
						{ provider: "anthropic", model: "claude-sonnet-5", label: "Claude Sonnet 5", credentialed: true, pinnable: true },
						{ provider: "gemini", model: "gemini-flash-latest", label: "Gemini Flash", credentialed: true, pinnable: true },
					],
					totalSelectableModels: 3,
					budget: { spentUsd: 2.5, capUsd: 5 },
				})}
			/>,
		)

		expect(screen.getByText("2 of 3")).toBeInTheDocument()
		expect(screen.getByText("$2.50")).toBeInTheDocument()
		expect(screen.getByText(/of \$5\.00/)).toBeInTheDocument()
	})

	it("omits the budget line for a BYOK workspace, since Unlok+'s cap never applied to it", () => {
		render(
			<UnlokWorkspaceInfoCard
				info={makeInfo({
					accessMode: "byok",
					models: [{ provider: "anthropic", model: "claude-sonnet-5", label: "Claude Sonnet 5", credentialed: true, pinnable: true }],
					totalSelectableModels: 1,
				})}
			/>,
		)

		expect(screen.getByText("1 of 1")).toBeInTheDocument()
		expect(screen.queryByText(/budget/i)).toBeNull()
	})

	it("shows the disabled-model count when the org has restricted models", () => {
		render(
			<UnlokWorkspaceInfoCard
				info={makeInfo({
					totalSelectableModels: 3,
					disabledModelCount: 3,
				})}
			/>,
		)

		expect(screen.getByText("3")).toBeInTheDocument()
		expect(screen.getByText(/restricted by your organization/i)).toBeInTheDocument()
	})
})
