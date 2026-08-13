/**
 * PRESELECTING A MODEL PROVIDER, WITHOUT TAKING THE WORD "PROVIDER" FOR IT.
 *
 * ## Two axes, one word
 *
 * `refarm sow` configures CREDENTIAL providers — `model`, `github`, `cloudflare` — selected by
 * `--github` / `--cloudflare`, with model as the default. Inside the model flow there is a second,
 * unrelated set: the twelve MODEL providers (`openai-codex`, `anthropic`, `ollama`, …), chosen
 * from a picker.
 *
 * Both are called "provider". A bare `--provider` would name one of them today and become
 * ambiguous the first time a future credential provider — Telegram, an ERP, a corporate SSO — wants
 * the same flag. So the flag is `--model-provider`, matching the vocabulary the repository already
 * uses everywhere (`MODEL_PROVIDER`, `tokens.modelProvider`, `refarm model providers`,
 * `SUBSCRIPTION_MODEL_PROVIDERS`), and **`--provider` is left deliberately unclaimed**. Naming the
 * axis costs six characters once; discovering the collision costs a breaking change.
 *
 * ## Five outcomes, because "I do not know that one" is not the only way to fail
 *
 * The state worth having is `no-credential-flow`: a provider this repository KNOWS — it is in
 * `MODEL_PROVIDERS`, the runtime understands it, `refarm model providers` lists it — that has no
 * way to authenticate here yet. `github-copilot` is exactly that today, which is the operator's
 * corporate quota (ISS-122). Reporting it as "unknown provider" would send him to check his
 * spelling; the truth is that the login does not exist yet and there is a filed item saying so.
 */
// Through the app's own re-export (`src/model-routing.ts`) rather than the package subpath: the
// test alias resolves `@refarm.dev/config/model-routing` against the package entry and lands on
// `index.js/model-routing`, which is a file used as a directory.
import { MODEL_PROVIDERS } from "../model-routing.js";

export type ModelProviderSelection =
	/** Log in through this provider's OAuth flow. */
	| { readonly kind: "oauth"; readonly id: string }
	/** Ask for this provider's API key. */
	| { readonly kind: "api"; readonly id: string }
	/** Local, keyless. */
	| { readonly kind: "ollama" }
	/**
	 * Offers BOTH a subscription login and an API key, so the bare id does not say which.
	 *
	 * Not resolved by picking one. A subscription and a key are different accounts, different
	 * billing and different quotas — choosing silently is the same class of act as writing a value
	 * into the operator's configuration on his behalf.
	 */
	| { readonly kind: "ambiguous"; readonly id: string; readonly qualified: readonly string[] }
	/** A real model provider with no credential flow implemented here yet. */
	| { readonly kind: "no-credential-flow"; readonly id: string; readonly reason: string }
	/** Not a model provider this repository knows at all. */
	| { readonly kind: "unknown"; readonly id: string; readonly known: readonly string[] };

/** Suffixes that disambiguate a provider offering both paths. `:subscription` mirrors the picker's
 *  own label ("Subscription - …"), so the flag reads like the menu it replaces. */
const SUBSCRIPTION_SUFFIX = ":subscription";
const KEY_SUFFIX = ":key";

/**
 * PURE. Which credential path a `--model-provider` value names.
 *
 * The provider inventories are injected rather than imported so this can be tested against a fixed
 * world — and so a caller that has already loaded them does not load them twice.
 */
export function resolveModelProviderSelection(
	value: string,
	inventories: { oauth: readonly string[]; apiKey: readonly string[] },
): ModelProviderSelection {
	const raw = value.trim().toLowerCase();
	const qualifiedAs = raw.endsWith(SUBSCRIPTION_SUFFIX)
		? "oauth"
		: raw.endsWith(KEY_SUFFIX)
			? "api"
			: null;
	const id = qualifiedAs
		? raw.slice(0, raw.lastIndexOf(":"))
		: raw;

	const hasOauth = inventories.oauth.includes(id);
	const hasKey = inventories.apiKey.includes(id);

	if (qualifiedAs === "oauth") {
		return hasOauth
			? { kind: "oauth", id }
			: { kind: "unknown", id: raw, known: knownSelections(inventories) };
	}
	if (qualifiedAs === "api") {
		return hasKey ? { kind: "api", id } : { kind: "unknown", id: raw, known: knownSelections(inventories) };
	}

	if (id === "ollama") return { kind: "ollama" };
	if (hasOauth && hasKey) {
		return {
			kind: "ambiguous",
			id,
			qualified: [`${id}${SUBSCRIPTION_SUFFIX}`, `${id}${KEY_SUFFIX}`],
		};
	}
	if (hasOauth) return { kind: "oauth", id };
	if (hasKey) return { kind: "api", id };

	// KNOWN TO THE RUNTIME, UNAUTHENTICATABLE HERE. The distinction the operator needs: his
	// corporate Copilot quota is a real provider whose login has not been built, not a typo.
	if ((MODEL_PROVIDERS as readonly string[]).includes(id)) {
		return {
			kind: "no-credential-flow",
			id,
			reason:
				`"${id}" is a model provider refarm knows, but no login or key flow is implemented for it ` +
				"here yet — it cannot be configured from the wizard.",
		};
	}
	return { kind: "unknown", id: raw, known: knownSelections(inventories) };
}

/** PURE. Everything a `--model-provider` value may be, for an error message that can be acted on. */
export function knownSelections(inventories: {
	oauth: readonly string[];
	apiKey: readonly string[];
}): string[] {
	const both = inventories.oauth.filter((id) => inventories.apiKey.includes(id));
	const selections = new Set<string>(["ollama"]);
	for (const id of inventories.oauth) {
		if (both.includes(id)) selections.add(`${id}${SUBSCRIPTION_SUFFIX}`);
		else selections.add(id);
	}
	for (const id of inventories.apiKey) {
		if (both.includes(id)) selections.add(`${id}${KEY_SUFFIX}`);
		else selections.add(id);
	}
	return [...selections].sort();
}

/** PURE. The sentence printed when a selection cannot be honoured. Every branch names what to do
 *  next, because a rejection that only says "no" costs the operator another round trip. */
export function formatSelectionRefusal(selection: ModelProviderSelection): string | null {
	switch (selection.kind) {
		case "ambiguous":
			return (
				`"${selection.id}" offers both a subscription login and an API key, and they are ` +
				"different accounts with different quotas — say which:\n" +
				selection.qualified.map((value) => `  --model-provider ${value}`).join("\n")
			);
		case "no-credential-flow":
			return `${selection.reason}\n  refarm model providers  lists what the runtime understands.`;
		case "unknown":
			return (
				`"${selection.id}" is not a model provider this wizard can configure. Known values:\n` +
				`  ${selection.known.join(", ")}`
			);
		default:
			return null;
	}
}
