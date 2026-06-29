# XR Surface POC

Status: Task 1 and Task 2 evidence for roadmap item 11.

This validation treats XR as a consumer surface around Refarm, not as a core runtime dependency.
It uses a renderer-neutral JSON envelope, a WebXR capability probe, and deterministic 2D/XR markup
builders that can be tested in Node without a browser, headset, dev server, A-Frame install, or
three.js install.

## Data Envelope

The first envelope visualizes a small Refarm surface map:

- `nodes`: supply blocks such as `ds`, `ds-html`, `dispatch-surface`, and `release-engine`;
- `links`: consumer relationships between those blocks;
- `actions`: dispatch-style affordances that a surface could expose.

The fixture is intentionally product-neutral. It does not encode `vault-seed` or DGK labels.

## Capability Probe

`probeWebXrCapability()` returns one of:

- `supported`: secure context, `navigator.xr` exists, and the requested session mode is supported;
- `unsupported`: WebXR API or requested session mode is absent;
- `blocked`: WebXR exists but secure context, permission policy, or runtime rejection blocks use.

The ordinary desktop fallback path is expected to be `unsupported`, not a failure.

## Gate

Run:

```bash
pnpm run xr-surface:poc:test
```

The test proves:

- the fixture schema is renderer-neutral;
- WebXR probing reports `supported`, `unsupported`, or `blocked` without throwing;
- 2D fallback markup and XR scene markup are generated from the same node/action IDs;
- no production package imports A-Frame or three.js.

## Next Step

Task 3 can turn the deterministic 2D markup into a static preview. Task 4 can add an isolated
A-Frame or three.js page inside this validation directory only after the equal-data gate stays
green.
