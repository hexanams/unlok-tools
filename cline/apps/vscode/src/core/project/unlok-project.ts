/**
 * The .unlok folder: how a repository, a person and a workspace tell Unlok
 * how to work, and how those three tiers combine.
 *
 * Layout in a repository (committed):
 *   UNLOK.md                  what this repo is and how to work in it
 *   .unlok/settings.json      { version, workspace: { teamId, name } }
 *   .unlok/rules/*.md         one rule per file
 *   .unlok/workflows/         slash workflows (same shape as .unlokrules/workflows)
 *   .unlok/hooks/  .unlok/skills/
 *   .unlok/rules.local.md, .unlok/settings.local.json   git ignored, this machine only
 * Personal: ~/.unlok/UNLOK.md.  Workspace: rules served by the backend.
 *
 * Precedence, lowest to highest: workspace, repo, personal. Except workspace
 * rules marked enforced, which sit above everything and cannot be overridden
 * below. Modelled on Claude Code's ~/.claude / .claude / CLAUDE.md layering,
 * with the workspace tier Unlok adds for teams.
 *
 * This module is dependency free on purpose (node:fs and node:path only) so
 * the CLI can adopt it unchanged.
 */

import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

export const UNLOK_PROJECT_VERSION = 1
export const UNLOK_MD = "UNLOK.md"
export const UNLOK_DIR = ".unlok"
export const UNLOK_RULES_DIR = "rules"
export const UNLOK_WORKFLOWS_DIR = "workflows"
export const UNLOK_HOOKS_DIR = "hooks"
export const UNLOK_SKILLS_DIR = "skills"
export const UNLOK_SETTINGS = "settings.json"
export const UNLOK_SETTINGS_LOCAL = "settings.local.json"
export const UNLOK_RULES_LOCAL = "rules.local.md"
export const LEGACY_RULES_DIR = ".unlokrules"

/** Where a rule came from, in ascending precedence for non-enforced rules. */
export type RuleSource = "workspace" | "repo" | "personal" | "workspace-enforced"

export interface UnlokRule {
	/** Display name: the file name, the rule title, or the first line. */
	title: string
	body: string
	source: RuleSource
	/** The file or "workspace:<id>" the rule came from. */
	origin: string
	enforced: boolean
	kind: "instruction" | "policy"
}

export interface WorkspaceRuleInput {
	id: string
	kind: "instruction" | "policy"
	title: string
	body: string
	enforced: boolean
}

export interface UnlokProjectSettings {
	version: number
	workspace?: { teamId: string; name?: string }
	[key: string]: unknown
}

export interface UnlokProjectStatus {
	root: string
	/** UNLOK.md or .unlok/ exists. */
	initialized: boolean
	hasUnlokMd: boolean
	hasUnlokDir: boolean
	/** A legacy .unlokrules folder is present and could be moved. */
	hasLegacyRules: boolean
	settings?: UnlokProjectSettings
	/** Problems a doctor would report; empty when the layout is sound. */
	problems: string[]
}

export interface EffectiveRules {
	rules: UnlokRule[]
	/** Titles of rules that were shadowed by a higher tier with the same title. */
	overridden: Array<{ title: string; by: RuleSource; was: RuleSource }>
}

async function exists(p: string): Promise<boolean> {
	try {
		await fs.access(p)
		return true
	} catch {
		return false
	}
}

async function readIfExists(p: string): Promise<string | undefined> {
	try {
		return await fs.readFile(p, "utf8")
	} catch {
		return undefined
	}
}

async function readJsonIfExists(p: string): Promise<Record<string, unknown> | undefined> {
	const text = await readIfExists(p)
	if (text === undefined) {
		return undefined
	}
	try {
		const parsed = JSON.parse(text)
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined
	} catch {
		return undefined
	}
}

export function personalUnlokDir(): string {
	return process.env.CLINE_DIR?.trim() || path.join(os.homedir(), UNLOK_DIR)
}

export function personalUnlokMdPath(): string {
	return path.join(personalUnlokDir(), UNLOK_MD)
}

/** Reads the repo's layout without changing anything. */
export async function detectUnlokProject(root: string): Promise<UnlokProjectStatus> {
	const unlokDir = path.join(root, UNLOK_DIR)
	const hasUnlokMd = await exists(path.join(root, UNLOK_MD))
	const hasUnlokDir = await exists(unlokDir)
	const hasLegacyRules = await exists(path.join(root, LEGACY_RULES_DIR))
	const problems: string[] = []
	let settings: UnlokProjectSettings | undefined
	if (hasUnlokDir) {
		const raw = await readJsonIfExists(path.join(unlokDir, UNLOK_SETTINGS))
		if (await exists(path.join(unlokDir, UNLOK_SETTINGS))) {
			if (!raw) {
				problems.push(`${UNLOK_DIR}/${UNLOK_SETTINGS} is not valid JSON.`)
			} else {
				const version = typeof raw.version === "number" ? raw.version : undefined
				if (version === undefined) {
					problems.push(`${UNLOK_DIR}/${UNLOK_SETTINGS} has no version.`)
				} else if (version > UNLOK_PROJECT_VERSION) {
					problems.push(
						`${UNLOK_DIR}/${UNLOK_SETTINGS} is version ${version}; this build understands ${UNLOK_PROJECT_VERSION}.`,
					)
				}
				const workspace = raw.workspace
				if (workspace !== undefined) {
					const teamId = (workspace as { teamId?: unknown })?.teamId
					if (typeof teamId !== "string" || !teamId.trim()) {
						problems.push(`${UNLOK_DIR}/${UNLOK_SETTINGS} names a workspace without a teamId.`)
					}
				}
				settings = { ...raw, version: version ?? UNLOK_PROJECT_VERSION } as UnlokProjectSettings
			}
		} else {
			problems.push(`${UNLOK_DIR}/ exists but has no ${UNLOK_SETTINGS}.`)
		}
		if (!hasUnlokMd) {
			problems.push(`${UNLOK_MD} is missing.`)
		}
	}
	return { root, initialized: hasUnlokMd || hasUnlokDir, hasUnlokMd, hasUnlokDir, hasLegacyRules, settings, problems }
}

export interface ScaffoldOptions {
	/** The active workspace when it is a team: written as the repo's binding. */
	workspace?: { teamId: string; name?: string }
	/** Repo name for the placeholder UNLOK.md. */
	projectName?: string
}

export interface ScaffoldResult {
	created: string[]
	/** Files left alone because they already existed. */
	kept: string[]
}

const GITIGNORE_LINES = [`${UNLOK_DIR}/${UNLOK_RULES_LOCAL}`, `${UNLOK_DIR}/${UNLOK_SETTINGS_LOCAL}`]

function placeholderUnlokMd(projectName: string): string {
	return [
		`# ${projectName}`,
		"",
		"Unlok reads this file at the start of every task in this repository. Keep it short and current.",
		"",
		"## What this is",
		"",
		"One paragraph on what the project does and who it is for.",
		"",
		"## How to work here",
		"",
		"- How to install, run and test.",
		"- Conventions that are not obvious from the code.",
		"- Anything a new contributor gets wrong the first time.",
		"",
		"## Where things live",
		"",
		"- Key folders and what they are for.",
		"",
		`Rules that apply to every task go in \`${UNLOK_DIR}/${UNLOK_RULES_DIR}/\`, one per file.`,
		"",
	].join("\n")
}

/**
 * Creates the layout. Idempotent: existing files are never overwritten, so
 * running it twice (or after a person edited UNLOK.md) changes nothing.
 */
export async function scaffoldUnlokProject(root: string, options: ScaffoldOptions = {}): Promise<ScaffoldResult> {
	const created: string[] = []
	const kept: string[] = []
	const unlokDir = path.join(root, UNLOK_DIR)
	for (const dir of [
		unlokDir,
		...[UNLOK_RULES_DIR, UNLOK_WORKFLOWS_DIR, UNLOK_HOOKS_DIR, UNLOK_SKILLS_DIR].map((d) => path.join(unlokDir, d)),
	]) {
		await fs.mkdir(dir, { recursive: true })
	}

	const writeIfMissing = async (file: string, content: string) => {
		const rel = path.relative(root, file)
		if (await exists(file)) {
			kept.push(rel)
			return
		}
		await fs.writeFile(file, content, "utf8")
		created.push(rel)
	}

	await writeIfMissing(path.join(root, UNLOK_MD), placeholderUnlokMd(options.projectName ?? path.basename(root)))

	const settingsPath = path.join(unlokDir, UNLOK_SETTINGS)
	if (await exists(settingsPath)) {
		kept.push(path.relative(root, settingsPath))
		// A binding given now is added to existing settings that lack one.
		if (options.workspace) {
			const raw = (await readJsonIfExists(settingsPath)) ?? {}
			if (!raw.workspace) {
				await fs.writeFile(
					settingsPath,
					`${JSON.stringify({ ...raw, version: raw.version ?? UNLOK_PROJECT_VERSION, workspace: options.workspace }, null, 2)}\n`,
					"utf8",
				)
			}
		}
	} else {
		const settings: UnlokProjectSettings = { version: UNLOK_PROJECT_VERSION }
		if (options.workspace) {
			settings.workspace = options.workspace
		}
		await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8")
		created.push(path.relative(root, settingsPath))
	}

	await writeIfMissing(
		path.join(unlokDir, UNLOK_RULES_DIR, "README.md"),
		"One rule per Markdown file. The file name is the rule's title. These apply to every task in this repository.\n",
	)

	// .gitignore: keep the machine-local files out of the repo.
	const gitignorePath = path.join(root, ".gitignore")
	const existing = (await readIfExists(gitignorePath)) ?? ""
	const missing = GITIGNORE_LINES.filter((line) => !existing.split(/\r?\n/).some((l) => l.trim() === line))
	if (missing.length > 0) {
		const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n"
		await fs.writeFile(gitignorePath, `${existing}${prefix}${missing.join("\n")}\n`, "utf8")
		created.push(".gitignore")
	}
	return { created, kept }
}

/** Moves .unlokrules/*.md into .unlok/rules/ (files only, never overwriting). */
export async function migrateLegacyRules(root: string): Promise<string[]> {
	const legacy = path.join(root, LEGACY_RULES_DIR)
	const target = path.join(root, UNLOK_DIR, UNLOK_RULES_DIR)
	const moved: string[] = []
	let entries: string[]
	try {
		entries = await fs.readdir(legacy)
	} catch {
		return moved
	}
	await fs.mkdir(target, { recursive: true })
	for (const name of entries) {
		const from = path.join(legacy, name)
		const stat = await fs.stat(from).catch(() => undefined)
		if (!stat?.isFile() || !name.toLowerCase().endsWith(".md")) {
			continue
		}
		const to = path.join(target, name)
		if (await exists(to)) {
			continue
		}
		await fs.rename(from, to)
		moved.push(name)
	}
	return moved
}

function titleFromMarkdown(fileName: string, body: string): string {
	const heading = body
		.split(/\r?\n/)
		.map((l) => l.trim())
		.find((l) => l.startsWith("#"))
	if (heading) {
		return heading.replace(/^#+\s*/, "").trim() || fileName
	}
	return fileName.replace(/\.md$/i, "")
}

async function readRuleFiles(dir: string, source: RuleSource): Promise<UnlokRule[]> {
	let names: string[]
	try {
		names = (await fs.readdir(dir)).filter((n) => n.toLowerCase().endsWith(".md") && n.toLowerCase() !== "readme.md").sort()
	} catch {
		return []
	}
	const rules: UnlokRule[] = []
	for (const name of names) {
		const file = path.join(dir, name)
		const body = (await readIfExists(file))?.trim()
		if (!body) {
			continue
		}
		rules.push({ title: titleFromMarkdown(name, body), body, source, origin: file, enforced: false, kind: "instruction" })
	}
	return rules
}

/** The repo tier: UNLOK.md, then .unlok/rules/*.md, then rules.local.md. */
export async function loadRepoRules(root: string): Promise<UnlokRule[]> {
	const rules: UnlokRule[] = []
	const md = (await readIfExists(path.join(root, UNLOK_MD)))?.trim()
	if (md) {
		rules.push({
			title: UNLOK_MD,
			body: md,
			source: "repo",
			origin: path.join(root, UNLOK_MD),
			enforced: false,
			kind: "instruction",
		})
	}
	rules.push(...(await readRuleFiles(path.join(root, UNLOK_DIR, UNLOK_RULES_DIR), "repo")))
	const local = (await readIfExists(path.join(root, UNLOK_DIR, UNLOK_RULES_LOCAL)))?.trim()
	if (local) {
		rules.push({
			title: UNLOK_RULES_LOCAL,
			body: local,
			source: "personal",
			origin: path.join(root, UNLOK_DIR, UNLOK_RULES_LOCAL),
			enforced: false,
			kind: "instruction",
		})
	}
	return rules
}

/** The personal tier: ~/.unlok/UNLOK.md. */
export async function loadPersonalRules(): Promise<UnlokRule[]> {
	const file = personalUnlokMdPath()
	const body = (await readIfExists(file))?.trim()
	if (!body) {
		return []
	}
	return [{ title: `~/${UNLOK_DIR}/${UNLOK_MD}`, body, source: "personal", origin: file, enforced: false, kind: "instruction" }]
}

/** The workspace tier, from the backend's rule rows. */
export function workspaceRulesToTier(rows: WorkspaceRuleInput[]): UnlokRule[] {
	return rows
		.filter((r) => r.body?.trim())
		.map((r) => ({
			title: r.title?.trim() || titleFromMarkdown("workspace rule", r.body),
			body: r.body.trim(),
			source: r.enforced ? "workspace-enforced" : "workspace",
			origin: `workspace:${r.id}`,
			enforced: Boolean(r.enforced),
			kind: r.kind === "policy" ? "policy" : "instruction",
		}))
}

const TIER_RANK: Record<RuleSource, number> = { workspace: 0, repo: 1, personal: 2, "workspace-enforced": 3 }

/**
 * Combines the tiers. Every rule is kept unless a higher tier carries a
 * rule with the same title, in which case the lower one is dropped and
 * reported as overridden. Enforced workspace rules rank above everything
 * and are listed first, so the model reads them before anything a repo or
 * a person wrote.
 */
export function mergeRules(input: { workspace?: UnlokRule[]; repo?: UnlokRule[]; personal?: UnlokRule[] }): EffectiveRules {
	const all = [...(input.workspace ?? []), ...(input.repo ?? []), ...(input.personal ?? [])]
	const byTitle = new Map<string, UnlokRule>()
	const overridden: EffectiveRules["overridden"] = []
	for (const rule of all) {
		const key = rule.title.trim().toLowerCase()
		const current = byTitle.get(key)
		if (!current) {
			byTitle.set(key, rule)
			continue
		}
		if (TIER_RANK[rule.source] > TIER_RANK[current.source]) {
			overridden.push({ title: rule.title, by: rule.source, was: current.source })
			byTitle.set(key, rule)
		} else {
			overridden.push({ title: current.title, by: current.source, was: rule.source })
		}
	}
	const rules = [...byTitle.values()].sort((a, b) => {
		if (a.enforced !== b.enforced) {
			return a.enforced ? -1 : 1
		}
		return 0
	})
	return { rules, overridden }
}

/** The system prompt section for a set of effective rules; empty when there are none. */
export function renderRulesSection(effective: EffectiveRules): string {
	if (effective.rules.length === 0) {
		return ""
	}
	const label = (r: UnlokRule) => {
		switch (r.source) {
			case "workspace-enforced":
				return "workspace rule, enforced"
			case "workspace":
				return "workspace rule"
			case "personal":
				return "personal rule"
			default:
				return "repository rule"
		}
	}
	const parts = [
		"# Unlok Rules",
		"",
		"Rules from the workspace, this repository and the person, highest precedence first. An enforced workspace rule may not be overridden by anything below it.",
	]
	for (const rule of effective.rules) {
		parts.push("", `## ${rule.title} (${label(rule)})`, "", rule.body)
	}
	return parts.join("\n")
}

/** Reads every tier from disk and merges it with the workspace rows given. */
export async function loadEffectiveRules(root: string, workspaceRules: WorkspaceRuleInput[] = []): Promise<EffectiveRules> {
	const [repo, personal] = await Promise.all([loadRepoRules(root), loadPersonalRules()])
	return mergeRules({ workspace: workspaceRulesToTier(workspaceRules), repo, personal })
}
