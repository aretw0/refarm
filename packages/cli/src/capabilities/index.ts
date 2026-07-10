/**
 * COMPAT re-export. The capability model — registry, types, surface-model, and
 * the cli/http/agent/openapi/palette projectors — moved to its own package,
 * `@refarm.dev/capabilities`. It was never "CLI"; it is the one declaration every
 * surface projects from (ADR-085), and living inside a package named `cli`
 * mislabelled it.
 *
 * This barrel keeps the `@refarm.dev/cli/capabilities` entry point stable for any
 * remaining importer. New code should import from `@refarm.dev/capabilities`
 * directly.
 */
export * from "@refarm.dev/capabilities";
