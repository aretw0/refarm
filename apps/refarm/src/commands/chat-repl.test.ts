import { describe, expect, it } from "vitest";
import { parseChatLine } from "./chat-repl.js";

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

	it("parses /reload", () => {
		expect(parseChatLine("/reload")).toEqual({ kind: "reload" });
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
		expect(parseChatLine("/RELOAD")).toEqual({ kind: "reload" });
		expect(parseChatLine("/Exit")).toEqual({ kind: "exit" });
	});

	it("treats unknown slash commands as plain messages", () => {
		expect(parseChatLine("/unknown")).toEqual({ kind: "message", text: "/unknown" });
	});

	it("does not treat non-leading slash as command", () => {
		expect(parseChatLine("hello /world")).toEqual({ kind: "message", text: "hello /world" });
	});
});
