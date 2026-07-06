import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { loadConfig, loadConfigAsync } from "./index.js";

export const CONFIG_NODE_SCHEMA = "refarm.config.node.v1";
export const CONFIG_NODE_KIND = "refarm/config";
export const CONFIG_NODE_DEFAULT_ID = "urn:refarm:config:workspace";
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

function redactValue(value, options, pathParts = []) {
    const patterns = options.patterns.map(normalizePattern);
    const redactions = [];

    function visit(current, currentPath) {
        if (Array.isArray(current)) {
            return current.map((item, index) => visit(item, [...currentPath, String(index)]));
        }

        if (!isPlainObject(current)) {
            return current;
        }

        const output = {};
        for (const [key, child] of Object.entries(current)) {
            const childPath = [...currentPath, key];
            if (shouldRedactKey(key, patterns)) {
                output[key] = CONFIG_NODE_REDACTION;
                redactions.push(pathLabel(childPath));
                continue;
            }
            output[key] = visit(child, childPath);
        }
        return output;
    }

    return {
        value: visit(value, pathParts),
        redactions,
    };
}

export function redactConfigForNode(config, options = {}) {
    return redactValue(config ?? {}, {
        patterns: options.redactionKeyPatterns ?? CONFIG_NODE_REDACTION_KEY_PATTERNS,
    });
}

export function createConfigNode(config, options = {}) {
    const { value: redactedConfig, redactions } = redactConfigForNode(config, options);
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
            source: options.source ?? "loaded-config",
        },
        boundaries: [
            "node data is redacted before hashing or graph handoff",
            "runtime secrets stay outside graph-portable config nodes",
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
