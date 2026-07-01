# Research: external reference - RTK (2026-07-01)

> Reference/influence note. RTK is a lesson source for command-output mediation,
> not a dependency decision and not product copy for `apps/refarm` or `apps/dev`.

## Source

- Repository: <https://github.com/rtk-ai/rtk>
- README: <https://github.com/rtk-ai/rtk/blob/develop/README.md>
- Architecture: <https://github.com/rtk-ai/rtk/blob/develop/docs/contributing/ARCHITECTURE.md>
- Telemetry note: <https://github.com/rtk-ai/rtk/blob/develop/docs/TELEMETRY.md>

## What RTK is

RTK is a Rust CLI proxy that sits between AI coding agents and common developer
commands. It runs the original command, preserves the essential signal, and
returns a compact representation to the model. Its public positioning emphasizes
four useful ideas for Refarm:

- command-specific filters rather than one generic summarizer;
- exit-code preservation so compact output does not break automation;
- a raw-output recovery path for failures and verbose inspection;
- local analytics that show adoption and weak filters, with telemetry opt-in.

The strongest insight is not "install RTK." It is that an agent platform needs a
first-class **observation membrane** between tools and model context. Raw output
is often too expensive, too noisy, and sometimes too risky to stream directly
into an agent. Compact output must remain reversible enough for debugging.

## Refarm assimilation map

| RTK lesson | Refarm home | Boundary |
|---|---|---|
| Command-specific output filters | `process-handoff`, `task-contract-v1`, future command-observation contract | contract first, not app copy |
| Failure-focused test/build summaries | finish lanes, `quality-gate`, release-engine handoffs | preserve exit codes and failed command |
| Raw-output tee for failures | task/session artifacts, source-local storage, Silo-backed private logs later | compact output is the prompt surface; raw output is retrievable evidence |
| Verbosity tiers | CLI JSON handoffs and runtime tool events | no hidden global shell mutation as the required path |
| Savings/adoption analytics | local `health`/`doctor`/capability-index metrics | opt-in/exportable, no server telemetry by default |
| Multi-agent integration adapters | plugin/hook profiles, not `apps/refarm` | each agent surface can opt into a mediation profile |

## Immediate implications

1. **Name the primitive before building it.** The durable Refarm primitive is not
   "token killer"; it is closer to `command-observation:v1` or
   `tool-observation:v1`: raw command, compact view, failure focus, raw artifact
   pointer, exit status, elapsed time, and policy/redaction metadata.

2. **Keep it provider-neutral.** RTK supports many AI tools by adapting to their
   hook/plugin surfaces. Refarm should keep the core shape independent of Codex,
   Claude, Pi, Hermes, or the Refarm app. Agent-specific wiring belongs in
   adapters/plugins.

3. **Do not require global shell rewriting.** Auto-rewrite is useful as an
   optional operator convenience, but Refarm's reference path should be explicit
   JSON/tool handoffs. The operator must be able to see when output was filtered,
   where raw evidence lives, and what policy was applied.

4. **Treat compact output as evidence, not truth.** RTK's fail-safe posture maps
   well to Refarm's verification-as-completion direction: a compact summary may
   unblock the model, but completion still needs inspectable source evidence.

5. **Use command-native structured formats first.** RTK's architecture prefers
   JSON/NDJSON/state-machine parsing when a tool exposes reliable structure.
   Refarm should do the same before adding broad text heuristics.

## Candidate slices

1. **Spec-only first pass:** add a `tool-observation:v1` or
   `command-observation:v1` feature spec that models compact view + raw evidence
   + exit status + redaction policy.

2. **Finish-lane proof:** have one existing finish/quality lane produce a compact
   observation envelope while preserving the current command and exit behavior.

3. **Raw evidence storage proof:** store long failure output as a local artifact
   and return only the artifact pointer plus focused failure summary in JSON
   handoffs.

4. **Discovery proof:** expose observation support through capability-index so
   downstream consumers can opt into compact command views without importing the
   runtime agent.

## Non-goals

- No dependency on RTK for v0.1.0 publication.
- No product copy inside `apps/dev`, `apps/refarm`, or future public site.
- No telemetry server.
- No irreversible shell hook as the default Refarm workflow.
- No replacement for existing `refarm resume/check/finish` handoffs.

## Relationship to current roadmap

RTK reinforces, but does not replace, current priorities:

- **ADR-078:** less raw output and clearer resource ceilings both serve the same
  "do not damage the working environment" goal.
- **Reference driver:** compact observations improve daily-driver ergonomics
  without promoting runtime fanout.
- **Verification-as-completion:** filtered output must point back to durable raw
  evidence when the source of truth matters.
- **GitHub Actions stabilization:** compact local observations can make CI
  failures easier to triage, but GitHub Actions remains the final confirmation
  signal before release PRs.

Verdict: assimilate RTK as an observation-membrane reference. The first useful
Refarm artifact should be a contract/spec and one finish-lane proof, not a new
global command proxy.
