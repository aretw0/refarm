// Gate C — the host-fs / host-shell bridge enforces the DECLARED capability.
//
// Before this, fs:read / fs:write / shell:spawn were declared in the manifest
// but the grant was never checked at the bridge: a Strict plugin that omitted
// fs:write could still call host-fs.write. These tests prove the capability axis
// now gates each effect, BESIDE the pre-existing path/identity checks:
//
//   - declared   → the capability gate passes (the effect proceeds);
//   - undeclared → denied with "permission denied ... did not declare '<cap>'",
//     i.e. it fails at the CAPABILITY gate, NOT at the fs-root jail or the
//     trusted-plugin/shell check (the "right reason" discipline).
//
// Dev/Permissive is a no-op here (grants everything) — the existing fs_shell_core
// tests use `PermissionGrant::permissive()` and stay green. These use a STRICT
// grant declaring an explicit set.

use super::*;
use crate::host::wasi_bridge::PermissionGrant;

/// Bindings under a STRICT grant declaring exactly `caps` — the effect axis is
/// enforced. Uses a permissive effect policy (default) so the ONLY thing that can
/// deny a well-declared call is the capability gate, keeping the assertions
/// attributable to the grant, not the path/identity policy.
fn make_strict_bindings(caps: &[&str]) -> TractorNativeBindings {
    let storage = NativeStorage::open(":memory:").unwrap();
    let sync = NativeSync::new(storage, ":memory:").unwrap();
    let telemetry = TelemetryBus::new(10);
    TractorNativeBindings::new(
        "test-agent",
        sync,
        telemetry,
        HostEffectPolicy::default(),
        crate::host::wasi_bridge::ModelRoute::default(),
        None,
        PermissionGrant::strict_declaring(caps),
        None,
        None,
    )
}

// ── host-fs.read gated on fs:read ────────────────────────────────────────────

#[tokio::test]
async fn read_is_denied_under_strict_without_fs_read() {
    let mut b = make_strict_bindings(&["fs:write", "shell:spawn"]);
    let err = HostFsHost::read(&mut b, "/etc/hostname".to_string())
        .await
        .expect_err("read must be denied when fs:read is not declared");
    assert!(
        err.contains("permission denied") && err.contains("fs:read"),
        "must fail at the capability gate naming fs:read, got: {err}"
    );
}

#[tokio::test]
async fn read_passes_the_capability_gate_when_fs_read_is_declared() {
    // A real temp file so a granted read succeeds end-to-end (default policy has
    // no fs-root jail configured, so the capability gate is the only barrier).
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("hello.txt");
    std::fs::write(&path, b"hi").unwrap();

    let mut b = make_strict_bindings(&["fs:read"]);
    let bytes = HostFsHost::read(&mut b, path.to_string_lossy().into_owned())
        .await
        .expect("declared fs:read must pass the capability gate and read the file");
    assert_eq!(bytes, b"hi");
}

// ── host-fs.write / edit gated on fs:write ───────────────────────────────────

#[tokio::test]
async fn write_is_denied_under_strict_without_fs_write() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("out.txt");

    let mut b = make_strict_bindings(&["fs:read"]);
    let err = HostFsHost::write(&mut b, path.to_string_lossy().into_owned(), b"x".to_vec())
        .await
        .expect_err("write must be denied when fs:write is not declared");
    assert!(
        err.contains("permission denied") && err.contains("fs:write"),
        "must fail at the capability gate naming fs:write, got: {err}"
    );
    assert!(!path.exists(), "the denied write must not have created the file");
}

#[tokio::test]
async fn write_passes_the_capability_gate_when_fs_write_is_declared() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("out.txt");

    let mut b = make_strict_bindings(&["fs:write"]);
    HostFsHost::write(&mut b, path.to_string_lossy().into_owned(), b"data".to_vec())
        .await
        .expect("declared fs:write must pass the capability gate and write the file");
    assert_eq!(std::fs::read(&path).unwrap(), b"data");
}

#[tokio::test]
async fn edit_is_denied_under_strict_without_fs_write() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("edit.txt");
    std::fs::write(&path, "original\n").unwrap();

    // edit needs fs:write (it mutates); declaring only fs:read must not suffice.
    let mut b = make_strict_bindings(&["fs:read"]);
    let err = HostFsHost::edit(&mut b, path.to_string_lossy().into_owned(), String::new())
        .await
        .expect_err("edit must be denied when fs:write is not declared");
    assert!(
        err.contains("permission denied") && err.contains("fs:write"),
        "edit must fail at the capability gate naming fs:write, got: {err}"
    );
}

// ── host-shell.spawn gated on shell:spawn ────────────────────────────────────

#[tokio::test]
async fn spawn_is_denied_under_strict_without_shell_spawn() {
    let mut b = make_strict_bindings(&["fs:read", "fs:write"]);
    let err = HostShellHost::spawn(&mut b, spawn_req(&["echo", "hi"]))
        .await
        .expect_err("spawn must be denied when shell:spawn is not declared");
    assert!(
        err.contains("permission denied") && err.contains("shell:spawn"),
        "must fail at the capability gate naming shell:spawn, NOT the trusted-plugin \
         or argv check, got: {err}"
    );
}

// ── the two axes are orthogonal ──────────────────────────────────────────────

#[tokio::test]
async fn dev_mode_permissive_grant_is_a_no_op_for_the_capability_gate() {
    // The existing fs_shell_core harness uses PermissionGrant::permissive(); this
    // pins the invariant that dev mode bypasses the capability gate entirely, so
    // this slice cannot have broken those tests.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("dev.txt");
    let mut b = make_bindings(); // permissive
    HostFsHost::write(&mut b, path.to_string_lossy().into_owned(), b"ok".to_vec())
        .await
        .expect("permissive grant must not gate host-fs.write");
    assert_eq!(std::fs::read(&path).unwrap(), b"ok");
}
