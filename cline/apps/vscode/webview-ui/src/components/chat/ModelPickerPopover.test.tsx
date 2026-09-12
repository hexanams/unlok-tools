import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ModelPickerPopover } from "./ModelPickerPopover"

const mockGetUnlokWorkspaceInfo = vi.fn()

vi.mock("@/services/grpc-client", () => ({
	AccountServiceClient: {
		getUnlokWorkspaceInfo: (...args: unknown[]) => mockGetUnlokWorkspaceInfo(...args),
	},
}))

function workspaceInfo(overrides: Partial<{ accessMode: string; models: unknown[] }> = {}) {
	return {
		accessMode: "byok",
		models: [],
		budget: { spentUsd: 0, capUsd: 0 },
		disabledModelCount: 0,
		totalSelectableModels: 0,
		...overrides,
	}
}

describe("ModelPickerPopover", () => {
	beforeEach(() => {
		mockGetUnlokWorkspaceInfo.mockReset()
	})

	it("always shows Auto, even before the workspace info loads", () => {
		mockGetUnlokWorkspaceInfo.mockReturnValue(new Promise(() => undefined))
		render(<ModelPickerPopover currentModelId="auto" onSelect={vi.fn()} triggerLabel="unlok:auto" />)

		fireEvent.click(screen.getByTestId("model-picker-trigger"))

		expect(screen.getByText("Auto")).toBeInTheDocument()
	})

	it("does not fetch the model list until the popover is actually opened", () => {
		mockGetUnlokWorkspaceInfo.mockReturnValue(new Promise(() => undefined))
		render(<ModelPickerPopover currentModelId="auto" onSelect={vi.fn()} triggerLabel="unlok:auto" />)

		expect(mockGetUnlokWorkspaceInfo).not.toHaveBeenCalled()
	})

	it("excludes models that aren't both pinnable and credentialed", async () => {
		mockGetUnlokWorkspaceInfo.mockResolvedValue(
			workspaceInfo({
				models: [
					{ provider: "openai", model: "gpt-5", label: "GPT-5", credentialed: true, pinnable: true },
					{ provider: "openai", model: "gpt-5-mini", label: "GPT-5 Mini", credentialed: false, pinnable: true },
					{
						provider: "anthropic",
						model: "claude-sonnet-5",
						label: "Claude Sonnet 5",
						credentialed: true,
						pinnable: false,
					},
				],
			}),
		)
		render(<ModelPickerPopover currentModelId="auto" onSelect={vi.fn()} triggerLabel="unlok:auto" />)

		fireEvent.click(screen.getByTestId("model-picker-trigger"))

		await waitFor(() => expect(screen.getByText("GPT-5")).toBeInTheDocument())
		expect(screen.queryByText("GPT-5 Mini")).not.toBeInTheDocument()
		expect(screen.queryByText("Claude Sonnet 5")).not.toBeInTheDocument()
	})

	it("tags available models as BYOK or Unlok+ based on the account's access mode", async () => {
		mockGetUnlokWorkspaceInfo.mockResolvedValue(
			workspaceInfo({
				accessMode: "unlok",
				models: [{ provider: "openai", model: "gpt-5", label: "GPT-5", credentialed: true, pinnable: true }],
			}),
		)
		render(<ModelPickerPopover currentModelId="auto" onSelect={vi.fn()} triggerLabel="unlok:auto" />)

		fireEvent.click(screen.getByTestId("model-picker-trigger"))

		await waitFor(() => expect(screen.getByText("Unlok+")).toBeInTheDocument())
	})

	it("calls onSelect with the provider/model string when a model row is clicked", async () => {
		const onSelect = vi.fn()
		mockGetUnlokWorkspaceInfo.mockResolvedValue(
			workspaceInfo({
				models: [{ provider: "openai", model: "gpt-5", label: "GPT-5", credentialed: true, pinnable: true }],
			}),
		)
		render(<ModelPickerPopover currentModelId="auto" onSelect={onSelect} triggerLabel="unlok:auto" />)

		fireEvent.click(screen.getByTestId("model-picker-trigger"))
		await waitFor(() => expect(screen.getByText("GPT-5")).toBeInTheDocument())
		fireEvent.click(screen.getByText("GPT-5"))

		expect(onSelect).toHaveBeenCalledWith("openai/gpt-5")
	})

	it("calls onSelect with 'auto' when the Auto row is clicked", () => {
		const onSelect = vi.fn()
		mockGetUnlokWorkspaceInfo.mockReturnValue(new Promise(() => undefined))
		render(<ModelPickerPopover currentModelId="openai/gpt-5" onSelect={onSelect} triggerLabel="unlok:openai/gpt-5" />)

		fireEvent.click(screen.getByTestId("model-picker-trigger"))
		fireEvent.click(screen.getByText("Auto"))

		expect(onSelect).toHaveBeenCalledWith("auto")
	})

	it("shows a friendly error instead of an empty popover when the fetch fails", async () => {
		mockGetUnlokWorkspaceInfo.mockRejectedValue(new Error("network down"))
		render(<ModelPickerPopover currentModelId="auto" onSelect={vi.fn()} triggerLabel="unlok:auto" />)

		fireEvent.click(screen.getByTestId("model-picker-trigger"))

		await waitFor(() => expect(screen.getByText(/couldn't load your available models/i)).toBeInTheDocument())
	})
	it("explains an empty BYOK workspace instead of a bare 'nothing here'", async () => {
		mockGetUnlokWorkspaceInfo.mockResolvedValueOnce({ accessMode: "byok", models: [] })
		render(<ModelPickerPopover currentModelId="auto" onSelect={vi.fn()} />)
		fireEvent.click(screen.getByTestId("model-picker-trigger"))
		await waitFor(() => expect(screen.getByText(/no provider keys yet/i)).toBeTruthy())
	})

	it("fetches again on every open so a dashboard change shows up without a reload", async () => {
		mockGetUnlokWorkspaceInfo.mockResolvedValue({ accessMode: "byok", models: [] })
		render(<ModelPickerPopover currentModelId="auto" onSelect={vi.fn()} />)
		fireEvent.click(screen.getByTestId("model-picker-trigger"))
		await waitFor(() => expect(mockGetUnlokWorkspaceInfo).toHaveBeenCalledTimes(1))
		fireEvent.click(screen.getByTestId("model-picker-trigger"))
		fireEvent.click(screen.getByTestId("model-picker-trigger"))
		await waitFor(() => expect(mockGetUnlokWorkspaceInfo).toHaveBeenCalledTimes(2))
	})
})
