import axios from "axios"
import { getAxiosSettings } from "@/shared/net"

// Same URL getUnlokWorkspaceInfo.ts uses -- see that file's own comment for
// why this is duplicated rather than imported from the SDK bundle.
const UNLOK_BASE_URL = "https://unlok-backend-xpts.onrender.com/v1"

export type UnlokConnectedRepoMeta = {
	fullName: string
	languagesSummary: string
	readmeExcerpt: string
}

/**
 * Repos connected and scanned via the dashboard's Integrations page --
 * metadata only (file content is a separate, on-demand backend call, see
 * app/repo_context.py's POST /v1/repo-context). Pure parsing, shared by
 * getUnlokWorkspaceInfo.ts (which already has a fetched GET /v1/me response
 * in hand for other fields) and fetchUnlokConnectedRepos below (which fetches
 * on its own for cline-session-factory.ts, a separate lifecycle event --
 * once per session start, not once per sign-in -- so this is two genuinely
 * separate GET /v1/me calls, not one shared response reused twice).
 */
export function parseConnectedRepos(data: Record<string, unknown>): UnlokConnectedRepoMeta[] {
	return Array.isArray(data.connected_repos)
		? data.connected_repos.map((r: Record<string, unknown>) => ({
				fullName: String(r.full_name ?? ""),
				languagesSummary: String(r.languages_summary ?? ""),
				readmeExcerpt: String(r.readme_excerpt ?? ""),
			}))
		: []
}

/** Standalone fetch+parse for a call site with no already-fetched /v1/me response. */
export async function fetchUnlokConnectedRepos(apiKey: string): Promise<UnlokConnectedRepoMeta[]> {
	const response = await axios.get(`${UNLOK_BASE_URL}/me`, {
		headers: { Authorization: `Bearer ${apiKey}` },
		...getAxiosSettings(),
	})
	return parseConnectedRepos(response.data ?? {})
}

// Matches both remote URL forms getGitRemoteUrls (utils/git.ts) can return --
// "origin: https://github.com/org/repo.git" and "origin: git@github.com:org/repo.git"
// -- against connectedRepos[].fullName ("org/repo"), case-insensitive since
// GitHub itself is case-insensitive for repo paths.
const GITHUB_REMOTE_RE = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i

/**
 * Finds the connected repo matching the workspace's git remotes, if any --
 * the "is this the repo I'm looking at right now" check that lets
 * cline-session-factory.ts inject only relevant context, not every
 * connected repo regardless of what's actually open.
 */
export function matchConnectedRepo(
	remoteLines: string[],
	repos: UnlokConnectedRepoMeta[],
): UnlokConnectedRepoMeta | undefined {
	if (repos.length === 0) {
		return undefined
	}
	for (const line of remoteLines) {
		const match = line.match(GITHUB_REMOTE_RE)
		if (!match) {
			continue
		}
		const candidate = `${match[1]}/${match[2]}`.toLowerCase()
		const found = repos.find((r) => r.fullName.toLowerCase() === candidate)
		if (found) {
			return found
		}
	}
	return undefined
}
