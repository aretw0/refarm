# @refarm.dev/scarecrow (O Espantalho)

Scarecrow is Refarm's runtime **citizenship auditor**. It passively watches the
telemetry bus of already-running plugins and reacts to bad behaviour — excessive
DOM update velocity (throttled), low accessibility scores, and strobe/seizure
hazards — emitting alerts the Shell can surface.

## Role

Scarecrow is an **observer/auditor**, not an ingress policy gate. It does not
see manifests, capabilities, installs, or signatures; it reacts to
post-hoc UI telemetry of plugins that are already running.

The admission decision — *what is allowed to enter the farm* (block excess
permission, review-first install, denied-capability receipt) — is **not** owned
here. That pure decision lives in `@refarm.dev/plugin-manifest`
(`decidePluginPolicy`); the governance/record surface is
`@refarm.dev/cli` (`CapabilityPolicy`); runtime isolation is `Fence`.
Scarecrow's future role in that chain is to emit the **audit receipt** for a
denial once the decision is made upstream.

## Features (implemented)

- **Performance citizenship**: throttles a plugin's headless state for a short
  window when `ui:performance` update velocity exceeds a configurable threshold.
- **Accessibility citizenship**: alerts on low `ui:a11y_audit` scores.
- **Strobe safety**: alerts on `ui:strobe_alert` (seizure-hazard) events.
- **Config from the graph**: thresholds load from a `ScarecrowConfig` node and
  hot-update via `system:config_updated`.
- **Health signal**: `getSystemHealth()` returns a decay score from recent alerts.

> The signature-verification / JSON-LD policy / threat-detection framing of
> earlier drafts is aspirational and not implemented. See [ROADMAP.md](./ROADMAP.md).
