import { createCapabilityRegistry, type CapabilityRegistry } from "@refarm.dev/capabilities";
import type { RecordsCommandDeps } from "@refarm.dev/capability-host";
import type { RecordsManifest } from "@refarm.dev/records-contract-v1";

import { reqManifest } from "../fixture.js";
import { createRequirementsLabCapability } from "../lab.js";

/**
 * A BROWSER-safe requirements registry for the Lab gallery web face. The `requirements-lab` verb is
 * pure compute over the records (buildRequirementsGraph → the dataset → buildLabManifest), with the
 * dataset fingerprint defaulting to Web Crypto sha256 — no node:crypto, no fs writer, no export
 * executor (all optional, injected only by the CLI). So seeding an in-memory manifest from the
 * fixture is enough — importing nothing from ../cli.js or the WASM-bound ../persona.js (createRequirements
 * LabCapability lives in the browser-safe ../lab.ts). Same verb the CLI runs; here the gallery renders.
 */
export function createLabWebRegistry(): CapabilityRegistry {
	const manifest: RecordsManifest = reqManifest();
	const records = {
		loadManifest: () => manifest,
		saveManifest: () => {},
	} as unknown as RecordsCommandDeps;
	return createCapabilityRegistry([createRequirementsLabCapability(records)]);
}
