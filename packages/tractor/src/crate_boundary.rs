//! Nothing on a PRODUCTION path may reach outside this crate's directory.
//!
//! `refarm-tractor` is a real published crate: `.github/workflows/publish-crates.yml`
//! fires on a `refarm-tractor@*` tag and runs `cargo publish`. `cargo package` copies
//! only the files Cargo knows about — 156 of them, all under `packages/tractor` — into a
//! `.crate` tarball, then does a VERIFY BUILD of that tarball in isolation. A compile-time
//! reference whose path climbs out of `packages/tractor` therefore builds perfectly here
//! and fails there, at the one moment there is no way back.
//!
//! This exists because that happened. On 2026-08-04 `model_rate_catalog.rs` embedded
//! `packages/model-catalog-v1/catalog/model-rates.v1.json` with `include_str!` on a
//! production path. Three separate validators covered that artifact's CONTENT (a CI
//! script, the TypeScript package's own validator, and the host's Rust mirror) and not
//! one of them looked at the PATH, so the crate quietly stopped being publishable. The
//! hazard was then written down in a design doc, which is not the same thing as being
//! prevented — hence tests rather than another paragraph.
//!
//! `#[cfg(test)]` code is exempt because the verify build does not compile it: `cargo
//! package`'s verification builds the lib and bins, not tests. That is why tractor's
//! cross-package fixture includes are all test-gated, and why the audited rate catalog
//! may still be read at test time.
//!
//! Scope is `src/`, the tree the lib and bins are built from. `tests/` ships in the
//! tarball but is not compiled by the verify build, so an include there cannot break a
//! publish.

use std::path::{Component, Path, PathBuf};

/// A compile-time path reference: the file it appears in, the literal it names, and
/// whether it sits inside a `#[cfg(test)]` scope.
struct Reference {
    in_file: PathBuf,
    literal: String,
    test_only: bool,
}

#[test]
fn no_production_include_reaches_outside_the_crate() {
    let crate_root = normalize(Path::new(env!("CARGO_MANIFEST_DIR")));
    let files = production_source_files(&crate_root);
    let test_only_files = whole_file_test_modules(&files);

    let mut escaping_production: Vec<String> = Vec::new();
    let mut escaping_test_only = 0usize;
    for file in &files {
        let text = read(file);
        let whole_file_is_test = test_only_files.contains(file);
        for reference in
            macro_arguments(file, &text, whole_file_is_test, &["include_str!", "include_bytes!"])
        {
            // An `include_*!` path is relative to the FILE that writes it.
            let dir = reference.in_file.parent().unwrap_or(Path::new("."));
            let resolved = normalize(&dir.join(&reference.literal));
            if resolved.starts_with(&crate_root) {
                continue;
            }
            if reference.test_only {
                escaping_test_only += 1;
                continue;
            }
            escaping_production.push(describe(&crate_root, &reference, &resolved));
        }
    }

    assert!(
        escaping_production.is_empty(),
        "a production include! reaches outside the crate, which makes `cargo publish` fail \
         at the verify build (`cargo package` never copies these files into the tarball):\n  \
         {}\n\nFix it by moving the data inside packages/tractor, resolving it at RUNTIME \
         from the sovereign dir the way the model rate catalog now does, or — if only tests \
         need it — putting the include behind #[cfg(test)].",
        escaping_production.join("\n  ")
    );

    // The scanner must still be able to SEE an escaping include, or the assertion above
    // passes because the parser broke rather than because the crate is clean. Tractor
    // deliberately keeps several cross-package fixtures behind #[cfg(test)].
    assert!(
        escaping_test_only >= 3,
        "the scanner found only {escaping_test_only} test-gated cross-package includes; it \
         used to find at least 3, so it has most likely stopped parsing rather than started \
         passing"
    );
}

/// The WIT world tractor's plugin bindings are generated from lives in
/// `packages/plugin-wit`, and `bindgen!` reads it at COMPILE time from
/// `path: "../plugin-wit/wit"` — outside the crate, and not in the package tarball.
///
/// This is a SECOND, still-unfixed instance of the same defect the rate catalog was, found
/// while removing that one (`cargo build` dep-info for `libtractor`/`tractor` lists the
/// five `packages/plugin-wit/wit/*.wit` files as build inputs, and `cargo package --list`
/// carries only tractor's own `wit/host/host-effects/world.wit`). Fixing it is an ownership
/// decision — vendor the world into `packages/tractor/wit`, or stop publishing the crate —
/// so it is not fixed here.
///
/// What IS done here is pin it, because "recorded in a doc" is how the first one survived.
/// The set below is exhaustive and closed: a THIRD compile-time escape cannot be added
/// without this test failing.
#[test]
fn the_wit_world_is_the_only_other_production_path_leaving_the_crate() {
    const KNOWN_UNFIXED: &[&str] = &["../plugin-wit/wit"];

    let crate_root = normalize(Path::new(env!("CARGO_MANIFEST_DIR")));
    let files = production_source_files(&crate_root);
    let test_only_files = whole_file_test_modules(&files);

    let mut escaping: Vec<String> = Vec::new();
    for file in &files {
        let text = read(file);
        let whole_file_is_test = test_only_files.contains(file);
        for reference in bindgen_paths(file, &text, whole_file_is_test) {
            // A `bindgen!` path is relative to CARGO_MANIFEST_DIR, not to the file.
            let resolved = normalize(&crate_root.join(&reference.literal));
            if resolved.starts_with(&crate_root) || reference.test_only {
                continue;
            }
            escaping.push(reference.literal);
        }
    }
    escaping.sort();
    escaping.dedup();

    assert_eq!(
        escaping,
        KNOWN_UNFIXED,
        "the set of bindgen! worlds read from outside the crate changed. If a path was \
         ADDED, `cargo publish` now has one more reason to fail at the verify build — do \
         what the rate catalog did and bring it inside packages/tractor. If a path was \
         REMOVED, that is the fix landing: delete it from KNOWN_UNFIXED (and when the list \
         empties, delete this test — the crate is publishable again)."
    );
}

fn read(file: &Path) -> String {
    std::fs::read_to_string(file)
        .unwrap_or_else(|err| panic!("read {}: {err}", file.display()))
}

fn describe(crate_root: &Path, reference: &Reference, resolved: &Path) -> String {
    format!(
        "{}: {:?} resolves to {} — outside {}",
        reference.in_file.strip_prefix(crate_root).unwrap_or(&reference.in_file).display(),
        reference.literal,
        resolved.display(),
        crate_root.display()
    )
}

/// Every `.rs` file the lib and bins are built from, in a stable order.
fn production_source_files(crate_root: &Path) -> Vec<PathBuf> {
    let src = crate_root.join("src");
    let files = rust_files(&src);
    assert!(
        files.len() > 50,
        "the scan found only {} files under {} — it is walking the wrong tree, and a guard \
         that inspects nothing passes for the wrong reason",
        files.len(),
        src.display()
    );
    files
}

/// Files that are test-only in their ENTIRETY: those pulled in by a `#[cfg(test)]`-gated
/// `#[path = "..."] mod ...;`. Nothing inside such a file says so.
fn whole_file_test_modules(files: &[PathBuf]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for file in files {
        let text = read(file);
        let dir = file.parent().unwrap_or(Path::new(".")).to_path_buf();
        for (start, end) in cfg_test_scopes(&text) {
            let scope = &text[start..end];
            let Some((_, after)) = scope.split_once("#[path") else {
                continue;
            };
            if let Some(literal) = first_string_literal(after) {
                out.push(normalize(&dir.join(literal)));
            }
        }
    }
    out
}

fn rust_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                out.push(normalize(&path));
            }
        }
    }
    out.sort();
    out
}

/// Byte ranges of the `#[cfg(test)]` scopes in `text`.
///
/// Deliberately simple, and deliberately biased toward FALSE POSITIVES: a scope is
/// recognised only from a `#[cfg(test)]` written on its own line at column 0, and it ends
/// at the first column-0 `}` line (rustfmt puts a top-level item's closing brace there) or
/// at the `mod name;` the attribute gates. If the shape is anything else the region is read
/// as shorter than it is, a reference inside it looks like production, and the test FAILS.
/// Failing loudly on an unusual shape is the safe direction; silently widening a test scope
/// over production code is not.
fn cfg_test_scopes(text: &str) -> Vec<(usize, usize)> {
    let lines = line_offsets(text);
    let mut scopes = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let (start, line) = lines[i];
        if line.trim() != "#[cfg(test)]" || line.starts_with(char::is_whitespace) {
            i += 1;
            continue;
        }
        let mut end = text.len();
        let mut j = i + 1;
        while j < lines.len() {
            let (offset, candidate) = lines[j];
            let trimmed = candidate.trim();
            if candidate.starts_with(char::is_whitespace) {
                j += 1;
                continue;
            }
            if trimmed == "}" || (trimmed.starts_with("mod ") && trimmed.ends_with(';')) {
                end = offset + candidate.len();
                break;
            }
            j += 1;
        }
        scopes.push((start, end));
        i = j + 1;
    }
    scopes
}

/// The first string-literal argument of each `needle` macro call in `text`.
fn macro_arguments(
    file: &Path,
    text: &str,
    whole_file_is_test: bool,
    needles: &[&str],
) -> Vec<Reference> {
    let scopes = cfg_test_scopes(text);
    let mut out = Vec::new();
    for needle in needles {
        let mut from = 0usize;
        while let Some(found) = text[from..].find(needle) {
            let at = from + found;
            from = at + needle.len();
            let Some(literal) = first_string_literal(&text[from..]) else {
                continue;
            };
            out.push(Reference {
                in_file: file.to_path_buf(),
                literal,
                test_only: whole_file_is_test || in_any_scope(at, &scopes),
            });
        }
    }
    out
}

/// The `path: "…"` argument of each `bindgen!` invocation. Scoped to the macro body so a
/// struct literal with a `path:` field (there are many, all HTTP routes) is not mistaken
/// for a compile-time file reference.
fn bindgen_paths(file: &Path, text: &str, whole_file_is_test: bool) -> Vec<Reference> {
    let scopes = cfg_test_scopes(text);
    let mut out = Vec::new();
    let mut from = 0usize;
    while let Some(found) = text[from..].find("bindgen!") {
        let at = from + found;
        from = at + "bindgen!".len();
        let body_end = text[from..].find("});").map(|end| from + end).unwrap_or(text.len());
        let body = &text[from..body_end];
        let Some((_, after)) = body.split_once("path:") else {
            continue;
        };
        let Some(literal) = first_string_literal(after) else {
            continue;
        };
        out.push(Reference {
            in_file: file.to_path_buf(),
            literal,
            test_only: whole_file_is_test || in_any_scope(at, &scopes),
        });
    }
    out
}

fn in_any_scope(at: usize, scopes: &[(usize, usize)]) -> bool {
    scopes.iter().any(|(start, end)| at >= *start && at < *end)
}

/// The first `"…"` in `text`. Paths never carry escapes; a literal that does is returned
/// verbatim and simply will not resolve inside the crate, which fails loudly.
fn first_string_literal(text: &str) -> Option<String> {
    let open = text.find('"')?;
    let rest = &text[open + 1..];
    let close = rest.find('"')?;
    Some(rest[..close].to_string())
}

/// Line starts and their text, without the trailing newline.
fn line_offsets(text: &str) -> Vec<(usize, &str)> {
    let mut out = Vec::new();
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        out.push((offset, line.trim_end_matches(['\n', '\r'])));
        offset += line.len();
    }
    out
}

/// Resolve `.` and `..` lexically. Not `canonicalize`: the target of an escaping reference
/// may not exist, and a guard that needs the file to be there would go quiet in exactly the
/// case it exists to catch.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}
