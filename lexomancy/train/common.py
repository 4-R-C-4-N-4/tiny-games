"""Shared helpers for the lexomancy training pipeline."""

import json
from pathlib import Path

import numpy as np

TRAIN_DIR = Path(__file__).parent
DATA = TRAIN_DIR / "data"
CACHE = Path.home() / ".cache" / "lexomancy"

VOCAB_TSV = DATA / "vocab.tsv"
EMB_NPY = DATA / "embeddings.f32.npy"
LABELS_JSONL = DATA / "labels.jsonl"
HEAD_NPZ = DATA / "head.npz"
REDUCED_NPZ = DATA / "reduced.npz"
ANCHOR_WORDS = DATA / "anchor-words.json"

CHANNELS = ["damage", "hex", "ward", "heal"]

# Runtime scoring constants — single source of truth, shipped in the asset
# header so the TS scorer and the python golden generator can never disagree.
SCORING = {
    "temperature": 2.5,   # softmax temp over raw 0-10 channel scores
    "zipfZero": 5.1,      # zipf at/above which rarity = 0
    "zipfRange": 3.3,     # rarity ramps to 1 over this many zipf points below zero
    # Power scale tuned against real fights: a word's power splits across all
    # four channels (a "damage" word rarely puts more than ~50-80% of its
    # power into damage), so the raw scale must be well above HP pools or
    # even good words tickle for 2-3. Playtest showed ~40-60 HP bosses were
    # nearly unkillable at the old base=4/rarity=16 scale.
    "powerBase": 7,
    "powerRarity": 26,
    "potencyFloor": 0.4,  # mundane words (all channels low) keep this fraction
    "costBase": 0.35,
    "costPurity": 0.6,
    "zipfScale": 32,      # uint8 zipf encoding: round(zipf * 32)
    # Similarity calibration: raw GloVe cosines put synonyms at ~0.45-0.6 and
    # unrelated words at ~0.2. Fatigue wants synonyms ≈ 1 and unrelated ≈ 0,
    # so similarity() = clamp((cos - simFloor) / simRange, 0, 1).
    "simFloor": 0.2,
    "simRange": 0.55,
}


def load_vocab():
    words, zipfs = [], []
    with open(VOCAB_TSV) as f:
        for line in f:
            w, z = line.rstrip("\n").split("\t")
            words.append(w)
            zipfs.append(float(z))
    return words, np.array(zipfs, dtype=np.float32)


def load_anchor_words():
    return json.loads(ANCHOR_WORDS.read_text())


def curated_words():
    """Every hand-authored word: channel seeds, stat adjectives, theme sets."""
    a = load_anchor_words()
    out = list(a.get("extras", []))
    for group in ("channels", "stats", "themes"):
        for wordset in a[group].values():
            out.extend(wordset)
    return sorted(set(out))


def load_labels():
    """word -> [damage, hex, ward, heal] floats 0-10."""
    labels = {}
    if LABELS_JSONL.exists():
        with open(LABELS_JSONL) as f:
            for line in f:
                r = json.loads(line)
                labels[r["word"]] = [float(r[c]) for c in CHANNELS]
    return labels
