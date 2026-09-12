/**
 * The .unlok folder in the extension: the setup card on the first task in
 * a folder that has none, the binding prompt when the repo names another
 * workspace, Initialize, and the effective rules list for Settings.
 */

import type { ClineMessage } from "@shared/ExtensionMessage"
import { fetchUnlokWorkspaceRules, rememberUnlokFact } from "@/core/controller/account/unlokMemory"
import { loadUnlokWorkspaces } from "@/core/controller/account/unlokWorkspaces"
import {
	detectUnlokProject,
	type EffectiveRules,
	loadEffectiveRules,
	scaffoldUnlokProject,
	type UnlokProjectStatus,
} from "@/core/project/unlok-project"
import { dismissSetupForever, isSetupDismissedForever } from "@/core/project/unlok-project-context"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"

/** What the chat card carries; the webview renders it (UnlokProjectCard). */
export type UnlokProjectCard =
	| { kind: "init"; root: string; folderName: string; hasLegacyDir: boolean; workspaceName: string }
	| { kind: "binding"; root: string; teamId: string; workspaceName: string; activeWorkspaceName: string }
	| { kind: "initialized"; root: string; created: string[]; foldedLegacy: number }

/**
 * The follow-up sent after scaffolding. It is a builtin slash command
 * (src/sdk/builtin-slash-commands.ts), so the chat shows "/init" and the
 * model receives the drafting instructions.
 */
export const UNLOK_INIT_COMMAND = "/init"

export interface UnlokProjectCoordinatorOptions {
	stateManager: StateManager
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	getWorkspaceRoot: () => Promise<string>
	postStateToWebview: () => Promise<void>
	/** Sends a prompt into the open task (queued when a turn is running). */
	sendFollowup: (prompt: string) => Promise<void>
}

const WORKSPACE_RULES_TTL_MS = 60_000

export class UnlokProjectCoordinator {
	/** Folders the person said "Not now" to, this session only. */
	private readonly dismissedNow = new Set<string>()
	/** One card per folder per session; a task restart must not repeat it. */
	private readonly shownFor = new Set<string>()
	private rulesCache: { apiKey: string; at: number; result: Awaited<ReturnType<typeof fetchUnlokWorkspaceRules>> } | undefined

	constructor(private readonly options: UnlokProjectCoordinatorOptions) {}

	private activeIsUnlok(): boolean {
		try {
			const apiConfig = this.options.stateManager.getApiConfiguration()
			const mode = this.options.stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
			return (mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) === "unlok"
		} catch {
			return false
		}
	}

	private apiKey(): string | undefined {
		try {
			const key = this.options.stateManager.getApiConfiguration()?.unlokApiKey
			return typeof key === "string" && key.trim() ? key : undefined
		} catch {
			return undefined
		}
	}

	private activeWorkspace(): { id: string; teamId: string; name: string } | undefined {
		try {
			const store = loadUnlokWorkspaces(this.options.stateManager)
			const active = store.workspaces.find((w) => w.id === store.activeId)
			if (!active) {
				return undefined
			}
			return {
				id: active.id,
				teamId: active.teamId ?? "",
				name: active.workspaceName || (active.teamId ? "Team" : "Personal"),
			}
		} catch {
			return undefined
		}
	}

	/** Cached for a minute: the session factory asks on every session build. */
	async workspaceRulesResult(): Promise<Awaited<ReturnType<typeof fetchUnlokWorkspaceRules>>> {
		const apiKey = this.apiKey()
		if (!apiKey || !this.activeIsUnlok()) {
			return { rules: [], version: "0", available: false }
		}
		if (this.rulesCache && this.rulesCache.apiKey === apiKey && Date.now() - this.rulesCache.at < WORKSPACE_RULES_TTL_MS) {
			return this.rulesCache.result
		}
		const result = await fetchUnlokWorkspaceRules(apiKey)
		this.rulesCache = { apiKey, at: Date.now(), result }
		return result
	}

	async workspaceRules(): Promise<Awaited<ReturnType<typeof fetchUnlokWorkspaceRules>>["rules"]> {
		return (await this.workspaceRulesResult()).rules
	}

	/**
	 * Called once a task has started. Shows the setup card when the folder has
	 * no UNLOK.md and no .unlok/, or the binding card when .unlok/settings.json
	 * names a workspace other than the active one. Never throws.
	 */
	async afterTaskStarted(sessionId: string): Promise<void> {
		if (!this.activeIsUnlok()) {
			return
		}
		try {
			const root = await this.options.getWorkspaceRoot()
			if (!root || this.shownFor.has(root)) {
				return
			}
			const status = await detectUnlokProject(root)
			const active = this.activeWorkspace()
			const bound = status.binding
			if (status.initialized && bound?.teamId && active && bound.teamId !== active.teamId) {
				this.shownFor.add(root)
				this.emitCard(
					{
						kind: "binding",
						root,
						teamId: bound.teamId,
						workspaceName: bound.name || "another workspace",
						activeWorkspaceName: active.name,
					},
					sessionId,
				)
				return
			}
			if (
				!status.initialized &&
				!status.hasLegacyDir &&
				!this.dismissedNow.has(root) &&
				!(await isSetupDismissedForever(root))
			) {
				this.shownFor.add(root)
				this.emitCard(
					{
						kind: "init",
						root,
						folderName: root.split(/[\\/]/).filter(Boolean).pop() ?? root,
						hasLegacyDir: status.hasLegacyDir,
						workspaceName: active?.name ?? "",
					},
					sessionId,
				)
			}
		} catch (error) {
			Logger.warn("[UnlokProject] Could not check the folder's Unlok setup:", error)
		}
	}

	/** Initialize: write UNLOK.md bound to the active team, fold an earlier .unlok/ folder in, then ask the agent to draft it. */
	async initialize(): Promise<UnlokProjectStatus> {
		const root = await this.options.getWorkspaceRoot()
		const active = this.activeWorkspace()
		const result = await scaffoldUnlokProject(root, {
			workspace: active?.teamId ? { teamId: active.teamId, name: active.name } : undefined,
		})
		const sessionId = this.options.sessions.getActiveSession()?.sessionId
		this.emitCard({ kind: "initialized", root, created: result.created, foldedLegacy: result.foldedLegacy }, sessionId)
		await this.options.postStateToWebview()
		try {
			await this.options.sendFollowup(UNLOK_INIT_COMMAND)
		} catch (error) {
			Logger.warn("[UnlokProject] Could not start the UNLOK.md drafting turn:", error)
		}
		return detectUnlokProject(root)
	}

	async dismiss(mode: "now" | "never"): Promise<void> {
		const root = await this.options.getWorkspaceRoot()
		this.dismissedNow.add(root)
		if (mode === "never") {
			await dismissSetupForever(root)
		}
	}

	async effectiveRules(): Promise<{
		status: UnlokProjectStatus
		effective: EffectiveRules
		workspaceRulesVersion: string
		workspaceRulesAvailable: boolean
	}> {
		const root = await this.options.getWorkspaceRoot()
		const [status, result] = await Promise.all([detectUnlokProject(root), this.workspaceRulesResult()])
		const effective = await loadEffectiveRules(root, result.rules)
		return { status, effective, workspaceRulesVersion: result.version, workspaceRulesAvailable: result.available }
	}

	/** "/remember <text>": saves a fact and confirms in chat. */
	async remember(text: string): Promise<string> {
		const apiKey = this.apiKey()
		if (!apiKey) {
			throw new Error("Connect an Unlok workspace to remember things.")
		}
		const fact = await rememberUnlokFact(apiKey, text)
		const sessionId = this.options.sessions.getActiveSession()?.sessionId
		this.emitInfo(`Remembered for this workspace: ${fact.title}`, sessionId)
		await this.options.postStateToWebview()
		return fact.title
	}

	private emitCard(card: UnlokProjectCard, sessionId: string | undefined): void {
		const message: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "unlok_project",
			text: JSON.stringify(card),
			partial: false,
		}
		this.options.messages.appendAndEmit([message], {
			type: "status",
			payload: { sessionId: sessionId ?? "", status: "running" },
		})
	}

	private emitInfo(text: string, sessionId: string | undefined): void {
		const message: ClineMessage = { ts: Date.now(), type: "say", say: "info", text, partial: false }
		this.options.messages.appendAndEmit([message], {
			type: "status",
			payload: { sessionId: sessionId ?? "", status: "running" },
		})
	}
}
