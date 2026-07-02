import { createSkillContractV1Adapter } from "./manifest.js";
import type { SkillContractV1Adapter } from "./types.js";

export function createInMemorySkillContractV1Adapter(): SkillContractV1Adapter {
	return createSkillContractV1Adapter();
}
