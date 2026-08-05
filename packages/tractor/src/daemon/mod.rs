// Which signal asked this node to stop (SIGINT *and* SIGTERM), and the one
// bounded-drain path both of them take. See its module doc for why handling only
// SIGINT made the safe way to stop this node the manual one.
pub(crate) mod shutdown;
mod ws_server;
pub use ws_server::{preflight_ws_bind_host, WsServer};
