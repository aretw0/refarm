import { defaultProviderModelRef, defaultScopedModelRef } from "@refarm.dev/config";
import { describe, expect, it } from "vitest";
import { CHAT_HELP_TEXT, parseChatLine } from "./chat-repl.js";

describe("parseChatLine", () => {
	it("treats plain text as a message", () => {
		expect(parseChatLine("hello world")).toEqual({
			kind: "message",
			text: "hello world",
		});
	});

	it("trims whitespace from plain text", () => {
		expect(parseChatLine("  hi there  ")).toEqual({
			kind: "message",
			text: "hi there",
		});
	});

	it("empty line is an empty message", () => {
		expect(parseChatLine("")).toEqual({ kind: "message", text: "" });
	});

	it("parses /reload with no args", () => {
		expect(parseChatLine("/reload")).toEqual({ kind: "reload", pluginIds: [] });
	});

	it("parses /reload with a single plugin id", () => {
		expect(parseChatLine("/reload runtime-agent")).toEqual({
			kind: "reload",
			pluginIds: ["@refarm/agent"],
		});
	});

	it("accepts the short `agent` alias for /reload", () => {
		expect(parseChatLine("/reload agent")).toEqual({
			kind: "reload",
			pluginIds: ["@refarm/agent"],
		});
	});

	it("accepts `/r` as a short alias for /reload", () => {
		expect(parseChatLine("/r")).toEqual({ kind: "reload", pluginIds: [] });
	});

	it("accepts `/r` with plugin aliases", () => {
		expect(parseChatLine("/r runtime-agent")).toEqual({
			kind: "reload",
			pluginIds: ["@refarm/agent"],
		});
	});

	it("parses /reload with multiple plugin ids", () => {
		expect(parseChatLine("/reload runtime-agent other-plugin")).toEqual({
			kind: "reload",
			pluginIds: ["@refarm/agent", "other-plugin"],
		});
	});

	it("normalizes legacy agent aliases for /reload", () => {
		expect(parseChatLine("/reload agent")).toEqual({
			kind: "reload",
			pluginIds: ["@refarm/agent"],
		});
	});

	it("normalizes scoped package IDs for /reload", () => {
		expect(parseChatLine("/reload @refarm.dev/agent")).toEqual({
			kind: "reload",
			pluginIds: ["@refarm/agent"],
		});
	});

	// `/model` (and its `/provider` alias) now route to the model capability
	// GROUP: parseChatLine only splits tokens and tags the verb; the rich model
	// grammar (bare-ref → set, scope-first, --scope, reset, fallback, base-url)
	// lives in the group's surface-neutral `resolve` and is tested against
	// resolveModelGrammar in apps/refarm. Here we pin only the routing: the raw
	// argv reaches the capability verbatim, in order, unparsed.
	const CAPS = new Set(["model", "provider"]);

	it("routes /model to the model capability with raw argv", () => {
		expect(parseChatLine("/model", CAPS)).toEqual({
			kind: "capability",
			name: "model",
			argv: [],
		});
		expect(parseChatLine("/model current", CAPS)).toEqual({
			kind: "capability",
			name: "model",
			argv: ["current"],
		});
		expect(parseChatLine("/model openai/gpt-5.5", CAPS)).toEqual({
			kind: "capability",
			name: "model",
			argv: ["openai/gpt-5.5"],
		});
		expect(parseChatLine("/model worker openai/gpt-5.3-codex-spark", CAPS)).toEqual({
			kind: "capability",
			name: "model",
			argv: ["worker", "openai/gpt-5.3-codex-spark"],
		});
		expect(parseChatLine("/model set --scope monitor openai/gpt-5.5", CAPS)).toEqual({
			kind: "capability",
			name: "model",
			argv: ["set", "--scope", "monitor", "openai/gpt-5.5"],
		});
	});

	it("routes the /provider alias to the model capability", () => {
		expect(parseChatLine("/provider", CAPS)).toEqual({
			kind: "capability",
			name: "provider",
			argv: [],
		});
		expect(parseChatLine("/provider openai/gpt-5.5", CAPS)).toEqual({
			kind: "capability",
			name: "provider",
			argv: ["openai/gpt-5.5"],
		});
	});

	// `/providers` and `/models` remain top-level shortcuts for the providers
	// sub-action, resolved before the capability check (so they work with or
	// without the capability set registered).
	it("routes /providers and /models to model providers", () => {
		expect(parseChatLine("/providers")).toEqual({
			kind: "capability",
			name: "model",
			argv: ["providers"],
		});
		expect(parseChatLine("/models")).toEqual({
			kind: "capability",
			name: "model",
			argv: ["providers"],
		});
	});

	it("falls through to a message when the capability is not registered", () => {
		// Without the model capability in the set, an unknown /model is just text —
		// the built-in model branch no longer intercepts it.
		expect(parseChatLine("/model openai/gpt-5.5")).toEqual({
			kind: "message",
			text: "/model openai/gpt-5.5",
		});
	});

	it("parses runtime credential setup commands", () => {
		expect(parseChatLine("/login")).toEqual({ kind: "login", args: [] });
		expect(parseChatLine("/sow --model openai/gpt-5.5")).toEqual({
			kind: "login",
			args: ["--model", "openai/gpt-5.5"],
		});
		expect(parseChatLine("/sow --model 'openrouter/anthropic/claude-sonnet-4.6'")).toEqual({
			kind: "login",
			args: ["--model", "openrouter/anthropic/claude-sonnet-4.6"],
		});
		expect(parseChatLine("/keys")).toEqual({
			kind: "keys",
			action: "provider-keys",
		});
	});

	it("keeps quoted slash-command arguments intact", () => {
		expect(parseChatLine("/session 'daily driver'")).toEqual({
			kind: "session",
			prefix: "daily driver",
		});
		// The quote is stripped by the token splitter; the capability argv keeps the
		// unquoted value as one token (the model group parses it downstream).
		expect(
			parseChatLine("/model set --scope worker 'openai/gpt-5.3-codex-spark'", new Set(["model"])),
		).toEqual({
			kind: "capability",
			name: "model",
			argv: ["set", "--scope", "worker", "openai/gpt-5.3-codex-spark"],
		});
	});

	it("treats malformed quoted slash commands as messages", () => {
		expect(parseChatLine("/sow --model 'openai/gpt-5.5")).toEqual({
			kind: "message",
			text: "/sow --model 'openai/gpt-5.5",
		});
	});

	it("parses /new", () => {
		expect(parseChatLine("/new")).toEqual({ kind: "new" });
	});

	it("parses /exit", () => {
		expect(parseChatLine("/exit")).toEqual({ kind: "exit" });
	});

	it("parses /quit as exit", () => {
		expect(parseChatLine("/quit")).toEqual({ kind: "exit" });
	});

	it("parses /q as exit", () => {
		expect(parseChatLine("/q")).toEqual({ kind: "exit" });
	});

	it("parses /help", () => {
		expect(parseChatLine("/help")).toEqual({ kind: "help" });
	});

	it("parses /commands as help", () => {
		expect(parseChatLine("/commands")).toEqual({ kind: "help" });
	});

	it("parses /h as help", () => {
		expect(parseChatLine("/h")).toEqual({ kind: "help" });
	});

	it("parses /? as help", () => {
		expect(parseChatLine("/?")).toEqual({ kind: "help" });
	});

	it("parses /history", () => {
		expect(parseChatLine("/history")).toEqual({ kind: "history", action: "show" });
		expect(parseChatLine("/history --clear")).toEqual({
			kind: "history",
			action: "clear",
		});
		expect(parseChatLine("/history clear")).toEqual({
			kind: "history",
			action: "clear",
		});
	});

	it("parses /hist as history show", () => {
		expect(parseChatLine("/hist")).toEqual({ kind: "history", action: "show" });
	});

	it("parses /hist with clear aliases", () => {
		expect(parseChatLine("/hist --clear")).toEqual({
			kind: "history",
			action: "clear",
		});
		expect(parseChatLine("/hist clear")).toEqual({
			kind: "history",
			action: "clear",
		});
	});

	it("parses /clear as history clear", () => {
		expect(parseChatLine("/clear")).toEqual({
			kind: "history",
			action: "clear",
		});
	});

	it("parses /cls as history clear", () => {
		expect(parseChatLine("/cls")).toEqual({
			kind: "history",
			action: "clear",
		});
	});

	it("parses /status", () => {
		expect(parseChatLine("/status")).toEqual({ kind: "status" });
	});

	it("parses /s as status", () => {
		expect(parseChatLine("/s")).toEqual({ kind: "status" });
	});

	it("parses /session with prefix", () => {
		expect(parseChatLine("/session abc123")).toEqual({
			kind: "session",
			prefix: "abc123",
		});
	});

	it("parses /session without prefix as a session command", () => {
		expect(parseChatLine("/session")).toEqual({
			kind: "session",
			prefix: "",
		});
	});

	it("is case-insensitive for slash commands", () => {
		expect(parseChatLine("/RELOAD")).toEqual({ kind: "reload", pluginIds: [] });
		expect(parseChatLine("/Exit")).toEqual({ kind: "exit" });
	});

	it("treats unknown slash commands as plain messages", () => {
		expect(parseChatLine("/unknown")).toEqual({
			kind: "message",
			text: "/unknown",
		});
	});

	it("does not treat non-leading slash as command", () => {
		expect(parseChatLine("hello /world")).toEqual({
			kind: "message",
			text: "hello /world",
		});
	});

	it("documents runtime-oriented slash commands", () => {
		expect(CHAT_HELP_TEXT).toContain("Refarm runtime");
		expect(CHAT_HELP_TEXT).toContain("/reload agent");
		expect(CHAT_HELP_TEXT).toContain("/model providers");
		// DERIVED, never retyped. `chat-repl.ts` builds these three lines from
		// `defaultProviderModelRef`/`defaultScopedModelRef`; hardcoding their output here made
		// this test a second, quieter copy of the model catalogue, and it went stale the moment
		// the openai default moved (it was asserting gpt-5.5 while the help rendered
		// gpt-5.6-sol). What this test is FOR is that the line exists and names the right verb —
		// which model is the default is the catalogue's business and has its own drift guard
		// (scripts/ci/check-model-defaults-drift.mjs).
		expect(CHAT_HELP_TEXT).toContain(`/provider ${defaultProviderModelRef("openai")}`);
		expect(CHAT_HELP_TEXT).toContain(`/model worker ${defaultScopedModelRef("worker", "openai")}`);
		expect(CHAT_HELP_TEXT).toContain(
			`/model monitor ${defaultScopedModelRef("monitor", "openai")}`,
		);
		expect(CHAT_HELP_TEXT).toContain("/model reset worker");
		expect(CHAT_HELP_TEXT).toContain("/model base-url http://127.0.0.1:8000");
		expect(CHAT_HELP_TEXT).toContain("/model fallback ollama/llama3.2");
		expect(CHAT_HELP_TEXT).toContain("/providers");
		expect(CHAT_HELP_TEXT).toContain("/models");
		expect(CHAT_HELP_TEXT).toContain("/login [args...]");
		expect(CHAT_HELP_TEXT).toContain("/sow [args...]");
		expect(CHAT_HELP_TEXT).toContain("/keys");
		expect(CHAT_HELP_TEXT).toContain("/status");
		expect(CHAT_HELP_TEXT).toContain("/r");
		expect(CHAT_HELP_TEXT).toContain("/history [--clear|clear]");
		expect(CHAT_HELP_TEXT).toContain("/hist");
		expect(CHAT_HELP_TEXT).toContain("/cls");
		expect(CHAT_HELP_TEXT).toContain("/clear");
		expect(CHAT_HELP_TEXT).toContain("/session [prefix]");
		expect(CHAT_HELP_TEXT).toContain("/q");
		expect(CHAT_HELP_TEXT).toContain("/h");
		expect(CHAT_HELP_TEXT).toContain("/commands");
		expect(CHAT_HELP_TEXT).toContain("/?");
	});
});

describe("parseChatLine capability routing", () => {
	const names = new Set(["review"]);

	it("routes a registered capability slash with its argv", () => {
		expect(parseChatLine("/review ./ext --grant storage:v1", names)).toEqual({
			kind: "capability",
			name: "review",
			argv: ["./ext", "--grant", "storage:v1"],
		});
	});

	it("is case-insensitive on the capability name", () => {
		expect(parseChatLine("/Review ./ext", names)).toMatchObject({
			kind: "capability",
			name: "review",
		});
	});

	it("lets a built-in win over a same-named capability (never shadowed)", () => {
		// A built-in like /status is dispatched by the table before the registry.
		expect(parseChatLine("/status", new Set(["status"]))).toEqual({
			kind: "status",
		});
	});

	it("degrades an unregistered slash to a model message", () => {
		expect(parseChatLine("/frobnicate x", names)).toEqual({
			kind: "message",
			text: "/frobnicate x",
		});
	});

	it("without a capability set, an unknown slash is still a message", () => {
		expect(parseChatLine("/review ./ext")).toEqual({
			kind: "message",
			text: "/review ./ext",
		});
	});
});
