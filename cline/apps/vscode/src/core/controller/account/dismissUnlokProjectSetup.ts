import { Empty, StringRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

/** "now" hides the setup card for this session; "never" remembers the folder in ~/.unlok. */
export async function dismissUnlokProjectSetup(controller: Controller, request: StringRequest): Promise<Empty> {
	await controller.unlokProject.dismiss(request.value === "never" ? "never" : "now")
	return Empty.create()
}
