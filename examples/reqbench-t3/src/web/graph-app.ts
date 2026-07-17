import { createCapabilityRegistry, type CapabilityRegistry } from "@refarm.dev/capabilities";
import type { RecordsCommandDeps } from "@refarm.dev/capability-host";
import type { RecordsManifest } from "@refarm.dev/records-contract-v1";

import { reqManifest } from "../fixture.js";
import { createRequirementsGraphCapability } from "../graph.js";

/**
 * A BROWSER-safe requirements registry for the interactive graph web face. The `requirements-graph`
 * verb is pure compute over the records (defineRecordsViewCapability from the browser-safe
 * `@refarm.dev/capabilities-v1/records-view` subpath → buildRequirementsGraph → a Surveyor graph),
 * so seeding an in-memory manifest from the fixture is enough — importing nothing from ../cli.js or
 * the WASM-bound ../persona.js. Same verb the CLI runs; here the graph mounts interactively.
 */
export function createGraphWebRegistry(): CapabilityRegistry {
	const manifest: RecordsManifest = reqManifest();
	const records = {
		loadManifest: () => manifest,
		saveManifest: () => {},
	} as unknown as RecordsCommandDeps;
	return createCapabilityRegistry([createRequirementsGraphCapability(records)]);
}
