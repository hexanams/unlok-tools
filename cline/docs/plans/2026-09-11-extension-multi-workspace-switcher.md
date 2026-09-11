# Extension multi workspace switcher

**Status (2026-09-11):** built the same day, per the user's decision to keep one live key per workspace. Backend revoke scoped by `team_id` (`app/admin.py`), authorize page passes `email`, `workspace`, `team_id` through the callback, extension stores the list in the `unlokWorkspaces` secret with `unlokApiKey` mirroring the active entry (`src/core/controller/account/unlokWorkspaces.ts`), Account tab lists and switches, General settings shows the active workspace, ErrorRow offers a switch or reconnect. Tests: backend 49, host 14 new, webview 35 in the touched specs.

## Context

While testing the Unlok VS Code extension on 2026-09-11 the user asked for this in Settings: "you should be able to switch workspace if one workspace fails, if two are not connected, you should be able to add more workspace and be able to switch." Today the extension holds exactly one Unlok API key (`apiConfiguration.unlokApiKey`, a VS Code secret). Signing in again replaces it, and the backend revokes the previous key for that client on every sign in (`app/admin.py::authorize_client_api_key`), so there is no way to keep two workspaces connected at once, and no way to recover from a failing workspace except signing in again from scratch.

Same day, the Account tab was fixed to show an Unlok connected view with "Switch account or workspace" and "Disconnect" (`webview-ui/src/components/account/UnlokAccountView.tsx`). That covers one workspace at a time. This plan is the real multi workspace version.

## What already exists and gets reused

- **The authorize page already picks account and workspace.** `unlok-frontend/src/app/extension/authorize/page.tsx` lets a signed in person choose which account and which workspace (personal or team) the key is pinned to, then redirects to the extension's loopback callback with `code=<key>`. Nothing new is needed on the choosing side.
- **Keys are already workspace scoped on the backend.** `ApiKey.team_id` pins a key to one workspace, and every request re-derives billing and permissions from that. Two keys for two workspaces is already a supported shape server side.
- **The callback path is one function.** `SharedUriHandler.ts` case `"/unlok"` hands `code` and `name` to `AuthService.handleUnlokCallback`, which writes the secret. This is the single place the "replace" behavior lives, so "append instead" is a contained change.
- **Workspace details are already fetched.** `getUnlokWorkspaceInfo.ts` calls `GET /v1/me` and returns email, access mode, models and budget for the active key. The switcher reuses it per entry for labels and health.

## One backend rule to decide first

`authorize_client_api_key` revokes every live key named `vscode-extension` for the user before minting a new one. With two workspaces on the same account (personal plus a team), adding the second would revoke the first. Two options:

1. **Name keys per workspace** (recommended): mint with `name = f"vscode-extension:{team_id or 'personal'}"` and only revoke keys with that exact name. One live key per client per workspace, still no orphan pile up, and adding a team workspace no longer kills the personal one. Small change in `app/admin.py`, one test in `tests/test_admin.py`.
2. Keep one key per client and let the extension hold keys from different accounts only. Simpler, but "personal plus my team" on one account is the most common case and would silently break.

Go with option 1 unless told otherwise.

## What gets built

### 1. Storage: a list of connected workspaces, one active

- `src/shared/storage/state-keys.ts`: add secret `unlokWorkspaces` (JSON array) next to `unlokApiKey`. Each entry: `{ id, apiKey, email, workspaceName, teamId, addedAt, lastError? }`. Keep `unlokApiKey` as the mirror of the active entry's key so every existing reader (`getUnlokWorkspaceInfo`, the sign in gate, the API handler) keeps working unchanged.
- `src/core/controller/account/unlokWorkspaces.ts` (new): pure helpers `addWorkspace`, `setActiveWorkspace`, `removeWorkspace`, `markWorkspaceError`, `clearWorkspaceError`, each writing the list and re-mirroring `unlokApiKey`. Unit tested with the fake storage the other controller tests already use.
- Migration: on first read, if `unlokApiKey` is set and `unlokWorkspaces` is empty, wrap the existing key as the single active entry so nobody is signed out by the upgrade.

### 2. Callback: append, never replace

- `unlok-frontend/src/app/extension/authorize/page.tsx`: add `email` and `workspace` (display name) to the callback redirect. The page already has both in hand, so the extension can label the entry without a round trip.
- `SharedUriHandler.ts` case `"/unlok"`: read `email`, `workspace`, `team_id`; call `handleUnlokCallback(code, { name, email, workspace, teamId })`.
- `src/sdk/auth-service.ts::handleUnlokCallback`: call `addWorkspace` and make it active. If an entry with the same `teamId` and email already exists, replace its key in place (this is the "reconnect a failed workspace" path, see 4).

### 3. UI: Account tab list, General settings shortcut

- `webview-ui/src/components/account/UnlokAccountView.tsx`: replace the single connected block with a list. Each row: workspace name, email, a status dot (connected, failing, checking), "Use this workspace" on non active rows, a remove control. Below the list: "Add another workspace" (runs `unlokAuthClicked`) and the dashboard link. Active row shows the existing `UnlokWorkspaceInfoCard`.
- `webview-ui/src/components/settings/sections/GeneralSettingsSection.tsx`: a compact "Active workspace: Acme (you@example.com)" row with a "Switch" button that jumps to the Account tab. This is what the user literally asked for in General settings; the full list stays in Account so General does not grow a second copy.
- New proto RPCs in `proto/cline/account.proto`: `listUnlokWorkspaces`, `setActiveUnlokWorkspace`, `removeUnlokWorkspace`. Generated clients via `bun run protos`.

### 4. Failure handling: the reason this exists

- Where the Unlok API handler classifies errors (the request path in `src/sdk/sdk-api-handler.ts`), treat 401 and 403 from Unlok, plus the backend's "No X key is connected" and wallet exhausted messages, as a workspace level failure: call `markWorkspaceError(activeId, message)`.
- `webview-ui/src/components/chat/ErrorRow.tsx`: when the error belongs to the active workspace and at least one other healthy workspace exists, render a "Switch to <name>" button inline, plus "Reconnect" (re runs sign in for that entry). With only one workspace connected, offer "Add another workspace" instead.
- A successful request clears `lastError` for the active entry, so the status dot recovers on its own.

### 5. Copy rules

No hyphens or dashes in any of the new UI strings. Everything is phrased as connecting and switching, never as keys, matching the authorize page rewrite from the same day.

## Verification

1. Backend: `pytest tests/test_admin.py` covers "adding a team workspace key does not revoke the personal one" and "re adding the same workspace revokes only its own previous key".
2. Extension unit tests: the `unlokWorkspaces` helpers (add, switch, remove, error mark, migration from a lone `unlokApiKey`).
3. Webview tests: Account list renders entries, switch calls the RPC, remove of the active entry promotes the next one, ErrorRow shows the switch button only when a healthy alternative exists.
4. Manual: connect personal, add a team workspace, confirm both listed and only one active; revoke the active key from the dashboard, send a message, see the failure banner with "Switch to", switch, send again successfully; reconnect the revoked one from its row.

## Estimate

About a day and a half: half a day backend plus storage and callback, half a day UI, the rest on failure handling and tests.
