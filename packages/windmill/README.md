# @refarm.dev/windmill

Windmill is Refarm's automation and workflow engine. It provides the infrastructure for autonomous tasks, provider-based integrations, and smart intents.

## Features

- **Provider Interface**: A unified interface for different automation backends (Browser, OS, Cloud).
- **Task Orchestration**: Executing complex workflows across multiple providers.
- **Local scheduler blocks**: Inspect, fire, and persist one-shot/cron scheduled work with a `.refarm` ledger.
- **Autonomous Intents**: (Planned) Triggering actions based on graph-detected patterns.

## Local Scheduler

`@refarm.dev/windmill/local-scheduler` exposes the host-owned tick helper:

```js
import { executeDueLocalScheduledWork } from "@refarm.dev/windmill/local-scheduler";
import { createLocalSchedulerLedger } from "@refarm.dev/windmill/local-scheduler-ledger";

const report = await executeDueLocalScheduledWork(automationAdapter, effortAdapter, {
	owner: "refarm-main",
	ledger: createLocalSchedulerLedger({ cwd: projectRoot }),
});
```

The ledger defaults to `.refarm/scheduler/ledger.json`. It records stable fire
keys after successful effort submission, so a host can restart and tick again
without re-firing the same one-shot or cron window.

See [ROADMAP.md](./ROADMAP.md) for the evolution towards WASM-based autonomous workflows.
