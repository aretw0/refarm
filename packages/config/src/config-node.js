import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { loadConfig, loadConfigAsync } from "./index.js";

export const CONFIG_NODE_SCHEMA = "refarm.config.node.v1";
export const CONFIG_NODE_KIND = "refarm/config";
export const CONFIG_NODE_DEFAULT_ID = "urn:sovereign:config:workspace";
export const CONFIG_NODE_REDACTION = "<redacted>";

export const CONFIG_NODE_REDACTION_KEY_PATTERNS = [
	"accessToken",
	"apiKey",
	"clientSecret",
	"credential",
	"password",
	"privateKey",
	"refreshToken",
	"secret",
	"token",
];

/**
 * DEVICE-LOCAL config keys — never enter the replicated config node.
 *
 * The canonical machine-vs-user split (VS Code `machine` scope, confirmed across
 * JetBrains / Chrome / 1Password / Syncthing): a field is device-local iff its value
 * names a filesystem path, an executable/allowlist, this device's own endpoint/identity,
 * or how/whether THIS host launches. Those never sync. "My preferences / my grants"
 * (model choice, capability grants, plugin composition) DO converge.
 *
 * These are matched by EXACT key name at any depth (not substring — unlike secret
 * redaction), so `autostart` catches `runtime.autostart` / `farmhand.autostart`,
 * `sidecarUrl` catches `runtime.sidecarUrl`, `engine` catches `tractor.engine`, and
 * `path` / `hostPath` catch `workspaces.*.path` / `.bridges[].path` / `.hostPath`
 * wherever they nest. Exact-key (not substring) so a device-global key that merely
 * CONTAINS one of these words is never stripped by accident. Device-local subtrees are
 * REMOVED (not `<redacted>`): a machine-specific value has no portable form, and removing
 * it makes two devices with identical device-global config compute the SAME node revision
 * (so the auditor stops seeing healthy per-device differences as drift).
 *
 * MUST stay byte-identical with the Rust mirror `CONFIG_NODE_DEVICE_LOCAL_KEYS`
 * (config_node.rs) or the cross-stack node digest diverges. Guarded by
 * scripts/ci/check-config-node-keys.mjs.
 *
 * NOTE: `MODEL_SHELL_ALLOWLIST` / `MODEL_FS_ROOT` are env-tier (never on the config
 * object today), so listing them here is belt-and-suspenders — they cannot leak in
 * even if a future writer ever puts them on the config.
 */
export const CONFIG_NODE_DEVICE_LOCAL_KEYS = [
	"autostart",
	"engine",
	"hostPath",
	"MODEL_FS_ROOT",
	"MODEL_SHELL_ALLOWLIST",
	"path",
	"peerId",
	"sidecarUrl",
];

function canonicalJson(value) {
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	}
	if (value && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

function isPlainObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePattern(pattern) {
	return String(pattern).toLowerCase();
}

function pathLabel(pathParts) {
	return pathParts.join(".");
}

function shouldRedactKey(key, patterns) {
	const normalizedKey = String(key).toLowerCase();
	return patterns.some((pattern) => normalizedKey.includes(pattern));
}

function shouldDropKey(key, deviceLocalKeys) {
	const normalizedKey = String(key).toLowerCase();
	return deviceLocalKeys.some((deviceLocal) => normalizedKey === deviceLocal);
}

// Sentinel: an object that became empty BECAUSE its only contents were device-local.
// The parent omits it entirely, so a container like `runtime` whose sole field was
// `sidecarUrl` does not survive as an orphan `{}` — otherwise a device with `runtime:{}`
// and a device with no `runtime` would hash differently, reintroducing false drift.
const DROP = Symbol("device-local-empty");

function redactValue(value, options, pathParts = []) {
	const patterns = options.patterns.map(normalizePattern);
	const deviceLocalKeys = options.deviceLocalKeys.map(normalizePattern);
	const redactions = [];
	const dropped = [];

	function visit(current, currentPath) {
		if (Array.isArray(current)) {
			return current.map((item, index) => visit(item, [...currentPath, String(index)]));
		}

		if (!isPlainObject(current)) {
			return current;
		}

		const output = {};
		let sawEntry = false;
		let droppedDeviceLocalHere = false;
		for (const [key, child] of Object.entries(current)) {
			sawEntry = true;
			const childPath = [...currentPath, key];
			// Device-local BEFORE secret: a device-local subtree vanishes as a whole
			// (a nested secret goes with it), so the two stacks agree on shape.
			if (shouldDropKey(key, deviceLocalKeys)) {
				dropped.push(pathLabel(childPath));
				droppedDeviceLocalHere = true;
				continue;
			}
			if (shouldRedactKey(key, patterns)) {
				output[key] = CONFIG_NODE_REDACTION;
				redactions.push(pathLabel(childPath));
				continue;
			}
			const visited = visit(child, childPath);
			if (visited === DROP) {
				dropped.push(pathLabel(childPath));
				droppedDeviceLocalHere = true;
				continue;
			}
			output[key] = visited;
		}
		// Prune a container ONLY when the strip emptied it — a legitimately-empty
		// device-global object (no device-local key removed) is preserved as-is.
		if (sawEntry && droppedDeviceLocalHere && Object.keys(output).length === 0) {
			return DROP;
		}
		return output;
	}

	const visited = visit(value, pathParts);
	return {
		value: visited === DROP ? {} : visited,
		redactions,
		dropped,
	};
}

export function redactConfigForNode(config, options = {}) {
	return redactValue(config ?? {}, {
		patterns: options.redactionKeyPatterns ?? CONFIG_NODE_REDACTION_KEY_PATTERNS,
		deviceLocalKeys: options.deviceLocalKeys ?? CONFIG_NODE_DEVICE_LOCAL_KEYS,
	});
}

/**
 * The device-GLOBAL projection of a config: device-local keys removed, secrets kept
 * as-is (they are still redacted downstream by createConfigNode). This is the portable
 * shape that replicates. The ConfigNodeAuditor recomputes the local revision over THIS
 * projection — not the raw file — so a healthy per-device difference (a local
 * `runtime.sidecarUrl`) stops reading as drift.
 */
export function toPortableConfig(config, options = {}) {
	const deviceLocalKeys = (options.deviceLocalKeys ?? CONFIG_NODE_DEVICE_LOCAL_KEYS).map(
		normalizePattern,
	);
	// Reuse the same walk with an empty redaction set: drop device-local keys, touch
	// nothing else (secret redaction still happens later inside createConfigNode).
	const { value } = redactValue(config ?? {}, { patterns: [], deviceLocalKeys });
	return value;
}

export function createConfigNode(config, options = {}) {
	const { value: redactedConfig, redactions, dropped } = redactConfigForNode(config, options);
	const configDigest = sha256(canonicalJson(redactedConfig));
	const id = options.id ?? CONFIG_NODE_DEFAULT_ID;

	return {
		schema: CONFIG_NODE_SCHEMA,
		kind: CONFIG_NODE_KIND,
		id,
		revision: `sha256:${configDigest}`,
		data: redactedConfig,
		evidence: {
			hashAlgorithm: "sha256",
			configDigest,
			redactedPaths: redactions.sort(),
			deviceLocalPaths: dropped.sort(),
			source: options.source ?? "loaded-config",
		},
		boundaries: [
			"node data is redacted before hashing or graph handoff",
			"runtime secrets stay outside graph-portable config nodes",
			"device-local fields (paths, endpoints, per-host launch/exec) never replicate",
			"host policy owns which config node revisions may be activated",
		],
	};
}

export function configFromNode(node) {
	if (!node || node.schema !== CONFIG_NODE_SCHEMA || node.kind !== CONFIG_NODE_KIND) {
		throw new TypeError("Expected a refarm.config.node.v1 config node");
	}
	return node.data;
}

/**
 * Read the RAW sovereign config from `.refarm/config.json` only — no env
 * interpolation, no `${...}` substitution, no merge of the legacy
 * `refarm.config.json`. This MUST mirror the Rust host's `refarm_config_json_from`
 * (tractor env_and_runtime.rs), which parses that single file's bytes and feeds
 * them straight to `build_config_node_payload`. The config node's `revision` is a
 * digest of THIS object (redacted); recomputing the digest from anything else
 * (e.g. `loadConfig`, which merges + interpolates) yields a different digest and
 * false drift. Returns null when the file is absent or invalid JSON (mirrors the
 * host's early-return). CONFORMANCE: keep in lockstep with refarm_config_json_from.
 */
export function loadRawSovereignConfig(root = process.cwd()) {
	const filePath = path.join(root, ".refarm", "config.json");
	let raw;
	try {
		raw = fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export function loadConfigNode(root, options = {}) {
	return createConfigNode(loadConfig(root), {
		...options,
		source: options.source ?? "loadConfig",
	});
}

export async function loadConfigNodeAsync(root, options = {}) {
	return createConfigNode(await loadConfigAsync(root), {
		...options,
		source: options.source ?? "loadConfigAsync",
	});
}
