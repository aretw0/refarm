# Homestead shell layout and scroll ownership

Status: implemented baseline

## Decision

Homestead uses an IDE-like viewport shell:

```text
#refarm-shell (fixed viewport owner)
  #refarm-header   fixed shell region
  #refarm-main     explicit primary scroll region
    #refarm-main-frame
      #refarm-slot-main
      #refarm-slot-streams
  #refarm-footer   fixed statusbar region
```

The document/body are not the scroll owner for Homestead apps. The shell owns the viewport, and only explicit regions may scroll.

## Why

Refarm is converging on one host model with Web, TUI, and headless renderers. The Web renderer should behave like a local workbench, not a document page where the footer disappears below the fold. Keeping header/statusbar outside the page scroll makes streams, diagnostics, action status, and future pane layouts align with IDE/TUI mental models.

## Contract

- `body` is locked to the viewport and does not provide implicit page scroll.
- `#refarm-shell[data-refarm-shell="viewport"]` is the viewport frame.
- `#refarm-header[data-refarm-shell-region="header"]` stays outside scrolling content.
- `#refarm-main[data-refarm-scroll-region="main"]` is the primary scroll container.
- `#refarm-footer[data-refarm-shell-region="statusbar"]` stays outside scrolling content.
- Nested panels that need independent scrolling must opt in with DS-owned utilities:
  - `.refarm-scroll-region` or `[data-refarm-scroll-region]`
  - `.refarm-scroll-region-y` or `[data-refarm-scroll-region="y"]`
  - `.refarm-scroll-region-x` or `[data-refarm-scroll-region="x"]`

## Accessibility notes

- `#refarm-main` remains the semantic `main` landmark and has `aria-label="Refarm workspace"`.
- `#refarm-main` is programmatically focusable so controllers can move focus into the scroll owner when routes or workspaces change.
- The statusbar uses `role="status"` and `aria-live="polite"` for shell status updates.
- Nested scroll regions should have labels when the region is not self-evident, especially inspectors, logs, streams, and tables.

## App guidance

Apps should not add global `body` or page-level scrolling to regain old document behavior. Instead:

- place page content inside the shared `Layout` slot;
- use stable Astro markup for static workbench structure;
- mark logs, inspectors, stream panes, and table bodies as explicit scroll regions;
- keep footer/statusbar content short and status-like, not a second navigation area.

`apps/dev` and `apps/me` both consume the shared Homestead layout, so this convention is intentionally product-agnostic.

## Renderer parity

The Web renderer's fixed statusbar mirrors TUI expectations: the statusbar is a shell affordance, not content. Headless mode should expose equivalent status through the status JSON contract rather than relying on DOM layout.
