import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { UnlokWorkspaceErrorActions } from "./UnlokWorkspaceErrorActions"

const setActiveMock = vi.fn().mockResolvedValue({})
const authMock = vi.fn().mockResolvedValue({})
vi.mock("@/services/grpc-client", () => ({
	AccountServiceClient: {
		setActiveUnlokWorkspace: (...args: unknown[]) => setActiveMock(...args),
		unlokAuthClicked: (...args: unknown[]) => authMock(...args),
	},
}))

const state = vi.hoisted(() => ({
	value: {
		mode: "act",
		apiConfiguration: { actModeApiProvider: "unlok", planModeApiProvider: "unlok" },
		unlokWorkspaces: [
			{ id: "ws-team", email: "me@acme.dev", workspaceName: "Acme Engineering", teamId: "t1", active: true, lastError: "401", addedAt: 1 },
			{ id: "ws-personal", email: "me@acme.dev", workspaceName: "Personal", teamId: "", active: false, lastError: "", addedAt: 2 },
		],
	} as Record<string, unknown>,
}))
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => state.value,
}))

describe("UnlokWorkspaceErrorActions", () => {
	beforeEach(() => {
		setActiveMock.mockClear()
		authMock.mockClear()
	})

	it("offers a switch to each healthy alternative and a reconnect for the failing active one", () => {
		render(<UnlokWorkspaceErrorActions />)
		fireEvent.click(screen.getByText("Switch to Personal"))
		expect(setActiveMock).toHaveBeenCalledWith(expect.objectContaining({ value: "ws-personal" }))
		fireEvent.click(screen.getByText("Reconnect Acme Engineering"))
		expect(authMock).toHaveBeenCalled()
		expect(screen.queryByText("Add another workspace")).toBeNull()
	})

	it("offers adding a workspace when there is nothing to switch to", () => {
		state.value = { ...state.value, unlokWorkspaces: [(state.value.unlokWorkspaces as unknown[])[0]] }
		render(<UnlokWorkspaceErrorActions />)
		expect(screen.getByText("Add another workspace")).toBeTruthy()
	})

	it("renders nothing when chat is not running through Unlok", () => {
		state.value = { ...state.value, apiConfiguration: { actModeApiProvider: "openai", planModeApiProvider: "openai" } }
		const { container } = render(<UnlokWorkspaceErrorActions />)
		expect(container.innerHTML).toBe("")
	})
})
