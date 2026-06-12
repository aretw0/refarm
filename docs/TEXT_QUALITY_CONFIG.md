# Text Quality Config

Status: maintained contract for deterministic prose scoring.

Refarm's text quality scorer is a dependency-free check for docs, proposals,
submission scaffolding, and other prose-heavy files. It is intentionally generic:
Refarm owns the scoring contract and JSON report shape; consumer projects own
their rubrics, dashboards, notebooks, and publication language.

## Config Discovery

By default, the CLI uses built-in rules. A project may opt in by adding:

```text
.refarm/text-quality.json
```

The file is discovered from the current working directory. Passing
`--config <path>` takes precedence over the discovered file. This keeps consumer
policy in the `.refarm` sidecar area instead of requiring a root-level
`refarm-config.json`.

## Minimal Example

```json
{
	"version": 1,
	"longSentenceWords": 45,
	"riskPatterns": [
		{
			"id": "draft-marker",
			"severity": "warn",
			"description": "Draft markers should be resolved before promotion.",
			"regex": "\\b(DRAFT_NOTE|REVIEW_MARKER)\\b"
		}
	]
}
```

## Supported Fields

| Field | Type | Role |
| --- | --- | --- |
| `version` | number | Consumer-managed config version. |
| `longSentenceWords` | non-negative number | Emits `info` findings for prose sentences above the threshold. Use `0` to disable. |
| `riskPatterns` | array | Regex-based findings with `id`, `severity`, optional `description`, and `regex`. |
| `repetitionHeuristics.paragraphStarter` | object | Configures repeated paragraph-start detection. |
| `rubric` | object | Optional deterministic scorecard with weighted criteria. |
| `profiles` | object | Named overlays selected with `--profile <name>`. |
| `audiences` | object | Named overlays selected by `--audience <name>` or frontmatter `audience`. |

`riskPatterns[].severity` must be `fail`, `warn`, or `info`.

`paragraphStarter` supports:

```json
{
	"enabled": true,
	"ngramWords": 2,
	"windowParagraphs": 12,
	"minOccurrencesInWindow": 3,
	"minWordLength": 2,
	"ignoreStarters": ["por exemplo"]
}
```

Numeric `paragraphStarter` fields must be positive integers.

## Rubric Scorecards

Rubrics let consumer projects define weighted, deterministic criteria without
moving domain-specific judgment into Refarm. Each criterion may require patterns
to be present and forbid patterns that should not remain.

```json
{
	"rubric": {
		"enabled": true,
		"scale": 5,
		"criteria": [
			{
				"id": "evidence",
				"label": "Evidence",
				"weight": 0.6,
				"severity": "warn",
				"requiredPatterns": [
					{
						"id": "explicit-source",
						"description": "At least one explicit source marker should be present.",
						"regex": "\\b(source|reference|evidence)\\b"
					}
				]
			},
			{
				"id": "draft-hygiene",
				"label": "Draft hygiene",
				"weight": 0.4,
				"forbiddenPatterns": [
					{
						"id": "draft-note",
						"description": "Draft notes should not remain.",
						"regex": "\\bDRAFT_NOTE\\b"
					}
				]
			}
		]
	}
}
```

When enabled, JSON reports include `metrics.rubric` with `scores`, `weights`,
`finalScore`, and per-criterion issues. Failed rubric checks also appear as
findings with `rule` values prefixed by `rubric:`.

## Profiles And Audiences

Profiles and audiences are shallow policy names with recursive object merging.
Audience overrides apply after profile overrides.

```json
{
	"longSentenceWords": 45,
	"profiles": {
		"strict": {
			"longSentenceWords": 38
		}
	},
	"audiences": {
		"introductory": {
			"longSentenceWords": 32
		}
	}
}
```

Files may declare an audience in Markdown frontmatter:

```markdown
---
audience: introductory
---
```

## JSON Errors

`--json` success reports include `ok: true`. Config failures use `ok: false`.

Missing or unreadable config files return `ERR_TEXT_QUALITY_CONFIG_READ` and
include `error.fsCode` when Node exposes a filesystem code such as `ENOENT`.

Invalid JSON returns:

```json
{
	"ok": false,
	"error": {
		"code": "ERR_TEXT_QUALITY_CONFIG_JSON",
		"configPath": ".refarm/text-quality.json"
	}
}
```

Valid JSON with unsupported shape returns
`ERR_TEXT_QUALITY_CONFIG_SCHEMA` and includes `error.issues`.

## Commands

```bash
pnpm run text-quality:test
pnpm run docs:text-quality
pnpm run text-quality:verify
node scripts/ci/check-text-quality.mjs --json docs/TEXT_QUALITY_CONFIG.md
```
