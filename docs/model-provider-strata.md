# Model Provider Strata

Refarm separates model providers by billing and credential semantics. This is a
runtime contract, not only a CLI presentation detail. Provider, credential, and
workspace-binding resolution happens below conversational and automation
surfaces: `refarm ask`, `refarm chat`, sessions, workers, monitors, and future
Telegram/PWA adapters are consumers of the same dispatch decision.

## API-key providers

API-key providers use public API billing and expose runtime credentials through
provider-specific API key variables, such as `OPENAI_API_KEY` or
`ANTHROPIC_API_KEY`.

Examples:

- `openai`: public OpenAI API pricing, `OPENAI_API_KEY`.
- `anthropic`: Anthropic API pricing, `ANTHROPIC_API_KEY`.
- `groq`, `mistral`, `gemini`, `xai`, `deepseek`, `together`, `openrouter`.
- `kimi-api`: Kimi Open Platform's public, pay-as-you-go API. This is distinct
  from the Kimi Code subscription and consumer Kimi membership.

These credentials can be exported to runtime tasks because the target runtime
adapter is expected to call the provider's public API.

## Subscription providers

Subscription providers use an operator account subscription or entitlement. They
must not be normalized into public API-key providers and must not be exported as
public API keys.

Examples:

- `openai-codex`: ChatGPT/Codex subscription login. Pi implements this by using
  OpenAI OAuth against `auth.openai.com` and sending Codex requests to
  `https://chatgpt.com/backend-api/codex/responses`, not to
  `https://api.openai.com/v1` with `OPENAI_API_KEY`.
- `github-copilot`: GitHub Copilot entitlement. Pi implements this by
  using GitHub device OAuth, exchanging that OAuth token for a Copilot internal
  token at `https://api.github.com/copilot_internal/v2/token`, and then using
  the Copilot API endpoint advertised by the returned token. That undocumented
  transport is a research reference, not Refarm's production contract. Pi's
  provider calls the model protocols directly and does not use Copilot CLI.
  GitHub's official Copilot SDK is a separate agent-runtime path over Copilot
  CLI and JSON-RPC; it is not a replacement implementation of the same raw
  provider adapter. Refarm evaluates both layers independently. Note that pi
  reaches that transport with another product's OAuth client id and VS Code
  version headers; the operator-facing consequences, and the fact that Copilot
  and GitHub platform access are two separate logins of one account, are in
  [`GITHUB_IDENTITY_SETUP.md`](GITHUB_IDENTITY_SETUP.md).

Subscription does not imply zero marginal cost. Current Copilot plans use AI
credits, included allowance, usage-based billing, and budgets; some legacy
individual plans still report premium requests. Those are quota/budget facts
scoped to an account, not static provider pricing.

`kimi-coding` is a separate potential subscription provider for Kimi Code. It
is not interchangeable with `kimi-api` and remains policy-gated because Kimi's
published benefit terms restrict unsupported clients.

References:

- Pi supported provider list:
  <https://github.com/earendil-works/pi/tree/main/packages/ai#supported-providers>
- Pi OpenAI Codex OAuth provider:
  <https://github.com/earendil-works/pi/blob/main/packages/ai/src/utils/oauth/openai-codex.ts>
- Pi OpenAI Codex responses provider:
  <https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/openai-codex-responses.ts>
- Pi GitHub Copilot OAuth provider:
  <https://github.com/earendil-works/pi/blob/main/packages/ai/src/utils/oauth/github-copilot.ts>
- GitHub Copilot SDK:
  <https://docs.github.com/en/copilot/how-tos/copilot-sdk/getting-started>
- GitHub Copilot billing:
  <https://docs.github.com/en/copilot/concepts/billing>
- Kimi API overview:
  <https://platform.kimi.ai/docs/api/overview>
- Account-aware provider design:
  [`superpowers/specs/2026-08-06-account-aware-copilot-kimi-providers-design.md`](./superpowers/specs/2026-08-06-account-aware-copilot-kimi-providers-design.md)

## Current Refarm contract

- `openai` and `openai-codex` are different providers.
- `OPENAI_API_KEY` satisfies `openai`.
- `OPENAI_CODEX_ACCESS_TOKEN` satisfies only the subscription credential check
  for `openai-codex`; it is not exported as `OPENAI_API_KEY`.
- `GITHUB_COPILOT_ACCESS_TOKEN` satisfies only the subscription credential check
  for `github-copilot`.
- Refarm's model dispatch blocks subscription-backed routes while no runtime
  adapter exists for the provider. `openai-codex` now has a runtime subscription adapter
  (Tractor `wasi_bridge` routes `/backend-api/codex/responses` with
  `OPENAI_CODEX_ACCESS_TOKEN`; it is listed in
  `RUNTIME_SUBSCRIPTION_MODEL_PROVIDERS`, so consumers may dispatch it).
  `github-copilot` remains blocked until its adapter exists.

This keeps quota failures legible. A 429 from `api.openai.com` means API billing
quota, not ChatGPT/Codex subscription quota. A subscription route must use the
subscription adapter.

Provider identity and credential identity are separate. Multiple named
credentials may exist for one provider, while node-owned workspace bindings
choose the credential used by a dispatch. An ambiguous provider must refuse;
last login, current working directory, and ambient credentials are not account
selectors.
