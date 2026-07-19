---
"@refarm.dev/capabilities": minor
"@refarm.dev/capability-homestead-surface": minor
---

Surface-agnostic capability argument validation via Ajv. `validateCapabilityArgs` (in
`@refarm.dev/capabilities`) validates a collected `{ ...args, ...options }` object against the
capability's DERIVED JSON Schema — the same schema the agent tool exposes — with Ajv (`coerceTypes`
handles string form values; the derived `required` list is enforced). The pattern-B inline form
dispatch (`wireCapabilityFormDispatch`) now runs this as a gate: invalid input is rejected against
the schema and reported as a field-scoped error through the existing result seam, blocking the
verb run — so a web form rejects the same bad input a CLI or an agent tool call would. One derived
schema, one validation contract, every surface.
