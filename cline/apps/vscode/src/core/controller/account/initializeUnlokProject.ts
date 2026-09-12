import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

/** Scaffolds UNLOK.md and .unlok/ in the open folder and starts the drafting turn. */
export async function initializeUnlokProject(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	await controller.unlokProject.initialize()
	return Empty.create()
}
