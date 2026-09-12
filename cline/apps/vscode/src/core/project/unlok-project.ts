/**
 * UNLOK.md: how a repository, a person and a workspace tell Unlok how to
 * work, and how those tiers combine.
 *
 * One file at the repository root, committed:
 *   UNLOK.md          text above the first "##" describes the repository;
 *                     every "##" section is one rule, named by its heading.
 *                     Optional YAML front matter binds it to a workspace:
 *                       ---
 *                       workspace: <team id>
 *                       workspace_name: Acme
 *                       ---
 *   UNLOK.local.md    the same shape, git ignored, this machine only.
 * Personal: ~/.unlok/UNLOK.md. Workspace: rules served by the backend.
 *
 * Precedence, lowest to highest: workspace, repository, personal. Except
 * workspace rules marked enforced, which sit above everything. Same-titled
 * rules resolve by that order; different titles all apply.
 *
 * An earlier layout put rules under a .unlok/ folder. It is still read for
 * one release, and Initialize folds it into UNLOK.md and removes it.
 *
 * Dependency free on purpose (node:fs, node:path, node:os only) so the CLI
 * can adopt it unchanged.
 */

import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

export const UNLOK_MD = "UNLOK.md"
export const UNLOK_LOCAL_MD = "UNLOK.local.md"
export const LEGACY_UNLOK_DIR = ".unlok"

/** Where a rule came from, in ascending precedence for non-enforced rules. */
export type RuleSource = "workspace" | "repo" | "personal" | "workspace-enforced"

export interface UnlokRule {
	/** The section heading, the file name for a preamble, or the rule title. */
	title: string
	body: string
	source: RuleSource
	/** The file (with a "#heading" suffix for a section), or "workspace:<id>". */
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

export interface UnlokBinding {
	teamId: string
	name?: string
}

export interface ParsedUnlokMd {
	binding?: UnlokBinding
	/** Text above the first "##" section, without the front matter. */
	preamble: string
	sections: Array<{ title: string; body: string }>
	/** Front matter lines that could not be read. */
	problems: string[]
}

export interface UnlokProjectStatus {
	root: string
	/** UNLOK.md exists. */
	initialized: boolean
	hasUnlokMd: boolean
	hasLocalMd: boolean
	/** The earlier .unlok/ folder is present and can be folded into UNLOK.md. */
	hasLegacyDir: boolean
	binding?: UnlokBinding
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

export function personalUnlokDir(): string {
	return process.env.CLINE_DIR?.trim() || path.join(os.homedir(), ".unlok")
}

export function personalUnlokMdPath(): string {
	return path.join(personalUnlokDir(), UNLOK_MD)
}

// ---- parsing ---------------------------------------------------------------

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** Reads the small front matter this file supports: flat "key: value" lines. */
function parseFrontMatter(text: string): { fields: Record<string, string>; rest: string; problems: string[] } {
	const match = FRONT_MATTER.exec(text)
	if (!match) {
		return { fields: {}, rest: text, problems: [] }
	}
	const fields: Record<string, string> = {}
	const problems: string[] = []
	for (const rawLine of match[1].split(/\r?\n/)) {
		const line = rawLine.trim()
		if (!line || line.startsWith("#")) {
			continue
		}
		const colon = line.indexOf(":")
		if (colon <= 0) {
			problems.push(`Front matter line could not be read: ${line}`)
			continue
		}
		const key = line.slice(0, colon).trim()
		const value = line
			.slice(colon + 1)
			.trim()
			.replace(/^["']|["']$/g, "")
		fields[key] = value
	}
	return { fields, rest: text.slice(match[0].length), problems }
}

export function parseUnlokMd(text: string): ParsedUnlokMd {
	const { fields, rest, problems } = parseFrontMatter(text)
	const binding: UnlokBinding | undefined = fields.workspace?.trim()
		? { teamId: fields.workspace.trim(), ...(fields.workspace_name?.trim() ? { name: fields.workspace_name.trim() } : {}) }
		: undefined
	const lines = rest.split(/\r?\n/)
	const preamble: string[] = []
	const sections: Array<{ title: string; body: string }> = []
	let current: { title: string; body: string[] } | undefined
	for (const line of lines) {
		const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line)
		if (heading) {
			if (current) {
				sections.push({ title: current.title, body: current.body.join("\n").trim() })
			}
			current = { title: heading[1].trim(), body: [] }
			continue
		}
		if (current) {
			current.body.push(line)
		} else {
			preamble.push(line)
		}
	}
	if (current) {
		sections.push({ title: current.title, body: current.body.join("\n").trim() })
	}
	return { binding, preamble: preamble.join("\n").trim(), sections: sections.filter((s) => s.body), problems }
}

function renderFrontMatter(binding: UnlokBinding): string {
	const lines = ["---", `workspace: ${binding.teamId}`]
	if (binding.name) {
		lines.push(`workspace_name: ${binding.name}`)
	}
	lines.push("---", "")
	return lines.join("\n")
}

// ---- detect ----------------------------------------------------------------

export async function detectUnlokProject(root: string): Promise<UnlokProjectStatus> {
	const mdPath = path.join(root, UNLOK_MD)
	const hasUnlokMd = await exists(mdPath)
	const hasLocalMd = await exists(path.join(root, UNLOK_LOCAL_MD))
	const hasLegacyDir = await exists(path.join(root, LEGACY_UNLOK_DIR))
	const problems: string[] = []
	let binding: UnlokBinding | undefined
	if (hasUnlokMd) {
		const parsed = parseUnlokMd((await readIfExists(mdPath)) ?? "")
		binding = parsed.binding
		problems.push(...parsed.problems)
		if (!parsed.preamble && parsed.sections.length === 0) {
			problems.push(`${UNLOK_MD} is empty.`)
		}
	}
	if (hasLegacyDir) {
		problems.push(`A ${LEGACY_UNLOK_DIR}/ folder from the earlier layout is present. Initialize folds it into ${UNLOK_MD}.`)
	}
	return { root, initialized: hasUnlokMd, hasUnlokMd, hasLocalMd, hasLegacyDir, binding, problems }
}

// ---- scaffold --------------------------------------------------------------

export interface ScaffoldOptions {
	/** The active workspace when it is a team: written as the file's binding. */
	workspace?: UnlokBinding
	/** Repository name for the placeholder. */
	projectName?: string
}

export interface ScaffoldResult {
	created: string[]
	/** Files left alone because they already existed. */
	kept: string[]
	/** Sections folded in from the earlier .unlok/ folder, which was then removed. */
	foldedLegacy: number
}

function placeholderUnlokMd(projectName: string, binding?: UnlokBinding): string {
	const body = [
		`# ${projectName}`,
		"",
		'Unlok reads this file at the start of every task in this repository. The text up here describes the project; every "##" section below is one rule, named by its heading.',
		"",
		"## How to work here",
		"",
		"How to install, run and test, and the conventions that are not obvious from the code.",
		"",
		"## Where things live",
		"",
		"Key folders and what they are for.",
		"",
	].join("\n")
	return binding ? renderFrontMatter(binding) + body : body
}

/**
 * Creates UNLOK.md if missing (never overwriting), git ignores UNLOK.local.md,
 * adds a binding to an existing file that has no front matter, and folds an
 * earlier .unlok/ folder into the file. Running it twice changes nothing.
 */
export async function scaffoldUnlokProject(root: string, options: ScaffoldOptions = {}): Promise<ScaffoldResult> {
	const created: string[] = []
	const kept: string[] = []
	const mdPath = path.join(root, UNLOK_MD)

	if (await exists(mdPath)) {
		kept.push(UNLOK_MD)
		if (options.workspace) {
			const text = (await readIfExists(mdPath)) ?? ""
			if (!FRONT_MATTER.test(text)) {
				await fs.writeFile(mdPath, renderFrontMatter(options.workspace) + text, "utf8")
			}
		}
	} else {
		await fs.writeFile(mdPath, placeholderUnlokMd(options.projectName ?? path.basename(root), options.workspace), "utf8")
		created.push(UNLOK_MD)
	}

	const gitignorePath = path.join(root, ".gitignore")
	const existing = (await readIfExists(gitignorePath)) ?? ""
	if (!existing.split(/\r?\n/).some((l) => l.trim() === UNLOK_LOCAL_MD)) {
		const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n"
		await fs.writeFile(gitignorePath, `${existing}${prefix}${UNLOK_LOCAL_MD}\n`, "utf8")
		created.push(".gitignore")
	}

	const foldedLegacy = await foldLegacyFolder(root)
	return { created, kept, foldedLegacy }
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

function stripLeadingHeading(body: string): string {
	const lines = body.split(/\r?\n/)
	const first = lines.findIndex((l) => l.trim())
	if (first >= 0 && /^#\s+/.test(lines[first].trim())) {
		lines.splice(first, 1)
	}
	return lines.join("\n").trim()
}

async function readLegacyRuleFiles(dir: string): Promise<Array<{ title: string; body: string; file: string }>> {
	let names: string[]
	try {
		names = (await fs.readdir(dir)).filter((n) => n.toLowerCase().endsWith(".md") && n.toLowerCase() !== "readme.md").sort()
	} catch {
		return []
	}
	const out: Array<{ title: string; body: string; file: string }> = []
	for (const name of names) {
		const file = path.join(dir, name)
		const body = (await readIfExists(file))?.trim()
		if (body) {
			out.push({ title: titleFromMarkdown(name, body), body: stripLeadingHeading(body) || body, file })
		}
	}
	return out
}

/**
 * Folds the earlier layout into the single file: .unlok/rules/*.md become
 * "##" sections of UNLOK.md, .unlok/rules.local.md becomes UNLOK.local.md,
 * a binding in .unlok/settings.json becomes front matter when the file has
 * none, then the folder is removed. Returns how many sections were folded.
 */
export async function foldLegacyFolder(root: string): Promise<number> {
	const legacy = path.join(root, LEGACY_UNLOK_DIR)
	if (!(await exists(legacy))) {
		return 0
	}
	const mdPath = path.join(root, UNLOK_MD)
	let text = (await readIfExists(mdPath)) ?? ""
	const parsed = parseUnlokMd(text)
	const present = new Set(parsed.sections.map((s) => s.title.toLowerCase()))
	let folded = 0

	const rules = await readLegacyRuleFiles(path.join(legacy, "rules"))
	const additions = rules.filter((r) => !present.has(r.title.toLowerCase()))
	if (additions.length > 0) {
		const block = additions.map((r) => `## ${r.title}\n\n${r.body}`).join("\n\n")
		text = `${text.replace(/\s*$/, "")}\n\n${block}\n`
		folded += additions.length
	}

	if (!parsed.binding) {
		try {
			const settings = JSON.parse((await readIfExists(path.join(legacy, "settings.json"))) ?? "{}") as {
				workspace?: { teamId?: string; name?: string }
			}
			if (settings.workspace?.teamId) {
				text = renderFrontMatter({ teamId: settings.workspace.teamId, name: settings.workspace.name }) + text
			}
		} catch {
			// Unreadable settings: nothing to carry over.
		}
	}
	if (text.trim()) {
		await fs.writeFile(mdPath, text, "utf8")
	}

	const local = (await readIfExists(path.join(legacy, "rules.local.md")))?.trim()
	if (local) {
		const localPath = path.join(root, UNLOK_LOCAL_MD)
		const existing = (await readIfExists(localPath)) ?? ""
		await fs.writeFile(localPath, existing ? `${existing.replace(/\s*$/, "")}\n\n${local}\n` : `${local}\n`, "utf8")
		folded += 1
	}

	await fs.rm(legacy, { recursive: true, force: true })
	return folded
}

// ---- load ------------------------------------------------------------------

function rulesFromFile(file: string, text: string, source: RuleSource, preambleTitle: string): UnlokRule[] {
	const parsed = parseUnlokMd(text)
	const rules: UnlokRule[] = []
	if (parsed.preamble) {
		rules.push({ title: preambleTitle, body: parsed.preamble, source, origin: file, enforced: false, kind: "instruction" })
	}
	for (const section of parsed.sections) {
		rules.push({
			title: section.title,
			body: section.body,
			source,
			origin: `${file}#${section.title}`,
			enforced: false,
			kind: "instruction",
		})
	}
	return rules
}

/** The repository tier: UNLOK.md (and, for one release, the earlier .unlok/rules), then UNLOK.local.md. */
export async function loadRepoRules(root: string): Promise<UnlokRule[]> {
	const rules: UnlokRule[] = []
	const mdPath = path.join(root, UNLOK_MD)
	const md = await readIfExists(mdPath)
	if (md?.trim()) {
		rules.push(...rulesFromFile(mdPath, md, "repo", UNLOK_MD))
	}
	for (const legacy of await readLegacyRuleFiles(path.join(root, LEGACY_UNLOK_DIR, "rules"))) {
		rules.push({
			title: legacy.title,
			body: legacy.body,
			source: "repo",
			origin: legacy.file,
			enforced: false,
			kind: "instruction",
		})
	}
	const localPath = path.join(root, UNLOK_LOCAL_MD)
	const local = await readIfExists(localPath)
	if (local?.trim()) {
		rules.push(...rulesFromFile(localPath, local, "personal", UNLOK_LOCAL_MD))
	}
	const legacyLocal = (await readIfExists(path.join(root, LEGACY_UNLOK_DIR, "rules.local.md")))?.trim()
	if (legacyLocal) {
		rules.push({
			title: "rules.local.md",
			body: legacyLocal,
			source: "personal",
			origin: path.join(root, LEGACY_UNLOK_DIR, "rules.local.md"),
			enforced: false,
			kind: "instruction",
		})
	}
	return rules
}

/** The personal tier: ~/.unlok/UNLOK.md. */
export async function loadPersonalRules(): Promise<UnlokRule[]> {
	const file = personalUnlokMdPath()
	const text = await readIfExists(file)
	if (!text?.trim()) {
		return []
	}
	return rulesFromFile(file, text, "personal", `~/.unlok/${UNLOK_MD}`)
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
 * and are listed first.
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
