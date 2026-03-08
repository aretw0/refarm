# Refarm Antenna - Go Template

This is a template for building an Antenna (HTTP Gateway) plugin for Refarm using TinyGo.

## Building

Requires TinyGo 0.30+ to compile to `wasm32-wasi`.
Run `tinygo build -o antenna.wasm -target wasi main.go`
