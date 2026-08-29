import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@/core/storage/StateManager"
import { toLegacyApiProvider } from "@/shared/model-catalog/provider-helpers"
import { Logger } from "@/shared/services/Logger"
import { getProviderModelIdKey } from "@/shared/storage/provider-keys"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkSessionRebuildScheduler } from "./sdk-session-rebuild-scheduler"
import type { SdkSessionHost } from "./session-host"
import type { TaskProxy } from "./task-proxy"
import type { VscodeSessionHost } from "./vscode-session-host"

type StartInput = Parameters<VscodeSessionHost["start"]>[0]
type InitialMessages = StartInput["initialMessages"]
type SessionConfig = Awaited<ReturnType<SdkSessionConfigBuilder["build"]>>

export interface SdkProviderChangeCoordinatorOptions {
	stateManager: StateManager
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	sessionConfigBuilder: SdkSessionConfigBuilder
	getTask: () => TaskProxy | undefined
	getWorkspaceRoot: () => Promise<string>
	loadInitialMessages: (sdkHost: SdkSessionHost, sessionId: string) => Promise<InitialMessages>
	buildStartSessionInput: (config: SessionConfig, input: { cwd: string; mode: Mode }) => StartInput
	postStateToWebview: () => Promise<void>
	rebuilds: Pick<SdkSessionRebuildScheduler, "request">
}

function providerForMode(config: ApiConfiguration, mode: Mode): string | undefined {
	const provider = mode === "plan" ? config.planModeApiProvider : config.actModeApiProvider
	// Compare canonical spellings: previously-persisted snapshots can still
	// hold SDK ids like `openai-compatible` while new writes use the legacy
	// `openai` spelling; a spelling-only difference must not be treated as a
	// provider switch (it would restart the active session for nothing).
	return provider === undefined ? undefined : toLegacyApiProvider(provider)
}

// A provider-only comparison misses the common case for a provider like
// "unlok", where every vendor model is reached through the SAME provider id
// and only the model id actually picks which one -- confirmed live: picking
// a different model in the picker updated the displayed selection and
// storage (commitModelSelection.ts already writes it correctly), but the
// live SDK session kept answering from whatever model it was built with,
// since previousProvider === nextProvider short-circuited before ever
// reaching a rebuild. Reading the mode-specific model id key (the same one
// commitModelSelection.ts writes to, via getProviderModelIdKey) closes that
// gap for every provider, not just Unlok -- switching models within any
// single-provider vendor (OpenAI gpt-4o -> gpt-5, etc.) now also rebuilds.
function modelIdForMode(config: ApiConfiguration, mode: Mode, provider: string | undefined): string | undefined {
	if (!provider) {
		return undefined
	}
	const key = getProviderModelIdKey(provider, mode)
	const value = (config as Record<string, unknown>)[key]
	return typeof value === "string" ? value : undefined
}

export class SdkProviderChangeCoordinator {
	constructor(private readonly options: SdkProviderChangeCoordinatorOptions) {}

	handleApiConfigurationChanged(previous: ApiConfiguration, next: ApiConfiguration): void {
		const mode = this.getCurrentMode()
		const previousProvider = providerForMode(previous, mode)
		const nextProvider = providerForMode(next, mode)
		const previousModelId = modelIdForMode(previous, mode, previousProvider)
		const nextModelId = modelIdForMode(next, mode, nextProvider)

		if (previousProvider === nextProvider && previousModelId === nextModelId) {
			return
		}

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			Logger.log("[SdkController] Provider changed without active session; next task will use new provider")
			return
		}

		Logger.log(
			`[SdkController] Active provider/model changed for ${mode}: ` +
				`${previousProvider ?? "none"}/${previousModelId ?? "none"} -> ${nextProvider ?? "none"}/${nextModelId ?? "none"}`,
		)

		this.options.rebuilds.request("provider", () => this.restartActiveSessionForProviderChange())
	}

	async restartActiveSessionForProviderChange(): Promise<void> {
		await this.performRestartActiveSessionForProviderChange()
	}

	private async performRestartActiveSessionForProviderChange(): Promise<void> {
		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			return
		}

		const { sdkHost: oldManager, sessionId: oldSessionId } = activeSession
		const cwd = await this.options.getWorkspaceRoot()
		const mode = this.getCurrentMode()

		Logger.log(`[SdkController] Restarting session ${oldSessionId} for provider change`)

		try {
			const config = await this.options.sessionConfigBuilder.build({ cwd, mode })
			config.sessionId = oldSessionId

			const initialMessages = await this.options.loadInitialMessages(oldManager, oldSessionId)
			const startInput = this.options.buildStartSessionInput(config, { cwd, mode })
			const restartResult = await this.options.sessions.replaceActiveSession({
				expectedSession: activeSession,
				startInput,
				...(initialMessages ? { initialMessages } : {}),
				disposeReason: "providerChange",
			})
			if (!restartResult) {
				return
			}

			const { startResult } = restartResult
			const task = this.options.getTask()
			if (task && task.taskId !== startResult.sessionId) {
				Logger.warn(
					`[SdkController] Provider restart returned a new session ID (${startResult.sessionId}); updating task proxy`,
				)
				task.taskId = startResult.sessionId
			}

			await this.options.postStateToWebview()
			Logger.log(`[SdkController] Session restarted for provider change: ${oldSessionId} -> ${startResult.sessionId}`)
		} catch (error) {
			Logger.error("[SdkController] Failed to restart session for provider change:", error)
			this.options.messages.appendAndEmit(
				[
					{
						ts: Date.now(),
						type: "say",
						say: "error",
						text: `Failed to reload provider configuration: ${
							error instanceof Error ? error.message : String(error)
						}. The active session may still use the previous provider.`,
						partial: false,
					},
				],
				{ type: "status", payload: { sessionId: oldSessionId, status: "error" } },
			)
			await this.options.postStateToWebview()
		}
	}

	private getCurrentMode(): Mode {
		return this.options.stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
	}
}
