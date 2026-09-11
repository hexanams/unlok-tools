import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { AuthHandler } from "@/hosts/external/AuthHandler"
import { openExternal } from "@/utils/env"
import { Controller } from ".."

/**
 * Initiates Unlok sign-in: opens the Unlok dashboard's extension-authorize
 * page, which mints an API key and redirects back to the callback URL below.
 *
 * Uses AuthHandler's local loopback server (the same mechanism OCA's login
 * already uses in desktop VS Code) instead of a `vscode://` deep link.
 * `vscode://` callbacks are dispatched by VS Code's own shell to whichever
 * window it considers "active" at that moment, not necessarily the window
 * that opened the browser — with multiple windows open, sign-in can land in
 * the wrong one. AuthHandler is a singleton scoped per extension-host
 * *process*, and each VS Code window runs its own process, so each window
 * binds its own unique port and the browser's redirect is unambiguous.
 */
export async function unlokAuthClicked(_: Controller, __: EmptyRequest): Promise<Empty> {
	const authHandler = AuthHandler.getInstance()
	authHandler.setEnabled(true)
	const callbackUrl = await authHandler.getCallbackUrl("/unlok")

	const authUrl = new URL("https://unlok-frontend-app.onrender.com/extension/authorize")
	authUrl.searchParams.set("callback_url", callbackUrl)

	await openExternal(authUrl.toString())

	return {}
}
