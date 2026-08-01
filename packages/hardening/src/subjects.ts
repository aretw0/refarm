/**
 * BINDING A SUBJECT — the part that cannot be inferred, kept where it cannot hide anything.
 *
 * A conformance suite checks an IMPLEMENTATION. `runTaskV1Conformance(adapter)` has no opinion
 * about which adapter, and no amount of scanning can invent one: the pairing is knowledge, not a
 * fact on disk.
 *
 * So the collector splits the two questions, and only one of them is allowed to be a list:
 *
 *   · WHICH SUITES EXIST is discovered from the filesystem (`discover.ts`) and can never be
 *     hand-maintained, because a list that must be edited by hand is what fails to catch the next
 *     suite — and had already failed here (15 counted by hand, 26 on disk).
 *   · WHICH SUBJECT DRIVES A SUITE is resolved by a convention first, and by the explicit table
 *     below when the convention cannot answer. A suite with no binding is still DISCOVERED, still
 *     REPORTED, and reported as `not-yet-hardened` with "bind a subject" as its fix. The failure
 *     mode of a hand-maintained list is silence; nothing here can be silent about a suite that
 *     exists, which is the property that actually matters.
 *
 * THE CONVENTION, and why it is guarded: fourteen packages export exactly one zero-argument
 * `createInMemory*` factory from their root, and it is the subject their own suite uses. Where a
 * package exports two, the convention refuses to guess. It also refuses where the single candidate
 * is not the subject at all: `createInMemoryAuthorizationProviderFixture()` returns a BUNDLE
 * (`{ provider, identity, storage }`), and binding it blindly produced `provider.authorize is not
 * a function` — a harness bug that would have been reported as a product defect. That is the exact
 * failure this file's explicit half exists to prevent, and it is why every explicit entry below
 * carries the reason it is not the convention.
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { DiscoveredSuite } from "./discover.js";

/** One invocation of a runner: the argument list, and a label when a suite is driven more than
 *  once (the design-system themes are four subjects for one contract). */
export interface SubjectInvocation {
	label: string | null;
	args: unknown[];
}

export type SubjectResolution =
	| { bound: true; invocations: SubjectInvocation[]; how: string }
	| { bound: false; fix: string };

type ModuleExports = Record<string, unknown>;

/** A binding the convention cannot reach. Each carries WHY, because an unexplained entry here is
 *  indistinguishable from a guess. */
interface ExplicitBinding {
	why: string;
	build: (root: ModuleExports, own: ModuleExports) => Promise<SubjectInvocation[]>;
}

const one = (args: unknown[]): SubjectInvocation[] => [{ label: null, args }];

function callFactory(exports: ModuleExports, name: string): unknown {
	const factory = exports[name];
	if (typeof factory !== "function") {
		throw new Error(`${name} is not exported as a function by this package`);
	}
	return (factory as () => unknown)();
}

const EXPLICIT_BINDINGS: Record<string, ExplicitBinding> = {
	"@refarm.dev/artifact-contract-v1#runArtifactV1Conformance": {
		why: "the package exports TWO zero-argument createInMemory* factories (a manifest producer and a registry), so the convention refuses to guess; the runner takes an ArtifactManifestProducer",
		build: async (root) => one([callFactory(root, "createInMemoryArtifactManifestProducer")]),
	},
	"@refarm.dev/asset-resolver-contract-v1#runAssetResolverV1Conformance": {
		why: "takes a harness AND a digest function — the digest is a host capability, not something the contract package can ship, so the collector supplies node:crypto's sha256",
		build: async (root) => {
			const { createHash } = await import("node:crypto");
			return one([
				callFactory(root, "createInMemoryAssetResolverConformanceHarness"),
				(bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex"),
			]);
		},
	},
	"@refarm.dev/authorization-contract-v1#runAuthorizationV1Conformance": {
		why: "the single createInMemory* factory returns a FIXTURE BUNDLE ({ provider, identity, storage }), not the provider — binding it by convention throws `provider.authorize is not a function`",
		build: async (root) => {
			const fixture = callFactory(root, "createInMemoryAuthorizationProviderFixture") as {
				provider?: unknown;
			};
			return one([fixture.provider]);
		},
	},
	"@refarm.dev/credentials-contract-v1#runCredentialsV1Conformance": {
		why: "takes a provider AND the two identity ids it must issue between; the ids only exist once the fixture's identity provider has created them, so the subject needs a two-step setup",
		build: async (root) => {
			const fixture = callFactory(root, "createInMemoryCredentialsProviderFixture") as {
				provider?: unknown;
				identity?: { create: (label: string) => Promise<{ id: string }> };
			};
			if (!fixture.identity) throw new Error("credentials fixture exposes no identity provider");
			const issuer = await fixture.identity.create("Issuer");
			const holder = await fixture.identity.create("Holder");
			return one([
				fixture.provider,
				{ issuerIdentityId: issuer.id, holderIdentityId: holder.id },
			]);
		},
	},
	"@refarm.dev/ds#runDsThemeConformance": {
		why: "the subject is a theme OBJECT, not a factory, so there is nothing for the convention to call; the package ships four builtin themes and each is a separate subject for the same contract",
		build: async (root) => {
			const themes = root.BUILTIN_THEMES as Record<string, unknown> | undefined;
			if (!themes) throw new Error("@refarm.dev/ds exports no BUILTIN_THEMES");
			return Object.entries(themes).map(([label, theme]) => ({ label, args: [theme] }));
		},
	},
	"@refarm.dev/prompt-contract-v1#runOperatorChannelConformance": {
		why: "no createInMemory* factory exists; the non-interactive channel is `createAutoOperatorChannel`, which is what the package's own suite drives (the others read a TTY, a socket or a peer)",
		build: async (root) => one([callFactory(root, "createAutoOperatorChannel")]),
	},
};

/** The package's root module, as `package.json` declares it. */
export function packageRootModule(packageDir: string): string | null {
	const manifestPath = path.join(packageDir, "package.json");
	if (!statSync(manifestPath, { throwIfNoEntry: false })?.isFile()) return null;
	let manifest: { main?: unknown; exports?: unknown };
	try {
		manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as typeof manifest;
	} catch {
		return null;
	}
	const root = (manifest.exports as Record<string, unknown> | undefined)?.["."];
	const target =
		typeof root === "string"
			? root
			: ((root as Record<string, unknown> | undefined)?.import ??
				(root as Record<string, unknown> | undefined)?.default ??
				manifest.main);
	if (typeof target !== "string") return null;
	return path.resolve(packageDir, target);
}

async function importIfPresent(modulePath: string | null): Promise<ModuleExports> {
	if (!modulePath || !statSync(modulePath, { throwIfNoEntry: false })?.isFile()) return {};
	try {
		return (await import(pathToFileURL(modulePath).href)) as ModuleExports;
	} catch {
		return {};
	}
}

/** Zero-argument `createInMemory*` factories on the package root — the convention's candidates. */
export function conventionCandidates(root: ModuleExports): string[] {
	return Object.entries(root)
		.filter(
			([name, value]) =>
				/^createInMemory/.test(name) && typeof value === "function" && value.length === 0,
		)
		.map(([name]) => name)
		.sort();
}

export async function resolveSubject(
	suite: DiscoveredSuite,
	own: ModuleExports,
): Promise<SubjectResolution> {
	const runner = own[suite.runner];
	if (typeof runner !== "function") {
		return { bound: false, fix: `${suite.runner} is not exported by the built module` };
	}

	const explicit = EXPLICIT_BINDINGS[suite.id];
	if (explicit) {
		const root = await importIfPresent(packageRootModule(suite.packageDir));
		return {
			bound: true,
			invocations: await explicit.build(root, own),
			how: `bound explicitly — ${explicit.why}`,
		};
	}

	if (runner.length === 0) {
		return { bound: true, invocations: one([]), how: "takes no subject: the suite checks the module itself" };
	}

	const root = await importIfPresent(packageRootModule(suite.packageDir));
	const candidates = conventionCandidates(root);
	if (runner.length === 1 && candidates.length === 1) {
		const name = candidates[0]!;
		return {
			bound: true,
			invocations: one([callFactory(root, name)]),
			how: `bound by convention — ${name}() is the package's only zero-argument createInMemory* factory`,
		};
	}

	const seen =
		candidates.length === 0
			? "the package exports no zero-argument createInMemory* factory"
			: `the package exports ${candidates.length} of them (${candidates.join(", ")}), so the convention will not guess`;
	return {
		bound: false,
		fix:
			`no subject is bound, so nothing here runs this suite: it takes ${runner.length} argument(s) and ${seen}. ` +
			`Export a single zero-argument createInMemory* factory from the package root, or add an explicit binding ` +
			`for ${suite.id} in packages/hardening/src/subjects.ts.`,
	};
}
