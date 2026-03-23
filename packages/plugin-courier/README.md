# @refarm.dev/plugin-courier (O Carteiro)

The Courier (also known as **Antenna**) is Refarm's broadcast plugin. It is responsible for materializing nodes from the Sovereign Graph as HTML and serving them via HTTP.

## Role

The Courier transforms private graph nodes into public-facing web pages, enabling "Graph-Native Publishing". Every node in your sovereign graph can potentially be a live URL.

## Features

- **Node Materialization**: Transform JSON-LD nodes into HTML.
- **Sovereign Signal**: A `.well-known` endpoint for intercepting the broadcast signal.
- **Tractor Integration**: Direct querying of the native microkernel for content discovery.

See [ROADMAP.md](./ROADMAP.md) for the path to custom templates and P2P broadcasting.
