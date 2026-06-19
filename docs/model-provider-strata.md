# Model Provider Strata

Refarm separates model providers by billing and credential semantics. This is a
runtime contract, not only a CLI presentation detail.

## API-key providers

API-key providers use public API billing and expose runtime credentials through
provider-specific API key variables, such as `OPENAI_API_KEY` or
`ANTHROPIC_API_KEY`.

Examples:

- `openai`: public OpenAI API pricing, `OPENAI_API_KEY`.
- `anthropic`: Anthropic API pricing, `ANTHROPIC_API_KEY`.
- `groq`, `mistral`, `gemini`, `xai`, `deepseek`, `together`, `openrouter`.

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
- `github-copilot`: GitHub Copilot subscription login. Pi implements this by
  using GitHub device OAuth, exchanging that OAuth token for a Copilot internal
  token at `https://api.github.com/copilot_internal/v2/token`, and then using
  the Copilot API endpoint advertised by the returned token.

References:

- Pi supported provider list:
  <https://github.com/earendil-works/pi/tree/main/packages/ai#supported-providers>
- Pi OpenAI Codex OAuth provider:
  <https://github.com/earendil-works/pi/blob/main/packages/ai/src/utils/oauth/openai-codex.ts>
- Pi OpenAI Codex responses provider:
  <https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/openai-codex-responses.ts>
- Pi GitHub Copilot OAuth provider:
  <https://github.com/earendil-works/pi/blob/main/packages/ai/src/utils/oauth/github-copilot.ts>

## Current Refarm contract

- `openai` and `openai-codex` are different providers.
- `OPENAI_API_KEY` satisfies `openai`.
- `OPENAI_CODEX_ACCESS_TOKEN` satisfies only the subscription credential check
  for `openai-codex`; it is not exported as `OPENAI_API_KEY`.
- `GITHUB_COPILOT_ACCESS_TOKEN` satisfies only the subscription credential check
  for `github-copilot`.
- `refarm ask` blocks subscription-backed routes until Refarm has an adapter
  that knows how to call the corresponding subscription endpoint.

This keeps quota failures legible. A 429 from `api.openai.com` means API billing
quota, not ChatGPT/Codex subscription quota. A subscription route must use the
subscription adapter.
