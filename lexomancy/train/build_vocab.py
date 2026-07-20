"""Build the game vocabulary: GloVe ∩ wordfreq, plus every curated word.

Emits data/vocab.tsv (word\tzipf, frequency-descending) and
data/embeddings.f32.npy (aligned float32 matrix, 300d).

Usage: .venv/bin/python build_vocab.py [--cap 60000] [--min-zipf 1.8]
"""

import argparse
import re

import numpy as np
from wordfreq import zipf_frequency

from common import CACHE, DATA, EMB_NPY, VOCAB_TSV, curated_words

GLOVE = CACHE / "glove.6B.300d.txt"
DICTIONARY = CACHE / "words_alpha.txt"  # dwyl/english-words: proper-noun-free
WORD_RE = re.compile(r"^[a-z]{2,24}$")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cap", type=int, default=80000)
    ap.add_argument("--min-zipf", type=float, default=1.4)
    args = ap.parse_args()

    dictionary = set(DICTIONARY.read_text().split())
    curated = set(curated_words())
    rows = []  # (word, zipf, vec)
    kept_curated = set()
    with open(GLOVE) as f:
        for line in f:
            word, rest = line.split(" ", 1)
            if not WORD_RE.match(word):
                continue
            forced = word in curated
            # Dictionary membership kills corpus junk (names, typos) that
            # floods the low-zipf band where the game's arcane tail lives.
            if word not in dictionary and not forced:
                continue
            z = zipf_frequency(word, "en")
            if z < args.min_zipf and not forced:
                continue
            vec = np.fromstring(rest, dtype=np.float32, sep=" ")
            rows.append((word, z, vec))
            if forced:
                kept_curated.add(word)

    missing = curated - kept_curated
    if missing:
        print(f"WARNING: {len(missing)} curated words not in GloVe: {sorted(missing)}")

    # Frequency-descending, curated words exempt from the cap.
    rows.sort(key=lambda r: -r[1])
    if len(rows) > args.cap:
        head, tail = rows[: args.cap], rows[args.cap :]
        head.extend(r for r in tail if r[0] in curated)
        rows = head

    words = [r[0] for r in rows]
    zipfs = [r[1] for r in rows]
    mat = np.stack([r[2] for r in rows])

    DATA.mkdir(parents=True, exist_ok=True)
    with open(VOCAB_TSV, "w") as f:
        for w, z in zip(words, zipfs):
            f.write(f"{w}\t{z:.2f}\n")
    np.save(EMB_NPY, mat)

    z = np.array(zipfs)
    print(f"vocab: {len(words)} words, emb {mat.shape}")
    print(f"zipf cutoff at cap boundary: {z[min(args.cap, len(z)) - 1]:.2f}")
    for lo, hi in [(5, 9), (4, 5), (3, 4), (2, 3), (0, 2)]:
        n = int(((z >= lo) & (z < hi)).sum())
        print(f"  zipf [{lo},{hi}): {n}")


if __name__ == "__main__":
    main()
