import { describe, expect, it } from "vitest";

import { createExtensionVerifyCapability } from "./integrity-verb.js";

describe("extension-verify verb — the integrity gate", () => {
	it("promotes an intact artifact and REJECTS a tampered one under the same declared integrity", async () => {
		const verb = createExtensionVerifyCapability();
		const env = (await verb.run({ args: {}, options: {}, json: true })) as unknown as {
			cases: Array<{ label: string; promoted: boolean }>;
			integrityGateHolds: boolean;
			declaredIntegrity: string;
		};
		const intact = env.cases.find((c) => c.label === "Artefato íntegro")!;
		const tampered = env.cases.find((c) => c.label === "Artefato adulterado")!;
		expect(intact.promoted).toBe(true);
		expect(tampered.promoted).toBe(false);
		expect(env.integrityGateHolds).toBe(true);
		expect(env.declaredIntegrity).toMatch(/^sha256-/);
	});
});
