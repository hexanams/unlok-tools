import { UnlokEffectiveRule, UnlokEffectiveRules } from "@shared/proto/cline/account"
import type { EmptyRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

const EXCERPT_CHARS = 240

/** Every rule the next task will load, with its source, for the Settings › Rules view. */
export async function getUnlokEffectiveRules(controller: Controller, _request: EmptyRequest): Promise<UnlokEffectiveRules> {
	const { status, effective, workspaceRulesVersion, workspaceRulesAvailable } = await controller.unlokProject.effectiveRules()
	return UnlokEffectiveRules.create({
		rules: effective.rules.map((rule) =>
			UnlokEffectiveRule.create({
				title: rule.title,
				source: rule.source,
				enforced: rule.enforced,
				excerpt: rule.body.length > EXCERPT_CHARS ? `${rule.body.slice(0, EXCERPT_CHARS).trimEnd()}…` : rule.body,
				origin: rule.origin,
				kind: rule.kind,
			}),
		),
		initialized: status.initialized,
		root: status.root,
		boundWorkspaceName: status.settings?.workspace?.name ?? "",
		boundTeamId: status.settings?.workspace?.teamId ?? "",
		problems: status.problems,
		overridden: effective.overridden.map((o) => `${o.title}: ${o.was} overridden by ${o.by}`),
		workspaceRulesVersion,
		workspaceRulesAvailable,
	})
}
