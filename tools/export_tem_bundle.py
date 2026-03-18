#!/usr/bin/env python3
"""
export_tem_bundle.py — Export torch_tem checkpoint to WeightsBundle JSON.

Converts a trained torch_tem model checkpoint (.pt) to the JSON format
consumed by the TypeScript codegen CLI (npx tem-codegen).

Usage:
  # From a real checkpoint:
  python tools/export_tem_bundle.py \\
    --checkpoint /path/to/torch_tem/checkpoints/tem_v1.pt \\
    --out packages/plugin-tem/src/core/generated/bundle.json

  # Synthetic bundle for CI (no checkpoint needed, uses zeros):
  python tools/export_tem_bundle.py \\
    --synthetic \\
    --out packages/plugin-tem/src/core/generated/bundle.json

WeightsBundle schema: packages/plugin-tem/src/core/weights.ts
Codegen guide:        packages/plugin-tem/CODEGEN.md
"""

import argparse
import json
import sys
from pathlib import Path


# ─── Default config (mirrors TEMConfig in tem-inference.ts) ──────────────────

DEFAULT_CONFIG = {
    "nG": [10, 10, 8, 6, 6],
    "nX": 64,
    "nActions": 16,
    "hiddenSize": 20,
}


# ─── Tensor helpers ───────────────────────────────────────────────────────────

def tensor_to_list(t) -> list:
    """Convert a torch tensor or numpy array to a flat Python list."""
    if hasattr(t, "detach"):
        return t.detach().cpu().numpy().flatten().tolist()
    if hasattr(t, "flatten"):
        return t.flatten().tolist()
    return list(t)


def zeros(n: int) -> list:
    return [0.0] * n


# ─── Synthetic bundle (no checkpoint needed) ─────────────────────────────────

def make_synthetic_bundle(config: dict) -> dict:
    """
    Generate a WeightsBundle with all-zero weights.
    Shapes are correct for the given config — useful for CI and testing.
    """
    n_g = config["nG"]
    n_x = config["nX"]
    n_actions = config["nActions"]
    hidden_size = config["hiddenSize"]
    n_modules = len(n_g)

    sum_g = sum(n_g)
    sum_p = sum(g * 3 for g in n_g)

    rnn = []
    for _ in range(n_actions):
        action_modules = []
        for f in range(n_modules):
            input_size = n_g[f] + n_actions
            action_modules.append({
                "W_ih": zeros(hidden_size * input_size),
                "W_hh": zeros(hidden_size * hidden_size),
                "b_ih": zeros(hidden_size),
                "b_hh": zeros(hidden_size),
                "hiddenSize": hidden_size,
                "inputSize": input_size,
            })
        rnn.append(action_modules)

    return {
        "version": "0.1.0-synthetic",
        "sourceCommit": "synthetic",
        "config": {
            "nG": n_g,
            "nX": n_x,
            "nActions": n_actions,
        },
        "weights": {
            "rnn": rnn,
            "conjunction": {
                "W_tile": zeros(sum_p * sum_g),
                "W_repeat": zeros(sum_p * n_x),
            },
            "placeGenerator": [
                {
                    "W": zeros(sum_p * sum_g),
                    "b": zeros(sum_p),
                    "inFeatures": sum_g,
                    "outFeatures": sum_p,
                }
            ],
            "sensoryDecoder": [
                {
                    "W": zeros(n_x * sum_p),
                    "b": zeros(n_x),
                    "inFeatures": sum_p,
                    "outFeatures": n_x,
                }
            ],
        },
    }


# ─── Real checkpoint export ───────────────────────────────────────────────────

def export_from_checkpoint(checkpoint_path: str, config: dict) -> dict:
    """
    Load a torch_tem checkpoint and extract weights into WeightsBundle format.

    Expected model attributes (torch_tem convention):
      model.g_GRU[action][module]  — GRUCell per action per frequency module
      model.W_tile                 — conjunction tile projection
      model.W_repeat               — conjunction repeat projection
      model.g_to_p                 — place generator linear layer(s)
      model.p_to_x                 — sensory decoder linear layer(s)

    Adjust attribute names if your torch_tem version differs.
    """
    try:
        import torch
    except ImportError:
        print("Error: PyTorch is required for real checkpoint export.", file=sys.stderr)
        print("Install with: pip install torch", file=sys.stderr)
        print("Or use --synthetic to generate a zero-weight bundle without PyTorch.", file=sys.stderr)
        sys.exit(1)

    n_g = config["nG"]
    n_x = config["nX"]
    n_actions = config["nActions"]
    n_modules = len(n_g)
    sum_g = sum(n_g)
    sum_p = sum(g * 3 for g in n_g)

    checkpoint = torch.load(checkpoint_path, map_location="cpu")

    # Support both raw state_dict and full checkpoint dicts
    if "model_state_dict" in checkpoint:
        state = checkpoint["model_state_dict"]
        source_commit = checkpoint.get("commit", None)
    elif "state_dict" in checkpoint:
        state = checkpoint["state_dict"]
        source_commit = checkpoint.get("commit", None)
    else:
        # Assume the checkpoint IS the state dict
        state = checkpoint
        source_commit = None

    def get(key: str):
        if key not in state:
            raise KeyError(
                f"Key '{key}' not found in checkpoint. "
                f"Available keys (first 10): {list(state.keys())[:10]}"
            )
        return tensor_to_list(state[key])

    rnn = []
    for a in range(n_actions):
        action_modules = []
        for f in range(n_modules):
            hidden_size = state.get(
                f"g_GRU.{a}.{f}.weight_ih_l0",
                state.get(f"g_GRU_{a}_{f}.weight_ih_l0"),
            )
            if hidden_size is None:
                # Try alternate naming conventions
                key_wih = f"encoder.g_GRU.{a}.{f}.weight_ih"
                key_whh = f"encoder.g_GRU.{a}.{f}.weight_hh"
                key_bih = f"encoder.g_GRU.{a}.{f}.bias_ih"
                key_bhh = f"encoder.g_GRU.{a}.{f}.bias_hh"
            else:
                key_wih = f"g_GRU.{a}.{f}.weight_ih_l0"
                key_whh = f"g_GRU.{a}.{f}.weight_hh_l0"
                key_bih = f"g_GRU.{a}.{f}.bias_ih_l0"
                key_bhh = f"g_GRU.{a}.{f}.bias_hh_l0"

            w_ih = get(key_wih)
            w_hh = get(key_whh)
            b_ih = get(key_bih)
            b_hh = get(key_bhh)

            # Derive dimensions from actual tensor shapes
            h = len(b_ih)
            input_size = n_g[f] + n_actions

            action_modules.append({
                "W_ih": w_ih,
                "W_hh": w_hh,
                "b_ih": b_ih,
                "b_hh": b_hh,
                "hiddenSize": h,
                "inputSize": input_size,
            })
        rnn.append(action_modules)

    bundle = {
        "version": "0.1.0",
        "config": {"nG": n_g, "nX": n_x, "nActions": n_actions},
        "weights": {
            "rnn": rnn,
            "conjunction": {
                "W_tile": get("W_tile"),
                "W_repeat": get("W_repeat"),
            },
            "placeGenerator": [
                {
                    "W": get("g_to_p.weight"),
                    "b": get("g_to_p.bias"),
                    "inFeatures": sum_g,
                    "outFeatures": sum_p,
                }
            ],
            "sensoryDecoder": [
                {
                    "W": get("p_to_x.weight"),
                    "b": get("p_to_x.bias"),
                    "inFeatures": sum_p,
                    "outFeatures": n_x,
                }
            ],
        },
    }

    if source_commit:
        bundle["sourceCommit"] = source_commit

    return bundle


# ─── Validation ───────────────────────────────────────────────────────────────

def validate_bundle(bundle: dict) -> None:
    """Validate WeightsBundle shapes. Raises ValueError on mismatch."""
    cfg = bundle["config"]
    n_g = cfg["nG"]
    n_x = cfg["nX"]
    n_actions = cfg["nActions"]
    n_modules = len(n_g)
    sum_g = sum(n_g)
    sum_p = sum(g * 3 for g in n_g)

    w = bundle["weights"]

    if len(w["rnn"]) != n_actions:
        raise ValueError(f"rnn: expected {n_actions} entries, got {len(w['rnn'])}")

    for a in range(n_actions):
        if len(w["rnn"][a]) != n_modules:
            raise ValueError(f"rnn[{a}]: expected {n_modules} modules, got {len(w['rnn'][a])}")
        for f in range(n_modules):
            m = w["rnn"][a][f]
            h = m["hiddenSize"]
            inp = m["inputSize"]
            if len(m["W_ih"]) != h * inp:
                raise ValueError(
                    f"rnn[{a}][{f}].W_ih: expected {h * inp}, got {len(m['W_ih'])}"
                )
            if len(m["W_hh"]) != h * h:
                raise ValueError(
                    f"rnn[{a}][{f}].W_hh: expected {h * h}, got {len(m['W_hh'])}"
                )

    expected_tile = sum_p * sum_g
    expected_repeat = sum_p * n_x

    if len(w["conjunction"]["W_tile"]) != expected_tile:
        raise ValueError(
            f"conjunction.W_tile: expected {expected_tile}, got {len(w['conjunction']['W_tile'])}"
        )
    if len(w["conjunction"]["W_repeat"]) != expected_repeat:
        raise ValueError(
            f"conjunction.W_repeat: expected {expected_repeat}, got {len(w['conjunction']['W_repeat'])}"
        )


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Export a torch_tem checkpoint to WeightsBundle JSON."
    )
    parser.add_argument("--checkpoint", help="Path to torch_tem .pt checkpoint file.")
    parser.add_argument("--out", required=True, help="Output path for bundle.json.")
    parser.add_argument(
        "--synthetic",
        action="store_true",
        help="Generate a synthetic zero-weight bundle (no checkpoint needed).",
    )
    parser.add_argument("--n-g", default="10,10,8,6,6", help="Comma-separated nG values.")
    parser.add_argument("--n-x", type=int, default=64, help="Observation dimension.")
    parser.add_argument("--n-actions", type=int, default=16, help="Number of actions.")
    parser.add_argument("--hidden-size", type=int, default=20, help="RNN hidden size.")

    args = parser.parse_args()

    if not args.synthetic and not args.checkpoint:
        parser.error("Either --checkpoint or --synthetic is required.")

    config = {
        "nG": [int(x) for x in args.n_g.split(",")],
        "nX": args.n_x,
        "nActions": args.n_actions,
        "hiddenSize": args.hidden_size,
    }

    if args.synthetic:
        bundle = make_synthetic_bundle(config)
        print(f"✓ Generated synthetic bundle (zeros, shapes correct for config)")
    else:
        bundle = export_from_checkpoint(args.checkpoint, config)
        print(f"✓ Exported checkpoint: {args.checkpoint}")

    validate_bundle(bundle)
    print(f"✓ Shape validation passed")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(bundle, indent=2))

    n_actions = config["nActions"]
    n_modules = len(config["nG"])
    print(f"✓ Wrote {args.out}")
    print(f"  Config: nG={config['nG']} nX={config['nX']} nActions={n_actions}")
    print(f"  RNN tensors: {n_actions} actions × {n_modules} modules")


if __name__ == "__main__":
    main()
