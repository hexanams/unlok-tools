export interface SlashCommand {
	name: string
	description?: string
	section?: "default" | "custom" | "mcp"
	cliCompatible?: boolean
}

export const BASE_SLASH_COMMANDS: SlashCommand[] = [
	{
		name: "clear",
		description: "Clears the current task and starts a new one",
		section: "default",
		cliCompatible: true,
	},
	// `/newtask` is an alias of `/compact`: condensing achieves its goal
	// (continue working with a fresh, summarized context window) without the
	// legacy new_task tool. The webview intercepts all three spellings and
	// runs the condense RPC (see useMessageHandlers.handleSendMessage).
	{
		name: "newtask",
		description: "Condenses the current task and continues with a fresh context window",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "deep-planning",
		description: "Create a comprehensive implementation plan before coding",
		section: "default",
		cliCompatible: true,
	},
	// NOTE: legacy's /newrule and /reportbug are hidden until their prompt
	// expansions are ported to the SDK runtime — without expansion the literal
	// command text reaches the model, which silently degrades to plain chat.
	{
		name: "init",
		description: "Sets this repository up for Unlok (UNLOK.md and .unlok) and drafts UNLOK.md",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "remember",
		description: "Saves what follows as a fact in this workspace's memory bank",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "compact",
		description: "Condenses your current context window",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "smol",
		description: "Alias for /compact",
		section: "default",
		cliCompatible: true,
	},
	// Answers from the signed-in Unlok account's (or pooled team's) already
	// digested Optimus memory -- intercepted and sent straight to
	// OptimusService.askOptimus (useMessageHandlers.ts), never expanded
	// into the model's prompt like a normal chat turn would be.
	// cliCompatible: false since this governs Cline's own generic CLI
	// runner (apps/cli), a separate surface from Unlok's own future CLI.
	{
		name: "optimus",
		description: "Ask Optimus a question about your team's memory",
		section: "default",
		cliCompatible: false,
	},
]

// VS Code-only slash commands
export const VSCODE_ONLY_COMMANDS: SlashCommand[] = []
