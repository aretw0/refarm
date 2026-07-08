# @refarm.dev/capability-host

White-label host boundary for Refarm-compatible apps and examples.

This package is the public place for host composition: command name, mounted
capabilities, operator status, surface actions, CLI projection, and HTTP serving.
It exists so consumers can import the host boundary without treating
`@refarm.dev/capabilities-v1` as the package for every layer of the ecosystem.

Current status: the package re-exports the host API while the implementation is
still incubated in `@refarm.dev/capabilities-v1`. Future slices can move the
implementation behind this boundary without changing consumers.
