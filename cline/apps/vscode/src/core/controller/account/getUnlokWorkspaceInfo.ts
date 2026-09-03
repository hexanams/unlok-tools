import type { EmptyRequest } from "@shared/proto/cline/common"
import { UnlokWorkspaceInfo } from "@shared/proto/cline/account"
import axios from "axios"
import { AuthService } from "@/sdk/auth-service"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"
import { parseConnectedRepos } from "./unlokConnectedRepos"

// Same URL the SDK's builtin Unlok provider config uses for chat completions
// (sdk/packages/llms/src/providers/builtins.ts) -- duplicated rather than
// imported because the extension host and the SDK are separate bundles, the
// same reason UnlokProvider.tsx re-declares it independently on the webview
// side.
const UNLOK_BASE_URL = "https://unlok-backend-xpts.onrender.com/v1"

/**
 * Fetches what the signed-in Unlok workspace allows -- selectable models,
 * Unlok+ budget spent/cap this month, and how many models the org has
 * disabled. Called once from UnlokSignInGate.tsx right after sign-in
 * succeeds, so the user sees real workspace data instead of an empty chat.
 */
export async function getUnlokWorkspaceInfo(controller: Controller, _request: EmptyRequest): Promise<UnlokWorkspaceInfo> {
	const apiConfiguration = controller.stateManager.getApiConfiguration()
	const apiKey = apiConfiguration?.unlokApiKey
	if (!apiKey) {
		throw new Error("Not signed in to Unlok")
	}

	try {
		const response = await axios.get(`${UNLOK_BASE_URL}/me`, {
			headers: { Authorization: `Bearer ${apiKey}` },
			...getAxiosSettings(),
		})
		const data = response.data ?? {}

		return UnlokWorkspaceInfo.create({
			accessMode: data.access_mode ?? "",
			models: Array.isArray(data.models)
				? data.models.map((m: Record<string, unknown>) => ({
						provider: String(m.provider ?? ""),
						model: String(m.model ?? ""),
						label: String(m.label ?? ""),
						credentialed: Boolean(m.credentialed ?? false),
						pinnable: Boolean(m.pinnable ?? false),
					}))
				: [],
			budget: {
				spentUsd: Number(data.budget?.spent_usd ?? 0),
				capUsd: Number(data.budget?.cap_usd ?? 0),
			},
			disabledModelCount: Number(data.disabled_model_count ?? 0),
			totalSelectableModels: Number(data.total_selectable_models ?? 0),
			userName: AuthService.getInstance().getUnlokUserName() ?? "",
			userEmail: String(data.email ?? ""),
			// Metadata only (repo name, a language summary derived from
			// manifests, a README excerpt) -- never file content. See
			// docs/plans/2026-09-02-github-integrations-and-optimus-context.md.
			// Real file content, for a repo with AI context turned on in the
			// dashboard, is a separate on-demand call (POST /v1/repo-context),
			// not part of this sign-in-time fetch.
			connectedRepos: parseConnectedRepos(data),
		})
	} catch (error) {
		Logger.error(`Failed to fetch Unlok workspace info: ${error}`)
		throw error
	}
}
