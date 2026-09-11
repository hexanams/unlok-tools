import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import FeatureSettingsSection from "./FeatureSettingsSection"

const mockUpdateSetting = vi.fn()
const mockExtensionState = vi.hoisted(() => ({
	value: {
		enableCheckpointsSetting: true,
		hooksEnabled: false,
		showFeatureTips: false,
		mcpDisplayMode: "rich",
		useAutoCondense: false,
		compactionStrategy: "basic",
		subagentsEnabled: false,
		worktreesEnabled: { user: true, featureFlag: true },
		focusChainSettings: { enabled: false, remindClineInterval: 6 },
		remoteConfigSettings: {},
		backgroundEditEnabled: false,
	},
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(() => mockExtensionState.value),
}))

vi.mock("../utils/settingsHandlers", () => ({
	updateSetting: (...args: unknown[]) => mockUpdateSetting(...args),
}))

describe("FeatureSettingsSection", () => {
	beforeEach(() => {
		mockUpdateSetting.mockClear()
		mockExtensionState.value = {
			...mockExtensionState.value,
			useAutoCondense: false,
			compactionStrategy: "basic",
		}
	})

	it("renders Hooks feature toggle", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		expect(screen.getByText("Hooks")).toBeTruthy()

		const advancedSection = container.querySelector("#advanced-features")
		const agentSection = container.querySelector("#agent-features")

		expect(advancedSection?.querySelector("#Hooks")).toBeTruthy()
		// The Agent group is hidden entirely now, so there is no section for Hooks to be wrongly inside of.
		expect(agentSection).toBeNull()
	})

	it("hides the Agent and Editor feature groups (Unlok keeps their defaults, not their toggles)", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		for (const label of [
			"Auto Compact",
			"Auto Compact Strategy",
			"Web Search",
			"Feature Tips",
			"Background Edit",
			"Checkpoints",
		]) {
			expect(screen.queryByText(label)).toBeNull()
		}
		expect(container.querySelector("#agent-features")).toBeNull()
		expect(container.querySelector("#optional-features")).toBeNull()
		// Advanced stays.
		expect(container.querySelector("#advanced-features")).toBeTruthy()
	})

	it("calls updateSetting with hooksEnabled when toggled", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		const hooksSwitch = container.querySelector("#Hooks")
		expect(hooksSwitch).toBeTruthy()

		fireEvent.click(hooksSwitch as Element)

		expect(mockUpdateSetting).toHaveBeenCalledWith("hooksEnabled", true)
	})
})
