import {
	CONFIG_NODE_DEFAULT_ID,
	configFromNode,
	createConfigNode,
	loadRawSovereignConfig,
} from "@refarm.dev/config";

/**
 * ConfigNodeAuditor: audits the RefarmConfig graph node against the local
 * `.refarm/config.json`, detecting cross-device drift.
 *
 * The config is now a CRDT-replicated graph node (`urn:sovereign:config:workspace`,
 * @type RefarmConfig). This auditor reads that node via an injected graphContext
 * (a `getNode`/`queryNodes` face over whichever runtime graph transport the host
 * provides) and cross-checks its `revision` digest against a recompute from the
 * local raw config file. A mismatch means the graph node and the local file diverged —
 * another device changed the config, or the local file drifted.
 *
 * MAKE-OR-BREAK — digest source parity: the recompute MUST feed `createConfigNode`
 * the SAME object the Rust host hashed: the RAW `.refarm/config.json`
 * (`loadRawSovereignConfig`), NOT the merged/interpolated `loadConfig`. Both sides
 * then redact secrets AND strip device-local fields internally, hashing the portable
 * projection with the same canonicalJson+sha256 (byte-identical parity pinned by the
 * cross-stack known-answer test in tractor config_node.rs), so equal configs → equal
 * revisions. Using `loadConfig` would fire false drift on every machine with a REFARM_*
 * var or a `${...}` placeholder.
 *
 * Device-local parity is what un-breaks cross-device auditing: because `createConfigNode`
 * strips device-local keys (sidecarUrl, paths, engine, autostart) before hashing, a node
 * written on device A and a local file on device B that differ ONLY in those machine-
 * specific fields recompute to the SAME revision — a healthy per-device difference no
 * longer reads as drift.
 *
 * Three honest outcomes, not two: checked-and-clean, checked-and-found-a-problem,
 * and could-not-check. Only the first two used to reach `issues` — a thrown read
 * (runtime unreachable mid-request, malformed response, …) fell into a THIRD,
 * unmarked bucket: `{ issues: [], note: "…skipped…" }`, which is byte-identical
 * to the clean-pass shape every consumer (`buildHealthReport`'s `issueCount`,
 * `refarm health`'s exit code) actually reads. That is how this auditor's whole
 * purpose — cross-device config-drift detection — passed for as long as the
 * sidecar-client's `@context` requirement made every real read throw (see the
 * Task history this file's own tests predate). A caught read failure now
 * returns a real `issues` entry (`config_node_unreachable`) instead of a note,
 * so "I could not check" can never again render as "I checked, it is fine".
 *
 * Graceful no-op (informational, never a failure — these ARE "checked, nothing
 * to find" states, not failures to check): no graphContext (store never ran /
 * db absent — nothing exists yet to have drifted), no RefarmConfig node yet
 * (fresh store — the read succeeded and definitively found nothing), or no
 * local `.refarm/config.json` to compare (the node read succeeded; there is
 * simply nothing local to diff it against — the documented node-fallback case
 * in `resolveSovereignConfig`).
 */
export class ConfigNodeAuditor {
	#graphContext;

	constructor(options = {}) {
		this.#graphContext = options.graphContext ?? null;
	}

	get id() {
		return "config-node";
	}
	get title() {
		return "Config Graph Node (cross-device drift)";
	}

	async audit(context = {}) {
		const rootDir = context.rootDir || process.cwd();

		if (!this.#graphContext) {
			return {
				issues: [],
				note: "config-node audit skipped: no graph store found (runtime never ran, or db absent)",
			};
		}

		let node;
		try {
			node = await this.#graphContext.getNode(CONFIG_NODE_DEFAULT_ID);
		} catch (e) {
			// A graphContext exists — the substrate this auditor depends on is
			// present — so a thrown read is not "nothing to audit yet", it is this
			// auditor FAILING at the one thing it exists to do. Reporting that as a
			// note (as this used to) is indistinguishable, to every consumer that
			// only counts `issues.length`, from "checked, found nothing wrong" — the
			// exact shape of the gap that let a real @context contract break upstream
			// (the sidecar never setting @context) go undetected here. This is a
			// real, distinct finding — "could not check" — not a clean pass.
			return {
				issues: [
					{
						type: "config_node_unreachable",
						path: CONFIG_NODE_DEFAULT_ID,
						note: `could not read the config graph node: ${e?.message ?? e}`,
					},
				],
			};
		}

		if (!node) {
			return {
				issues: [],
				note: "config-node audit: no RefarmConfig node in the graph yet (fresh store)",
			};
		}

		// Validate the stored node's shape (schema/kind); malformed → an issue.
		try {
			configFromNode(node);
		} catch (e) {
			return {
				issues: [
					{
						type: "config_node_invalid",
						path: CONFIG_NODE_DEFAULT_ID,
						note: `stored config node is malformed: ${e?.message ?? e}`,
					},
				],
			};
		}

		// Recompute the revision from the SAME raw source the host hashed.
		const localConfig = loadRawSovereignConfig(rootDir);
		if (localConfig == null) {
			return {
				issues: [],
				note: "config-node audit skipped: no local .refarm/config.json to compare",
			};
		}

		const localRevision = createConfigNode(localConfig).revision;
		if (node.revision !== localRevision) {
			return {
				issues: [
					{
						type: "config_node_drift",
						path: CONFIG_NODE_DEFAULT_ID,
						note: `graph node revision ${node.revision} differs from local ${localRevision} — another device changed config, or the local file drifted`,
					},
				],
			};
		}

		return {
			issues: [],
			note: "config node in sync with the local config",
		};
	}
}
