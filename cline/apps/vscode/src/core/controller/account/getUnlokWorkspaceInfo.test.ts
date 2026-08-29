import { describe, expect, it, vi } from "vitest"

const axiosGetMock = vi.fn()
vi.mock("axios", () => ({
	default: { get: (...args: unknown[]) => axiosGetMock(...args) },
}))

const getUnlokUserNameMock = vi.fn().mockReturnValue(undefined)
vi.mock("@/sdk/auth-service", () => ({
	AuthService: { getInstance: () => ({ getUnlokUserName: getUnlokUserNameMock }) },
}))

const { getUnlokWorkspaceInfo } = await import("./getUnlokWorkspaceInfo")

function fakeController(apiKey: string | undefined) {
	return {
		stateManager: {
			getApiConfiguration: () => ({ unlokApiKey: apiKey }),
		},
	}
}

describe("getUnlokWorkspaceInfo", () => {
	it("rejects when no Unlok API key is configured, without making a network call", async () => {
		await expect(getUnlokWorkspaceInfo(fakeController(undefined) as never, {})).rejects.toThrow("Not signed in to Unlok")
		expect(axiosGetMock).not.toHaveBeenCalled()
	})

	it("sends the API key as a bearer token to the backend's /v1/me route", async () => {
		axiosGetMock.mockResolvedValueOnce({
			data: { access_mode: "unlok", models: [], budget: { spent_usd: 0, cap_usd: 5 }, disabled_model_count: 0 },
		})

		await getUnlokWorkspaceInfo(fakeController("sk_test_key") as never, {})

		expect(axiosGetMock).toHaveBeenCalledWith(
			expect.stringMatching(/\/v1\/me$/),
			expect.objectContaining({ headers: { Authorization: "Bearer sk_test_key" } }),
		)
	})

	it("maps the backend's snake_case response onto the proto message", async () => {
		axiosGetMock.mockResolvedValueOnce({
			data: {
				access_mode: "unlok",
				models: [
					{
						provider: "anthropic",
						model: "claude-sonnet-5",
						label: "Claude Sonnet 5",
						credentialed: true,
						pinnable: true,
					},
				],
				budget: { spent_usd: 2.5, cap_usd: 5.0 },
				disabled_model_count: 3,
				total_selectable_models: 4,
			},
		})

		const result = await getUnlokWorkspaceInfo(fakeController("sk_test_key") as never, {})

		expect(result.accessMode).toBe("unlok")
		expect(result.models).toEqual([
			{
				provider: "anthropic",
				model: "claude-sonnet-5",
				label: "Claude Sonnet 5",
				credentialed: true,
				pinnable: true,
			},
		])
		expect(result.budget).toEqual({ spentUsd: 2.5, capUsd: 5.0 })
		expect(result.disabledModelCount).toBe(3)
		expect(result.totalSelectableModels).toBe(4)
	})

	it("defaults credentialed and pinnable to false when the backend omits them", async () => {
		axiosGetMock.mockResolvedValueOnce({
			data: {
				access_mode: "byok",
				models: [{ provider: "openai", model: "gpt-5", label: "GPT-5" }],
				budget: { spent_usd: 0, cap_usd: 5 },
				disabled_model_count: 0,
			},
		})

		const result = await getUnlokWorkspaceInfo(fakeController("sk_test_key") as never, {})

		expect(result.models[0].credentialed).toBe(false)
		expect(result.models[0].pinnable).toBe(false)
	})

	it("combines the display name captured at sign-in with the backend's email", async () => {
		getUnlokUserNameMock.mockReturnValueOnce("Ada Lovelace")
		axiosGetMock.mockResolvedValueOnce({
			data: {
				access_mode: "byok",
				models: [],
				budget: { spent_usd: 0, cap_usd: 5 },
				disabled_model_count: 0,
				email: "ada@unlok.dev",
			},
		})

		const result = await getUnlokWorkspaceInfo(fakeController("sk_test_key") as never, {})

		expect(result.userName).toBe("Ada Lovelace")
		expect(result.userEmail).toBe("ada@unlok.dev")
	})

	it("defaults userName and userEmail to empty strings when neither is available", async () => {
		getUnlokUserNameMock.mockReturnValueOnce(undefined)
		axiosGetMock.mockResolvedValueOnce({
			data: { access_mode: "byok", models: [], budget: { spent_usd: 0, cap_usd: 5 }, disabled_model_count: 0 },
		})

		const result = await getUnlokWorkspaceInfo(fakeController("sk_test_key") as never, {})

		expect(result.userName).toBe("")
		expect(result.userEmail).toBe("")
	})

	it("propagates a failed request rather than returning a silently empty result", async () => {
		axiosGetMock.mockRejectedValueOnce(new Error("network down"))

		await expect(getUnlokWorkspaceInfo(fakeController("sk_test_key") as never, {})).rejects.toThrow("network down")
	})
})
