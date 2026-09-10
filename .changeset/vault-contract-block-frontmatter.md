---
"@refarm.dev/vault-contract-v1": minor
---

`planRecordFiles` and `recordToVaultNote` accept `blockStyle: true`, rendering nested frontmatter values across indented YAML lines instead of one compact JSON line. Off by default: `organizeRecords` and `searchRecords` feed the vault surface, whose reference matcher parses frontmatter line-by-line and reads flow values. Only the file planner takes the option, and only a consumer materializing notes for people to read needs it.
