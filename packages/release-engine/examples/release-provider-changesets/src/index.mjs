export const changesetsReleaseProvider = Object.freeze({
  id: "changesets",
  type: "changesets",
  supportsPublish: true,
  supportsDryRun: true,
  publishCommands: [
    "pnpm changeset publish",
  ],
  publishDryRunCommands: [
    "pnpm changeset version",
  ],
  publishRequiresManualApproval: true,
});

export function createChangesetsReleaseProvider(overrides = {}) {
  return {
    ...changesetsReleaseProvider,
    ...overrides,
    publishCommands: overrides.publishCommands || [
      ...changesetsReleaseProvider.publishCommands,
    ],
    publishDryRunCommands: overrides.publishDryRunCommands || [
      ...changesetsReleaseProvider.publishDryRunCommands,
    ],
  };
}

export function createChangesetsReleasePolicy({
  policyVersion = "2026-01",
  mode = "changeset",
  phases = [],
  packageProfiles = [],
  selections = [],
  defaultSelection,
  providerOverrides,
} = {}) {
  return {
    policyVersion,
    mode,
    providers: [
      createChangesetsReleaseProvider(providerOverrides),
    ],
    packageProfiles,
    selections,
    ...(defaultSelection ? { defaultSelection } : {}),
    phases,
  };
}
