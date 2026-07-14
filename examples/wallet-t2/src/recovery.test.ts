import { createInMemoryIdentityProvider } from "@refarm.dev/identity-contract-v1";
import { describe, expect, it } from "vitest";

import { createRecoverCapability } from "./recovery.js";

describe("recover — lost-device identity recovery via deriveFromSession", () => {
	it("recovers the SAME identity from the same session, and signing works again", async () => {
		const identity = createInMemoryIdentityProvider();
		const verb = createRecoverCapability(identity);

		const res = (await verb.run({
			args: { session: "citizen-opaque-session" },
			options: {},
			json: true,
		})) as unknown as {
			ok: boolean;
			recovered: boolean;
			holder: string;
			signingRestored: boolean;
		};
		expect(res.ok).toBe(true);
		expect(res.recovered).toBe(true);
		expect(res.signingRestored).toBe(true);

		// On a NEW device (fresh provider), the same session recovers the same holder id.
		const newDevice = createRecoverCapability(createInMemoryIdentityProvider());
		const again = (await newDevice.run({
			args: { session: "citizen-opaque-session" },
			options: {},
			json: true,
		})) as unknown as { ok: boolean; holder: string };
		expect(again.ok).toBe(true);
		expect(again.holder).toBe(res.holder);
	});

	it("errors helpfully when no session is passed", async () => {
		const verb = createRecoverCapability(createInMemoryIdentityProvider());
		const res = (await verb.run({ args: {}, options: {}, json: true })) as unknown as {
			ok: boolean;
			error: string;
		};
		expect(res.ok).toBe(false);
		expect(res.error).toBe("no_session");
	});

	it("errors clearly when the provider does not support recovery", async () => {
		// A minimal provider WITHOUT deriveFromSession — the verb reports it, not a crash.
		const noRecovery = {
			pluginId: "test",
			capability: "identity:v1" as never,
			create: async () => ({ id: "x", publicKey: "p", createdAt: "" }),
			sign: async () => ({ signature: "s", algorithm: "a" }),
			verify: async () => ({ valid: true, identity: { id: "x", publicKey: "p", createdAt: "" } }),
			get: async () => null,
		};
		const res = (await createRecoverCapability(noRecovery).run({
			args: { session: "x" },
			options: {},
			json: true,
		})) as unknown as { ok: boolean; error: string };
		expect(res.ok).toBe(false);
		expect(res.error).toBe("recovery_unsupported");
	});
});
