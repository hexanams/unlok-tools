import React from "react"
import ChatTextArea from "@/components/chat/ChatTextArea"
import OptimusModeBanner from "@/components/chat/OptimusModeBanner"
import QuotedMessagePreview from "@/components/chat/QuotedMessagePreview"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"

interface InputSectionProps {
	chatState: ChatState
	messageHandlers: MessageHandlers
	scrollBehavior: ScrollBehavior
	placeholderText: string
	shouldDisableFilesAndImages: boolean
	selectFilesAndImages: () => Promise<void>
	/** Whether the current turn can be stopped (see ChatView's buttonConfig.stoppable). */
	canStop: boolean
	onStop: () => void
	/** What Unlok actually picked for the last completed turn, if anything -- see ChatView. */
	lastTurnRoutingNote: string | undefined
}

/**
 * Input section including quoted message preview and chat text area
 */
export const InputSection: React.FC<InputSectionProps> = ({
	chatState,
	messageHandlers,
	scrollBehavior,
	placeholderText,
	shouldDisableFilesAndImages,
	selectFilesAndImages,
	canStop,
	onStop,
	lastTurnRoutingNote,
}) => {
	const {
		activeQuote,
		setActiveQuote,
		isTextAreaFocused,
		inputValue,
		setInputValue,
		sendingDisabled,
		selectedImages,
		setSelectedImages,
		selectedFiles,
		setSelectedFiles,
		textAreaRef,
		handleFocusChange,
		lastMessage,
		planModeSelected,
		setPlanModeSelected,
		planRoutingPolicy,
		setPlanRoutingPolicy,
		isOptimusMode,
		setIsOptimusMode,
	} = chatState

	const { isAtBottom, scrollToBottomAuto } = scrollBehavior
	const { turnState } = useExtensionState()
	const legacyTaskRunning =
		turnState === undefined &&
		(lastMessage?.partial === true || (lastMessage?.type === "say" && lastMessage.say === "api_req_started"))
	const allowQueuedSubmit = turnState?.phase === "streaming" || turnState?.phase === "awaiting_approval" || legacyTaskRunning
	const submitDisabled = sendingDisabled && !allowQueuedSubmit

	return (
		<>
			{activeQuote && (
				<div style={{ marginBottom: "-12px", marginTop: "10px" }}>
					<QuotedMessagePreview
						isFocused={isTextAreaFocused}
						onDismiss={() => setActiveQuote(null)}
						text={activeQuote}
					/>
				</div>
			)}

			{isOptimusMode && (
				<div style={{ marginBottom: "6px", marginTop: "10px" }}>
					<OptimusModeBanner onExit={() => setIsOptimusMode(false)} />
				</div>
			)}

			<ChatTextArea
				activeQuote={activeQuote}
				canStop={canStop}
				inputValue={inputValue}
				lastTurnRoutingNote={lastTurnRoutingNote}
				onFocusChange={handleFocusChange}
				onHeightChange={() => {
					if (isAtBottom) {
						scrollToBottomAuto()
					}
				}}
				onSelectFilesAndImages={selectFilesAndImages}
				onSend={() => messageHandlers.handleSendMessage(inputValue, selectedImages, selectedFiles)}
				onStop={onStop}
				placeholderText={placeholderText}
				planModeSelected={planModeSelected}
				planRoutingPolicy={planRoutingPolicy}
				ref={textAreaRef}
				selectedFiles={selectedFiles}
				selectedImages={selectedImages}
				sendingDisabled={submitDisabled}
				setInputValue={setInputValue}
				setPlanModeSelected={setPlanModeSelected}
				setPlanRoutingPolicy={setPlanRoutingPolicy}
				setSelectedFiles={setSelectedFiles}
				setSelectedImages={setSelectedImages}
				shouldDisableFilesAndImages={shouldDisableFilesAndImages}
			/>
		</>
	)
}
