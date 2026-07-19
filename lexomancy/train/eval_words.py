"""Spot-check the trained scorer: print full in-game profiles for words.

Usage: .venv/bin/python eval_words.py inferno mirror panacea susurrus
       .venv/bin/python eval_words.py            # default tour of the ladder
"""

import sys

import numpy as np

from common import CHANNELS, HEAD_NPZ, REDUCED_NPZ, load_vocab
from export_assets import profile

DEFAULT = [
    "kill", "slay", "smite", "immolate", "conflagration",
    "curse", "blight", "malediction",
    "wall", "mirror", "bulwark", "aegis",
    "heal", "balm", "panacea",
    "winter", "gravity", "rust", "anchor", "lullaby",
    "chair", "spreadsheet", "bureaucracy", "sepulchre", "zephyr",
]


def main():
    words_arg = [w.lower() for w in sys.argv[1:]] or DEFAULT
    words, zipfs = load_vocab()
    index = {w: i for i, w in enumerate(words)}
    q = np.load(REDUCED_NPZ)["q"]
    head_npz = np.load(HEAD_NPZ)
    head = {k: head_npz[k].astype(np.float32) for k in ("w1", "b1", "w2", "b2")}
    zipf_u8 = np.clip(np.round(np.asarray(zipfs) * 32), 0, 255).astype(np.uint8)

    hdr = "word            " + " ".join(f"{c:>6}" for c in CHANNELS) + "  dominant  rarity power cost"
    print(hdr)
    print("-" * len(hdr))
    for w in words_arg:
        if w not in index:
            print(f"{w:15s} (not in vocab)")
            continue
        p = profile(w, index, q, zipf_u8, head)
        mixes = " ".join(f"{p['mix'][c]:6.2f}" for c in CHANNELS)
        print(
            f"{w:15s} {mixes}  {p['dominant']:8s} {p['rarity']:6.2f} {p['power']:5d} {p['cost']:4d}"
        )


if __name__ == "__main__":
    main()
