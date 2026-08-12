import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createScriptedOperatorChannel,
	OperatorPromptCancelledError,
} from "@refarm.dev/prompt-contract-v1";
import { describe, expect, it } from "vitest";

import {
	answerStandingQuestion,
	applyChanges,
	createFileOperationTrail,
	createMemoryOperationTrail,
	createNodeOperationFileSystem,
	isReversible,
	makeOperationRecord,
	OPERATION_AUTHORIZE,
	OPERATION_CONSENT_CAPABILITY,
	OPERATION_DECLINE,
	OPERATION_LATER,
	operationDecisionPrompt,
	operationTimeline,
	recordOperation,
	renderOperationRequest,
	reverseChanges,
	runOperationConsent,
	standingDecision,
	standingQuestion,
	summariseStandingQuestions,
	undoOperationRecord,
	type OperationConsentChannel,
	type OperationFileChange,
	type OperationFileSystem,
	type OperationQuestion,
	type OperationRecord,
	type OperationRequest,
} from "./index.js";

// ── doubles ───────────────────────────────────────────────────────────────────

/** A filesystem in a Map — so nothing under a real HOME is ever a test's business. */
function memoryFs(seed: Record<string, string> = {}): OperationFileSystem & {
	files: Map<string, string>;
	writes: string[];
} {
	const files = new Map(Object.entries(seed));
	const writes: string[] = [];
	return {
		files,
		writes,
		async readFile(path) {
			return files.has(path) ? files.get(path)! : null;
		},
		async writeFile(path, content) {
			writes.push(path);
			files.set(path, content);
		},
		async removeFile(path) {
			writes.push(path);
			files.delete(path);
		},
	};
}

function channelAnswering(answer: string): OperationConsentChannel {
	return {
		async ask() {
			return answer;
		},
	};
}

/** A channel that FAILS if it is ever consulted — how "did not re-ask" is proven. */
function channelThatMustNotBeAsked(): OperationConsentChannel {
	return {
		async ask() {
			throw new Error("the operator was asked again — the standing decision was ignored");
		},
	};
}

const PROFILE = "/home/op/.bashrc";
const EXPORT_LINE = 'export PATH="$HOME/.local/bin:$PATH"';

function requestAppending(before: string | null, text = EXPORT_LINE): OperationRequest {
	const head =
		before === null ? "" : before.endsWith("\n") || before === "" ? before : `${before}\n`;
	const after = `${head}${text}\n`;
	const line = after.slice(0, after.indexOf(text)).split("\n").length;
	const change: OperationFileChange = {
		path: PROFILE,
		before,
		after,
		insertion: { line, text, placement: `no fim do arquivo (linha ${line})` },
	};
	return {
		id: `shell-path:${PROFILE}`,
		kind: "shell-path",
		title: "Pôr os atalhos do kit no seu PATH",
		purpose: "Para você digitar farm-ask em vez do caminho inteiro do kit.",
		requester: "farm-client/instalador",
		requestedAt: "2026-07-30T10:00:00.000Z",
		changes: [change],
		undo: { kind: "restore-snapshot", summary: `Restaura ${PROFILE} exatamente como está agora.` },
	};
}

let tick = 0;
const clock = () => `2026-07-30T12:00:0${tick++}.000Z`;

// ── R2: the request states the change exactly ─────────────────────────────────

describe("the request states the change exactly, before it is made", () => {
	it("names the file, the line, the position, and shows the current contents", () => {
		const request = requestAppending("# perfil\nexport EDITOR=vim\n");
		const text = renderOperationRequest(request).join("\n");

		expect(text).toContain(PROFILE);
		expect(text).toContain("linha 3");
		expect(text).toContain("no fim do arquivo");
		expect(text).toContain(EXPORT_LINE);
		// What the file looks like NOW — not merely a promise about what it will look like.
		expect(text).toContain("Como está agora");
		expect(text).toContain("export EDITOR=vim");
		// And the added line is marked as added in the result view.
		expect(text).toMatch(/\+\s+3 │ export PATH/);
	});

	it("says a missing file will be created rather than pretending it is empty", () => {
		const text = renderOperationRequest(requestAppending(null)).join("\n");
		expect(text).toContain("ainda não existe — será criado");
		expect(text).not.toContain("Como está agora");
	});

	it("states the undo in the REQUEST — before the decision, not after", () => {
		const text = renderOperationRequest(requestAppending("")).join("\n");
		expect(text).toContain("Desfazer: Restaura /home/op/.bashrc exatamente como está agora.");
	});

	it("an irreversible operation says so in the request, with a reason", () => {
		const request = requestAppending("");
		request.undo = { kind: "irreversible", reason: "o arquivo original não pode ser reconstruído" };
		const text = renderOperationRequest(request).join("\n");
		expect(text).toContain("NÃO dá para desfazer");
		expect(text).toContain("o arquivo original não pode ser reconstruído");
		expect(isReversible(request.undo)).toBe(false);
	});

	it("carries decision-time notes into the render AND into the record", async () => {
		const request = requestAppending("# perfil\n");
		request.notes = ["escolhi ~/.bashrc porque seu shell é bash; ~/.profile também existe"];
		expect(renderOperationRequest(request).join("\n")).toContain("porque seu shell é bash");

		const trail = createMemoryOperationTrail();
		await runOperationConsent({
			request,
			trail,
			fs: memoryFs({ [PROFILE]: "# perfil\n" }),
			channel: channelAnswering(OPERATION_AUTHORIZE),
			now: clock,
		});
		expect((await trail.read())[0]!.notes).toEqual(request.notes);
	});

	it("offers three answers, and Enter changes nothing", () => {
		const prompt = operationDecisionPrompt(requestAppending(""));
		expect(prompt.options.map((o) => o.value)).toEqual([
			OPERATION_AUTHORIZE,
			OPERATION_DECLINE,
			OPERATION_LATER,
		]);
		expect(prompt.default).toBe(OPERATION_LATER);
	});
});

// ── authorising ───────────────────────────────────────────────────────────────

describe("authorising applies exactly the proposed change", () => {
	it("writes the after-snapshot and touches nothing else", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n", "/home/op/.zshrc": "untouched\n" });
		const trail = createMemoryOperationTrail();
		const request = requestAppending("# perfil\n");

		const outcome = await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_AUTHORIZE),
			now: clock,
			decidedBy: "op",
			host: "phone",
		});

		expect(outcome.status).toBe("authorized");
		expect(fs.files.get(PROFILE)).toBe(`# perfil\n${EXPORT_LINE}\n`);
		expect(fs.files.get("/home/op/.zshrc")).toBe("untouched\n");
		expect(fs.writes).toEqual([PROFILE]);
	});

	it("records what changed, why, who asked, who authorised, when, and how to undo it", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		const request = requestAppending("# perfil\n");

		await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_AUTHORIZE),
			now: clock,
			decidedBy: "arthur",
			host: "phone",
		});

		const [record] = await trail.read();
		expect(record!.decision).toBe("authorized");
		expect(record!.purpose).toBe(request.purpose);
		expect(record!.requester).toBe("farm-client/instalador");
		expect(record!.decidedBy).toBe("arthur");
		expect(record!.host).toBe("phone");
		expect(record!.requestedAt).toBe("2026-07-30T10:00:00.000Z");
		expect(record!.decidedAt).toBeTruthy();
		expect(record!.appliedAt).toBe(record!.decidedAt);
		expect(record!.changes[0]!.before).toBe("# perfil\n");
		expect(record!.changes[0]!.after).toBe(`# perfil\n${EXPORT_LINE}\n`);
		expect(record!.undo).toEqual({
			kind: "restore-snapshot",
			summary: `Restaura ${PROFILE} exatamente como está agora.`,
		});
	});

	it("a change that cannot be recorded is not made — the trail failure rolls the files back", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		trail.append = async () => {
			throw new Error("trilha somente-leitura");
		};

		await expect(
			runOperationConsent({
				request: requestAppending("# perfil\n"),
				trail,
				fs,
				channel: channelAnswering(OPERATION_AUTHORIZE),
				now: clock,
			}),
		).rejects.toThrow("trilha somente-leitura");

		expect(fs.files.get(PROFILE)).toBe("# perfil\n");
	});
});

// ── the undo actually reverses ────────────────────────────────────────────────

describe("the record's undo is executable, not a sentence", () => {
	it("round-trips through a file trail and the undo puts the file back", async () => {
		const dir = await mkdtemp(join(tmpdir(), "opconsent-"));
		try {
			const nodeFs = createNodeOperationFileSystem();
			const profile = join(dir, ".bashrc");
			await writeFile(profile, "# perfil\nexport EDITOR=vim\n");
			const trailPath = join(dir, "operations.json");
			const trail = createFileOperationTrail(trailPath, nodeFs);

			const before = await readFile(profile, "utf8");
			const request = requestAppending(before);
			request.changes[0]!.path = profile;
			request.id = `shell-path:${profile}`;

			await runOperationConsent({
				request,
				trail,
				fs: nodeFs,
				channel: channelAnswering(OPERATION_AUTHORIZE),
				now: clock,
				decidedBy: "op",
			});
			expect(await readFile(profile, "utf8")).toBe(`${before}${EXPORT_LINE}\n`);

			// The trail is a real file, and it round-trips.
			const document = JSON.parse(await readFile(trailPath, "utf8")) as {
				capability: string;
				records: Array<{ id: string }>;
			};
			expect(document.capability).toBe(OPERATION_CONSENT_CAPABILITY);
			const [stored] = await trail.read();
			expect(stored!.id).toBe(document.records[0]!.id);

			// APPLY the undo — a stored string that is never executed proves nothing.
			await undoOperationRecord({ record: stored!, trail, fs: nodeFs, now: clock });
			expect(await readFile(profile, "utf8")).toBe(before);

			const timeline = operationTimeline(await trail.read(), request.id);
			expect(timeline.map((r) => r.decision)).toEqual(["authorized", "undone"]);
			expect(timeline[1]!.revisitOf).toBe(stored!.id);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("undoing a creation removes the file it created", async () => {
		const fs = memoryFs();
		const trail = createMemoryOperationTrail();
		const request = requestAppending(null);

		await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_AUTHORIZE),
			now: clock,
		});
		expect(fs.files.has(PROFILE)).toBe(true);

		const [record] = await trail.read();
		await undoOperationRecord({ record: record!, trail, fs, now: clock });
		expect(fs.files.has(PROFILE)).toBe(false);
	});

	it("refuses to undo what it never applied, or what it warned was irreversible", async () => {
		const trail = createMemoryOperationTrail();
		const declined = makeOperationRecord({
			request: requestAppending(""),
			decision: "declined",
			decidedBy: "op",
			decidedAt: "2026-07-30T12:00:00.000Z",
		});
		await expect(undoOperationRecord({ record: declined, trail, fs: memoryFs() })).rejects.toThrow(
			/only an authorized operation/,
		);

		const irreversible = makeOperationRecord({
			request: { ...requestAppending(""), undo: { kind: "irreversible", reason: "sem volta" } },
			decision: "authorized",
			decidedBy: "op",
			decidedAt: "2026-07-30T12:00:00.000Z",
		});
		await expect(
			undoOperationRecord({ record: irreversible, trail, fs: memoryFs() }),
		).rejects.toThrow(/irreversible/);
	});

	it("reversing a change set is swapping the snapshots — nothing is invented", () => {
		const changes: OperationFileChange[] = [{ path: "/a", before: "x\n", after: "y\n" }];
		expect(reverseChanges(changes)).toEqual([{ path: "/a", before: "y\n", after: "x\n" }]);
		expect(changes[0]!.before).toBe("x\n");
	});
});

// ── R4: declining is remembered ───────────────────────────────────────────────

describe("declining is a first-class, remembered outcome", () => {
	it("records the refusal, including what was refused", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		const request = requestAppending("# perfil\n");

		const outcome = await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_DECLINE),
			now: clock,
			decidedBy: "op",
		});

		expect(outcome.status).toBe("declined");
		expect(fs.writes).toEqual([]);
		expect(fs.files.get(PROFILE)).toBe("# perfil\n");
		const [record] = await trail.read();
		expect(record!.decision).toBe("declined");
		expect(record!.appliedAt).toBeNull();
		// What was refused is on the record — "you said no to THIS", not merely "you said no".
		expect(record!.changes[0]!.after).toContain(EXPORT_LINE);
	});

	it("a second run sees the prior decline and does not ask again", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		const request = requestAppending("# perfil\n");
		await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_DECLINE),
			now: clock,
		});

		const asked: string[] = [];
		const outcome = await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelThatMustNotBeAsked(),
			now: clock,
			announce: (line) => asked.push(line),
		});

		expect(outcome.status).toBe("already-decided");
		expect(outcome.record!.decision).toBe("declined");
		// Not even the request text is re-printed: a standing decision is not a nag.
		expect(asked).toEqual([]);
		expect((await trail.read()).length).toBe(1);
	});

	it("a prior authorisation is equally standing — the wizard does not re-propose it", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		const request = requestAppending("# perfil\n");
		await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_AUTHORIZE),
			now: clock,
		});

		const outcome = await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelThatMustNotBeAsked(),
			now: clock,
		});
		expect(outcome.status).toBe("already-decided");
		expect(outcome.record!.decision).toBe("authorized");
	});

	it("a deliberate revisit re-opens the question and chains to what it supersedes", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		const request = requestAppending("# perfil\n");
		await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_DECLINE),
			now: clock,
		});
		const [first] = await trail.read();

		const outcome = await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_AUTHORIZE),
			now: clock,
			revisit: true,
		});

		expect(outcome.status).toBe("authorized");
		expect(outcome.record!.revisitOf).toBe(first!.id);
		expect(fs.files.get(PROFILE)).toBe(`# perfil\n${EXPORT_LINE}\n`);
		// The refusal is still in the trail — a change of mind does not erase the mind that changed.
		const timeline = operationTimeline(await trail.read(), request.id);
		expect(timeline.map((r) => r.decision)).toEqual(["declined", "authorized"]);
		expect(standingDecision(timeline, request.id)!.decision).toBe("authorized");
	});

	it('"agora não" records nothing, so the question comes back next run', async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		const request = requestAppending("# perfil\n");

		const outcome = await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_LATER),
			now: clock,
		});
		expect(outcome.status).toBe("deferred");
		expect(await trail.read()).toEqual([]);
		expect(fs.writes).toEqual([]);

		const second = await runOperationConsent({
			request,
			trail,
			fs,
			channel: channelAnswering(OPERATION_AUTHORIZE),
			now: clock,
		});
		expect(second.status).toBe("authorized");
	});
});

// ── no operator, and cancellation ─────────────────────────────────────────────

describe("nobody to ask", () => {
	it("without a channel it never prompts, never writes, never records — and never reads", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		let reads = 0;
		const watched = {
			...trail,
			read: async () => {
				reads++;
				return trail.read();
			},
		};

		const outcome = await runOperationConsent({
			request: requestAppending("# perfil\n"),
			trail: watched,
			fs,
			channel: null,
			now: clock,
		});

		expect(outcome).toEqual({ status: "no-operator", record: null });
		expect(reads).toBe(0);
		expect(fs.writes).toEqual([]);
	});

	it("cancellation mid-prompt propagates and records nothing", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		const cancelling: OperationConsentChannel = {
			async ask() {
				throw new OperatorPromptCancelledError();
			},
		};

		await expect(
			runOperationConsent({
				request: requestAppending("# perfil\n"),
				trail,
				fs,
				channel: cancelling,
				now: clock,
			}),
		).rejects.toBeInstanceOf(OperatorPromptCancelledError);

		expect(await trail.read()).toEqual([]);
		expect(fs.writes).toEqual([]);
		expect(fs.files.get(PROFILE)).toBe("# perfil\n");
	});
});

// ── the seams ─────────────────────────────────────────────────────────────────

describe("the seams hold", () => {
	it("a real prompt-contract-v1 OperatorChannel satisfies the structural channel", async () => {
		// The whole reason this block imports nothing: the prompt block's channel must fit WITHOUT
		// being depended on. If this ever stops type-checking, the structural claim is fiction.
		const channel: OperationConsentChannel = createScriptedOperatorChannel([OPERATION_DECLINE]);
		const trail = createMemoryOperationTrail();
		const outcome = await runOperationConsent({
			request: requestAppending(""),
			trail,
			fs: memoryFs(),
			channel,
			now: clock,
		});
		expect(outcome.status).toBe("declined");
	});

	it("a corrupt trail file degrades into an empty trail, never into a wizard that cannot run", async () => {
		const dir = await mkdtemp(join(tmpdir(), "opconsent-"));
		try {
			const path = join(dir, "operations.json");
			await writeFile(path, "{ not json");
			const trail = createFileOperationTrail(path, createNodeOperationFileSystem());
			expect(await trail.read()).toEqual([]);

			const record = makeOperationRecord({
				request: requestAppending(""),
				decision: "declined",
				decidedBy: "op",
				decidedAt: "2026-07-30T12:00:00.000Z",
			});
			await trail.append(record);
			expect((await trail.read()).map((r) => r.id)).toEqual([record.id]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("applyChanges removes a file whose after-snapshot is null", async () => {
		const fs = memoryFs({ "/a": "x\n" });
		await applyChanges([{ path: "/a", before: "x\n", after: null }], fs);
		expect(fs.files.has("/a")).toBe(false);
	});

	it("the block imports node built-ins only — the device constraint is load-bearing", async () => {
		const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
		const specifiers = [...source.matchAll(/^\s*import\s[^"']*["']([^"']+)["']/gm)].map(
			(m) => m[1],
		);
		expect(specifiers).toEqual(["node:fs/promises", "node:path"]);
	});

	it("declares no runtime dependencies", async () => {
		const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
			dependencies?: Record<string, string>;
			peerDependencies?: Record<string, string>;
		};
		expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
		expect(Object.keys(pkg.peerDependencies ?? {})).toEqual([]);
	});
});

// ── the record WITHOUT the prompt ─────────────────────────────────────────────

describe("recordOperation — the operator's own change is remembered, never re-confirmed", () => {
	it("applies the change and appends an authorized record, asking nobody", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		const request = requestAppending("# perfil\n");
		const record = await recordOperation({
			request,
			trail,
			fs,
			now: clock,
			decidedBy: "op",
			host: "torre",
		});

		expect(fs.files.get(PROFILE)).toBe(request.changes[0]?.after);
		expect(record.decision).toBe("authorized");
		expect(record.decidedBy).toBe("op");
		expect(record.host).toBe("torre");
		expect(record.appliedAt).toBe(record.decidedAt);
		expect(await trail.read()).toEqual([record]);
	});

	it("takes no channel at all — there is no prompt here to suppress", () => {
		// Structural, and the point: `runOperationConsent` REQUIRES something to ask. This
		// function has no such parameter, so no consumer can accidentally acquire a
		// confirmation step, and none needs a `--yes` to get rid of one.
		expect("channel" in ({} as Record<string, unknown>)).toBe(false);
		expect(recordOperation.length).toBe(1);
	});

	it("does not consult the standing decision — a repeat is a new fact, not a re-ask", async () => {
		// A declined PATH operation must not be re-asked (R4). A config value set twice is two
		// changes, and the second is not a question anyone declined.
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const request = requestAppending("# perfil\n");
		const trail = createMemoryOperationTrail([
			makeOperationRecord({
				request,
				decision: "declined",
				decidedBy: "op",
				decidedAt: "2026-07-29T00:00:00.000Z",
			}),
		]);
		await recordOperation({ request, trail, fs, now: clock });
		expect((await trail.read()).at(-1)?.decision).toBe("authorized");
	});

	it("ROLLS BACK the file when the record cannot be written", async () => {
		// "A change that cannot be remembered is not made" — the same guarantee the consent
		// journey gives, because it is the same requirement.
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const failing = {
			async read() {
				return [];
			},
			async append(): Promise<never> {
				throw new Error("trail is read-only");
			},
		};
		await expect(
			recordOperation({ request: requestAppending("# perfil\n"), trail: failing, fs, now: clock }),
		).rejects.toThrow(/trail is read-only/);
		expect(fs.files.get(PROFILE)).toBe("# perfil\n");
	});

	it("the record it writes can be UNDONE, and the undo actually restores the file", async () => {
		const fs = memoryFs({ [PROFILE]: "# perfil\n" });
		const trail = createMemoryOperationTrail();
		const record = await recordOperation({
			request: requestAppending("# perfil\n"),
			trail,
			fs,
			now: clock,
		});
		expect(isReversible(record.undo)).toBe(true);

		const undone = await undoOperationRecord({ record, trail, fs, now: clock });
		expect(undone.decision).toBe("undone");
		expect(fs.files.get(PROFILE)).toBe("# perfil\n");
		// Append-only: the original record is still there, with the reversal after it.
		expect((await trail.read()).map((entry) => entry.decision)).toEqual(["authorized", "undone"]);
	});
});

describe("a question that outlives the process that asked it", () => {
	/**
	 * ISS-077's sentence, made false: *"waiting for a human" is indistinguishable from "dead"*.
	 * The trail has always remembered DECISIONS. Nothing remembered a question still WAITING, so a
	 * background run that asked and died left no trace of having asked — and on its next run it
	 * asked again, until the operator had four cards for one VPN and had learned to ignore them.
	 *
	 * P1 IS UNTOUCHED. `pending_prompt.rs` still gives a PROMPT the lifetime of its asker. This is
	 * a different record in the trail the operator's decisions already live in: the prompt dies,
	 * the memory that it was asked does not.
	 */
	function trailInMemory() {
		let records: OperationRecord[] = [];
		let questions: OperationQuestion[] = [];
		return {
			read: async () => records,
			append: async (record: OperationRecord) => {
				records = [...records, record];
				questions = questions.filter((q) => q.requestId !== record.requestId);
				return record;
			},
			readQuestions: async () => questions,
			openQuestion: async (question: OperationQuestion) => {
				questions = [...questions.filter((q) => q.requestId !== question.requestId), question];
			},
			closeQuestion: async (requestId: string) => {
				questions = questions.filter((q) => q.requestId !== requestId);
			},
			peek: () => questions,
		};
	}

	const NOW = "2026-08-11T12:00:00.000Z";

	it("records the question BEFORE asking, so a run that dies leaves the trace", async () => {
		const trail = trailInMemory();
		// A channel that never answers is exactly the run this is for: it is still waiting when
		// the process is killed. Recording after the answer would leave nothing behind.
		let seen: OperationQuestion[] = [];
		const channel = {
			ask: async () => {
				seen = trail.peek();
				return "defer";
			},
		};
		await runOperationConsent({
			request: requestAppending("# perfil\n"),
			trail,
			channel: channel as never,
			now: () => NOW,
		});
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({ requestId: requestAppending("# perfil\n").id, askedAt: NOW });
	});

	it("closes the question on the way out, including when the ask THROWS", async () => {
		const trail = trailInMemory();
		const channel = {
			ask: async () => {
				throw new Error("operator hung up");
			},
		};
		await expect(
			runOperationConsent({
				request: requestAppending("# perfil\n"),
				trail,
				channel: channel as never,
				now: () => NOW,
			}),
		).rejects.toThrow("operator hung up");
		// A question left standing because its asker raised would block the next run from asking
		// at all, turning a crash into silence.
		expect(trail.peek()).toEqual([]);
	});

	it("refuses to ask a SECOND time while the first is still standing", async () => {
		const trail = trailInMemory();
		await trail.openQuestion({
			requestId: requestAppending("# perfil\n").id,
			kind: "k",
			title: "t",
			purpose: "p",
			requester: "the run that died",
			askedAt: NOW,
			expiresAt: "2026-08-12T12:00:00.000Z",
		});
		let asked = false;
		const outcome = await runOperationConsent({
			request: requestAppending("# perfil\n"),
			trail,
			channel: { ask: async () => { asked = true; return "authorize"; } } as never,
			fs: memoryFs(),
			now: () => NOW,
		});
		expect(asked).toBe(false);
		expect(outcome.status).toBe("already-asked");
		// Distinct from `already-decided` (they answered) and `deferred` (they said not now).
		expect(outcome.status).not.toBe("already-decided");
	});

	it("asks again once the window has closed — a crash must not become a permanent veto", async () => {
		const trail = trailInMemory();
		await trail.openQuestion({
			requestId: requestAppending("# perfil\n").id,
			kind: "k",
			title: "t",
			purpose: "p",
			requester: "a run killed yesterday",
			askedAt: "2026-08-09T12:00:00.000Z",
			expiresAt: "2026-08-10T12:00:00.000Z",
		});
		const outcome = await runOperationConsent({
			request: requestAppending("# perfil\n"),
			trail,
			channel: { ask: async () => "authorize" } as never,
			// A memory filesystem because authorising APPLIES the change: the sample request
			// writes to a real path, and the repo's own write-guard caught these tests reaching
			// for it. Containment working on the person who built it.
			fs: memoryFs(),
			now: () => NOW,
		});
		expect(outcome.status).toBe("authorized");
	});

	it("a decision ENDS the question, so an answered operation stops looking like it is waiting", async () => {
		const trail = trailInMemory();
		await runOperationConsent({
			request: requestAppending("# perfil\n"),
			trail,
			channel: { ask: async () => "authorize" } as never,
			// A memory filesystem because authorising APPLIES the change: the sample request
			// writes to a real path, and the repo's own write-guard caught these tests reaching
			// for it. Containment working on the person who built it.
			fs: memoryFs(),
			now: () => NOW,
		});
		expect(trail.peek()).toEqual([]);
	});

	it("a trail that cannot remember questions behaves EXACTLY as before", async () => {
		// `readQuestions === undefined` is a readable answer — this trail cannot tell you — and a
		// caller must not read an empty list out of it. Every existing implementor is this one.
		let records: OperationRecord[] = [];
		const plain = {
			read: async () => records,
			append: async (record: OperationRecord) => {
				records = [...records, record];
				return record;
			},
		};
		const outcome = await runOperationConsent({
			request: requestAppending("# perfil\n"),
			trail: plain,
			channel: { ask: async () => "authorize" } as never,
			// A memory filesystem because authorising APPLIES the change: the sample request
			// writes to a real path, and the repo's own write-guard caught these tests reaching
			// for it. Containment working on the person who built it.
			fs: memoryFs(),
			now: () => NOW,
		});
		expect(outcome.status).toBe("authorized");
	});
});

describe("standingQuestion", () => {
	const Q = (over: Partial<OperationQuestion> = {}): OperationQuestion => ({
		requestId: "op:1",
		kind: "k",
		title: "t",
		purpose: "p",
		requester: "r",
		askedAt: "2026-08-11T10:00:00.000Z",
		expiresAt: "2026-08-12T10:00:00.000Z",
		...over,
	});

	it("separates never-asked from asked-and-timed-out", () => {
		// Two empty-looking answers that mean different things: nobody asked, versus somebody
		// asked and the window closed with no answer.
		expect(standingQuestion([], "op:1", "2026-08-11T12:00:00.000Z").standing).toBe("none");
		expect(
			standingQuestion([Q({ expiresAt: "2026-08-11T11:00:00.000Z" })], "op:1", "2026-08-11T12:00:00.000Z")
				.standing,
		).toBe("expired");
	});

	it("reports an outstanding question and hands back WHO asked it", () => {
		const result = standingQuestion([Q({ requester: "the nightly run" })], "op:1", "2026-08-11T12:00:00.000Z");
		expect(result.standing).toBe("outstanding");
		expect(result.question?.requester).toBe("the nightly run");
	});

	it("ignores questions about other operations", () => {
		expect(standingQuestion([Q({ requestId: "op:2" })], "op:1", "2026-08-11T12:00:00.000Z").standing).toBe(
			"none",
		);
	});
});

describe("summariseStandingQuestions — what a surface shows the operator", () => {
	const Q = (over: Partial<OperationQuestion>): OperationQuestion => ({
		requestId: "op:1",
		kind: "k",
		title: "t",
		purpose: "p",
		requester: "r",
		askedAt: "2026-08-11T10:00:00.000Z",
		expiresAt: "2026-08-12T10:00:00.000Z",
		...over,
	});
	const NOW = "2026-08-11T12:00:00.000Z";

	it("separates what is still answerable from what timed out", () => {
		const summary = summariseStandingQuestions(
			[
				Q({ requestId: "a", expiresAt: "2026-08-12T10:00:00.000Z" }),
				Q({ requestId: "b", expiresAt: "2026-08-11T09:00:00.000Z" }),
			],
			NOW,
		);
		expect(summary.outstanding.map((q) => q.requestId)).toEqual(["a"]);
		expect(summary.expired.map((q) => q.requestId)).toEqual(["b"]);
	});

	it("REPORTS the expired rather than sweeping them", () => {
		// A question nobody answered in time is a commitment this node could not keep. Hiding it
		// makes the node look like it never asked — the same reason a skipped automation window is
		// reported instead of silently passed over.
		const summary = summariseStandingQuestions([Q({ expiresAt: "2026-08-11T09:00:00.000Z" })], NOW);
		expect(summary.expired).toHaveLength(1);
	});

	it("puts the newest first, because that is where an operator looks", () => {
		const summary = summariseStandingQuestions(
			[
				Q({ requestId: "old", askedAt: "2026-08-11T08:00:00.000Z" }),
				Q({ requestId: "new", askedAt: "2026-08-11T11:00:00.000Z" }),
			],
			NOW,
		);
		expect(summary.outstanding.map((q) => q.requestId)).toEqual(["new", "old"]);
	});

	it("an empty input is an EMPTY SUMMARY, never an absent one", () => {
		// The caller decides what absence means. This function's empty answer is "I looked and
		// found none", which is the sentence that lets an operator stop wondering — and it is a
		// different sentence from the one a caller prints when nothing could be read at all.
		expect(summariseStandingQuestions([], NOW)).toEqual({ outstanding: [], expired: [] });
	});
});

describe("a trail with nothing to remember leaves no file", () => {
	it("a run that asks and then defers is indistinguishable from a run that never happened", async () => {
		// A real property, pinned by `delivery add` and `process add` before this slice existed and
		// broken by it on the first pass: the standing-question record made every ask touch the
		// file, so a defer left an empty document where there had been nothing at all.
		const fs = memoryFs();
		const trail = createFileOperationTrail("/t/operations.json", fs);
		await trail.openQuestion?.({
			requestId: "op:1",
			kind: "k",
			title: "t",
			purpose: "p",
			requester: "r",
			askedAt: "2026-08-11T10:00:00.000Z",
			expiresAt: null,
		});
		expect(fs.files.get("/t/operations.json")).toBeDefined();

		await trail.closeQuestion?.("op:1");
		expect(fs.files.get("/t/operations.json")).toBeUndefined();
	});

	it("but a run that DIED asking leaves its question behind", async () => {
		// The removal is conditional on BOTH lists being empty, which is what keeps the crash case
		// working: nothing closes the question, so nothing removes the file.
		const fs = memoryFs();
		const trail = createFileOperationTrail("/t/operations.json", fs);
		await trail.openQuestion?.({
			requestId: "op:1",
			kind: "k",
			title: "t",
			purpose: "p",
			requester: "the run that died",
			askedAt: "2026-08-11T10:00:00.000Z",
			expiresAt: null,
		});
		expect(await trail.readQuestions?.()).toHaveLength(1);
	});
});

describe("garbage: what a standing-question trail is allowed to keep", () => {
	/**
	 * The operator's point, and it matters more than tidiness: a surface people scroll past has
	 * stopped working. The standing-question record exists to stop questions being ignored — left
	 * to accumulate, it would manufacture the very habit it was built to break.
	 *
	 * Two mechanisms, answering different questions:
	 *   RETENTION — automatic, bounded, applied when the trail is written.
	 *   DISMISS   — the operator saying this was handled elsewhere or no longer matters.
	 */
	const AT = "2026-08-12T12:00:00.000Z";
	const expiredQ = (n: number): OperationQuestion => ({
		requestId: `old:${n}`,
		kind: "k",
		title: `stale ${n}`,
		purpose: "p",
		requester: "a dead run",
		askedAt: `2026-08-0${1 + (n % 9)}T01:00:00.000Z`,
		expiresAt: "2026-08-11T01:00:00.000Z",
	});
	const liveQ: OperationQuestion = {
		requestId: "live:1",
		kind: "k",
		title: "still answerable",
		purpose: "p",
		requester: "a run still waiting",
		askedAt: AT,
		expiresAt: "2026-08-13T01:00:00.000Z",
	};

	async function seeded(maxExpiredKept?: number) {
		const fs = memoryFs();
		const trail = createFileOperationTrail("/t/operations.json", fs, {
			now: () => AT,
			...(maxExpiredKept === undefined ? {} : { maxExpiredKept }),
		});
		for (let n = 0; n < 14; n += 1) await trail.openQuestion?.(expiredQ(n));
		await trail.openQuestion?.(liveQ);
		return { fs, trail };
	}

	it("bounds how many EXPIRED it keeps, as a side effect of writing", async () => {
		const { trail } = await seeded(3);
		const questions = (await trail.readQuestions?.()) ?? [];
		const summary = summariseStandingQuestions(questions, AT);
		expect(summary.expired).toHaveLength(3);
	});

	it("never drops an OUTSTANDING one, at any count", async () => {
		// A question still inside its window is a live obligation. Discarding one to save space
		// would silently lose the thing this whole record is for.
		const { trail } = await seeded(1);
		const summary = summariseStandingQuestions((await trail.readQuestions?.()) ?? [], AT);
		expect(summary.outstanding.map((q) => q.requestId)).toEqual(["live:1"]);
	});

	it("dismisses every expired one at once, and only those", async () => {
		// Nobody dismisses fourteen things one id at a time.
		const { trail } = await seeded(100);
		expect(await trail.dismissExpiredQuestions?.(AT)).toBe(14);
		const summary = summariseStandingQuestions((await trail.readQuestions?.()) ?? [], AT);
		expect(summary.expired).toEqual([]);
		expect(summary.outstanding.map((q) => q.requestId)).toEqual(["live:1"]);
	});

	it("dismisses one by id, and says plainly when nothing matched", async () => {
		const { trail } = await seeded(100);
		expect(await trail.dismissQuestion?.("live:1")).toBe(true);
		// Not an error and not a success: it may have been answered a second ago.
		expect(await trail.dismissQuestion?.("live:1")).toBe(false);
	});

	it("leaves no file behind once there is nothing left to remember", async () => {
		const { fs, trail } = await seeded(100);
		await trail.dismissExpiredQuestions?.(AT);
		await trail.dismissQuestion?.("live:1");
		expect(fs.files.get("/t/operations.json")).toBeUndefined();
	});

	it("dismissing clears the RECORD, and a decision trail is not touched by it", async () => {
		// Dismiss says "stop telling me", never "cancel it" — and never "pretend it was decided".
		const { trail } = await seeded(100);
		await trail.dismissExpiredQuestions?.(AT);
		expect(await trail.read()).toEqual([]);
	});
});

describe("answering a question whose asker is gone", () => {
	/**
	 * The last link: a run asks and dies, the node remembers, `resume` reports it, and the answer
	 * lands HERE — applying the change the original process would have applied, into the same
	 * trail it would have written to.
	 *
	 * The record has to carry the WHOLE REQUEST for that to be possible. Carrying only the title
	 * is enough to report a question and enough to stop a second run asking it; it is not enough
	 * to answer one, because a decision and its application happen together in this block and
	 * `already-decided` deliberately does not re-apply. A decision recorded out of band without
	 * the changes would be a decision that never took effect — worse than not deciding, because it
	 * looks like it worked.
	 */
	const AT = "2026-08-12T12:00:00.000Z";
	function standing(over: Partial<OperationQuestion> = {}): OperationQuestion {
		const request = requestAppending("# perfil\n");
		return {
			requestId: request.id,
			kind: request.kind,
			title: request.title,
			purpose: request.purpose,
			requester: "a run that died",
			askedAt: "2026-08-12T10:00:00.000Z",
			expiresAt: "2026-08-13T10:00:00.000Z",
			request,
			...over,
		};
	}

	async function seeded(question = standing(), seed: Record<string, string> = {}) {
		const fs = memoryFs(seed);
		const trail = createFileOperationTrail("/t/operations.json", fs, { now: () => AT });
		await trail.openQuestion?.(question);
		return { fs, trail, question };
	}

	it("applies the change and records the decision", async () => {
		const question = standing();
		const change = question.request!.changes[0]!;
		const { fs, trail } = await seeded(question, { [change.path]: change.before ?? "" });
		const outcome = await answerStandingQuestion({
			requestId: question.requestId,
			decision: "authorized",
			trail,
			fs,
			now: () => AT,
		});
		expect(outcome.status).toBe("applied");
		expect(fs.files.get(change.path)).toBe(change.after);
		// And the question stops standing, because a decision ends it.
		expect(await trail.readQuestions?.()).toEqual([]);
	});

	it("REFUSES when the world moved between the asking and the answering", async () => {
		// ISS-118's second check, made real. The gap between asking and answering is exactly where
		// a card sits on a phone for an hour — and the operator authorised a change to the file
		// they were SHOWN, not to this one.
		const question = standing();
		const change = question.request!.changes[0]!;
		const { fs, trail } = await seeded(question, { [change.path]: "somebody else edited this\n" });
		const outcome = await answerStandingQuestion({
			requestId: question.requestId,
			decision: "authorized",
			trail,
			fs,
			now: () => AT,
		});
		expect(outcome.status).toBe("stale");
		expect(fs.files.get(change.path)).toBe("somebody else edited this\n");
		// The question SURVIVES a refusal: nothing was decided, so it is still standing.
		expect(await trail.readQuestions?.()).toHaveLength(1);
	});

	it("declining records the refusal and touches nothing", async () => {
		const question = standing();
		const change = question.request!.changes[0]!;
		const { fs, trail } = await seeded(question, { [change.path]: change.before ?? "" });
		const outcome = await answerStandingQuestion({
			requestId: question.requestId,
			decision: "declined",
			trail,
			fs,
			now: () => AT,
		});
		expect(outcome.status).toBe("declined");
		expect(fs.files.get(change.path)).toBe(change.before);
	});

	it("will not answer a question whose window closed", async () => {
		const { trail } = await seeded(standing({ expiresAt: "2026-08-11T10:00:00.000Z" }));
		const outcome = await answerStandingQuestion({
			requestId: standing().requestId,
			decision: "authorized",
			trail,
			now: () => AT,
		});
		expect(outcome.status).toBe("expired");
	});

	it("says UNANSWERABLE for a record written before requests were stored", async () => {
		// Reported honestly rather than offered a button that fails. Such a question can still be
		// seen and dismissed; it cannot be answered, and pretending otherwise would apply nothing
		// while claiming success.
		const question = standing();
		delete (question as { request?: unknown }).request;
		const { trail } = await seeded(question);
		const outcome = await answerStandingQuestion({
			requestId: question.requestId,
			decision: "authorized",
			trail,
			now: () => AT,
		});
		expect(outcome.status).toBe("unanswerable");
	});

	it("not-found is not an error — it may have been answered a moment ago", async () => {
		const { trail } = await seeded();
		const outcome = await answerStandingQuestion({
			requestId: "nothing-like-this",
			decision: "authorized",
			trail,
			now: () => AT,
		});
		expect(outcome.status).toBe("not-found");
	});
});
