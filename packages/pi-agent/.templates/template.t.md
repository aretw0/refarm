<!-- mdt template — run `mdt update` to sync, `mdt check` in CI -->

<!-- {@env_vars} -->
| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | — | `anthropic` \| `ollama` \| `openai` \| any OpenAI-compat name |
| `LLM_DEFAULT_PROVIDER` | — | Personal sovereign default when `LLM_PROVIDER` unset |
| `LLM_MODEL` | provider default | Model ID override |
| `LLM_BASE_URL` | provider default | Base URL override (required for custom OpenAI-compat) |
| `ANTHROPIC_API_KEY` | — | Required when `LLM_PROVIDER=anthropic` |
| `OPENAI_API_KEY` | — | Required when `LLM_PROVIDER=openai` |
| `LLM_MAX_CONTEXT_TOKENS` | unlimited | Block prompts estimated above this token count |
| `LLM_FALLBACK_PROVIDER` | — | Retry with this provider on primary error or budget block |
| `LLM_BUDGET_<PROVIDER>_USD` | unlimited | Rolling 30-day cap, e.g. `LLM_BUDGET_ANTHROPIC_USD=5.0` |
| `LLM_HISTORY_TURNS` | `0` (disabled) | Conversational memory depth from CRDT — opt-in |
| `LLM_TOOL_CALL_MAX_ITER` | `5` | Max agentic tool loop iterations per prompt |
| `LLM_TOOL_OUTPUT_MAX_LINES` | unlimited | Truncate tool output at N lines before feeding back to LLM |
<!-- {/env_vars} -->
