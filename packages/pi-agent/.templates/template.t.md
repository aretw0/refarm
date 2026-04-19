<!-- mdt template — run `mdt update` to sync, `mdt check` in CI -->

<!-- {@tools} -->
| Tool | Source | Description |
|---|---|---|
| `read_file` | agent-fs | Read file contents at absolute path |
| `write_file` | agent-fs | Write UTF-8 content to file atomically |
| `edit_file` | agent-fs read+write | Multi-edit: `{path, edits:[{old_str,new_str}]}` — exact match required, ambiguous matches rejected |
| `list_dir` | agent-shell (ls) | List files and directories at a path |
| `search_files` | agent-shell (grep) | Search for regex pattern in files; optional `glob` filter; returns `file:line` matches |
| `bash` | agent-shell | Run command via structured argv — no shell injection |
<!-- {/tools} -->

<!-- {@config_fields} -->
| Field | Maps to | Description |
|---|---|---|
| `provider` | `LLM_PROVIDER` | Active provider for this project |
| `model` | `LLM_MODEL` | Model ID override |
| `default_provider` | `LLM_DEFAULT_PROVIDER` | Sovereign default when provider unset |
| `budgets.<provider>` | `LLM_BUDGET_<PROVIDER>_USD` | Rolling 30-day spend cap in USD |
<!-- {/config_fields} -->

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
| `LLM_TOOL_OUTPUT_MAX_LINES` | unlimited | Truncate tool output at N lines before feeding back to LLM; pipeline: strip ANSI → dedup → truncate |
<!-- {/env_vars} -->
