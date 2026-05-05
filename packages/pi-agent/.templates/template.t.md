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
| `read_structured` | agent-fs | Parse JSON/TOML/YAML with pagination: `{path, format?, page_size?, page_offset?}` |
| `write_structured` | agent-fs | Validate then write JSON/TOML/YAML atomically — rejects invalid syntax before touching the file |
| `list_sessions` | CRDT | List all conversation sessions with id, name, leaf, and which is active |
| `current_session` | CRDT | Return metadata of the currently active session (id, leaf_entry_id) |
| `navigate` | CRDT | Move session pointer to a specific entry: `{session_id, entry_id}` |
| `fork` | CRDT | Branch a new session from an existing entry: `{session_id, entry_id, name?}` |
<!-- {/tools} -->

<!-- {@config_fields} -->
| Field | Maps to | Description |
|---|---|---|
| `provider` | `LLM_PROVIDER` | Active provider for this project |
| `model` | `LLM_MODEL` | Model ID override |
| `default_provider` | `LLM_DEFAULT_PROVIDER` | Sovereign default when provider unset |
| `stream_responses` | `LLM_STREAM_RESPONSES` | Explicit provider streaming opt-in/out (`true` → `1`, `false` → `0`) |
| `budgets.<provider>` | `LLM_BUDGET_<PROVIDER>_USD` | Rolling 30-day spend cap in USD |
| `trusted_plugins[]` | (host policy) | Optional allowlist for plugins allowed to use `agent-shell` |
<!-- {/config_fields} -->

<!-- {@env_vars} -->
| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | — | `anthropic` \| `openai` \| `groq` \| `mistral` \| `xai` \| `deepseek` \| `together` \| `openrouter` \| `gemini` \| `ollama` \| any OpenAI-compat name |
| `LLM_DEFAULT_PROVIDER` | — | Personal sovereign default when `LLM_PROVIDER` unset |
| `LLM_MODEL` | provider default | Model ID override |
| `LLM_BASE_URL` | provider default | Base URL override (required for custom OpenAI-compat) |
| `ANTHROPIC_API_KEY` | — | Required when `LLM_PROVIDER=anthropic` |
| `OPENAI_API_KEY` | — | Required when `LLM_PROVIDER=openai`; fallback for unknown compat providers |
| `GROQ_API_KEY` | — | Required when `LLM_PROVIDER=groq` |
| `MISTRAL_API_KEY` | — | Required when `LLM_PROVIDER=mistral` |
| `XAI_API_KEY` | — | Required when `LLM_PROVIDER=xai` |
| `DEEPSEEK_API_KEY` | — | Required when `LLM_PROVIDER=deepseek` |
| `TOGETHER_API_KEY` | — | Required when `LLM_PROVIDER=together` |
| `OPENROUTER_API_KEY` | — | Required when `LLM_PROVIDER=openrouter` |
| `GEMINI_API_KEY` | — | Required when `LLM_PROVIDER=gemini` |
| `LLM_MAX_CONTEXT_TOKENS` | unlimited | Block prompts estimated above this token count |
| `LLM_FALLBACK_PROVIDER` | — | Retry with this provider on primary error or budget block |
| `LLM_BUDGET_<PROVIDER>_USD` | unlimited | Rolling 30-day cap, e.g. `LLM_BUDGET_ANTHROPIC_USD=5.0` |
| `LLM_HISTORY_TURNS` | `0` (disabled) | Conversational memory depth from CRDT — opt-in |
| `LLM_TOOL_CALL_MAX_ITER` | `5` | Max agentic tool loop iterations per prompt |
| `LLM_TOOL_OUTPUT_MAX_LINES` | unlimited | Truncate tool output at N lines before feeding back to LLM; pipeline: strip ANSI → dedup → truncate |
| `LLM_SHELL_ALLOWLIST` | unset (permissive) | Comma-separated allowlist for `agent_shell::spawn`; if set, commands outside list are rejected with `[blocked: <cmd> not in allowlist]` |
| `LLM_FS_ROOT` | unset (permissive) | Restrict `agent_fs::{read,write,edit}` to this subtree; paths outside are rejected with `[blocked: path outside LLM_FS_ROOT]` |
| `LLM_SYSTEM` | built-in default | System prompt override — distros and stacks inject persona/role here without recompiling |
| `LLM_SESSION_ID` | — | Pin the active session by CRDT `@id`; auto-selects most recent session when unset |
<!-- {/env_vars} -->
