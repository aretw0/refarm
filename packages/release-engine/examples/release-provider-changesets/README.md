# Changesets Release Provider Example

This is the canonical `changesets` provider example for
`@refarm.dev/release-engine` policies.

It is intentionally not a publish adapter. It only declares release intent and
dry-run commands for a host/CI workflow that already owns credentials,
approvals, and publication.

## Provider

```js
import {
  createChangesetsReleaseProvider,
} from "./src/index.mjs";

const provider = createChangesetsReleaseProvider();
```

The resulting provider is equivalent to:

```json
{
  "id": "changesets",
  "type": "changesets",
  "supportsPublish": true,
  "supportsDryRun": true,
  "publishCommands": ["pnpm changeset publish"],
  "publishDryRunCommands": ["pnpm changeset version"],
  "publishRequiresManualApproval": true
}
```

## Policy Helper

```js
import {
  createChangesetsReleasePolicy,
} from "./src/index.mjs";

const policy = createChangesetsReleasePolicy({
  phases: [
    {
      id: "quality",
      name: "Quality",
      commands: ["pnpm test"],
      required: true,
      riskWeight: 3
    }
  ]
});
```

Downstream projects can copy this shape into `refarm.config.json` under
`releasePolicy`, or use the helper inside their own policy generator.
