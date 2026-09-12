# One context: compaction, curated memory, and the .unlok folder

## Context

Three findings from live use on 2026-09-12, all about the same thing: the agent's context is owned in two places and remembered in none.

1. Unlok writes a memory only when its backend fold runs (`app/sessions.py`, the block that calls `_compact_context` and adds a `Memory` row). A short session never grows past the verbatim tail, so it leaves nothing behind.
2. The extension's `/compact` is Cline's local condense (`apps/vscode/src/sdk/sdk-compaction-coordinator.ts`). It never talks to the backend, and because the backend recognises a session by a fingerprint of the message prefix (`app/sessions.py::fingerprint_session`), the next request after a local compaction looks like a new session: rolling summary, tier and sticky provider reset, and the folded content never reaches the bank.
3. Rules live in `.unlokrules/` per repo and nowhere for a workspace, so nothing keeps members consistent, and a repo is never asked to set itself up.

Decisions already taken with the user: memory index is injected on the first turn of a task only; memories are workspace owned with the author kept for attribution; the repo folder is `.unlok/` (not `.unlokai`); a repo's workspace binding is required at init when the active workspace is a team.

Claude Code is the reference for the shape: one owner of compaction with a structured continuation summary, memory as small curated facts with an always loaded index and on demand bodies, written at natural moments and updated in place, and a layered `~/.claude` / `.claude` / `CLAUDE.md` config. Unlok adds a tier Claude does not have: the workspace.

## Phase 1: one compaction, one session

**Backend**
- `POST /v1/sessions/compact` (new, `app/sessions.py` router): body `{session_id?, messages, focus?}`. Runs the existing `_compact_context` with a rewritten `_compaction_system_prompt`: four sections (task, decisions, files that matter, next steps) plus the caller's focus. Stores the summary on the `ConversationSession`, writes the memory row exactly as the in request fold does today (Phase 2 replaces that write with extraction), returns `{session_id, summary, keep_from_index, provider, model, cost_usd}`.
- Session identity by header: `X-Unlok-Session-Id` on `/v1/chat/completions` and on the compact endpoint. `resolve_session_routing` prefers it; the fingerprint stays as the fallback for clients that send nothing.
- The in request auto fold keeps working unchanged for clients that never call compact.

**SDK and extension**
- `sdk/packages/llms/src/providers/vendors/openai-compatible.ts`: send `X-Unlok-Session-Id` (the SDK session id) on Unlok requests, next to where `X-Unlok-Served-By` is already read.
- `sdk-compaction-coordinator.ts`: when the provider is Unlok, call the compact endpoint with the current messages and any `/compact <focus>` text, then replace the local compaction sidecar with the returned summary and keep index. Fall back to the local condense only when the backend is unreachable, and say so in the chat row.
- Auto compact uses the same path, so the threshold is decided once.

**Tests**: backend route (summary shape, session continuity across a compaction, fallback fingerprint), SDK header, coordinator adoption of the returned summary.

## Phase 2: curated memory with an index

**Extraction, not summaries**
- `app/memory_bank.py::extract_durable_facts(source)`: one cheap tier call over a fold or a finished session. Returns a JSON list of facts `{kind: user|feedback|project|reference, title, description, body, subject_key}` or an empty list, and the prompt is told that empty is the expected common answer. This is the noise filter.
- Substance floor before calling the model: at least two user turns and 400 characters of non tool content.
- Dedupe: a fact whose `subject_key` matches an existing active one is updated in place; a contradicting fact replaces it. A cap of one extraction per session per ten minutes.

**Storage**: reuse `Memory` (migration 0041 adds `kind`, `title`, `subject_key`; `summary` stays as the body). `CoreMemory` stays for pinned facts. Rollup keeps merging old raw rows.

**Triggers**: the Phase 1 compact endpoint; `POST /v1/sessions/{id}/close` called by the extension when a task ends or has been idle thirty minutes; `POST /v1/memory/facts` for an explicit "remember this" (a slash command in the extension and CLI).

**Index and recall**
- `GET /v1/memory/index`: `[{title, description, kind}]` for the active workspace, pinned first then newest, capped at 60 entries.
- The extension injects the index into the system prompt on the first turn of a task, in `apps/vscode/src/sdk/cline-session-factory.ts` next to the connected repo context it already injects. Full bodies are recalled through Optimus (`POST /v1/optimus/{user_id}`), which already reads the bank.
- The dashboard memory bank page shows kind and title; edit, pin and forget already exist.

**Tests**: extraction returns empty for chit chat and facts for a decision; dedupe by subject key; close endpoint writes at most one; index ordering and cap; system prompt contains the index on turn one and not on turn two.

## Phase 3: the .unlok folder, init, and workspace versus local

**Layout** (repo, committed): `UNLOK.md` at the root; `.unlok/rules/*.md`, `.unlok/workflows/`, `.unlok/hooks/`, `.unlok/skills/`; `.unlok/settings.json` with the workspace binding and project defaults; `.unlok/rules.local.md` and `settings.local.json` git ignored. Personal: `~/.unlok/UNLOK.md`. Workspace: rules stored on the server and synced.

**Precedence**: personal over repo over workspace, except workspace rules marked `enforced`, which nothing below may override. Enforced is for governance: provider restrictions, allowed tools, budget caps.

**Shared module** `sdk/packages/core/src/project/unlok-project.ts`: detect, scaffold, validate (`version` in `settings.json`), load the four tiers, merge with precedence and enforced flags, and report each effective rule's source. Both the extension and the CLI use it, so `unlok init` and the extension's Initialize produce the same layout.

**Extension**
- First task in a folder: if no `UNLOK.md` and no `.unlok/`, show a chat card ("This repo isn't set up for Unlok yet") with Initialize and Not now; "never for this repo" is remembered in `~/.unlok`.
- Initialize: scaffold, then a cheap tier init turn that reads the repo and drafts `UNLOK.md` through the normal file approval.
- Binding: when `settings.json` names a workspace and the active one differs, a one line prompt to switch (Phase 0 of this session already ends the session on a switch).
- A Rules view in Settings listing effective rules with their source; enforced ones shown locked.
- `.unlokrules/` keeps loading; init offers to move it into `.unlok/rules/`.

**CLI**: `unlok init`, and `unlok doctor` validates the layout and version.

**Backend and dashboard**
- `team_rules` (migration 0042): `{id, team_id, kind: instruction|policy, body, enforced, updated_by, updated_at}`. `GET /v1/workspaces/rules` for members, `PUT` for owner and admin. Delivered through the existing remote config sync (`apps/vscode/src/core/storage/remote-config/`).
- Governance page gains a Rules tab with the enforced toggle.

**Tests**: merge precedence and enforced override; scaffold idempotence; init card shows once; binding mismatch prompt; rules endpoint permissions.

## Sizes

Phase 1 about a day and a half, Phase 2 about two days, Phase 3 about two and a half days. Phases ship independently and in this order; Phase 1 alone fixes the `/compact` session reset.
