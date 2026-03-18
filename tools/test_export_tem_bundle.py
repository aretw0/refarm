#!/usr/bin/env python3
"""
Tests for export_tem_bundle.py — run with: python tools/test_export_tem_bundle.py

Uses only Python stdlib (no torch, no pytest) so they run in CI without deps.
All tests use --synthetic mode.
"""

import json
import sys
import tempfile
from pathlib import Path

# Import the module under test
sys.path.insert(0, str(Path(__file__).parent))
from export_tem_bundle import make_synthetic_bundle, validate_bundle, DEFAULT_CONFIG

PASS = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"

failures = []


def test(name: str, fn):
    try:
        fn()
        print(f"  {PASS} {name}")
    except Exception as e:
        print(f"  {FAIL} {name}: {e}")
        failures.append(name)


# ─── make_synthetic_bundle ────────────────────────────────────────────────────

print("make_synthetic_bundle")


def check_synthetic_structure():
    b = make_synthetic_bundle(DEFAULT_CONFIG)
    assert "version" in b
    assert "config" in b
    assert "weights" in b
    assert b["config"]["nG"] == DEFAULT_CONFIG["nG"]
    assert b["config"]["nX"] == DEFAULT_CONFIG["nX"]
    assert b["config"]["nActions"] == DEFAULT_CONFIG["nActions"]


test("returns correct top-level structure", check_synthetic_structure)


def check_rnn_dimensions():
    cfg = {"nG": [4, 4], "nX": 8, "nActions": 4, "hiddenSize": 6}
    b = make_synthetic_bundle(cfg)
    assert len(b["weights"]["rnn"]) == 4, "rnn should have 4 action entries"
    assert len(b["weights"]["rnn"][0]) == 2, "each action should have 2 modules"
    m = b["weights"]["rnn"][0][0]
    expected_wih = 6 * (4 + 4)  # hiddenSize * (nG[0] + nActions)
    assert len(m["W_ih"]) == expected_wih, f"W_ih: expected {expected_wih}, got {len(m['W_ih'])}"


test("RNN tensor shapes are correct", check_rnn_dimensions)


def check_conjunction_dimensions():
    cfg = {"nG": [4, 4], "nX": 8, "nActions": 4, "hiddenSize": 6}
    b = make_synthetic_bundle(cfg)
    sum_g = 8
    sum_p = 24
    assert len(b["weights"]["conjunction"]["W_tile"]) == sum_p * sum_g
    assert len(b["weights"]["conjunction"]["W_repeat"]) == sum_p * cfg["nX"]


test("conjunction tensor shapes are correct", check_conjunction_dimensions)


def check_all_zeros():
    b = make_synthetic_bundle(DEFAULT_CONFIG)
    w = b["weights"]
    for a in w["rnn"]:
        for m in a:
            assert all(v == 0.0 for v in m["W_ih"]), "W_ih should be zeros"
    assert all(v == 0.0 for v in w["conjunction"]["W_tile"])


test("all values are zero", check_all_zeros)


def check_json_serializable():
    b = make_synthetic_bundle(DEFAULT_CONFIG)
    json_str = json.dumps(b)
    restored = json.loads(json_str)
    assert restored["config"]["nG"] == DEFAULT_CONFIG["nG"]


test("output is JSON-serializable and round-trips", check_json_serializable)


# ─── validate_bundle ──────────────────────────────────────────────────────────

print("\nvalidate_bundle")


def check_valid_passes():
    b = make_synthetic_bundle(DEFAULT_CONFIG)
    validate_bundle(b)  # should not raise


test("passes for a valid synthetic bundle", check_valid_passes)


def check_wrong_rnn_count():
    b = make_synthetic_bundle(DEFAULT_CONFIG)
    b["weights"]["rnn"].pop()  # remove one action
    try:
        validate_bundle(b)
        raise AssertionError("should have raised ValueError")
    except ValueError as e:
        assert "rnn" in str(e).lower()


test("raises ValueError when rnn action count is wrong", check_wrong_rnn_count)


def check_wrong_w_ih():
    cfg = {"nG": [4, 4], "nX": 8, "nActions": 4, "hiddenSize": 6}
    b = make_synthetic_bundle(cfg)
    b["weights"]["rnn"][0][0]["W_ih"] = [1.0, 2.0]  # wrong size
    try:
        validate_bundle(b)
        raise AssertionError("should have raised ValueError")
    except ValueError as e:
        assert "W_ih" in str(e)


test("raises ValueError when W_ih has wrong size", check_wrong_w_ih)


def check_wrong_w_tile():
    b = make_synthetic_bundle(DEFAULT_CONFIG)
    b["weights"]["conjunction"]["W_tile"] = [0.0, 0.0]  # wrong size
    try:
        validate_bundle(b)
        raise AssertionError("should have raised ValueError")
    except ValueError as e:
        assert "W_tile" in str(e)


test("raises ValueError when W_tile has wrong size", check_wrong_w_tile)


# ─── CLI smoke test ───────────────────────────────────────────────────────────

print("\nCLI --synthetic")


def check_cli_synthetic():
    import subprocess
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        out_path = f.name

    result = subprocess.run(
        [sys.executable, "tools/export_tem_bundle.py", "--synthetic", "--out", out_path],
        capture_output=True, text=True,
        cwd=str(Path(__file__).parent.parent),
    )
    assert result.returncode == 0, f"CLI failed: {result.stderr}"

    bundle = json.loads(Path(out_path).read_text())
    assert bundle["config"]["nG"] == DEFAULT_CONFIG["nG"]
    assert bundle["sourceCommit"] == "synthetic"


test("CLI --synthetic writes valid bundle.json", check_cli_synthetic)


# ─── Summary ─────────────────────────────────────────────────────────────────

print()
if failures:
    print(f"\033[31m{len(failures)} test(s) failed: {', '.join(failures)}\033[0m")
    sys.exit(1)
else:
    print(f"\033[32mAll tests passed.\033[0m")
