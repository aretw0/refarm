# @refarm.dev/capability-host

White-label host boundary for Refarm-compatible apps and examples.

This package is the public place for host composition: command name, mounted
capabilities, operator status, surface actions, CLI projection, and HTTP serving.
It exists so consumers can import the host boundary without treating
`@refarm.dev/capabilities-v1` as the package for every layer of the ecosystem.

Current status: the package re-exports the host API while the implementation is
still incubated in `@refarm.dev/capabilities-v1`. Future slices can move the
implementation behind this boundary without changing consumers.

`runCapabilityHostCli(import.meta.url, () => buildProgram(), { compiledFileName:
"cli.js" })` is the standard entrypoint helper for white-label CLIs. It keeps
direct-run detection, `parseAsync(process.argv)`, and error/exit-code handling in
the host boundary instead of repeating that plumbing in every app or example.
