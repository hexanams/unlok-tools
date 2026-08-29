import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"

export type ModeToggleDraftAction = "clear" | "restore" | "keep"

export function getModeToggleDraftAction(input: {
	consumed: boolean
	currentText: string
	submittedText: string
}): ModeToggleDraftAction {
	if (input.consumed) {
		return input.currentText === input.submittedText ? "clear" : "keep"
	}

	return input.currentText.length === 0 && input.submittedText.length > 0 ? "restore" : "keep"
}

/**
 * The composer's Plan/Auto/Manual selector. Plan now drives Unlok's
 * step-plan feature (decompose the goal into priced, tiered steps; run them
 * with approval -- see plan-coordinator.ts) rather than Cline's classic
 * discuss-before-acting Plan mode; all three options run on top of "act"
 * underneath. Auto and Manual differ only in which autoApprovalSettings
 * preset is applied -- see AUTO_MODE_ACTIONS/MANUAL_MODE_ACTIONS in
 * shared/AutoApprovalSettings.ts. Which pill is "active" for Plan is tracked
 * separately (ChatState.planModeSelected, local UI state) since Mode alone
 * can no longer distinguish it -- see getActiveChatModeOption below, which
 * still keys off Mode for Auto/Manual only.
 */
export type ChatModeOption = "plan" | "auto" | "manual"

const COMPARABLE_ACTION_KEYS = ["readFiles", "editFiles", "executeSafeCommands", "useBrowser", "useMcp"] as const

function actionsMatchPreset(actions: AutoApprovalSettings["actions"], preset: AutoApprovalSettings["actions"]): boolean {
	return COMPARABLE_ACTION_KEYS.every((key) => !!actions[key] === !!preset[key])
}

/**
 * Derives which of the three composer options is "active" for highlighting.
 * Auto/Manual are derived from the current autoApprovalSettings rather than
 * stored as their own field, so a user who hand-tweaks an individual toggle
 * in the auto-approve modal after picking a preset sees neither Auto nor
 * Manual highlighted once the mix no longer matches either preset exactly
 * -- Manual is the fallback label for that case, as the more conservative
 * assumption to default to.
 */
export function getActiveChatModeOption(
	mode: "plan" | "act",
	actions: AutoApprovalSettings["actions"],
	autoPreset: AutoApprovalSettings["actions"],
	manualPreset: AutoApprovalSettings["actions"],
): ChatModeOption {
	if (mode === "plan") {
		return "plan"
	}
	if (actionsMatchPreset(actions, autoPreset)) {
		return "auto"
	}
	if (actionsMatchPreset(actions, manualPreset)) {
		return "manual"
	}
	return "manual"
}

const CHAT_MODE_CYCLE: readonly ChatModeOption[] = ["plan", "auto", "manual"]

/** Used by the keyboard shortcut to cycle Plan -> Auto -> Manual -> Plan -> ... */
export function getNextChatModeOption(current: ChatModeOption): ChatModeOption {
	const index = CHAT_MODE_CYCLE.indexOf(current)
	return CHAT_MODE_CYCLE[(index + 1) % CHAT_MODE_CYCLE.length]
}
