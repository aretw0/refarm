import { describe, expect, it } from "vitest";

import {
	buildDeclaration,
	diffDeclarations,
	isSealedPath,
	summariseNotCarried,
} from "./node-declaration.js";
import { sealPayload } from "./node-seal.js";

const CONFIG = { node: { name: "n1" }, surfaces: { web: { port: 3000 } }, workspaces: {} };

const declaration = (overrides: Partial<Parameters<typeof buildDeclaration>[0]> = {}) =>
	buildDeclaration({
		nodeName: "n1",
		declaredAt: "2026-08-13T00:00:00Z",
		governance: "local",
		config: CONFIG,
		authPolicy: null,
		seal: sealPayload({ files: {} }, "pw"),
		reAuthenticate: ["github"],
		notCarried: { history: 8, storage: 4, bytes: 575815, replicates: true },
		...overrides,
	});

describe("isSealedPath", () => {
	it("seals identity AND its secrets, so a restored node is trusted by its old peers", () => {
		// The certificate is public and the key is not, but they are useless apart: a node with a CA
		// key and no CA certificate cannot present the identity the key proves.
		for (const file of [
			".refarm/node-id",
			".refarm/node.json",
			".refarm/tls/ca.key",
			".refarm/tls/ca.crt",
			".refarm/tls/ca.cnf",
			".refarm/delivery/telegram.token",
		]) {
			expect(isSealedPath(file), file).toBe(true);
		}
	});

	it("leaves the DECISIONS in cleartext, which is the whole readability of the file", () => {
		expect(isSealedPath(".refarm/config.json")).toBe(false);
		expect(isSealedPath(".refarm/auth-policy.json")).toBe(false);
	});

	it("does not seal history or storage — the declaration never carries them at all", () => {
		expect(isSealedPath(".refarm/task-memory.db")).toBe(false);
		expect(isSealedPath(".refarm/data/refarm/default.db")).toBe(false);
	});
});

describe("summariseNotCarried", () => {
	it("counts history and storage APART, because they are lost for different reasons", () => {
		// History is gone for good: nothing reproduces a record of the past. Storage is expected back
		// by replication. Collapsing them into one number would hide which of the two an operator is
		// actually looking at, and only one of them has a remedy.
		expect(
			summariseNotCarried([
				{ relative: ".refarm/config.json", bytes: 4962 }, // a decision — carried
				{ relative: ".refarm/tls/ca.crt", bytes: 1200 }, // sealed — carried
				{ relative: ".refarm/task-memory.db", bytes: 200 }, // history
				{ relative: ".refarm/sas/verification-log.ndjson", bytes: 100 },
				{ relative: ".refarm/data/refarm/default.db", bytes: 900 }, // storage
				{ relative: ".local/share/refarm/default.peer", bytes: 50 },
			]),
		).toEqual({ history: 2, storage: 2, bytes: 1250, replicates: true });
	});

	it("counts nothing as not-carried when everything is a decision or sealed", () => {
		expect(
			summariseNotCarried([
				{ relative: ".refarm/config.json", bytes: 10 },
				{ relative: ".refarm/node-id", bytes: 6 },
			]),
		).toEqual({ history: 0, storage: 0, bytes: 0, replicates: true });
	});
});

describe("buildDeclaration", () => {
	it("carries the config VERBATIM rather than re-encoding it", () => {
		// A translation would be a second vocabulary, and a second vocabulary rots against the first
		// the day someone adds a key. The declaration is a container.
		expect(declaration().declarations).toEqual(CONFIG);
	});

	it("names credentials to re-obtain and carries none of them", () => {
		const built = declaration();
		expect(built.reAuthenticate).toEqual(["github"]);
		expect(JSON.stringify(built)).not.toContain("gho_");
	});

	it("records what it did NOT carry, so the file cannot read as complete", () => {
		expect(declaration().notCarried).toEqual({
			history: 8,
			storage: 4,
			bytes: 575815,
			replicates: true,
		});
	});
});

describe("diffDeclarations", () => {
	it("returns all four per-key verdicts", () => {
		const diff = diffDeclarations(
			{ node: { name: "n1" }, surfaces: { web: { port: 4000 } }, processes: {} },
			declaration(),
		);
		const verdict = (key: string) => diff.keys.find((entry) => entry.key === key)?.verdict;
		expect(verdict("node")).toBe("aligned");
		expect(verdict("surfaces")).toBe("divergent");
		expect(verdict("processes")).toBe("node-only");
		expect(verdict("workspaces")).toBe("source-only");
	});

	it("calls identity UNCOMPARABLE when the seal cannot be opened by this build", () => {
		// The third state that stops the presence-read-as-health defect from returning. Reporting
		// `aligned` for the cleartext half while silently skipping the sealed half would claim an
		// agreement nothing established.
		const future = declaration();
		const diff = diffDeclarations(CONFIG, {
			...future,
			seal: { ...future.seal, custody: "peer" },
		});
		expect(diff.identity).toBe("uncomparable");
		expect(diff.aligned).toBe(false);
	});

	it("is aligned only when every key agrees AND identity is comparable", () => {
		const diff = diffDeclarations(CONFIG, declaration());
		expect(diff.keys.every((entry) => entry.verdict === "aligned")).toBe(true);
		expect(diff.aligned).toBe(true);
	});
});
