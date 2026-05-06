# GitHub Actions budget guardrail

Refarm must not consume all available GitHub Actions capacity. The working split is:

- **50% Refarm** (`aretw0/refarm`)
- **50% agents-lab** (`aretw0/agents-lab`)

Treat CI as confirmation, not the development loop. Prefer local validation and batch small
compatible changes before opening or refreshing PRs.

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
- allocation: 50% Refarm / 50% agents-lab

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

Use the guard form before a push/PR that will trigger Actions. It fails closed
when the target repository is over allocation, and can optionally fail on WARN:

```bash
npm run actions:budget:guard
npm run actions:budget:guard -- --repo aretw0/refarm
npm run actions:budget:guard -- --fail-on-warn
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

The report keeps two signals separate:

- **official billing**: exact month-to-date Actions Linux minutes from GitHub billing;
- **runner-time**: workflow/run duration by repository, useful for operational discipline
  even when public repositories are fully discounted.

## Operating policy

Before opening or refreshing a PR:

1. Run the closest local validation first.
2. Run `npm run actions:budget:guard` if the work is likely to trigger broad CI.
3. Keep Refarm below its allocation unless explicitly borrowing from agents-lab budget.
4. Prefer one coherent PR over repeated force-refreshes that retrigger the same workflows.
5. If CI fails, inspect exact failed logs before pushing another attempt.

## Warning thresholds

- **OK**: project uses less than 80% of its allocation.
- **WARN**: project uses 80–100% of its allocation.
- **OVER ALLOCATION**: project exceeds its 50% share.

If Refarm is in WARN or OVER ALLOCATION, switch to local-only iteration until the next
necessary confirmation point.
