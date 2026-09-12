/**
 * What a task carries in from the .unlok tiers and the memory bank.
 *
 * Rules (workspace, repo, personal) go into every session's system prompt.
 * The memory index goes in on the first turn of a task only: it is a list
 * of titles and one-line descriptions, cheap to carry, and the model asks
 * Optimus for a body when a title looks relevant. A resumed task already
 * had it. Both sections are built by pure functions so they can be tested
 * without a workspace or a network.
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { UnlokMemoryIndexEntry, UnlokWorkspaceRuleRow } from "@/core/controller/account/unlokMemory"
import { resolveDataDirFromEnv } from "@/shared/storage/storage-context"
import { type EffectiveRules, loadEffectiveRules, renderRulesSection } from "./unlok-project"

export const MEMORY_INDEX_SECTION_TITLE = "# Memory Index"

export function renderMemoryIndexSection(entries: UnlokMemoryIndexEntry[]): string {
	if (entries.length === 0) {
		return ""
	}
	const lines = [
		MEMORY_INDEX_SECTION_TITLE,
		"",
		"Facts Unlok has kept about this workspace from earlier tasks, titles only. When one is relevant, ask for its body with the /optimus command or say what you need; do not guess at the contents. Pinned facts come first.",
		"",
	]
	for (const entry of entries) {
		const kind = entry.kind ? ` (${entry.kind})` : ""
		lines.push(`- ${entry.title}${kind}: ${entry.description}`)
	}
	return lines.join("\n")
}

export interface UnlokContextInput {
	root: string
	/** Rules from the workspace, already fetched (empty when personal or offline). */
	workspaceRules: UnlokWorkspaceRuleRow[]
	/** The memory index, already fetched; ignored unless this is a new task. */
	memoryIndex: UnlokMemoryIndexEntry[]
	isNewTask: boolean
}

export interface UnlokContextSections {
	rules: string
	memoryIndex: string
	effective: EffectiveRules
}

export async function buildUnlokContextSections(input: UnlokContextInput): Promise<UnlokContextSections> {
	const effective = await loadEffectiveRules(input.root, input.workspaceRules)
	return {
		rules: renderRulesSection(effective),
		memoryIndex: input.isNewTask ? renderMemoryIndexSection(input.memoryIndex) : "",
		effective,
	}
}

// ---- "never for this repo" ------------------------------------------------

const SETUP_FILE = "unlok-project-setup.json"

interface SetupPrefs {
	never: string[]
}

function setupFilePath(): string {
	return path.join(resolveDataDirFromEnv(), "settings", SETUP_FILE)
}

async function readSetupPrefs(): Promise<SetupPrefs> {
	try {
		const parsed = JSON.parse(await fs.readFile(setupFilePath(), "utf8")) as Partial<SetupPrefs>
		return { never: Array.isArray(parsed.never) ? parsed.never.map(String) : [] }
	} catch {
		return { never: [] }
	}
}

export async function isSetupDismissedForever(root: string): Promise<boolean> {
	const prefs = await readSetupPrefs()
	return prefs.never.includes(path.resolve(root))
}

export async function dismissSetupForever(root: string): Promise<void> {
	const prefs = await readSetupPrefs()
	const resolved = path.resolve(root)
	if (!prefs.never.includes(resolved)) {
		prefs.never.push(resolved)
	}
	const file = setupFilePath()
	await fs.mkdir(path.dirname(file), { recursive: true })
	await fs.writeFile(file, `${JSON.stringify(prefs, null, 2)}\n`, "utf8")
}
