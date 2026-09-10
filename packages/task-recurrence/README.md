# @refarm.dev/task-recurrence

Generic **recurring-task expansion** for `task:v1`. A recurring spec (a title/body **template** + a
**schedule reference**) expands into a concrete, dated `task:v1` create-input — ready to hand to a
`TaskContractAdapter`. It is the write-side complement of the read-side source adapters: `source-oslc`
pulls work-items IN; this emits recurring work-items OUT.

- `resolveScheduleRef(ref, now)` — a neutral schedule token → a concrete date:
  `"today"` · `"next-weekday:N"` (0=Mon…6=Sun) · `"month-day:N"`.
- `expandTemplate(template, vars)` — `{key}` substitution; unknown keys left intact.
- `expandRecurringTask(spec, { now, deadline?, vars?, formatDate? })` — the full expansion to a
  `task:v1` create-input (title templated, `due_at_ns` from the deadline or the resolved date, status
  `pending`).

All functions are **pure** given an explicit `now` — never reads the clock — so expansion is
deterministic and testable.

## The sovereign boundary

Distilled from an operational vault's recurring-task generator (rcdc5's `almtask`). This package owns
only the **generic** kernel (schedule resolution + templating). The vendor vocabulary — a UST service
catalog, an effort→deadline calculation, one ALM's import-CSV columns — **stays with the consumer** as
product/config, mapped onto these neutral primitives. Refarm owns the generic; your vault owns the vocab.
