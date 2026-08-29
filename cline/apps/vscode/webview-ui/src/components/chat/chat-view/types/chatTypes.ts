/**
 * Shared types and interfaces for the chat view components
 */

import { ClineAsk, ClineMessage } from "@shared/ExtensionMessage"
import { ListRange, VirtuosoHandle } from "react-virtuoso"
import { ButtonActionType } from "../shared/buttonConfig"

export interface PendingUserMessage {
	message: ClineMessage
	afterTs: number
}

export interface PendingResponse {
	/** Locally unique submission id, used to avoid an older RPC clearing newer state. */
	id: number
	/** TurnState sequence observed when the RPC was sent. */
	turnStateSeq: number | undefined
	/** Raw backend message count observed when the RPC was sent (legacy fallback). */
	messageCount: number
}

/**
 * Chat state interface
 */
export interface ChatState {
	// State values
	inputValue: string
	setInputValue: React.Dispatch<React.SetStateAction<string>>
	activeQuote: string | null
	setActiveQuote: React.Dispatch<React.SetStateAction<string | null>>
	isTextAreaFocused: boolean
	setIsTextAreaFocused: React.Dispatch<React.SetStateAction<boolean>>
	selectedImages: string[]
	setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>
	selectedFiles: string[]
	setSelectedFiles: React.Dispatch<React.SetStateAction<string[]>>
	sendingDisabled: boolean
	setSendingDisabled: React.Dispatch<React.SetStateAction<boolean>>
	enableButtons: boolean
	setEnableButtons: React.Dispatch<React.SetStateAction<boolean>>
	primaryButtonText: string | undefined
	setPrimaryButtonText: React.Dispatch<React.SetStateAction<string | undefined>>
	secondaryButtonText: string | undefined
	setSecondaryButtonText: React.Dispatch<React.SetStateAction<string | undefined>>
	expandedRows: Record<number, boolean>
	setExpandedRows: React.Dispatch<React.SetStateAction<Record<number, boolean>>>
	pendingUserMessage: PendingUserMessage | undefined
	setPendingUserMessage: React.Dispatch<React.SetStateAction<PendingUserMessage | undefined>>
	pendingResponse: PendingResponse | undefined
	setPendingResponse: React.Dispatch<React.SetStateAction<PendingResponse | undefined>>
	// Whether the composer's "Plan" pill is selected -- independent of the
	// underlying SDK Mode (which stays "act" the whole time for the Unlok
	// step-plan feature; see chat-textarea-mode-toggle.ts). Local-only, not
	// synced from the extension host.
	planModeSelected: boolean
	setPlanModeSelected: React.Dispatch<React.SetStateAction<boolean>>
	// Which routing policy generatePlan uses to shape tier assignment --
	// local UI state, not a persisted account setting (see
	// PlanRoutingPolicyDropdown.tsx for why).
	planRoutingPolicy: string
	setPlanRoutingPolicy: React.Dispatch<React.SetStateAction<string>>
	// Local UI feedback around generatePlan's request/response round trip --
	// the RPC itself has no streaming/progress signal, so this is the only
	// way the Plan screen can show "generating" instead of looking inert,
	// and the only way a failure (no credential, backend error, network)
	// ever reaches the user instead of only a console.error.
	planGenerating: boolean
	setPlanGenerating: React.Dispatch<React.SetStateAction<boolean>>
	planGenerationError: string | null
	setPlanGenerationError: React.Dispatch<React.SetStateAction<string | null>>

	// Refs
	textAreaRef: React.RefObject<HTMLTextAreaElement>

	// Derived values
	lastMessage: ClineMessage | undefined
	secondLastMessage: ClineMessage | undefined
	clineAsk: ClineAsk | undefined
	task: ClineMessage | undefined

	// Handlers
	handleFocusChange: (isFocused: boolean) => void
	clearExpandedRows: () => void
	resetState: () => void

	// Scroll-related state (will be moved to scroll hook)
	isAtBottom?: boolean
	pendingScrollToMessage?: number | null
}

/**
 * Message handlers interface
 */
export interface MessageHandlers {
	executeButtonAction: (action: ButtonActionType, text?: string, images?: string[], files?: string[]) => Promise<void>
	handleSendMessage: (text: string, images: string[], files: string[]) => Promise<void>
	handleTaskCloseButtonClick: () => void
	startNewTask: () => Promise<void>
}

/**
 * Scroll behavior interface
 */
export interface ScrollBehavior {
	virtuosoRef: React.RefObject<VirtuosoHandle>
	scrollContainerRef: React.RefObject<HTMLDivElement>
	disableAutoScrollRef: React.MutableRefObject<boolean>
	scrollToBottomSmooth: () => void
	scrollToBottomAuto: () => void
	scrollToMessage: (messageIndex: number) => void
	toggleRowExpansion: (ts: number, options?: { preserveAutoScroll?: boolean }) => void
	handleRowHeightChange: (isTaller: boolean) => void
	handleLastRowContentChange: () => void
	isAtBottom: boolean
	setIsAtBottom: React.Dispatch<React.SetStateAction<boolean>>
	pendingScrollToMessage: number | null
	setPendingScrollToMessage: React.Dispatch<React.SetStateAction<number | null>>
	scrolledPastUserMessage: ClineMessage | null
	handleRangeChanged: (range: ListRange) => void
}

/**
 * Welcome section props
 */
export interface WelcomeSectionProps {
	showAnnouncement: boolean
	hideAnnouncement: () => void
	showHistoryView: () => void
	telemetrySetting: string
	version: string
	taskHistory: any[]
	shouldShowQuickWins: boolean
}
