# @refarm.dev/operation-web-v1

Browser-neutral projection of Refarm's admitted operation catalog. It lists the
node-owned catalog, starts only an opaque declared id, and reads the bounded lifecycle
of a run. It never accepts argv and never carries command output.

The caller supplies the current bearer token. Authentication and scope remain the
sidecar gate's responsibility. Human interface messages ship in English, Brazilian
Portuguese and Spanish; operation ids and node-owned descriptions remain canonical.
