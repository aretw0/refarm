# @refarm.dev/source-git

Git implementation of the `source:v1` capability. Caches partial clones under
`~/.cache/checkouts/<host>/<org>/<repo>`, reuses them, fetches when stale, and
fast-forwards when clean. Depends only on `git` in PATH.
