import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/** Forgets a connected Unlok workspace; removing the active one promotes the next. */
export async function removeUnlokWorkspace(controller: Controller, req: StringRequest): Promise<Empty> {
	await controller.removeUnlokWorkspace(req.value)
	return {}
}
