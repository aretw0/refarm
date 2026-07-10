# @refarm.dev/surface-terminal

The **terminal surfaces** of the capability model. A capability is declared once
in `@refarm.dev/capabilities` (the neutral model); this package projects that
model onto a terminal, in the two ways a terminal is used:

- **`cli-projector`** (`./cli`) — projects the registry into a Commander command
  tree. Coupled to Commander (the CLI framework).
- **`tui-runtime`** (`./tui`) — an interactive terminal app: consumes
  `tuiSurfaceModel(registry)`, renders the sections/items, reads a selection, and
  invokes the verb's `run()`, rendering its envelope. Uses `node:readline`
  (native, no external TUI dependency).
- **`parse-argv`** (`./argv`) — argv parsing for the capability grammar. `argv` is
  a terminal concept, so it lives here.

## Why a separate package

`@refarm.dev/capabilities` is the **pure model**: the registry, the descriptor
types, the open surface axis, the neutral envelope, and the projectors that
transform the model into data (`agent`/`openapi`/`palette` — consumed by web and
http, not just the CLI). Those belong to the model every surface projects.

The CLI projector, by contrast, **marries a surface technology** (Commander), and
the TUI runtime marries another (a terminal read-loop). A projector coupled to a
concrete surface library is not the model — it is a surface *of* the model. Keeping
them here keeps `capabilities` free of `commander`/`chalk`/`readline`, so the model
stays a clean leaf and new surfaces are added without touching it (ADR-085).
