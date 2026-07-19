---
"@refarm.dev/ds": minor
---

DTCG token source: author each theme once as a W3C Design Tokens (DTCG) JSON
(`src/tokens/*.tokens.json`) and generate the shipped `themes/*.css` (byte-identical) plus
surface-neutral `DsTheme` objects (`BUILTIN_THEMES`) from it. This inverts the old
CSS-is-source direction (the `DsTheme` was reverse-extracted from CSS by regex). A drift-guard
test proves the emit is byte-faithful for every theme, including verde-jardim's light/dark mode
blocks. Built-ins now reach non-CSS surfaces from the source directly
(`projectThemeToTui(BUILTIN_THEMES[id])`, `ThemeRegistry.register(id, BUILTIN_THEMES[id],
"built-in")`). New exports: `BUILTIN_THEMES`, `dtcgToDsTheme`. Style Dictionary is deferred to the
first native-platform target; the DTCG source is what lets it drop in then.
