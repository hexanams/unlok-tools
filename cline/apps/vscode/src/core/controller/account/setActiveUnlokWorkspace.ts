import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/** Makes the given connected Unlok workspace the one chat runs through. */
export async function setActiveUnlokWorkspace(controller: Controller, req: StringRequest): Promise<Empty> {
	await controller.setActiveUnlokWorkspace(req.value)
	return {}
}
