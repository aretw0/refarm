# {{REFARM_NAME}} — A Sovereign Farm

A sovereign Astro application scaffolded by [Refarm](https://refarm.dev).

## Structure

```
src/
  pages/
    index.astro     # Main page — boots Tractor, mounts StudioShell
astro.config.mjs    # Astro config via @refarm.dev/config
tsconfig.json       # TypeScript config via @refarm.dev/tsconfig
package.json        # Dependencies and scripts
```

## Getting Started

```bash
npm install
npm run dev
```

## Scripts

| Command          | Description                       |
|------------------|-----------------------------------|
| `npm run dev`    | Start local development server    |
| `npm run build`  | Build for production              |
| `npm run preview`| Preview the production build      |
