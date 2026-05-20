# Refarm Courier - Go Template

This is a template for building an Courier (HTTP Gateway) plugin for Refarm using TinyGo.

## Building

Requires TinyGo 0.30+ to compile to `wasm32-wasi`.
Run `tinygo build -o courier.wasm -target wasi main.go`
