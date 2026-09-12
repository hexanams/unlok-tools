import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	detectUnlokProject,
	foldLegacyFolder,
	loadRepoRules,
	mergeRules,
	parseUnlokMd,
	renderRulesSection,
	scaffoldUnlokProject,
	type UnlokRule,
	workspaceRulesToTier,
} from "./unlok-project"

let root: string

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "unlok-project-"))
})

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true })
})

const rule = (title: string, source: UnlokRule["source"], body = `${title} body`, enforced = false): UnlokRule => ({
	title,
	body,
	source,
	origin: `${source}:${title}`,
	enforced,
	kind: "instruction",
})

describe("parseUnlokMd", () => {
	it("reads the binding from front matter, the preamble, and one rule per heading", () => {
		const parsed = parseUnlokMd(
			[
				"---",
				"workspace: team-1",
				'workspace_name: "Acme"',
				"---",
				"# Demo",
				"",
				"A proxy.",
				"",
				"## Tests before done",
				"",
				"Run bun test.",
				"",
				"## Commit style",
				"One change per commit.",
				"",
			].join("\n"),
		)
		expect(parsed.binding).toEqual({ teamId: "team-1", name: "Acme" })
		expect(parsed.preamble).toBe("# Demo\n\nA proxy.")
		expect(parsed.sections).toEqual([
			{ title: "Tests before done", body: "Run bun test." },
			{ title: "Commit style", body: "One change per commit." },
		])
		expect(parsed.problems).toEqual([])
	})

	it("works without front matter and reports a bad front matter line", () => {
		expect(parseUnlokMd("# Just a preamble").binding).toBeUndefined()
		const bad = parseUnlokMd("---\nnot a field\n---\n## A\nb")
		expect(bad.problems[0]).toMatch(/could not be read/)
		expect(bad.sections).toEqual([{ title: "A", body: "b" }])
	})
})

describe("detectUnlokProject", () => {
	it("reports an untouched repo as not initialized", async () => {
		const status = await detectUnlokProject(root)
		expect(status.initialized).toBe(false)
		expect(status.problems).toEqual([])
	})

	it("reads the binding and flags an empty file and a legacy folder", async () => {
		await fs.writeFile(path.join(root, "UNLOK.md"), "---\nworkspace: t1\n---\n")
		await fs.mkdir(path.join(root, ".unlok"), { recursive: true })
		const status = await detectUnlokProject(root)
		expect(status.initialized).toBe(true)
		expect(status.binding).toEqual({ teamId: "t1" })
		expect(status.problems).toEqual(
			expect.arrayContaining([expect.stringMatching(/is empty/), expect.stringMatching(/\.unlok\/ folder/)]),
		)
	})
})

describe("scaffoldUnlokProject", () => {
	it("creates one file with the binding, ignores the local file, and is idempotent", async () => {
		const first = await scaffoldUnlokProject(root, { workspace: { teamId: "t1", name: "Acme" }, projectName: "demo" })
		expect(first.created).toEqual(["UNLOK.md", ".gitignore"])
		const text = await fs.readFile(path.join(root, "UNLOK.md"), "utf8")
		expect(text.startsWith("---\nworkspace: t1\nworkspace_name: Acme\n---\n# demo")).toBe(true)
		expect(await fs.readFile(path.join(root, ".gitignore"), "utf8")).toContain("UNLOK.local.md")
		expect(await fs.stat(path.join(root, ".unlok")).catch(() => undefined)).toBeUndefined()

		await fs.writeFile(path.join(root, "UNLOK.md"), "# edited by hand\n")
		const second = await scaffoldUnlokProject(root, { projectName: "demo" })
		expect(second.created).toEqual([])
		expect(second.kept).toEqual(["UNLOK.md"])
		expect(await fs.readFile(path.join(root, "UNLOK.md"), "utf8")).toBe("# edited by hand\n")
	})

	it("adds a binding to an existing file without front matter", async () => {
		await fs.writeFile(path.join(root, "UNLOK.md"), "# demo\n")
		await scaffoldUnlokProject(root, { workspace: { teamId: "t2" } })
		expect(await fs.readFile(path.join(root, "UNLOK.md"), "utf8")).toBe("---\nworkspace: t2\n---\n# demo\n")
	})
})

describe("foldLegacyFolder", () => {
	it("folds .unlok/rules, the local file and the binding into the single file and removes the folder", async () => {
		await fs.writeFile(path.join(root, "UNLOK.md"), "# demo\n\n## Testing\n\nRun bun test.\n")
		await fs.mkdir(path.join(root, ".unlok", "rules"), { recursive: true })
		await fs.writeFile(path.join(root, ".unlok", "rules", "style.md"), "# Style\n\nUse tabs.")
		await fs.writeFile(path.join(root, ".unlok", "rules", "testing.md"), "# Testing\n\nduplicate, already present")
		await fs.writeFile(path.join(root, ".unlok", "rules.local.md"), "Only here.")
		await fs.writeFile(
			path.join(root, ".unlok", "settings.json"),
			JSON.stringify({ version: 1, workspace: { teamId: "t9", name: "Globex" } }),
		)

		const folded = await foldLegacyFolder(root)

		expect(folded).toBe(2)
		const text = await fs.readFile(path.join(root, "UNLOK.md"), "utf8")
		expect(text.startsWith("---\nworkspace: t9\nworkspace_name: Globex\n---\n")).toBe(true)
		expect(text).toContain("## Style\n\nUse tabs.")
		expect(text.match(/## Testing/g)).toHaveLength(1)
		expect(await fs.readFile(path.join(root, "UNLOK.local.md"), "utf8")).toBe("Only here.\n")
		expect(await fs.stat(path.join(root, ".unlok")).catch(() => undefined)).toBeUndefined()
	})
})

describe("loadRepoRules", () => {
	it("reads the preamble and each section, then the local file as personal", async () => {
		await fs.writeFile(path.join(root, "UNLOK.md"), "# Demo\nHow to work here.\n\n## Testing\nRun bun test.\n")
		await fs.writeFile(path.join(root, "UNLOK.local.md"), "## Editor\nUse the fast model.\n")
		const rules = await loadRepoRules(root)
		expect(rules.map((r) => [r.title, r.source])).toEqual([
			["UNLOK.md", "repo"],
			["Testing", "repo"],
			["Editor", "personal"],
		])
		expect(rules[1].origin).toMatch(/UNLOK\.md#Testing$/)
	})
})

describe("mergeRules", () => {
	it("lets personal override repo, repo override workspace, and nothing override enforced", () => {
		const effective = mergeRules({
			workspace: [
				rule("Commit style", "workspace", "workspace says"),
				rule("No prod keys", "workspace-enforced", "never", true),
			],
			repo: [rule("Commit style", "repo", "repo says"), rule("No prod keys", "repo", "repo tries to relax this")],
			personal: [rule("Commit style", "personal", "person says"), rule("Editor", "personal")],
		})
		const byTitle = Object.fromEntries(effective.rules.map((r) => [r.title, r]))
		expect(byTitle["Commit style"].body).toBe("person says")
		expect(byTitle["No prod keys"].body).toBe("never")
		expect(effective.rules[0].title).toBe("No prod keys")
		expect(effective.overridden).toEqual(
			expect.arrayContaining([
				{ title: "Commit style", by: "repo", was: "workspace" },
				{ title: "Commit style", by: "personal", was: "repo" },
				{ title: "No prod keys", by: "workspace-enforced", was: "repo" },
			]),
		)
	})

	it("renders enforced rules first with their source", () => {
		const text = renderRulesSection(
			mergeRules({
				workspace: workspaceRulesToTier([
					{ id: "w1", kind: "policy", title: "", body: "# Budget\nStay under $5 a task.", enforced: true },
					{ id: "w2", kind: "instruction", title: "Tone", body: "Be brief.", enforced: false },
				]),
				repo: [rule("Testing", "repo")],
			}),
		)
		expect(text.indexOf("## Budget (workspace rule, enforced)")).toBeGreaterThan(-1)
		expect(text.indexOf("## Budget")).toBeLessThan(text.indexOf("## Tone (workspace rule)"))
		expect(text).toContain("## Testing (repository rule)")
		expect(renderRulesSection(mergeRules({}))).toBe("")
	})
})
