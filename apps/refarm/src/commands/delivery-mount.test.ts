import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import {
	couldNotAttempt,
	delivered,
	refused,
	type DeliveryAdapter,
	type DeliveryAdapterFactory,
	type DeliveryRequest,
} from "@refarm.dev/delivery-contract-v1";
import {
	createStdioOperatorChannel,
	currentPromptPublisher,
	type OperatorChannel,
} from "@refarm.dev/prompt-contract-v1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { askerForCommandPath, installDeclaredDelivery } from "./delivery-mount.js";

/**
 * THE LAST MILE, under test.
 *
 * `delivery.test.ts` proves the seam (catalog, routing, three outcomes) against a
 * hub a test constructed. This file proves the WIRING: that the refarm CLI mounts
 * that seam onto the channel every wizard already builds, that an operator who
 * declared nothing is running unchanged code, and that no notification failure
 * can reach the question.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

let workdir: string;
let mounts: Array<{ unmount(): void }>;

beforeEach(() => {
	workdir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-delivery-mount-"));
	mounts = [];
});

afterEach(() => {
	for (const mount of mounts) mount.unmount();
	fs.rmSync(workdir, { recursive: true, force: true });
	expect(currentPromptPublisher()).toBeNull();
});

function writeConfig(config: unknown): string {
	fs.mkdirSync(path.join(workdir, ".refarm"), { recursive: true });
	fs.writeFileSync(path.join(workdir, ".refarm", "config.json"), JSON.stringify(config));
	return workdir;
}

function declaring(overrides: Record<string, unknown> = {}): string {
	return writeConfig({
		delivery: {
			pocket: {
				adapter: "spy",
				capability: "answer",
				unattended: true,
				tokenEnv: "SPY_TOKEN",
				...overrides,
			},
		},
	});
}

/** A delivery adapter that touches no network and records what it was handed. */
function spyAdapter(
	options: {
		id?: string;
		capability?: "announce" | "answer";
		unattended?: boolean;
		announceOutcome?: (request: DeliveryRequest) => ReturnType<typeof delivered>;
		offerOutcome?: (request: DeliveryRequest) => ReturnType<typeof delivered>;
		throwOnOffer?: boolean;
	} = {},
) {
	const id = options.id ?? "spy";
	const capability = options.capability ?? "answer";
	const offered: DeliveryRequest[] = [];
	const announced: DeliveryRequest[] = [];
	let creations = 0;
	let sinkRef: { answer(value: string | boolean): boolean } | null = null;

	const adapter: DeliveryAdapter = {
		id,
		capability,
		unattended: options.unattended ?? true,
		async announce(request) {
			announced.push(request);
			return options.announceOutcome?.(request) ?? delivered(id, "announce", 1);
		},
	};
	if (capability === "answer") {
		adapter.offerAnswer = async (request, sink) => {
			offered.push(request);
			sinkRef = sink;
			if (options.throwOnOffer) throw new Error("socket hang up");
			return options.offerOutcome?.(request) ?? delivered(id, "answer", 1);
		};
	}

	const factory: DeliveryAdapterFactory = {
		id,
		create: () => {
			creations += 1;
			return adapter;
		},
	};
	return {
		factory,
		offered,
		announced,
		creations: () => creations,
		press: (value: string | boolean) => sinkRef?.answer(value) ?? false,
	};
}

/** A terminal that is not a terminal: enough for readline's line-based prompts. */
function fakeIo() {
	const input = new PassThrough() as PassThrough & NodeJS.ReadStream;
	const output = new PassThrough() as PassThrough & NodeJS.WriteStream;
	input.isTTY = false;
	output.isTTY = false;
	output.resume();
	return { input, output };
}

/**
 * A wizard. It knows about `OperatorChannel` and nothing else — no import, no
 * option, no channel name. Every assertion below drives THIS, unchanged.
 */
async function bringTheVpnUp(operator: OperatorChannel): Promise<boolean> {
	return operator.ask({ type: "confirm", question: "Bring the VPN up?" });
}

async function mount(options: Parameters<typeof installDeclaredDelivery>[0]) {
	const result = await installDeclaredDelivery(options);
	mounts.push(result);
	return result;
}

/** Let the hub's synchronous publish, and the delivery promise chain, run. */
async function settleMicrotasks(): Promise<void> {
	for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

// ── D1 — undeclared delivery changes NOTHING ──────────────────────────────────

describe("D1 — an operator who declared nothing is running unchanged code", () => {
	it("installs no publisher when there is no delivery block", async () => {
		const result = await mount({ asker: { command: "refarm auth enroll" }, root: workdir });
		expect(result.declared).toBe(false);
		expect(result.channels).toEqual([]);
		expect(result.hub).toBeNull();
		expect(currentPromptPublisher()).toBeNull();
	});

	it("the wizard's question goes to the terminal and nowhere else", async () => {
		const warnings: string[] = [];
		await mount({
			asker: { command: "refarm auth enroll" },
			root: workdir,
			warn: (message) => warnings.push(message),
		});
		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
		input.write("y\n");
		await expect(answer).resolves.toBe(true);
		expect(warnings).toEqual([]);
	});

	it("does not even construct an adapter — undeclared is inert, not merely quiet", async () => {
		const spy = spyAdapter();
		writeConfig({ surfaces: {}, workspaces: {} });
		await mount({
			asker: { command: "refarm auth enroll" },
			root: workdir,
			factories: [spy.factory],
		});
		expect(spy.creations()).toBe(0);
		expect(currentPromptPublisher()).toBeNull();
	});

	it("a config that cannot be read leaves the terminal working, and says so", async () => {
		fs.mkdirSync(path.join(workdir, ".refarm"), { recursive: true });
		fs.writeFileSync(path.join(workdir, ".refarm", "config.json"), "{ not json");
		const warnings: string[] = [];
		const result = await mount({
			asker: { command: "refarm auth enroll" },
			root: workdir,
			warn: (message) => warnings.push(message),
		});
		expect(result.hub).toBeNull();
		expect(currentPromptPublisher()).toBeNull();
		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
		input.write("y\n");
		await expect(answer).resolves.toBe(true);
	});

	it("a channel naming an unknown adapter is reported, and installs nothing", async () => {
		writeConfig({
			delivery: { pigeon: { capability: "announce", unattended: false } },
		});
		const warnings: string[] = [];
		const result = await mount({
			asker: { command: "refarm auth enroll" },
			root: workdir,
			factories: [],
			warn: (message) => warnings.push(message),
		});
		expect(result.declared).toBe(true);
		expect(result.channels).toEqual([]);
		expect(currentPromptPublisher()).toBeNull();
		expect(warnings.join()).toContain("pigeon");
	});
});

// ── D5 — the wizard gains reach with no code change ───────────────────────────

describe("D5 — the mount reaches a declared channel with no wizard change", () => {
	it("the question a wizard asked at the terminal also reaches the pocket", async () => {
		const spy = spyAdapter();
		const result = await mount({
			asker: { command: "refarm connection up" },
			root: declaring(),
			factories: [spy.factory],
			attending: () => false,
			env: { SPY_TOKEN: "irrelevant" },
		});
		expect(result.channels).toEqual(["pocket"]);

		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
		await settleMicrotasks();

		expect(spy.offered).toHaveLength(1);
		expect(spy.offered[0]!.question).toBe("Bring the VPN up?");
		expect(spy.offered[0]!.asker).toBe("refarm connection up");

		// …and the operator settles it from their pocket, never touching the terminal.
		expect(spy.press("true")).toBe(true);
		await expect(answer).resolves.toBe(true);
	});

	it("unmounting puts the process back exactly where it was", async () => {
		const spy = spyAdapter();
		const result = await mount({
			asker: { command: "refarm connection up" },
			root: declaring(),
			factories: [spy.factory],
		});
		expect(currentPromptPublisher()).not.toBeNull();
		result.unmount();
		result.unmount();
		expect(currentPromptPublisher()).toBeNull();

		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
		input.write("y\n");
		await expect(answer).resolves.toBe(true);
		expect(spy.offered).toHaveLength(0);
	});

	it("the asker label is the invocation the operator would recognise", () => {
		expect(askerForCommandPath(["auth", "enroll"]).command).toBe("refarm auth enroll");
		expect(askerForCommandPath([]).command).toBe("refarm");
		expect(askerForCommandPath(["auth"]).pid).toBe(process.pid);
	});

	it("declaring delivery puts NO deadline on a prompt that never had one", async () => {
		const spy = spyAdapter();
		await mount({
			asker: { command: "refarm connection up" },
			root: declaring(),
			factories: [spy.factory],
		});
		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
		await settleMicrotasks();
		// The remote peer must not carry `createRemoteOperatorChannel`'s ten-minute
		// default: a peered expiry ends BOTH sides, which would mean declaring a
		// notification channel silently timed out every terminal prompt.
		const pending = spy.offered[0]!;
		expect(pending.expiresAt).toBeNull();
		input.write("y\n");
		await expect(answer).resolves.toBe(true);
	});
});

// ── D4 — a delivery failure never becomes a prompt failure ────────────────────

describe("D4 — the question survives every way delivery can fail", () => {
	it("a transport that REFUSES leaves the prompt answerable at the terminal", async () => {
		const spy = spyAdapter({
			offerOutcome: (request) => refused("spy", "answer", 1, `no chat for ${request.promptId}`),
		});
		const warnings: string[] = [];
		await mount({
			asker: { command: "refarm connection up" },
			root: declaring(),
			factories: [spy.factory],
			warn: (message) => warnings.push(message),
		});

		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
		await settleMicrotasks();
		input.write("y\n");
		await expect(answer).resolves.toBe(true);
		await settleMicrotasks();
		expect(warnings.join()).toContain("could not be delivered");
	});

	it("an adapter that THROWS leaves the prompt answerable on the wire", async () => {
		const spy = spyAdapter({ throwOnOffer: true });
		const warnings: string[] = [];
		const result = await mount({
			asker: { command: "refarm connection up" },
			root: declaring(),
			factories: [spy.factory],
			warn: (message) => warnings.push(message),
		});

		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
		await settleMicrotasks();

		// The question is still standing on the hub the attending kit reads.
		const pending = result.hub!.list();
		expect(pending).toHaveLength(1);
		expect(result.hub!.answer(pending[0]!.id, false, "my-phone").ok).toBe(true);
		await expect(answer).resolves.toBe(false);
		expect(warnings.join()).toContain("could not be delivered");
	});

	it("the three outcomes are distinguishable in the record", async () => {
		const cases: Array<{
			outcome: (request: DeliveryRequest) => ReturnType<typeof delivered>;
			status: string;
		}> = [
			{ outcome: () => delivered("spy", "answer", 1), status: "delivered" },
			{ outcome: () => refused("spy", "answer", 1, "chat not found"), status: "refused" },
			{ outcome: () => couldNotAttempt("spy", "answer", 1, "network unreachable"), status: "could-not-attempt" },
		];

		for (const testCase of cases) {
			const spy = spyAdapter({ offerOutcome: testCase.outcome });
			const result = await mount({
				asker: { command: "refarm connection up" },
				root: declaring(),
				factories: [spy.factory],
				warn: () => {},
			});
			const { input, output } = fakeIo();
			const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
			await settleMicrotasks();
			const promptId = result.hub!.list()[0]!.id;
			await settleMicrotasks();

			const record = result.attachment!.recordFor(promptId);
			expect(record?.outcomes.map((entry) => entry.status)).toEqual([testCase.status]);
			expect(record?.reached).toBe(testCase.status === "delivered");

			result.hub!.answer(promptId, true, "my-phone");
			await expect(answer).resolves.toBe(true);
			result.unmount();
		}
	});
});

// ── D5 — THE ACCEPTANCE TEST, asserted on the real wizards ────────────────────

describe("D5 — no wizard gained a line about delivery", () => {
	/**
	 * The files the operator named as the measure of this design. Reading them is
	 * the only assertion that cannot be satisfied by a well-behaved mock: if
	 * delivery ever needs a wizard to cooperate, one of these paths grows the
	 * word, and this fails.
	 */
	const WIZARDS = [
		"apps/refarm/src/commands/auth.ts",
		"apps/refarm/src/commands/intention.ts",
		"apps/refarm/src/commands/init.ts",
		"apps/refarm/src/commands/sow.ts",
		"apps/refarm/src/commands/migrate.ts",
		"apps/refarm/src/credentials/model.ts",
		"apps/refarm/src/credentials/cloudflare.ts",
		"packages/operation-consent-v1/src/index.ts",
		"packages/farm-client/src/path-operation.mjs",
	];

	it.each(WIZARDS)("%s says nothing about delivery", (relative) => {
		const source = fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
		expect(source.toLowerCase()).not.toContain("deliver");
	});

	it("and the wizards that ask still go through the ONE join point", () => {
		const asking = WIZARDS.filter((relative) => relative !== "apps/refarm/src/commands/intention.ts");
		const joined = asking.filter((relative) => {
			const source = fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
			return source.includes("createStdioOperatorChannel") || source.includes("OperatorChannel");
		});
		// If a wizard ever stops building its channel this way, the mount stops
		// reaching it — silently. That would be the worst possible regression, so
		// the join point is asserted rather than assumed.
		expect(joined).toEqual(asking);
	});
});
