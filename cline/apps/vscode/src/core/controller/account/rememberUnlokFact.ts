import { String as ProtoString, StringRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

/** "/remember <text>": saves a fact to the workspace's memory bank and returns its title. */
export async function rememberUnlokFact(controller: Controller, request: StringRequest): Promise<ProtoString> {
	const text = (request.value ?? "").trim()
	if (!text) {
		throw new Error("Tell me what to remember: /remember <the fact>")
	}
	const title = await controller.unlokProject.remember(text)
	return ProtoString.create({ value: title })
}
