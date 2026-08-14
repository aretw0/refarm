import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SiloCore } from "./index.js";

const homes: string[] = [];

function silo(): SiloCore {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "silo-desc-"));
	homes.push(home);
	return new SiloCore({ storagePath: path.join(home, "identity.json") });
}

afterEach(() => {
	for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

/**
 * THE LISTING THAT RETURNS NO SECRETS.
 *
 * `listSecrets(namespace)` returns VALUES, so nothing that shows the operator a list of credentials
 * may call it — the list travels to a terminal, a log, a phone and a JSON consumer. The
 * account-aware design (D2) requires this as its own primitive rather than as a filtered call to
 * that one, and the difference is not only the values.
 */
describe("listSecretDescriptors", () => {
	it("returns NO secret material, checked against the whole serialised result", () => {
		// Asserted by searching the output for the value rather than by checking key names: a field
		// renamed or nested later would slip past a key-name assertion, and what matters is whether
		// the bytes leave.
		const store = silo();
		return store
			.saveSecret("model", "acc-a", "SUPER-SECRET-TOKEN")
			.then(() => store.listSecretDescriptors("model"))
			.then((descriptors) => {
				expect(JSON.stringify(descriptors)).not.toContain("SUPER-SECRET-TOKEN");
				expect(descriptors).toHaveLength(1);
				expect(descriptors[0]).toMatchObject({ id: "acc-a", ref: "model/acc-a", readable: true });
			});
	});

	it("REPORTS an unreadable secret instead of omitting it", () => {
		// The behavioural difference from `listSecrets`, and the reason a filtered call to it could
		// not have served. `listSecrets` drops entries this build cannot read, so a secret protected
		// by a future scheme is INVISIBLE — and a catalog reconciled against that listing would call
		// its descriptor `incomplete` and send the operator to log in again over a credential that is
		// still there.
		const store = silo();
		const file = store.storagePath;
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(
			file,
			JSON.stringify({
				secrets: {
					model: {
						"acc-future": { value: "OPAQUE", protection: { scheme: "hardware-v9", encrypted: true } },
					},
				},
			}),
		);
		return store.listSecretDescriptors("model").then((descriptors) => {
			expect(descriptors).toHaveLength(1);
			expect(descriptors[0]).toMatchObject({
				id: "acc-future",
				readable: false,
				protection: "hardware-v9",
			});
			expect(JSON.stringify(descriptors)).not.toContain("OPAQUE");
		});
	});

	it("says an absent namespace has nothing, rather than throwing", async () => {
		expect(await silo().listSecretDescriptors("model")).toEqual([]);
	});

	it("is deterministic in order, so a listing reads the same twice", async () => {
		const store = silo();
		await store.saveSecret("model", "b", "1");
		await store.saveSecret("model", "a", "2");
		expect((await store.listSecretDescriptors("model")).map((d) => d.id)).toEqual(["a", "b"]);
	});
});
