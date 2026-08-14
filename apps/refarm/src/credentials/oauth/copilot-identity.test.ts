import { describe, expect, it } from "vitest";

import {
	copilotRequestIdentity,
	describeCopilotIdentity,
	EDITOR_IMITATION,
	resolveCopilotIdentity,
} from "./copilot-identity.js";

const REFARM_CLIENT_ID = "Ov23-refarm";

describe("resolveCopilotIdentity", () => {
	it("defaults to refarm's OWN identity, so imitation is never reached by accident", () => {
		// Measured 2026-08-14: refarm's own identity gets HTTP 403 at the exchange. That is a worse
		// outcome than imitation and it is still the default, because the alternative is a node that
		// impersonates another product without anyone having decided to.
		expect(resolveCopilotIdentity(undefined)).toEqual({ kind: "refarm" });
		expect(resolveCopilotIdentity({})).toEqual({ kind: "refarm" });
		expect(resolveCopilotIdentity({ providers: {} })).toEqual({ kind: "refarm" });
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
				providers: { githubCopilot: { identity: "integration", integrationId: "refarm-cli" } },
			}),
		).toEqual({ kind: "integration", id: "refarm-cli" });
	});

	it("falls back to refarm's identity when `integration` is declared without an id", () => {
		// A half-declared integration must not silently become imitation, and must not send an empty
		// header. Falling back to the honest identity fails visibly at the exchange instead.
		expect(
			resolveCopilotIdentity({ providers: { githubCopilot: { identity: "integration" } } }),
		).toEqual({ kind: "refarm" });
	});

	it("treats an unrecognised value as refarm's identity rather than guessing", () => {
		expect(
			resolveCopilotIdentity({ providers: { githubCopilot: { identity: "vscode" } } }),
		).toEqual({ kind: "refarm" });
	});
});

describe("copilotRequestIdentity", () => {
	it("sends refarm's own client id and NO editor headers by default", () => {
		const identity = copilotRequestIdentity({ kind: "refarm" }, REFARM_CLIENT_ID, "0.1.0");
		expect(identity.clientId).toBe(REFARM_CLIENT_ID);
		expect(JSON.stringify(identity.headers)).not.toMatch(/vscode|GitHubCopilotChat|Editor-/iu);
		expect(identity.headers["User-Agent"]).toContain("refarm");
	});

	it("sends the editor's client id AND its headers when imitation is declared", () => {
		// Both halves or neither: the client id without the headers, or the reverse, is a shape no
		// real client sends, and a partial imitation is the worst of both — it impersonates AND it
		// does not work.
		const identity = copilotRequestIdentity({ kind: "editor-imitation" }, REFARM_CLIENT_ID, "0.1.0");
		expect(identity.clientId).toBe(EDITOR_IMITATION.clientId);
		expect(identity.headers["Copilot-Integration-Id"]).toBe("vscode-chat");
		expect(identity.headers["Editor-Version"]).toBeDefined();
		expect(identity.headers["User-Agent"]).not.toContain("refarm");
	});

	it("keeps refarm's own client id when an integration id is granted", () => {
		// An integration id authorises refarm's OWN identity at the endpoint. Pairing it with a
		// borrowed client id would be imitation wearing a licence.
		const identity = copilotRequestIdentity(
			{ kind: "integration", id: "refarm-cli" },
			REFARM_CLIENT_ID,
			"0.1.0",
		);
		expect(identity.clientId).toBe(REFARM_CLIENT_ID);
		expect(identity.headers["Copilot-Integration-Id"]).toBe("refarm-cli");
		expect(identity.headers["User-Agent"]).toContain("refarm");
		expect(JSON.stringify(identity.headers)).not.toMatch(/vscode|Editor-Version/iu);
	});
});

describe("describeCopilotIdentity", () => {
	it("says NOTHING for the honest identity, and says it loudly for imitation", () => {
		// A node that imitates in silence is a node nobody knows will break. This string is what
		// `credential list` and `model doctor` print.
		expect(describeCopilotIdentity({ kind: "refarm" })).toBeNull();
		const notice = describeCopilotIdentity({ kind: "editor-imitation" });
		expect(notice).toMatch(/imitat/iu);
		expect(notice).toMatch(/without notice|may be/iu);
	});

	it("names the integration id, because which authorisation is in use is worth knowing", () => {
		expect(describeCopilotIdentity({ kind: "integration", id: "refarm-cli" })).toContain(
			"refarm-cli",
		);
	});
});
