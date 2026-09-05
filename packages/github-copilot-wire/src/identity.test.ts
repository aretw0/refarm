import { describe, expect, it } from "vitest";

import {
	copilotRequestIdentity,
	describeCopilotIdentity,
	EDITOR_IMITATION,
	resolveCopilotIdentity,
} from "./identity.js";

const OWN_CLIENT_ID = "Ov23-own";
const OWN_USER_AGENT = "acme-cli/0.1.0";

describe("resolveCopilotIdentity", () => {
	it("defaults to the caller's OWN identity, so imitation is never reached by accident", () => {
		// Measured 2026-08-14: a self-registered identity gets HTTP 403 at the exchange. That is a worse
		// outcome than imitation and it is still the default, because the alternative is a node that
		// impersonates another product without anyone having decided to.
		expect(resolveCopilotIdentity(undefined)).toEqual({ kind: "own" });
		expect(resolveCopilotIdentity({})).toEqual({ kind: "own" });
		expect(resolveCopilotIdentity({ providers: {} })).toEqual({ kind: "own" });
	});

	it("honours a declared imitation, which is the operator accepting a stated risk", () => {
		expect(
			resolveCopilotIdentity({ providers: { githubCopilot: { identity: "editor-imitation" } } }),
		).toEqual({ kind: "editor-imitation" });
	});

	it("honours a granted integration id, which needs no code path of its own", () => {
		// The whole point of the profile: when GitHub grants an id, it is a VALUE, not a new branch.
		expect(
			resolveCopilotIdentity({
				providers: { githubCopilot: { identity: "integration", integrationId: "acme-cli" } },
			}),
		).toEqual({ kind: "integration", id: "acme-cli" });
	});

	it("falls back to the caller's own identity when `integration` is declared without an id", () => {
		// A half-declared integration must not silently become imitation, and must not send an empty
		// header. Falling back to the honest identity fails visibly at the exchange instead.
		expect(
			resolveCopilotIdentity({ providers: { githubCopilot: { identity: "integration" } } }),
		).toEqual({ kind: "own" });
	});

	it("treats an unrecognised value as the caller's own identity rather than guessing", () => {
		expect(
			resolveCopilotIdentity({ providers: { githubCopilot: { identity: "vscode" } } }),
		).toEqual({ kind: "own" });
	});
});

describe("copilotRequestIdentity", () => {
	it("sends the CALLER's own client id and user-agent, and NO editor headers, by default", () => {
		// The user agent is INJECTED, not built here: a provider adapter that named one consumer
		// could not be used by another, and this package must not know who ships it.
		const identity = copilotRequestIdentity({ kind: "own" }, OWN_CLIENT_ID, OWN_USER_AGENT);
		expect(identity.clientId).toBe(OWN_CLIENT_ID);
		expect(JSON.stringify(identity.headers)).not.toMatch(/vscode|GitHubCopilotChat|Editor-/iu);
		expect(identity.headers["User-Agent"]).toBe(OWN_USER_AGENT);
	});

	it("sends the editor's client id AND its headers when imitation is declared", () => {
		// Both halves or neither: the client id without the headers, or the reverse, is a shape no
		// real client sends, and a partial imitation is the worst of both — it impersonates AND it
		// does not work.
		const identity = copilotRequestIdentity({ kind: "editor-imitation" }, OWN_CLIENT_ID, OWN_USER_AGENT);
		expect(identity.clientId).toBe(EDITOR_IMITATION.clientId);
		expect(identity.headers["Copilot-Integration-Id"]).toBe("vscode-chat");
		expect(identity.headers["Editor-Version"]).toBeDefined();
		// The caller's own name must be GONE, not merely accompanied: a user agent naming both is
		// a shape no real client sends.
		expect(identity.headers["User-Agent"]).not.toBe(OWN_USER_AGENT);
	});

	it("keeps the CALLER's own client id when an integration id is granted", () => {
		// An integration id authorises the caller's OWN identity at the endpoint. Pairing it with a
		// borrowed client id would be imitation wearing a licence.
		const identity = copilotRequestIdentity(
			{ kind: "integration", id: "acme-cli" },
			OWN_CLIENT_ID,
			OWN_USER_AGENT,
		);
		expect(identity.clientId).toBe(OWN_CLIENT_ID);
		expect(identity.headers["Copilot-Integration-Id"]).toBe("acme-cli");
		expect(identity.headers["User-Agent"]).toBe(OWN_USER_AGENT);
		expect(JSON.stringify(identity.headers)).not.toMatch(/vscode|Editor-Version/iu);
	});
});

describe("describeCopilotIdentity", () => {
	it("says NOTHING for the honest identity, and says it loudly for imitation", () => {
		// A node that imitates in silence is a node nobody knows will break. This string is what
		// `credential list` and `model doctor` print.
		expect(describeCopilotIdentity({ kind: "own" })).toBeNull();
		const notice = describeCopilotIdentity({ kind: "editor-imitation" });
		expect(notice).toMatch(/imitat/iu);
		expect(notice).toMatch(/without notice|may be/iu);
	});

	it("names the integration id, because which authorisation is in use is worth knowing", () => {
		expect(describeCopilotIdentity({ kind: "integration", id: "acme-cli" })).toContain(
			"acme-cli",
		);
	});
});
