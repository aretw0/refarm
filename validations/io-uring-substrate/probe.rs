use std::fs;
use std::io;
use std::os::raw::{c_int, c_long};

const ENOSYS: i32 = 38;
const EPERM: i32 = 1;
const EACCES: i32 = 13;
const EOPNOTSUPP: i32 = 95;

#[cfg(target_os = "linux")]
const SYS_IO_URING_SETUP: c_long = 425;

#[repr(C)]
#[derive(Default)]
struct IoSqringOffsets {
    head: u32,
    tail: u32,
    ring_mask: u32,
    ring_entries: u32,
    flags: u32,
    dropped: u32,
    array: u32,
    resv1: u32,
    user_addr: u64,
}

#[repr(C)]
#[derive(Default)]
struct IoCqringOffsets {
    head: u32,
    tail: u32,
    ring_mask: u32,
    ring_entries: u32,
    overflow: u32,
    cqes: u32,
    flags: u32,
    resv1: u32,
    user_addr: u64,
}

#[repr(C)]
#[derive(Default)]
struct IoUringParams {
    sq_entries: u32,
    cq_entries: u32,
    flags: u32,
    sq_thread_cpu: u32,
    sq_thread_idle: u32,
    features: u32,
    wq_fd: u32,
    resv: [u32; 3],
    sq_off: IoSqringOffsets,
    cq_off: IoCqringOffsets,
}

unsafe extern "C" {
    fn syscall(num: c_long, ...) -> c_long;
    fn close(fd: c_int) -> c_int;
}

fn json_string(value: &str) -> String {
    let mut out = String::from("\"");
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn kernel_release() -> String {
    fs::read_to_string("/proc/sys/kernel/osrelease")
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}

fn is_container() -> bool {
    fs::metadata("/.dockerenv").is_ok()
}

fn classify_errno(errno: i32) -> (&'static str, &'static str) {
    match errno {
        ENOSYS => (
            "unsupported",
            "io_uring_setup syscall is not implemented by this kernel/runtime",
        ),
        EPERM | EACCES => (
            "blocked",
            "io_uring_setup exists but is blocked by permissions or container policy",
        ),
        EOPNOTSUPP => (
            "unsupported",
            "io_uring_setup is not supported by this kernel/runtime",
        ),
        _ => (
            "blocked",
            "io_uring_setup returned an initialization error; keep fallback enabled",
        ),
    }
}

#[cfg(target_os = "linux")]
fn probe() -> (String, Option<i32>, String) {
    let mut params = IoUringParams::default();
    let fd = unsafe { syscall(SYS_IO_URING_SETUP, 2_u32, &mut params as *mut IoUringParams) };

    if fd >= 0 {
        unsafe {
            close(fd as c_int);
        }
        return (
            "available".to_string(),
            None,
            "io_uring_setup initialized and closed a minimal ring".to_string(),
        );
    }

    let errno = io::Error::last_os_error().raw_os_error().unwrap_or(-1);
    let (status, reason) = classify_errno(errno);
    (status.to_string(), Some(errno), reason.to_string())
}

#[cfg(not(target_os = "linux"))]
fn probe() -> (String, Option<i32>, String) {
    (
        "unsupported".to_string(),
        None,
        "io_uring is Linux-only".to_string(),
    )
}

fn main() {
    let (status, errno, reason) = probe();
    let errno_json = errno.map_or_else(|| "null".to_string(), |value| value.to_string());

    println!(
        "{{\"ok\":true,\"schema\":\"refarm.io_uring_probe.v1\",\"status\":{},\"errno\":{},\"reason\":{},\"syscall\":\"io_uring_setup\",\"kernelRelease\":{},\"arch\":{},\"container\":{},\"fallback\":\"standard-file-io\",\"publicApi\":\"async-io:native-linux\"}}",
        json_string(&status),
        errno_json,
        json_string(&reason),
        json_string(&kernel_release()),
        json_string(std::env::consts::ARCH),
        if is_container() { "true" } else { "false" },
    );
}
