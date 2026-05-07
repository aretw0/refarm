# GitHub Actions budget guardrail

Refarm must not consume all available GitHub Actions capacity. Treat CI as
confirmation, not the development loop. Prefer local validation and batch small
compatible changes before opening or refreshing PRs.

The default hard guard is account-month based: it checks the current billing
period's net billable Actions Linux minutes against the configured quota
baseline. The older 50% Refarm / 50% agents-lab repo split is still available as
an advisory allocation mode, but it should not be used as the default blocker
when GitHub discounts public-repo minutes or the billing panel shows a lower
month-to-date quota burn.

## Local budget check

```bash
npm run actions:budget
npm run actions:budget:json
npm run actions:budget:guard
```

Defaults:

- repositories: `aretw0/refarm,aretw0/agents-lab`
- official billing period: current UTC month
- runner-time observation window: `30` days
- monthly quota baseline: `2000` minutes
- default guard mode: account net billable month-to-date posture
- advisory allocation mode: 50% Refarm / 50% agents-lab

Override when needed:

```bash
npm run actions:budget -- --days 7
npm run actions:budget -- --quota 3000
npm run actions:budget -- --repos aretw0/refarm,aretw0/agents-lab
npm run actions:budget -- --year 2026 --month 5
```

Use `--no-official` when billing scope is unavailable, or `--jobs` when you need a
slower job-summed runner-time estimate:

```bash
npm run actions:budget -- --no-official
npm run actions:budget -- --jobs
```

Use the guard form before a push/PR that will trigger Actions. By default it
checks account-level net billable month-to-date posture, which is the safer
signal when the enhanced billing API reports high gross public-repo minutes that
are fully discounted. It can optionally fail on WARN:

```bash
npm run actions:budget:guard
npm run actions:budget:guard:json
npm run actions:budget:guard -- --fail-on-warn
npm run actions:budget:json > /tmp/actions-budget.json
npm run actions:budget:guard -- --input /tmp/actions-budget.json
npm run actions:budget:guard -- --input /tmp/actions-budget.json --json
npm run actions:budget:guard:test
```

The JSON form emits a stable guard decision envelope with `schemaVersion`,
`mode`, `status`, `shouldFail`, quota/burn fields, and the same failure exit code
as the human form. Use it for dashboards and agent handoffs.

Use allocation mode when you explicitly want the older per-repo split as an
advisory/local discipline signal:

```bash
npm run actions:budget:guard -- --mode allocation --repo aretw0/refarm
npm run actions:budget:guard -- --mode allocation --repo aretw0/refarm --fail-on-warn
```

## Official billing source

The script uses GitHub's enhanced billing endpoint when available:

```text
GET /users/{username}/settings/billing/usage/summary?product=Actions&sku=actions_linux
GET /users/{username}/settings/billing/usage/summary?repository={owner/repo}&product=Actions&sku=actions_linux
```

Authentication requires a token with `user` scope:

```bash
gh auth refresh -h github.com -s user
```

The report keeps these signals separate:

- **official gross billing**: exact month-to-date Actions Linux minutes observed by
  GitHub billing, including minutes that may later be discounted;
- **official net billable billing**: the quantity left after GitHub discounts; this
  is the default hard guard signal because it tracks billable quota posture more
  closely than gross public-repo minutes;
- **runner-time**: workflow/run duration by repository, useful for operational discipline
  even when public repositories are fully discounted.

## Operating policy

Before opening or refreshing a PR:

1. Run the closest local validation first.
2. Run `npm run actions:budget:guard` if the work is likely to trigger broad CI.
3. Use `--mode allocation` only when you intentionally want per-repo fairness
   discipline in addition to the account-level hard guard.
4. Prefer one coherent PR over repeated force-refreshes that retrigger the same workflows.
5. If CI fails, inspect exact failed logs before pushing another attempt.

## Warning thresholds

Default account mode:

- **OK**: account net billable usage is below 80% of the quota baseline.
- **WARN**: account net billable usage is 80–100% of the quota baseline.
- **OVER ALLOCATION**: account net billable usage exceeds the quota baseline.

Allocation mode:

- **OK**: project gross usage is below 80% of its advisory allocation.
- **WARN**: project gross usage is 80–100% of its advisory allocation.
- **OVER ALLOCATION**: project gross usage exceeds its advisory allocation.

If account mode is WARN or OVER ALLOCATION, switch to local-only iteration until
the next necessary confirmation point. If only allocation mode is over, treat it
as a fairness signal and decide explicitly whether Refarm may borrow unused
capacity from other repositories.
