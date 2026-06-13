# Deployment Guide

This guide outlines deploy paths for the current Refarm development app and for custom WASM plugin repositories.

## 1. Deploying The Refarm Development App

`apps/dev` is a static Astro application. It is designed to be hosted on static providers that can serve the headers needed by WebContainers, including `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.

### GitHub Pages

The canonical repository uses `.github/workflows/deploy-dev.yml` for GitHub Pages.

1. Fork the [aretw0/refarm](https://github.com/aretw0/refarm) repository (or the current canonical owner).
2. Go to **Settings > Pages**.
3. Set **Source** to "GitHub Actions".
4. The `.github/workflows/deploy-dev.yml` will automatically build and deploy the `apps/dev` distribution on every push to `main`.

### Template Button Blueprint

If you are building a custom Refarm distribution, you can add this button to your README:

[![Deploy to GitHub Pages](https://github.com/aretw0/refarm/raw/main/assets/deploy-to-ghp.svg)](https://github.com/new?template_name=refarm&template_owner=aretw0)

If the canonical owner changes, update the badge URL and `template_owner` accordingly.

---

## 2. Plugin CI/CD Standards

Plugin repositories can copy the workflow template as a starting point for build and conformance checks.

### Setup

1. Copy `.github/workflow-templates/plugin-ci.yml` to your plugin repository's `.github/workflows/` directory.
2. The workflow will automatically:
    - **Build**: Compile your WASM component.
    - **Test**: Run contract conformance tests against your code.
    - **Hash**: Provide the SHA-256 hash required for Nostr NIP-94.

### Why Conformance Matters

The Refarm runtime expects plugin contracts to be explicit. Running `plugin-ci` helps verify that:

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
