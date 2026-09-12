import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	detectUnlokProject,
	loadRepoRules,
	mergeRules,
	migrateLegacyRules,
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

describe("detectUnlokProject", () => {
	it("reports an untouched repo as not initialized", async () => {
		const status = await detectUnlokProject(root)
		expect(status.initialized).toBe(false)
		expect(status.problems).toEqual([])
	})

	it("reads the binding and flags a settings file without a version", async () => {
		await fs.mkdir(path.join(root, ".unlok"), { recursive: true })
		await fs.writeFile(
			path.join(root, ".unlok", "settings.json"),
			JSON.stringify({ workspace: { teamId: "t1", name: "Acme" } }),
		)
		const status = await detectUnlokProject(root)
		expect(status.initialized).toBe(true)
		expect(status.settings?.workspace).toEqual({ teamId: "t1", name: "Acme" })
		expect(status.problems).toContain(".unlok/settings.json has no version.")
		expect(status.problems).toContain("UNLOK.md is missing.")
	})

	it("flags a newer layout version and invalid JSON", async () => {
		await fs.mkdir(path.join(root, ".unlok"), { recursive: true })
		await fs.writeFile(path.join(root, ".unlok", "settings.json"), "{ nope")
		expect((await detectUnlokProject(root)).problems[0]).toMatch(/not valid JSON/)
		await fs.writeFile(path.join(root, ".unlok", "settings.json"), JSON.stringify({ version: 99 }))
		expect((await detectUnlokProject(root)).problems[0]).toMatch(/version 99/)
	})
})

describe("scaffoldUnlokProject", () => {
	it("creates the layout with the workspace binding and is idempotent", async () => {
		const first = await scaffoldUnlokProject(root, { workspace: { teamId: "t1", name: "Acme" }, projectName: "demo" })
		expect(first.created).toEqual(expect.arrayContaining(["UNLOK.md", path.join(".unlok", "settings.json"), ".gitignore"]))
		const settings = JSON.parse(await fs.readFile(path.join(root, ".unlok", "settings.json"), "utf8"))
		expect(settings).toEqual({ version: 1, workspace: { teamId: "t1", name: "Acme" } })
		expect(await fs.readFile(path.join(root, "UNLOK.md"), "utf8")).toContain("# demo")
		const gitignore = await fs.readFile(path.join(root, ".gitignore"), "utf8")
		expect(gitignore).toContain(".unlok/rules.local.md")
		expect(gitignore).toContain(".unlok/settings.local.json")

		await fs.writeFile(path.join(root, "UNLOK.md"), "# edited by hand\n")
		const second = await scaffoldUnlokProject(root, { workspace: { teamId: "t1", name: "Acme" } })
		expect(second.created).toEqual([])
		expect(second.kept).toContain("UNLOK.md")
		expect(await fs.readFile(path.join(root, "UNLOK.md"), "utf8")).toBe("# edited by hand\n")
		expect((await fs.readFile(path.join(root, ".gitignore"), "utf8")).match(/rules\.local\.md/g)).toHaveLength(1)
	})

	it("adds a binding to existing settings that lack one", async () => {
		await scaffoldUnlokProject(root)
		expect(JSON.parse(await fs.readFile(path.join(root, ".unlok", "settings.json"), "utf8"))).toEqual({ version: 1 })
		await scaffoldUnlokProject(root, { workspace: { teamId: "t2" } })
		expect(JSON.parse(await fs.readFile(path.join(root, ".unlok", "settings.json"), "utf8"))).toEqual({
			version: 1,
			workspace: { teamId: "t2" },
		})
	})
})

describe("migrateLegacyRules", () => {
	it("moves markdown files from .unlokrules into .unlok/rules without overwriting", async () => {
		await fs.mkdir(path.join(root, ".unlokrules", "workflows"), { recursive: true })
		await fs.writeFile(path.join(root, ".unlokrules", "style.md"), "# Style\nUse tabs.")
		await fs.writeFile(path.join(root, ".unlokrules", "keep.md"), "legacy")
		await fs.mkdir(path.join(root, ".unlok", "rules"), { recursive: true })
		await fs.writeFile(path.join(root, ".unlok", "rules", "keep.md"), "already here")
		const moved = await migrateLegacyRules(root)
		expect(moved).toEqual(["style.md"])
		expect(await fs.readFile(path.join(root, ".unlok", "rules", "keep.md"), "utf8")).toBe("already here")
		expect(await fs.readFile(path.join(root, ".unlok", "rules", "style.md"), "utf8")).toBe("# Style\nUse tabs.")
	})
})

describe("loadRepoRules", () => {
	it("reads UNLOK.md, the rules folder and the local file with their sources", async () => {
		await fs.writeFile(path.join(root, "UNLOK.md"), "# Demo\nHow to work here.")
		await fs.mkdir(path.join(root, ".unlok", "rules"), { recursive: true })
		await fs.writeFile(path.join(root, ".unlok", "rules", "README.md"), "ignored")
		await fs.writeFile(path.join(root, ".unlok", "rules", "testing.md"), "# Testing\nRun bun test.")
		await fs.writeFile(path.join(root, ".unlok", "rules.local.md"), "Only on this machine.")
		const rules = await loadRepoRules(root)
		expect(rules.map((r) => [r.title, r.source])).toEqual([
			["UNLOK.md", "repo"],
			["Testing", "repo"],
			["rules.local.md", "personal"],
		])
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
		expect(byTitle["No prod keys"].enforced).toBe(true)
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
