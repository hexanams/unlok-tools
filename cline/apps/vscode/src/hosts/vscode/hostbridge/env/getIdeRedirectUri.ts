import { EmptyRequest, String } from "@shared/proto/cline/common"
import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"

export async function getIdeRedirectUri(_: EmptyRequest): Promise<String> {
	if (vscode.env.uiKind === vscode.UIKind.Web) {
		// In VS Code Web (code serve-web), the auth callback is handled by an HTTP server
		// (AuthHandler). Returning empty here means the success page won't try to redirect
		// to a vscode:// URI (which would open the desktop app instead of the web tab).
		return { value: "" }
	}
	const uriScheme = vscode.env.uriScheme || "vscode"
	// Upstream hardcoded its own marketplace id here. The auth success page
	// redirects the browser to this URI to bring the IDE back to the front,
	// and a deep link to an extension that isn't installed makes VS Code offer
	// to install it: with the upstream id that was "Would you like to install
	// 'Cline'?" after every Unlok sign in. Use this build's real id instead.
	return { value: `${uriScheme}://${ExtensionRegistryInfo.id}` }
}
