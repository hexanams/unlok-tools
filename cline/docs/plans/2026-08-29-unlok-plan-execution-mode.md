# Unlok "Plan" execution mode

## Context

The user shared a design mockup for the Unlok VS Code extension: instead of free-form chat, a task gets broken into an ordered list of steps up front, each step tagged with a routing tier (fast/cheap/smart) and priced before it runs (exact once known, or an honest range when a step's scope depends on an earlier step's output). The whole plan shows a total estimated cost range, execution pauses after each step for approval ("Run remaining" vs "Step through" one at a time), and the existing chat input area gains a routing-policy dropdown next to its mode selector. The user wants this as a full working feature that **replaces** the extension's current chat view, not an addition alongside it.

Two decisions were confirmed with the user up front:
1. The chat input's existing Plan/Auto/Manual selector (`chat-textarea-mode-toggle.ts`) already has a literal `"plan"` option — today it triggers Cline's classic "discuss before acting" mode. Selecting **Plan now triggers this new step-plan feature instead**, fully replacing that old behavior.
2. No real preflight cost estimation exists anywhere in the codebase today (only a coarse ~4-chars-per-token heuristic used for billing holds). V1 **reuses that same coarse estimator** rather than building a more accurate one, and shows a cost **range** whenever a step's scope isn't knowable until an earlier step runs.

Research confirmed a lot of load-bearing infrastructure already exists and should be reused, not rebuilt — most importantly: the backend already treats a literal tier name (`"fast"`/`"cheap"`/`"smart"`) as a deterministic pinned model with fallback protection (verified live, `app/routing.py:753-779`), so **step execution needs zero new backend routing logic** — only plan *generation* is new. The existing `estimate_cost_usd` pre-call estimator (`app/billing.py:210-235`, verified live) is the exact building block for per-step estimates. The extension already has a per-mode model-id field (`actModeUnlokModelId`, verified in `cline-session-factory.ts:437`) that a step's tier can be written into to pin its model.

## Scope boundary

`POST /v1/plan` is **stateless** — it takes a goal, returns steps + estimates, persists nothing. All run-state (which step is in progress, paused-after-N, actual cost once known) lives only in the extension host, keyed to the task, in a per-task JSON file — the same pattern Cline's existing FocusChain checklist already uses (`apps/vscode/src/core/task/focus-chain/file-utils.ts`).

## 1. Backend (`unlok-backend`)

**New schemas** in `app/schemas.py`:
- `PlanStepCostEstimate`: `is_range: bool`, plus either `exact_usd` or `low_usd`/`high_usd`.
- `PlanStep`: `id`, `title`, `scope` (e.g. `"7 files"`, `"relay/router.ts"`, `"npm test"`), `tier: Literal["fast","cheap","smart"]`, `kind: Literal["llm_step","tool_only_step"]`, `depends_on_step_id: str | None`, `estimate`, `status`.
- `PlanRequest`: `goal`, `routing_policy` (reuses the existing 4 policy names), `workspace_context` (optional, caller-capped).
- `PlanResponse`: `steps`, `total_estimate`, plus the generation call's own provider/model/tokens/cost/latency (this decomposition call is itself billable — see below).

**Cost-estimation rule** (implemented as a small helper, not scattered inline):
1. `kind == "tool_only_step"` (e.g. running the test suite) → always exact `$0`, no LLM cost lookup.
2. `llm_step` with `depends_on_step_id is None` (scope is a known, literal file/component list) → **exact**: one `estimate_cost_usd` call sized off the stated file/unit count via a small constant (`PLAN_STEP_CHARS_PER_FILE = 3000`, same order-of-magnitude philosophy as the existing chars/4 heuristic).
3. `llm_step` with `depends_on_step_id` set (scope only known once that step runs) → **range**: two `estimate_cost_usd` calls, a conservative-low size and a `PLAN_RANGE_HIGH_MULTIPLIER = 5`× high size.
- Total estimate sums low/high (or exact) across all steps; if no step is a range, the total collapses to a single number too — matches the mockup's own two display states.
- Reuse `get_rate_per_1k` (`app/costing.py:74-82`) under the hood so plan estimates and real post-hoc charges never drift apart.

**New file `app/plan_generation.py`**: one LLM call on the `"smart"` tier (`TIER_ALIASES["smart"]` — plan quality compounds across every downstream step, this is not a place to economize) that decomposes `goal` into an ordered JSON step list. `routing_policy` shapes this only as *prompt guidance* ("cost_first: prefer fast/cheap, escalate only when genuinely needed") — no new numeric thresholds. On malformed/unparseable output: **fail loudly** with a 502, never silently fabricate a single fallback step.

**New endpoint `app/plan.py`** (`POST /v1/plan`), registered in `app/main.py`. Follows `app/beast_mode.py`'s endpoint-scaffolding shape, but — unlike `beast_mode.py` — uses the same `authenticate` (Bearer API-key) dependency `app/proxy.py` uses, since this is called by the extension during ordinary use, not from the Clerk-gated dashboard. It **must** go through `resolve_billing_and_reserve`/`commit_billing` (`app/billing.py`) since the decomposition call is real, billable LLM spend.

**Step execution itself needs no backend changes**: each step's turn is an ordinary `POST /v1/chat/completions` with `model` set to the literal tier string, hitting `resolve_model_alias`'s existing non-`"auto"` branch and the existing billing path untouched.

## 2. Proto (`apps/vscode/proto/cline/plan.proto`, new file)

New `PlanService` with `generatePlan`, `subscribeToPlanState` (streaming, same shape as `account.proto`'s existing `subscribeToAuthStatusUpdate`), `runPlanSteps` (mode: `"run_remaining"` | `"step"`), `editPlanStep`, `clearPlan`. Messages: `PlanStep`, `PlanCostEstimate`, `PlanState` (steps + total estimate + `done_count` + `run_status` + `paused_after_step_id`).

Handlers as one file per RPC under new `apps/vscode/src/core/controller/plan/`, matching the existing folder-per-service convention (e.g. `src/core/controller/worktree/`) — no separate registration file needed beyond `bun run protos`. `generatePlan.ts` mirrors `getUnlokWorkspaceInfo.ts`'s exact shape (axios call with `Authorization: Bearer <unlokApiKey>`).

## 3. Extension host

**New `PlanCoordinator`** (`apps/vscode/src/sdk/plan-coordinator.ts`): holds `PlanState` (the generated proto type directly, no separate hand-rolled TS mirror), persists it to `plan_taskid_<id>.json` in the task's own directory via the same `ensureTaskDirectoryExists` primitive FocusChain uses, so a paused plan survives a window reload.

**Step execution reuses turn-level pause, not tool-level pause** — this is the key risk-avoidance decision. Each step is coarse enough (a mockup step reads like "read every call site", "run npm test") to run as one ordinary auto-approved agentic turn, pausing *between* turns. This deliberately leaves `SdkInteractionCoordinator`'s existing per-tool-call approval gate (`pendingToolApprovalResolve`) completely untouched — Auto/Manual keep depending on it exactly as today. Concretely, `runSteps`:
1. Sets `actModeUnlokModelId` to the step's tier string (pins the model deterministically, per the routing.py behavior verified above).
2. Rebuilds the session with that model and auto-continues with a synthesized "do exactly this step" prompt, tool calls inside that turn auto-approved (the human already approved by clicking Run/Step).
3. Waits for the turn to reach `TurnPhase: "completed"` (or `"error"`), marks the step done, persists state, and either stops (`"step"` mode) or continues to the next pending step (`"run_remaining"` mode).

This needs one small refactor: `SdkModeCoordinator.performRebuildSessionForMode` (`sdk-mode-coordinator.ts:206-391`) currently always also flips the persisted `mode` and stamps a mode-switch notice — neither applies to a same-mode, different-model step rebuild. Factor the teardown/rebuild/auto-continue block into a private `performSessionRebuild(configOverrides, autoContinueOptions)`, called by the existing mode-toggle path unchanged, and by a new narrow `rebuildSessionForStepModel(tier, continuationPrompt)` that `PlanCoordinator` calls. `PlanCoordinator` never reaches into `SdkInteractionCoordinator` at all — the two pause concerns stay fully separated.

**Selecting "Plan" — exact behavior change**: in `ChatTextArea.tsx`'s `setChatMode`, the `target === "plan"` branch stops calling `togglePlanActModeProto` (classic SDK Plan mode); `targetUnderlyingMode` becomes `"act"` for all three pills now. Instead, submitting a message while `"plan"` is selected calls the new `generatePlan` RPC, and the webview swaps to `PlanView` once a `PlanState` comes back. The classic Plan/Act SDK machinery (`Mode = "plan" | "act"` in `src/shared/storage/types.ts`, `SdkModeCoordinator.togglePlanActMode`) is left in place, not deleted — it just becomes unreachable from this UI.

## 4. Webview UI (`apps/vscode/webview-ui/src/components/plan/`, new directory)

Follows the house style already established by `UnlokSignInGate.tsx`/`UnlokWorkspaceInfoCard.tsx` (Tailwind utilities, `VSCodeButton`, fetch-once-on-mount via the gRPC client).

- **`PlanView.tsx`**: rendered in `ChatView.tsx` in place of the normal message column when `activeChatMode === "plan"` and a plan is active — same "full replace" pattern `UnlokSignInGate` already uses. Header: step count, done count, running spend.
- **`PlanCard.tsx`** / **`PlanStepRow.tsx`**: the bordered step list; each row shows status icon (✓ done/strikethrough, ▶ in-progress, ○ pending), title, scope, a tier badge (lifting the existing badge treatment from `RequestStartRow.tsx:196-201`), and cost (exact, "est $X", "est $low–$high", or "no model cost").
- **`PlanFooter.tsx`**: total estimate (single number or range) with a client-side-generated explanation, "Run remaining" / "Step through" buttons, the "Paused after step N, waiting on you" status line, and the static "Nothing runs until you approve..." note.
- **`PlanRoutingPolicyDropdown.tsx`**: new, sits next to the existing mode pill in `ChatTextArea.tsx`, only shown in Plan mode. Kept as local UI state (default `"balanced"`), not a persisted account setting — sent fresh on each `generatePlan` call, since today `routing_policy` is only writable via the Clerk-gated dashboard endpoint, not reachable with the extension's API-key auth.
- The existing textarea is reused for "Change a step, or add one" (placeholder swaps when a plan is active); free-text edits go to `editPlanStep` instead of the normal send path. V1 ships whole-plan regeneration from edited text; targeted single-step edits are a fast-follow, not required for v1.

## 5. Build order and risk

1. **Backend first** — schemas, `plan_generation.py`, `plan.py`, `main.py` registration, tests (prompt reliability, the exact-vs-range rule, billing wiring). Fully testable in isolation via pytest/curl.
2. **Proto** — `plan.proto`, `bun run protos`, stub handlers (can initially just proxy to the backend).
3. **Extension host** — `PlanCoordinator`, the `SdkModeCoordinator` refactor, per-task JSON persistence, `setChatMode`'s branch change.
4. **Webview UI** — the new component tree, wired to the now-real gRPC calls.

**Biggest open risks, to validate with real usage before calling this done:**
- **Plan-generation quality**: a `"smart"`-tier JSON-decomposition call with no existing structured-output helper to lean on in this codebase — malformed JSON, wrong tier picks, or steps that don't cleanly fit one turn each are realistic failure modes only discoverable by testing against real goals, not from code review alone. Mitigated by failing loudly on parse errors rather than silently degrading.
- **Turn-boundary mismatch**: the design assumes each step finishes in one turn. A step that needs a retry or hits a tool error (`TurnPhase: "awaiting_followup"` mid-step) needs explicit handling — treat as "step failed, needs the user," not silent auto-continuation — and this needs validating against real agent behavior.
- The `SdkModeCoordinator` refactor touches code the *existing*, shipped Plan/Act toggle depends on. Lower risk than the two above since it's covered by existing tests and mechanical in nature, but still the largest diff in the change.

## Verification

- Backend: `pytest` for the new `app/plan.py`/`app/plan_generation.py` tests (prompt-shape validation, exact-vs-range estimate math, billing reserve/commit), plus a manual `curl -X POST /v1/plan` against a real goal to sanity-check plan quality.
- Extension: `bun run check-types`, `bun run lint`, existing + new vitest suites (`PlanCoordinator`, the `SdkModeCoordinator` refactor's existing tests must still pass unchanged, new `PlanView`/`PlanStepRow` component tests).
- End-to-end: launch the extension in the VS Code Extension Development Host, select Plan mode, submit a real multi-file goal, verify the step list renders with correct tiers/costs, click "Step through" and confirm it pauses after exactly one step, click "Run remaining" and confirm it runs to completion or a real error, confirm the plan survives a window reload (persistence).

### Critical files
- `unlok-backend/app/routing.py`, `app/billing.py`, `app/costing.py`, `app/beast_mode.py` (pattern to follow), `app/schemas.py`, `app/main.py`
- `apps/vscode/proto/cline/account.proto` (pattern to follow for the new `plan.proto`)
- `apps/vscode/src/sdk/sdk-mode-coordinator.ts`, `src/sdk/cline-session-factory.ts`
- `apps/vscode/webview-ui/src/components/chat/ChatTextArea.tsx`, `chat-textarea-mode-toggle.ts`, `RequestStartRow.tsx`
- `apps/vscode/src/core/controller/account/getUnlokWorkspaceInfo.ts` (pattern to follow for new plan RPC handlers)
- `apps/vscode/webview-ui/src/components/chat/UnlokSignInGate.tsx`, `webview-ui/src/components/welcome/UnlokWorkspaceInfoCard.tsx` (house style to match)
