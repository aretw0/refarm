/**
 * WHO OWNS EACH CONFIG KEY — the tier separation, as data.
 *
 * `.refarm/config.json` is read at more than one place in the filesystem. `storage-fs`'s
 * `scope.ts` declares three of them (`org < workspace < user`), the workspace tier anchored on
 * the operator's directory. What nothing declared, until this file, is WHICH KEY BELONGS TO
 * WHICH TIER — so every key was, in effect, workspace-declarable, including the ones that
 * decide what a plugin may do to the machine.
 *
 * That is not untidiness, it is a privilege boundary. `approvedPermissions` and `spawnEnv` are
 * enforced by the Rust host (`host_effects_bridge/policy_and_fs.rs`); a repository that could
 * declare them would be a repository granting itself capabilities on the node that cloned it.
 *
 * THE MODEL (operator ruling, 2026-08-10): a workspace never DECLARES a node-owned key. It may
 * REQUEST one — inertly, in the `requests` block — and the node's onboarding turns a request
 * into a grant if the operator approves. The word was already in the schema: `approvedPermissions`
 * is a grant, and a grant has a grantor.
 *
 * THE SANCTION (same ruling): a key outside its tier is DROPPED from the composition and
 * REPORTED. Never a load failure — the node must keep starting with a wrong config, because an
 * operator whose daily driver refuses to boot over a stray key fixes it by deleting the guard.
 * Fail open for availability, closed for privilege.
 */

/** The tiers a key can be owned by. `node` is the device's own answer; `workspace` is the
 *  repository's. There is deliberately no `either`: a key with two owners has none, and the
 *  composition would have to invent a merge rule nobody declared. */
export const CONFIG_TIERS = ["node", "workspace"];

/**
 * THE TABLE. One line per top-level key, correctable in one line — which is the point. A wrong
 * call here should be an edit, not an archaeology expedition through the readers.
 *
 * `requestable` is the operator's model made mechanical: `true` means a workspace may name this
 * key inside `requests` so onboarding can offer the operator a grant; `false` means the key has
 * no meaning coming from a repository at all, so requesting it is as wrong as declaring it.
 */
export const CONFIG_KEY_OWNERSHIP = {
	// ---- Node-owned, and a workspace may ASK. These are the capability surface: what a
	// workspace legitimately needs to say is "I need X to work", never "I have X".
	approvedPermissions: {
		owner: "node",
		requestable: true,
		reason:
			"the grant itself, enforced by the Rust host; a repository declaring its own grants is the boundary this table exists to draw",
	},
	spawnEnv: {
		owner: "node",
		requestable: true,
		reason:
			"what the host injects into every spawned process (PATH, HOME); a repository setting it chooses which binaries the node runs",
	},
	trusted_plugins: {
		owner: "node",
		requestable: true,
		reason: "which plugin code may load at all — the decision a plugin cannot be trusted to make about itself",
	},
	nodeTools: {
		owner: "node",
		requestable: true,
		reason:
			"health SPAWNS every declared command to read its version, so a repository that could declare this would choose which binaries the node executes; stating the need (`I require gh >= 2.40.0`) is legitimate, holding the declaration is not",
	},
	connections: {
		owner: "node",
		requestable: true,
		reason:
			"a connection names a command that runs on THIS machine, which is why it is already read filesystem-only and never from the replicated node",
	},
	delivery: {
		owner: "node",
		requestable: true,
		reason: "channels carry the node's credentials; a workspace may need a channel, it may not hold one",
	},
	processes: {
		owner: "node",
		requestable: true,
		reason:
			"a declared unit is a long-running process on the node; a repository may say it needs one, the node decides whether to run it",
	},

	// ---- Node-owned, and NOT requestable: a repository asking for these is asking to redefine
	// the node it was cloned onto, which is not a need it can have.
	node: { owner: "node", requestable: false, reason: "the node's own identity and name" },
	tractor: { owner: "node", requestable: false, reason: "which runtime engine THIS device runs" },
	surfaces: {
		owner: "node",
		requestable: false,
		reason: "how the node exposes itself to the network and which gate guards each surface",
	},
	workspaces: {
		owner: "node",
		requestable: false,
		reason: "the node's catalog of workspaces; a workspace declaring the catalog that contains it is circular",
	},

	// ---- Workspace-owned. The tier is not empty, which is what keeps this a separation rather
	// than a ban: policy ABOUT a repository belongs to the repository.
	health: {
		owner: "workspace",
		requestable: false,
		reason: "audit policy about this repository's own tree — per-repo by nature, and inert on any other node",
	},
};

/** Where a workspace states a NEED rather than a value. Inert by construction: nothing composes
 *  this block into effective config, so a request can never become a grant by accident. */
export const CONFIG_REQUEST_BLOCK_KEY = "requests";

/**
 * PURE. Three states, never two. A key this table does not name is `unknown` — NOT "allowed"
 * and NOT "forbidden". Collapsing unknown onto either one is how a new key silently acquires a
 * tier: onto `allowed` and the next capability key is workspace-declarable the day it ships;
 * onto `forbidden` and adding a legitimate key breaks the operator's config until someone
 * remembers this file exists. Reported instead, so the table is what changes.
 */
export function classifyConfigKey(key) {
	const entry = CONFIG_KEY_OWNERSHIP[key];
	if (!entry) return { state: "unknown", key };
	return { state: "known", key, owner: entry.owner, requestable: entry.requestable, reason: entry.reason };
}

/**
 * PURE. Audits ONE tier's raw config object against the table. Returns what the composition
 * should keep and what it must drop, plus a finding per dropped key — the caller applies the
 * sanction, this function only judges, so a reporting-only caller (`refarm check`) and an
 * enforcing one (the composer) cannot drift apart in what they consider wrong.
 *
 * `tier` is REQUIRED and has no default. A default would reintroduce the exact defect this
 * module was written for: an untagged read that silently picks a tier.
 */
export function auditConfigTier(config, tier) {
	if (!CONFIG_TIERS.includes(tier)) {
		throw new Error(`Unknown config tier "${tier}" — expected one of ${CONFIG_TIERS.join(", ")}`);
	}
	const kept = {};
	const dropped = [];
	const findings = [];
	if (!config || typeof config !== "object" || Array.isArray(config)) {
		return { tier, kept, dropped, findings, requests: null };
	}

	// The request block is never composed and never audited as a value — it is a statement of
	// need, so its CONTENTS are checked for requestability instead.
	const requests = auditRequestBlock(config[CONFIG_REQUEST_BLOCK_KEY], tier, findings);

	for (const [key, value] of Object.entries(config)) {
		if (key === CONFIG_REQUEST_BLOCK_KEY) continue;
		const verdict = classifyConfigKey(key);
		if (verdict.state === "unknown") {
			// Kept, because dropping a key nobody has classified would break a working node over
			// this table's incompleteness. Reported, because an unclassified capability key is
			// exactly the hole this module closes.
			kept[key] = value;
			findings.push({
				key,
				tier,
				severity: "warning",
				problem: "unclassified-key",
				message: `\`${key}\` has no declared owner in CONFIG_KEY_OWNERSHIP — kept, but nothing knows which tier may set it.`,
			});
			continue;
		}
		if (verdict.owner === tier) {
			kept[key] = value;
			continue;
		}
		dropped.push(key);
		findings.push({
			key,
			tier,
			severity: verdict.requestable ? "high" : "warning",
			problem: "wrong-tier",
			message:
				`\`${key}\` is owned by the \`${verdict.owner}\` tier and was declared in \`${tier}\` — dropped. ${verdict.reason}.` +
				(verdict.requestable
					? ` A workspace states this as a NEED under \`${CONFIG_REQUEST_BLOCK_KEY}\`, and the node grants it.`
					: " This key has no meaning coming from a workspace."),
		});
	}
	return { tier, kept, dropped, findings, requests };
}

/** PURE. A `requests` block is only meaningful in the workspace tier, and may only name keys
 *  the table marks requestable. Pushes findings onto the caller's list rather than returning a
 *  second one, so `auditConfigTier` has exactly one finding stream to reason about. */
function auditRequestBlock(raw, tier, findings) {
	if (raw === undefined) return null;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		findings.push({
			key: CONFIG_REQUEST_BLOCK_KEY,
			tier,
			severity: "warning",
			problem: "malformed-requests",
			message: `\`${CONFIG_REQUEST_BLOCK_KEY}\` must be an object mapping a requestable key to what the workspace needs.`,
		});
		return null;
	}
	if (tier !== "workspace") {
		findings.push({
			key: CONFIG_REQUEST_BLOCK_KEY,
			tier,
			severity: "warning",
			problem: "requests-outside-workspace",
			message: `\`${CONFIG_REQUEST_BLOCK_KEY}\` is how a WORKSPACE states a need; the \`${tier}\` tier grants instead of asking.`,
		});
		return null;
	}
	const requested = {};
	for (const [key, value] of Object.entries(raw)) {
		const verdict = classifyConfigKey(key);
		if (verdict.state === "known" && verdict.requestable) {
			requested[key] = value;
			continue;
		}
		findings.push({
			key,
			tier,
			severity: "warning",
			problem: verdict.state === "unknown" ? "unclassified-request" : "not-requestable",
			message:
				verdict.state === "unknown"
					? `\`${key}\` is requested but has no declared owner, so nothing can decide whether the request is legitimate.`
					: `\`${key}\` cannot be requested: ${verdict.reason}.`,
		});
	}
	return requested;
}

/**
 * PURE. What the operator has to DECIDE: every requestable key a workspace asked for that the
 * node has not answered. This is the onboarding queue — the list `refarm workspace onboard`
 * would walk — kept here rather than in a command so the "what is outstanding" question has one
 * answer whether it is asked by a command, a doctor finding, or a test.
 *
 * A request the node has already answered is NOT pending, whatever the answer was: granting and
 * refusing are both decisions, and re-asking a decided question is how an operator learns to
 * approve without reading.
 */
export function pendingRequests(workspaceConfig, nodeConfig) {
	const audit = auditConfigTier(workspaceConfig, "workspace");
	if (!audit.requests) return [];
	return Object.entries(audit.requests)
		.filter(([key]) => !(nodeConfig && typeof nodeConfig === "object" && key in nodeConfig))
		.map(([key, requested]) => ({ key, requested, reason: CONFIG_KEY_OWNERSHIP[key].reason }));
}
