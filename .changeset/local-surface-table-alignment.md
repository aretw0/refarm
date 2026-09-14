---
"@refarm.dev/local-surface": patch
---

Align table cells to their own column, and make `actions` optional.

Both were found by a second consumer (`coop-vault`) building a read-only panel
in plain JS, and neither surfaced in the first consumer, which is TypeScript and
always declared actions.

- The panel table took its header from the FIRST row's keys and then emitted
  `Object.values(row)` per row. Because JS objects preserve insertion order, two
  rows carrying the same keys in different orders — which happens naturally when
  rows come from different sources — produced a well-formed table with values
  under the wrong columns, with no error or warning. Rows with differing keys
  lost columns and shifted values onto the neighbouring label. Headers are now
  the union of every row's keys, and each cell is looked up by key.
- `actions` was required on `LocalSurfaceInput` while `routeBase`, `theme`,
  `evidence` and `boundaries` were optional. Omitting it threw
  `Cannot read properties of undefined (reading 'map')`, which does not name the
  field. A read-only surface has nothing to click; it now defaults to `[]`.
