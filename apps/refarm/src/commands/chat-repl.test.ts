import { describe, expect, it } from "vitest";
import { CHAT_HELP_TEXT, parseChatLine } from "./chat-repl.js";

describe("parseChatLine", () => {
	it("treats plain text as a message", () => {
		expect(parseChatLine("hello world")).toEqual({ kind: "message", text: "hello world" });
	});

	it("trims whitespace from plain text", () => {
		expect(parseChatLine("  hi there  ")).toEqual({ kind: "message", text: "hi there" });
	});

	it("empty line is an empty message", () => {
		expect(parseChatLine("")).toEqual({ kind: "message", text: "" });
	});

	it("parses /reload with no args", () => {
		expect(parseChatLine("/reload")).toEqual({ kind: "reload", pluginIds: [] });
	});

	it("parses /reload with a single plugin id", () => {
		expect(parseChatLine("/reload pi-agent")).toEqual({
			kind: "reload",
			pluginIds: ["@refarm/pi-agent"],
		});
	});

	it("parses /reload with multiple plugin ids", () => {
		expect(parseChatLine("/reload pi-agent other-plugin")).toEqual({
			kind: "reload",
			pluginIds: ["@refarm/pi-agent", "other-plugin"],
		});
	});

	it("normalizes scoped package IDs for /reload", () => {
		expect(parseChatLine("/reload @refarm.dev/pi-agent")).toEqual({
			kind: "reload",
			pluginIds: ["@refarm/pi-agent"],
		});
	});

	it("parses /model as current model", () => {
		expect(parseChatLine("/model")).toEqual({ kind: "model", action: "current" });
		expect(parseChatLine("/model current")).toEqual({ kind: "model", action: "current" });
	});

	it("parses /model provider/model as a default route change", () => {
		expect(parseChatLine("/model openai/gpt-5.5")).toEqual({
			kind: "model",
			action: "set",
			scope: "default",
			ref: "openai/gpt-5.5",
		});
	});

	it("parses scoped /model route changes", () => {
		expect(parseChatLine("/model worker openai/gpt-5.3-codex-spark")).toEqual({
			kind: "model",
			action: "set",
			scope: "worker",
			ref: "openai/gpt-5.3-codex-spark",
		});
		expect(parseChatLine("/model set --scope monitor openai/gpt-5.5")).toEqual({
			kind: "model",
			action: "set",
			scope: "monitor",
			ref: "openai/gpt-5.5",
		});
	});

	it("parses runtime credential setup commands", () => {
		expect(parseChatLine("/login")).toEqual({ kind: "login", args: [] });
		expect(parseChatLine("/sow --model openai/gpt-5.5")).toEqual({
			kind: "login",
			args: ["--model", "openai/gpt-5.5"],
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

	it("parses /help", () => {
		expect(parseChatLine("/help")).toEqual({ kind: "help" });
	});

	it("parses /session with prefix", () => {
		expect(parseChatLine("/session abc123")).toEqual({ kind: "session", prefix: "abc123" });
	});

	it("treats /session without prefix as plain message", () => {
		expect(parseChatLine("/session")).toEqual({ kind: "message", text: "/session" });
	});

	it("is case-insensitive for slash commands", () => {
		expect(parseChatLine("/RELOAD")).toEqual({ kind: "reload", pluginIds: [] });
		expect(parseChatLine("/Exit")).toEqual({ kind: "exit" });
	});

	it("treats unknown slash commands as plain messages", () => {
		expect(parseChatLine("/unknown")).toEqual({ kind: "message", text: "/unknown" });
	});

	it("does not treat non-leading slash as command", () => {
		expect(parseChatLine("hello /world")).toEqual({ kind: "message", text: "hello /world" });
	});

	it("documents runtime-oriented slash commands", () => {
		expect(CHAT_HELP_TEXT).toContain("Refarm runtime");
		expect(CHAT_HELP_TEXT).toContain("/reload pi-agent");
		expect(CHAT_HELP_TEXT).toContain("/model worker <ref>");
		expect(CHAT_HELP_TEXT).toContain("/login [args...]");
	});
});
