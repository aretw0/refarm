# @refarm.dev/playbook

A declarative, multi-step **playbook**: sequence capability/plugin verbs, and thread each
step's output into the next. This is the thin layer above refarm's canonical execution spine —
it does **not** run anything itself. Its steps compile to dispatch requests that the caller
runs through the canonical `dispatch → Effort → dispatch_to_plugin` protocol. So the playbook
is pure data + a pure interpreter; the real runtime, the agent-tool surface, and the
trigger/schedule layer stay exactly as they are.

## Why this layer

refarm already has the execution spine: an `Effort` is `{ direction, tasks: Task[] }`, tasks
run through one canonical dispatch protocol (shared by the `dispatch` command, SPI
`call_plugin`, and the agent's `invoke_tool` leg), and `automation-contract-v1` triggers
Efforts. What was missing is a **sequence of verb calls that threads structured data between
steps** — an Effort's tasks run independently (no output→input), and `delegate_chain` threads
only text between sub-agent turns. This package is that missing piece, and nothing else.

## The shape

```json
{
  "name": "scrape-and-store",
  "steps": [
    { "verb": "source:pull",   "with": { "ref": "{{ input.ref }}" }, "saveAs": "pulled" },
    { "verb": "records:store", "with": { "records": "{{ pulled.records }}" } }
  ]
}
```

- **`verb`** — `"<pluginId>:<verb>"`, the canonical dispatch target.
- **`with`** — the args. A string that is exactly `{{ path }}` resolves to the **raw value**
  (arrays/objects pass through with their type); embedded `{{ path }}` does string
  substitution. Paths resolve against `input` (the initial input) and any earlier step's
  `saveAs` binding.
- **`saveAs`** — bind this step's result under a name for later steps to reference.

## Usage

```ts
import { parsePlaybook, runPlaybook, type DispatchStep } from "@refarm.dev/playbook";

const parsed = parsePlaybook(docFromJsonOrYaml);
if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));

// `dispatch` is how each verb actually runs. In production it builds a dispatch Effort
// (buildDispatchEffort from @refarm.dev/capabilities-v1), submits it (SubmitEffort), and
// reads back the correlated dispatch-result node by replyRef. In tests it's a fake.
const dispatch: DispatchStep = async ({ pluginId, verb, args }) => {
  const effort = buildDispatchEffort({ pluginId, verb, args }, newId, nowIso);
  const effortId = await submitEffort(effort);
  return await readDispatchResult(effortId); // out-of-band result by replyRef
};

const result = await runPlaybook(parsed.playbook, { dispatch, input: { ref: "web:efd" } });
```

The interpreter emits `PlaybookDispatch` requests (`{ pluginId, verb, args }`) — exactly the
shape `buildDispatchEffort` takes — and never runs a verb itself. A failed step aborts the run
(remaining steps reported as skipped) unless `continueOnError` is set.

## What this package is NOT

- Not an executor — dispatch is injected; the real runtime is farmhand/tractor.
- Not a scheduler — triggering/scheduling is `automation-contract-v1` + the windmill scheduler.
- Not tied to scraping — a playbook sequences *any* verbs. Scraping is just the first use
  (source/browser-driver verbs as steps).

Surface a `playbook:run` verb from a plugin and it becomes an agent tool for free (the live
`capability-tools` path renders every dispatchable verb as a tool) — so an agent can run a
playbook, and a playbook can call verbs, through the same one protocol.
