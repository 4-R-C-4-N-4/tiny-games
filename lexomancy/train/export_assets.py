"""Pack the shipping asset: web/public/lexicon.bin + golden test fixtures.

Layout (little-endian):
  "LEXO" magic, u32 version, u32 headerLen, header JSON,
  then sections at header-declared offsets (each 4-byte aligned):
  vocab (utf8, newline-joined), vectors (int8 count*dims), zipf (uint8 count),
  head (float32: w1, b1, w2, b2), anchors (float32 unit centroids).

Also emits src/model-scorer.golden.json: full profiles for a handful of words
computed with the exact runtime formulas, so the TS scorer is pinned to python.

Usage: .venv/bin/python export_assets.py
"""

import json
import math
import struct
from pathlib import Path

import numpy as np

from common import CHANNELS, HEAD_NPZ, REDUCED_NPZ, SCORING, load_anchor_words, load_vocab

OUT_BIN = Path(__file__).parent.parent / "web" / "public" / "lexicon.bin"
OUT_GOLDEN = Path(__file__).parent.parent / "src" / "model-scorer.golden.json"

GOLDEN_WORDS = [
    "kill", "immolate", "conflagration", "mirror", "bulwark", "panacea",
    "malediction", "winter", "anchor", "lullaby", "spreadsheet", "sepulchre",
]
GOLDEN_PAIRS = [("kill", "murder"), ("kill", "mirror"), ("frost", "ice"), ("honey", "anvil")]


def js_round(x):
    """Python round() ties-to-even (round(6.5)==6); JS Math.round ties-up
    (Math.round(6.5)==7). power/cost feed the TS golden test directly, so
    match JS semantics here rather than silently disagreeing at .5 ties."""
    return math.floor(x + 0.5)


def gelu_tanh(x):
    return 0.5 * x * (1.0 + np.tanh(np.sqrt(2.0 / np.pi) * (x + 0.044715 * x**3)))


def head_forward(head, x):
    h = gelu_tanh(x @ head["w1"].T + head["b1"])
    logits = h @ head["w2"].T + head["b2"]
    return 1.0 / (1.0 + np.exp(-logits)) * 10.0


def profile(word, index, q, zipf_u8, head):
    s = SCORING
    i = index[word]
    x = q[i].astype(np.float32) / 127.0
    raw = head_forward(head, x[None, :])[0]
    exps = np.exp((raw - raw.max()) / s["temperature"])
    mix = exps / exps.sum()
    mix = np.where(mix < s["mixFloor"], 0, mix)
    mix = mix / mix.sum()  # softmax max is always >= 1/4 > mixFloor, so sum > 0
    z = zipf_u8[i] / s["zipfScale"]
    rarity = float(np.clip((s["zipfZero"] - z) / s["zipfRange"], 0, 1))
    potency = float(np.clip(raw.max() / 10.0, 0, 1))
    power = js_round((s["powerBase"] + s["powerRarity"] * rarity) * (s["potencyFloor"] + (1 - s["potencyFloor"]) * potency))
    purity = float(mix.max())
    cost = max(1, js_round(power * (s["costBase"] + s["costPurity"] * purity)))
    return {
        "word": word,
        "mix": {c: float(m) for c, m in zip(CHANNELS, mix)},
        "dominant": CHANNELS[int(mix.argmax())],
        "rarity": rarity,
        "power": power,
        "cost": cost,
    }


def cosine(index, q, a, b):
    va = q[index[a]].astype(np.float32)
    vb = q[index[b]].astype(np.float32)
    cos = float(va @ vb / (np.linalg.norm(va) * np.linalg.norm(vb)))
    return float(np.clip((cos - SCORING["simFloor"]) / SCORING["simRange"], 0, 1))


def main():
    words, zipfs = load_vocab()
    red = np.load(REDUCED_NPZ)
    q = red["q"]
    head_npz = np.load(HEAD_NPZ)
    head = {k: head_npz[k].astype(np.float32) for k in ("w1", "b1", "w2", "b2")}
    count, dims = q.shape
    hidden = head["b1"].shape[0]
    index = {w: i for i, w in enumerate(words)}

    zipf_u8 = np.clip(np.round(np.asarray(zipfs) * SCORING["zipfScale"]), 0, 255).astype(np.uint8)

    anchors = load_anchor_words()
    anchor_names, anchor_rows, anchor_scales = [], [], []
    for group in ("stats", "themes"):
        for name, members in anchors[group].items():
            vecs = [q[index[w]].astype(np.float32) / 127.0 for w in members if w in index]
            c = np.mean(vecs, axis=0)
            c /= np.linalg.norm(c)
            anchor_names.append(f"{group}:{name}")
            anchor_rows.append(c.astype(np.float32))
            # Per-anchor scale: mean calibrated affinity of the anchor's own
            # members. Diffuse anchors (scattered wordsets) read low for
            # everything; dividing by this evens the playing field.
            sims = []
            for v in vecs:
                cos = float(v @ c / np.linalg.norm(v))
                sims.append(np.clip((cos - SCORING["simFloor"]) / SCORING["simRange"], 0, 1))
            # Floor prevents very diffuse anchors from inflating all affinities.
            anchor_scales.append(round(max(0.55, float(np.mean(sims))), 4))
    anchor_mat = np.stack(anchor_rows)

    vocab_bytes = "\n".join(words).encode()
    head_bytes = b"".join(head[k].tobytes() for k in ("w1", "b1", "w2", "b2"))

    def pad4(n):
        return (4 - n % 4) % 4

    # Assemble sections with explicit offsets, each aligned to 4 bytes.
    sections = {}
    blobs = []

    def add(name, data):
        offset = sum(len(b) for b in blobs)
        sections[name] = {"offset": offset, "length": len(data)}
        blobs.append(data + b"\x00" * pad4(len(data)))

    add("vocab", vocab_bytes)
    add("vectors", q.tobytes())
    add("zipf", zipf_u8.tobytes())
    add("head", head_bytes)
    add("anchors", anchor_mat.tobytes())

    header = {
        "count": count,
        "dims": dims,
        "hidden": hidden,
        "channels": CHANNELS,
        "scoring": SCORING,
        "anchorNames": anchor_names,
        "anchorScales": anchor_scales,
        "sections": sections,
    }
    header_bytes = json.dumps(header).encode()
    header_bytes += b" " * pad4(len(header_bytes))

    OUT_BIN.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_BIN, "wb") as f:
        f.write(b"LEXO")
        f.write(struct.pack("<II", 1, len(header_bytes)))
        f.write(header_bytes)
        for b in blobs:
            f.write(b)
    size = OUT_BIN.stat().st_size
    print(f"packed {OUT_BIN} ({size / 1e6:.2f} MB, {count} words x {dims}d, {len(anchor_names)} anchors)")

    golden = {
        "profiles": [profile(w, index, q, zipf_u8, head) for w in GOLDEN_WORDS if w in index],
        "similarity": [
            {"a": a, "b": b, "value": cosine(index, q, a, b)}
            for a, b in GOLDEN_PAIRS
            if a in index and b in index
        ],
    }
    OUT_GOLDEN.write_text(json.dumps(golden, indent=2) + "\n")
    print(f"golden fixtures -> {OUT_GOLDEN}")


if __name__ == "__main__":
    main()
