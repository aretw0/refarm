# Deployment Guide — Residency in Grand Style

This guide outlines how to deploy your own instance of the Refarm host (Homestead) or your custom WASM plugins.

## 1. Deploying the Refarm Host (Homestead)

The Refarm Host is a static Astro application. It is designed to be hosted on any provider that supports **SharedArrayBuffer** (required for WebContainers).

### GitHub Pages (Official Recommendation)
Refarm is pre-configured for GitHub Pages.
1. Fork the [aretw0/refarm](https://github.com/aretw0/refarm) repository (or the current canonical owner).
2. Go to **Settings > Pages**.
3. Set **Source** to "GitHub Actions".
4. The `.github/workflows/deploy-dev.yml` will automatically build and deploy the `apps/dev` distribution on every push to `main`.

### "Deploy to..." Button Blueprint
If you are building a custom Refarm distribution, you can add this button to your README:

[![Deploy to GitHub Pages](https://github.com/aretw0/refarm/raw/main/assets/deploy-to-ghp.svg)](https://github.com/new?template_name=refarm&template_owner=aretw0)

If the canonical owner changes, update the badge URL and `template_owner` accordingly.

---

## 2. Plugin CI/CD Standards

To ensure your plugin is ready for the Refarm ecosystem, we provide a standardized GitHub Action template.

### Setup
1. Copy [.github/workflow-templates/plugin-ci.yml](file:///.github/workflow-templates/plugin-ci.yml) to your plugin repository's `.github/workflows/` directory.
2. The workflow will automatically:
    - **Build**: Compile your WASM component.
    - **Test**: Run contract conformance tests against your code.
    - **Hash**: Provide the SHA-256 hash required for Nostr NIP-94.

### Why Conformance Matters?
The Refarm micro-kernel is strict. By running the `plugin-ci`, you ensure that:
- Your storage operations are atomic and valid JSON-LD.
- Your identity management follows the BIP-39 / Nostr standard.
- Your sync logic won't cause data corruption for users.

---

## 3. Advanced Cloud Deployments (SSR)

If you need Edge features or SSR:
1. Open `apps/dev/astro.config.mjs`.
2. Add an adapter (e.g., `@astrojs/vercel` or `@astrojs/cloudflare`).
3. Change `output: "static"` to `output: "hybrid"`.

> [!IMPORTANT]
> Always verify that your hosting provider allows the `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers, otherwise WebContainers will not boot.
