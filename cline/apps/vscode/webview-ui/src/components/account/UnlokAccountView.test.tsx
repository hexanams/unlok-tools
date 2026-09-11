import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { UnlokAccountView } from "./UnlokAccountView"

const setActiveMock = vi.fn().mockResolvedValue({})
const removeMock = vi.fn().mockResolvedValue({})
const authMock = vi.fn().mockResolvedValue({})
const infoMock = vi.fn().mockResolvedValue({
	accessMode: "unlok",
	models: [],
	budget: { spentUsd: 1, capUsd: 5 },
	disabledModelCount: 0,
	totalSelectableModels: 0,
	userName: "",
	userEmail: "me@acme.dev",
	connectedRepos: [],
})

vi.mock("@/services/grpc-client", () => ({
	AccountServiceClient: {
		getUnlokWorkspaceInfo: (...args: unknown[]) => infoMock(...args),
		setActiveUnlokWorkspace: (...args: unknown[]) => setActiveMock(...args),
		removeUnlokWorkspace: (...args: unknown[]) => removeMock(...args),
		unlokAuthClicked: (...args: unknown[]) => authMock(...args),
	},
}))

const state = vi.hoisted(() => ({
	value: {
		unlokWorkspaces: [
			{ id: "ws-team", email: "me@acme.dev", workspaceName: "Acme Engineering", teamId: "t1", active: true, lastError: "", addedAt: 1 },
			{ id: "ws-personal", email: "me@acme.dev", workspaceName: "Personal", teamId: "", active: false, lastError: "", addedAt: 2 },
			{ id: "ws-side", email: "me@gmail.com", workspaceName: "Side project", teamId: "", active: false, lastError: "401", addedAt: 3 },
		],
	},
}))
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => state.value,
}))

describe("UnlokAccountView", () => {
	beforeEach(() => {
		setActiveMock.mockClear()
		removeMock.mockClear()
		authMock.mockClear()
	})

	it("lists every connected workspace and marks the active one", async () => {
		render(<UnlokAccountView />)
		expect(screen.getByText("Acme Engineering")).toBeTruthy()
		expect(screen.getByText("Personal")).toBeTruthy()
		expect(screen.getByText("Side project")).toBeTruthy()
		expect(screen.getByText("3 workspaces")).toBeTruthy()
		expect(screen.getByText("Not working right now")).toBeTruthy()
		await waitFor(() => expect(infoMock).toHaveBeenCalled())
	})

	it("switches to another workspace by id", () => {
		render(<UnlokAccountView />)
		const [usePersonal] = screen.getAllByText("Use this workspace")
		fireEvent.click(usePersonal)
		expect(setActiveMock).toHaveBeenCalledWith(expect.objectContaining({ value: "ws-personal" }))
	})

	it("removes a workspace by id and adds one through the Unlok sign in", () => {
		render(<UnlokAccountView />)
		fireEvent.click(screen.getByLabelText("Remove Personal"))
		expect(removeMock).toHaveBeenCalledWith(expect.objectContaining({ value: "ws-personal" }))
		fireEvent.click(screen.getByText("Add another workspace"))
		expect(authMock).toHaveBeenCalled()
	})
})
