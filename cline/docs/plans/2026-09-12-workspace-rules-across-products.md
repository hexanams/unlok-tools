# Workspace rules across products

**Status (2026-09-12):** Phase A shipped. Backend b5099f6 (`GET /v1/rules`, `/v1/rules/surfaces`, version and ETag, rendered block, `rules_version` on `/v1/me`, `X-Unlok-Rules-Version` recorded on requests), dashboard 7f897ee (chips from the registry, version on the tab and on Requests), extension 1268a0d (ETag cached fetch, the version header on every completion, the Team plan note under Settings › Rules). Phase B shipped in backend 3233f26: Optimus reads the workspace's rules once when its digest is built and reuses them until it expires, so rules load on first launch rather than per message. Phase B2 shipped as the gateway (backend 06ed93b, LibreChat 7f52ff8): a completion from a team key that carries no rules version gets the workspace's rules for its product prepended, once per session; the dashboard chat and raw API calls follow rules with no client work. Phase C shipped as one header and a read only Options view in the Browser Agent (unlok-tools nanobrowser). The repository tier is one file now, `UNLOK.md`, not a `.unlok/` folder (see the guide). Phase D shipped on 2026-09-13: typed policies (backend c8328d1 and 68976c7, migration 0045; dashboard 0f957b9; Browser Agent 94e684d; extension df0c6ba; docs b199a48). Unlok enforces the model allowlist and the spend cap per task in the gateway for every product; the Browser Agent enforces allowed domains (a locked allow list) and blocked actions (a refusal at the pre click checkpoint); Unlok Code's web fetch honours allowed domains.

## Context

Workspace rules shipped on 2026-09-12 as a team owned list (`team_rules`) with a kind (instruction or policy), an enforced flag, and an `applies_to` set naming the products a rule is for: the VS Code extension, the Browser Agent, Optimus, and the dashboard's chat. Today only the extension loads them, through `GET /v1/me/rules?surface=extension`, merged with the repository's `.unlok` tier and the person's `~/.unlok/UNLOK.md`. The Browser Agent and Optimus store and display their rules but never read them.

Three things stand in the way of "every product loads its rules" being one piece of work rather than three:

1. **Rules are a Team plan feature, and the products must say so.** A rule is a `team_rules` row. A personal workspace has none, by design, and the Browser Agent on a device account or a personal Unlok account therefore runs without workspace rules until it is connected to a team. Each product needs one honest, cheap answer for that case (the backend now returns `available: false, reason: team_plan`) rather than a silent empty list.
2. **Each product would render the prompt block itself.** The extension has `renderRulesSection`; the Browser Agent and Optimus would each need their own copy of "enforced first, then the rest, each with its source". Three renderers drift.
3. **Nothing says which version of the rules a request ran under.** When a member reports that the agent ignored a policy, there is no way to tell whether the rule was even loaded at the time.

The plan below fixes those first, then adds the two loaders. Every product ends up doing the same thing: ask one endpoint for its surface, cache by version, paste one rendered block into its system prompt. Adding a fourth product later is one registry entry and one loader.

## Principles

- **One source.** Rules live on the server, per team workspace (a Team plan feature). Local tiers (repository, `~/.unlok`) stay extension only, layered on top by the merge that already exists, and work for everyone.
- **One contract.** `GET /v1/rules?surface=<name>` for every product, API key or dashboard session, with a version and an ETag.
- **One renderer.** The server returns the prompt block ready to paste. Products with no local tiers paste it. The extension still merges its local tiers but uses the same block for the workspace tier.
- **Enforcement in code where it can be.** A policy is text first, and later a typed policy some products can enforce mechanically. The text is never dropped, so a product that cannot enforce a type still tells the model.
- **Poll, do not push.** A rule change reaches a product within a minute through cheap conditional requests. No sockets, no fan out.

## Phase A: the contract

**Backend**

- Rules stay team owned. No personal rows: a personal workspace gets `available: false, reason: team_plan` from every rules read, and every product shows the Team plan notice instead of an empty list.
- `app/rules.py` gains a surface registry: `SURFACES = {"extension": {"label": "Unlok Code", ...}, "browser": {...}, "optimus": {...}, "chat": {...}}`, served by `GET /v1/rules/surfaces` so the dashboard stops hardcoding the list. Adding a product is one entry.
- `GET /v1/rules?surface=<name>` (new, `app/rules.py`), accepting either the API key (`authenticate`) or the dashboard session (`get_current_session`) through the existing `authenticate_dashboard_or_key` dependency Optimus already uses. Response:

  ```json
  {
    "version": "a1b2c3d4",
    "workspace": {"type": "team", "id": "...", "name": "Acme"},
    "surface": "browser",
    "rules": [{"id": "...", "kind": "policy", "title": "...", "body": "...", "enforced": true, "applies_to": ["browser"], "policy_type": null, "config": null}],
    "rendered": "# Workspace Rules\n\n..."
  }
  ```

  `version` is a short hash of the ids, bodies and `updated_at` of the rules that apply to the surface. The response carries it as `ETag`; a request with a matching `If-None-Match` gets 304 and no body. `rendered` is built by one function, `render_rules_block(rules)`: enforced policies first, then policies, then instructions, each as `## Title (workspace rule, enforced)` plus body, in the wording the extension uses today.
- `/v1/me/rules` and `/v1/workspaces/rules` keep working as aliases for one release, then go.
- `GET /v1/me` gains `rules_version` per surface, so a client that already calls `/v1/me` at start can tell whether to refetch without a second round trip.
- Chat completions and Optimus accept `X-Unlok-Rules-Version`; the value lands in `request_meta.rules_version` and the Requests page shows it. This is the audit trail: a request either ran under version `a1b2c3d4` or under none.

**Dashboard**

- Governance › Rules and policies keeps its Team plan notice on the personal workspace. The surface chips come from `/v1/rules/surfaces`.

**Extension**

- `fetchUnlokWorkspaceRules` calls `/v1/rules?surface=extension` with `If-None-Match` and keeps the current one minute cache. Settings › Rules says "Workspace rules are part of the Team plan" when the key is personal. The rendered block is not used here because the extension merges local tiers by title; the ordering rules are the same.
- Every chat completion carries `X-Unlok-Rules-Version` (the SDK's Unlok builtin gets a second header next to the session id).

**Tests:** the Team plan answer on a personal key and session, version stability and change, 304 on match, `rendered` ordering, alias parity, `rules_version` on `/v1/me`, `request_meta.rules_version` on a completion.

## Phase B: Optimus

Optimus is server side, so this is a backend change and every product's `/optimus` gets it at once: the extension's command, the dashboard's Ask Optimus, the Browser Agent's slash command.

- `ask_optimus` loads the rules block for the caller's team workspace (`auth.team_id`; a personal caller gets none) with `surface="optimus"`. Note this is the workspace the key or session is acting in, which is separate from the `memory_team` grant that decides whose memories may be read: a member without that grant still answers under the team's rules.
- `run_optimus` takes `rules_block: str | None` and prepends it to `_OPTIMUS_ANSWER_SYSTEM_PROMPT` for the answer call only. The digest build does not change: rules govern how Optimus answers, not what the bank contains.
- In process cache keyed by `(workspace, surface)` for sixty seconds, invalidated by version, so a burst of questions does not re-read the table.
- `OptimusResponse` gains `rules_version`, and the answer's usage event records it.

**Tests:** a policy in the workspace reaches the answer call's system prompt; a personal caller's prompt carries no block; a member without `memory_team` still gets team rules; cache hit within the window, miss after a version change.

## Phase B2: the gateway applies rules when the client did not

Built instead of a chat-only loader. Every chat completion already says whether the client loaded rules (the extension sends `X-Unlok-Rules-Version`). When that header is missing and the key belongs to a team, the backend prepends the workspace's rendered block for the product named by `X-Unlok-Surface` (`chat`, `browser`; anything else counts as the new `api` product) as a system message, the way the compacted summary is added. Read once per session at its first message and kept for the session; without a session, once a minute per workspace. Saving rules on the dashboard forgets the workspace cache. The request records the version and `rules_source: gateway`, and the Requests page shows both.

- The dashboard chat (LibreChat) sends `X-Unlok-Surface: chat` from its endpoint config, so it needs no other change.
- Raw API use with a team key follows the `api` rules unless the script loads rules itself and says so.
- The Browser Agent sends `X-Unlok-Surface: browser` on gateway requests (Phase C).

**Tests:** the block for a team key without a version, none for a personal key, per-session read once, per-workspace cache and its invalidation on save, surface defaulting.

## Phase C: the Browser Agent

Shipped as the smaller shape the gateway allows: one header and a read only view. Its gateway requests carry `X-Unlok-Surface: browser`, so the backend adds the rules marked for the Browser Agent to every task; Options › Workspace rules lists them with the version and a Refresh button, or shows the Team plan notice on a device or personal account. The store and prompt splitting below are not needed while the gateway does the work; they stay here as the path if the planner ever needs the block shaped differently.

The Browser Agent runs as a device account (a personal workspace) until a person connects a team account, so most installs have no workspace rules and the view must say so plainly rather than fail.

- `packages/storage/lib/settings/workspaceRules.ts`: a `createStorage` backed store `{version, workspace, rules, rendered, fetchedAt}` plus `refreshWorkspaceRules(baseUrl, apiKey)` that sends `If-None-Match` and keeps the stored copy on 304 or on any failure. A task never waits on the network for rules: refresh runs at task start with a two second budget, and the task uses whatever the store holds.
- `Executor` reads the store once per task and hands `rendered` to `PlannerPrompt` and `NavigatorPrompt`, which append it after their templates (`BasePrompt` gets an optional `workspaceRulesBlock`). The planner gets the whole block; the navigator gets policies only, since its prompt is action oriented and every token there costs on each step.
- Requests to `/v1/chat/completions` carry `X-Unlok-Rules-Version` from the store, so the Requests page shows what the agent ran under.
- Options › Unlok account gains a read only "Workspace rules" list (title, kind, enforced, version, last refreshed) with a Refresh button and a link to Governance. On a device or personal account it shows the Team plan notice instead. Editing stays on the dashboard.
- The `/optimus` command already goes through the backend and gets Phase B for free.

**Tests:** the store keeps its copy on 304 and on failure; the planner prompt contains the block; the navigator prompt contains policies only; a task starts even when the backend is unreachable.

## Phase D: mechanical policies

**Shipped 2026-09-13.** Text tells the model; code stops the action. Two columns on the rule (`policy_type`, `config` JSON) let a policy carry something a product can enforce without the model's cooperation. Enforced typed policies cannot be loosened locally. As built: `normalize_policy_config` validates each type on save in product language; `render_rules_block` adds one "Enforced in code" sentence under a typed policy so the model still hears it; `typed_policies` merges per type (lists unioned, lowest cap, enforced if any) and every rules response carries the result as `policies`; `GET /v1/rules/surfaces` lists the types for the dashboard. The gateway reads the workspace's policies once a minute per surface (forgotten on save) into a context variable that `_strip_disabled_candidates`, the pinned model check and a new spend cap check read. Sessions gained `spent_usd`, added to by `record_usage_event`.

| policy_type | config | Enforced by |
|---|---|---|
| `allowed_domains` | `{"domains": ["*.example.com"]}` | Browser Agent: merged into `firewallStore` as a locked allow list; the extension's URL fetch tool checks it too |
| `blocked_actions` | `{"actions": ["purchase", "signup", "payment"]}` | Browser Agent: `consequential-actions.ts` already classifies these; an enforced policy turns its confirmation into a refusal |
| `spend_cap_per_task` | `{"usd": 5}` | Backend billing: the reservation for a session stops at the cap and the error names the policy |
| `model_allowlist` | `{"models": ["anthropic/claude-sonnet-5"]}` | Backend routing: the same path the disabled model list uses today |

The templates that shipped map onto these ("Only the sites named in the task" is `allowed_domains`, "No purchases, payments or sign ups" is `blocked_actions`, plus "Five dollars a task" and "Approved models only"). The dashboard shows a policy's type under "Enforced in code" with the fields for it, keeps the text for products that cannot enforce the type, and refuses to save a typed policy with nothing filled in. The Browser Agent keeps a `workspacePoliciesStore` refreshed at task start with a short budget, and the extension refuses a web fetch outside the allowed domains before approval.

## Rollout order and sizes

A, then B and B2, then C, then D. A is about three quarters of a day, B half a day, B2 half a day, C a day and a half, D two days across the four enforcement points. Each phase ships on its own: after A nothing changes for members; after B every Optimus answer follows the workspace's rules; after C the Browser Agent does; D is where "policy" starts meaning something the model cannot talk its way past.

## Not in this plan

- Push delivery of rule changes. Sixty second polling with 304s costs nothing measurable and needs no new infrastructure.
- Per repository rules for the Browser Agent. It has no repository; the personal and workspace tiers are the whole story there.
- Rules for the CLI. It loads the extension's `.unlok` module once the shared move lands, and then asks for `surface=extension` like the extension does.
