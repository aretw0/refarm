# @refarm.dev/capability-host

White-label host boundary for Refarm-compatible apps and examples.

This package is the public place for host composition: command name, mounted
capabilities, operator status, surface actions, CLI projection, and HTTP serving.
It exists so consumers can import the host boundary without treating
`@refarm.dev/capabilities-v1` as the package for every layer of the ecosystem.

Current status: the package re-exports the host API while the implementation is
still incubated in `@refarm.dev/capabilities-v1`. Future slices can move the
implementation behind this boundary without changing consumers.

`defineCapabilityApp({ host, defaultOptions, programOptions })` is the standard
app/example factory. It returns `host`, `registry`, `baseModel`, `program`,
`surfaceActions`, `serve`, and `runCli` helpers so white-label consumers declare
their extension host once instead of repeating CLI, HTTP, and inspection plumbing
in every app.
Use `defaultOptions` for normal app defaults such as local state paths; they apply
to every helper surface, including `serve({ appOptions })`. Keep `programOptions`
for CLI-only option transforms.

`app.runCli(import.meta.url, { compiledFileName: "cli.js" })` is the standard
entrypoint helper for white-label CLIs. It keeps direct-run detection,
`parseAsync(process.argv)`, and error/exit-code handling in the host boundary
instead of repeating that plumbing in every app or example.

`operatorStatus.capabilityUnit` and `operatorStatus.units` receive the same host
context. Use `hostCommand(["verb", "--json"])` for surface actions so examples
and apps declare only the verb they extend while the host owns the white-label
binary name.

`serve.openApiPath`, `serve.openApiTitle`, and `serve.openApiVersion` let the host
declare its HTTP capability spec with product-neutral metadata. Consumers still call
`app.serve()` or `dgk serve`; the mounted surface publishes the OpenAPI document
without importing the lower-level projector.
The `serve` command prints `url`, `capabilitiesUrl`, `agentToolsUrl`, and
`openApiUrl` so manual operators and tools do not need to derive discovery URLs.

Node app defaults live under `@refarm.dev/capability-host/node`. Use
`createLocalRecordsStatePathResolver({ appId, envKey, fileName })` to keep local
records state path and env override wiring out of each example.
