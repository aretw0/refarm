# Trusted publishing — npm release runbook

Refarm publishes public npm packages through GitHub Actions. The intended steady state is
**stage-only trusted publishing**: GitHub gets a short-lived OIDC credential to run
`npm stage publish`; a maintainer approves the staged tarball with npm 2FA before it is public.

The npm registry cannot attach a trusted publisher to a package that does not exist. This is a
registry limitation, not a Refarm policy. The inaugural 0.1.0 publication is therefore the only
token-authenticated operation; every later release must migrate to OIDC before release automation
is enabled again.

## One-command plan and links

From the Refarm checkout, run:

```bash
pnpm run release:trusted-publishing:plan -- --json
```

It reads the accepted release selection and emits, without contacting npm or reading a token:

- each package's direct npm page URL;
- the exact `npx npm@^11.15.0 trust github ...` command;
- direct GitHub links for Actions secrets, variables, and environments;
- a blocking verdict if a package's `repository.url` does not exactly identify
  `https://github.com/aretw0/refarm.git`.

The repository URL check is release-critical: npm compares it to the GitHub repository during
OIDC authentication.

## Bootstrap once

1. Keep `RELEASE_AUTOMATION=false`. Run the First Publish Selection workflow on `main` with
   `dry_run=true`; it exercises plan, boundary audit, packed-tarball install smoke, and publish
   dry-runs without publishing.
2. Put a newly-created, narrowly scoped npm publish token in the GitHub Actions secret named
   `NPM_TOKEN`. Never paste it into an issue, shell history, a workflow, or this repository.
   The direct link is emitted by the plan command.
3. Dispatch the same workflow with `dry_run=false` and its displayed typed confirmation. It is
   intentionally the only operation that can use `NPM_TOKEN`.
4. Confirm every package/version is visible with `npm view @refarm.dev/<name>@0.1.0 version`.

Do not re-use that token for a later release.

## Configure OIDC in bulk, then revoke the token

After the packages exist, authenticate interactively with npm and run the commands printed by the
plan. They bind each package to exactly `aretw0/refarm` and the filename
`release-changesets.yml`, permitting **only** `npm stage publish`:

```bash
pnpm run release:trusted-publishing:plan
```

`npm trust` needs npm 11.15.0+, write access to the package, and account 2FA. The emitted `npx`
command uses that version without modifying the workstation's global npm. npm may offer a
five-minute 2FA grace window to make the batch practical; inspect the package list before using
it.

For each package, verify the relationship with:

```bash
npx --yes npm@^11.15.0 trust list @refarm.dev/<name>
```

Only after all package relationships are verified and the OIDC workflow has staged a release:

1. Set package Publishing access to **Require two-factor authentication and disallow tokens**.
2. Delete `NPM_TOKEN` from GitHub Actions secrets and revoke it at npmjs.com.
3. Keep `RELEASE_AUTOMATION=false` unless a release is deliberately being dispatched.

The workflow migration itself must install npm 11.15+ and use `npm stage publish`; Changesets'
legacy `changeset publish` path is not stage-only. That source change is separately gated before
this runbook can be used for post-bootstrap releases.

## Safety invariants

- `id-token: write` is necessary but is not authentication by itself.
- Trusted publishers are configured per package. The registry currently permits one relationship
  per package, so Refarm uses one future release workflow rather than splitting authority.
- A staged version occupies its semver slot. Inspect and approve it; reject it with 2FA if it is
  wrong before retrying.
- Do not turn on direct `npm publish` permission for the trusted publisher. Stage-only OIDC plus
  human 2FA approval is the release boundary.

References: [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/),
[npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/), and
[npm stage](https://docs.npmjs.com/cli/v11/commands/npm-stage/).
