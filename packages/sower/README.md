# @refarm.dev/sower

Sower is Refarm's data ingestion engine, responsible for "seeding" the Sovereign Graph with external data sources (JSON, CSV, RSS).

## Role

Combined with its sibling **Thresher**, Sower forms the complete ETL (Extract, Transform, Load) cycle for the sovereign farm. 

- **Sower**: Seed external data into the graph.
- **Thresher**: Harvest subgraphs and export them.

See [ROADMAP.md](./ROADMAP.md) for the evolution of transformation pipelines and native importers.
