/**
 * THE SAME MEASUREMENT THAT FOUND ISS-128, KEPT AS A TEST.
 *
 * `account-write.test.ts` proves this logic against a fake silo. That is the right default — it is
 * fast and it isolates the decision. But the defect it now guards was NOT found there: it was found
 * in a lab, against a REAL `SiloCore` with `SILO_HOME` redirected, because the fake never modelled
 * where a namespaced envelope actually lands. The first version of that probe even read
 * `tokens.secrets` when `secrets` is a TOP-LEVEL key beside `tokens`, and reported "no envelopes"
 * for a credential the same run called healthy.
 *
 * So the real store gets its own test, deliberately. A fake that drifts from the store proves the
 * fake, and ISS-070 is this repository's record of measurements that existed only on one machine.
 *
 * WHAT IT PINS: a second login for a provider whose credential is still on the LEGACY flat slot
 * must not delete the account already there. Measured 2026-08-16 before the fix — account A's token
 * was gone and the call returned `migratedFromLegacy: true`, reporting the deletion as a migration.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SiloCore } from "@refarm.dev/silo";
import { afterEach, describe, expect, it } from "vitest";

import { readCatalog } from "./account-view-loader.js";
import { writeModelCredential } from "./account-write.js";

const labs: string[] = [];

/** A real silo and a real catalog home, both throwaway. Nothing here touches the operator's. */
function lab() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-silo-lab-"));
	labs.push(dir);
	const home = path.join(dir, "refarm");
	fs.mkdirSync(home, { recursive: true });
	const silo = new SiloCore({ storagePath: path.join(dir, "silo", "identity.json") });
	return { home, silo };
}

afterEach(() => {
	for (const dir of labs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const MODEL_NS = "model";
const ACCOUNT_A = { access: "TOKEN-DA-CONTA-A", accountId: "aaaa-1111" };
const ACCOUNT_B = { access: "TOKEN-DA-CONTA-B", accountId: "bbbb-2222" };

async function legacyEntry(silo: SiloCore, provider: string) {
	const tokens = ((await silo.loadTokens()) ?? {}) as Record<string, unknown>;
	const flat = (tokens.oauthCredentials ?? {}) as Record<string, unknown>;
	return flat[provider];
}

describe("a second login against a real silo (ISS-128)", () => {
	it("stores the new account WITHOUT deleting the legacy one", async () => {
		const { home, silo } = lab();
		await silo.saveTokens({ oauthCredentials: { "openai-codex": ACCOUNT_A } });

		const result = await writeModelCredential({
			home,
			silo,
			provider: "openai-codex",
			credentials: ACCOUNT_B,
			alias: "segunda",
		});

		// The new account landed, in the namespace — read through the silo's OWN api, never by
		// reaching into its file shape.
		const envelopes = (await silo.listSecrets(MODEL_NS)) ?? {};
		expect(Object.keys(envelopes)).toHaveLength(1);
		expect(readCatalog(home)).toHaveLength(1);

		// And the account that was already here is still here. This assertion is the whole item.
		expect(await legacyEntry(silo, "openai-codex")).toMatchObject({ access: ACCOUNT_A.access });
		expect(result.migratedFromLegacy).toBe(false);
		expect(result.legacyKept).toBeTruthy();
	});

	it("retires the legacy entry when the SAME account logs in again", async () => {
		// The other half of the guarantee. Keeping it here would leave two entries for one
		// credential and every dispatch would refuse as ambiguous on a node with one real account.
		const { home, silo } = lab();
		await silo.saveTokens({ oauthCredentials: { "openai-codex": ACCOUNT_A } });

		const result = await writeModelCredential({
			home,
			silo,
			provider: "openai-codex",
			credentials: { ...ACCOUNT_A, access: "TOKEN-RENOVADO" },
		});

		expect(result.migratedFromLegacy).toBe(true);
		expect(await legacyEntry(silo, "openai-codex")).toBeUndefined();
		expect(Object.keys((await silo.listSecrets(MODEL_NS)) ?? {})).toHaveLength(1);
	});
});
