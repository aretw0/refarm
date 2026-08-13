import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	SOVEREIGN_WITNESS_FILES,
	captureWitnesses,
	compareWitnesses,
	formatWitnessReport,
	isBreach,
	readWitness,
	witnessedPaths,
} from "./sovereign-tripwire.mjs";

/**
 * A TRIPWIRE THAT HAS NEVER FIRED IS DECORATION. These trip it on purpose, in each of the three
 * ways the operator's configuration has been or could be damaged, and pin the two silences that
 * matter as much: an untouched run says nothing, and a file it could not read is not a breach.
 */
function makeHome() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-tripwire-"));
	for (const relative of SOVEREIGN_WITNESS_FILES) {
		const file = path.join(home, relative);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify({ tokens: { modelId: "gpt-5.5" } }));
	}
	return home;
}

test("an untouched run reports nothing at all", () => {
	const home = makeHome();
	try {
		const before = captureWitnesses(home);
		const changes = compareWitnesses(before, captureWitnesses(home));
		assert.deepEqual(changes, []);
		assert.equal(formatWitnessReport(changes), "");
		assert.equal(isBreach(changes), false);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("the ISS-121 incident trips it — a sentinel written into the live model route", () => {
	// The literal defect: a conformance test's probe value landing in the operator's silo. Before
	// this, nothing in the repository would have said so; a human found it days later by reading
	// `model doctor` output that looked wrong.
	const home = makeHome();
	try {
		const before = captureWitnesses(home);
		const silo = path.join(home, ".silo/identity.json");
		fs.writeFileSync(silo, JSON.stringify({ tokens: { modelId: "__refarm_ancestor_option_probe__" } }));
		const changes = compareWitnesses(before, captureWitnesses(home));
		assert.deepEqual(changes, [{ file: silo, change: "modified" }]);
		assert.equal(isBreach(changes), true);
		const report = formatWitnessReport(changes);
		assert.match(report, /SOVEREIGN TRIPWIRE/u);
		assert.match(report, /MODIFIED/u);
		assert.ok(report.includes(silo), "the report must name the file, not just the fact");
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("a DELETED config trips it too — the ISS-109 shape", () => {
	// ISS-109 removed a key rather than the file, but deletion is the same class and the cheaper
	// mistake to make: a suite that "cleans up" after itself against the real home.
	const home = makeHome();
	try {
		const before = captureWitnesses(home);
		const config = path.join(home, ".refarm/config.json");
		fs.rmSync(config);
		const changes = compareWitnesses(before, captureWitnesses(home));
		assert.deepEqual(changes, [{ file: config, change: "deleted" }]);
		assert.equal(isBreach(changes), true);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("a CREATED config trips it — a node that had none now has one it did not choose", () => {
	// The case on a fresh machine, which is the one an operator is least equipped to notice: there
	// was nothing to compare against, so a wrong file looks exactly like a first run.
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-tripwire-empty-"));
	try {
		const before = captureWitnesses(home);
		const silo = path.join(home, ".silo/identity.json");
		fs.mkdirSync(path.dirname(silo), { recursive: true });
		fs.writeFileSync(silo, "{}");
		const changes = compareWitnesses(before, captureWitnesses(home));
		assert.deepEqual(changes, [{ file: silo, change: "created" }]);
		assert.equal(isBreach(changes), true);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("an UNREADABLE file is reported and is NOT a breach", () => {
	// The third state. Failing the run because permissions changed would train an operator to
	// ignore the tripwire, which is worse than not having one; claiming success would make it
	// blind exactly when it cannot see.
	const home = makeHome();
	try {
		const file = witnessedPaths(home)[0];
		const before = [{ file, state: "unreadable", digest: null, reason: "EACCES" }];
		const changes = compareWitnesses(before, captureWitnesses(home));
		assert.deepEqual(changes, [{ file, change: "unverifiable", reason: "EACCES" }]);
		assert.equal(isBreach(changes), false);
		assert.match(formatWitnessReport(changes), /could not verify/u);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("readWitness separates absent from unreadable", () => {
	const home = makeHome();
	try {
		assert.equal(readWitness(path.join(home, ".silo/identity.json")).state, "present");
		assert.equal(readWitness(path.join(home, ".silo/nothing-here.json")).state, "absent");
		// A directory read as a file yields EISDIR, not ENOENT — an error that is not absence.
		const witness = readWitness(path.join(home, ".silo"));
		assert.equal(witness.state, "unreadable");
		assert.equal(witness.digest, null);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("it watches named files, and says which", () => {
	// The limit is part of the contract: a sovereign store nobody added here passes silently, so
	// a caller can print what is actually watched instead of assuming it is everything.
	const watched = witnessedPaths("/home/somebody");
	assert.deepEqual(watched, [
		"/home/somebody/.silo/identity.json",
		"/home/somebody/.refarm/config.json",
		// Both places a node database has been found — the live one and the one the Rust source
		// documents, which on the operator's node held a copy a week stale.
		"/home/somebody/.refarm/data/refarm/default.db",
		"/home/somebody/.local/share/refarm/default.db",
	]);
});
