# @refarm.dev/agent-bench

A **token regression-net for the agent** — the piece the maturity audit found
missing. The repo already senses *structural* and *performance* regression well
(conformance suites, `tractor-bench` with a 20% latency threshold, coverage
ratchet), but nothing sensed **token** regression: a change could quietly make the
agent burn more tokens for the same work (prompt caching stops marking, context
injection drifts back toward dumping content) and no gate would notice.

This mirrors `tractor-bench`'s shape — baseline JSON + percentage threshold + GHA
payload — but the metric is **tokens**, not latency.

## How it works

`agent-token-bench` drives the **real `agent.wasm`** (via the tractor `PluginHost`,
the same way the harness tests do) through a fixed, deterministic scenario against a
mock LLM with **known** token counts. It reads the `UsageRecord` the agent persists
and records the token totals. Because the mock counts are fixed, the signal is the
**delta the agent adds**: extra turns, extra usage records, and — as the metric set
grows — how much prefix it re-sends.

```bash
pnpm --filter @refarm.dev/agent-bench run bench:save   # establish the baseline
pnpm --filter @refarm.dev/agent-bench run bench:check  # fail if tokens regressed

# or across every package that has a bench, via the unified turbo task:
pnpm turbo run bench:check
```

`check` fails (exit 1) if any `lower_is_better` metric grew past its threshold — a
proven gate, not just a runner. Requires a built `agent.wasm` component
(`cargo component build --release -p agent`).

## Why a standalone crate (not inside tractor)

`packages/tractor/**` is a §8-protected surface (serialized lock/handoff). This
bench needs the same host machinery to load `agent.wasm`, so it depends on
`refarm-tractor` **as a library** — the same dependency the harness tests take —
rather than adding a `bin` inside the protected crate. The token regression-net is
its own thing, and adding it touches no protected code.

Its `Cargo.lock` is pinned from tractor's (especially `loro`) so the transitive
resolution matches the host it links against.

## Metrics (designed to grow)

| metric | unit | lower is better |
| --- | --- | --- |
| `tokens_in` | tokens | yes |
| `tokens_out` | tokens | yes |
| `usage_records` | records | yes (extra turns cost) |

Add a "prefix bytes re-sent" metric once the agent's cache accounting is read back,
and a multi-turn scenario to measure history growth.
