"""Teacher labeling: score seed words 0-10 per spell channel with a local LLM.

The label set = every curated anchor word + a zipf-stratified random sample of
the vocab. Resumable: words already in data/labels.jsonl are skipped, so it is
safe to re-run after interruption or with a bigger --sample.

Usage: .venv/bin/python label_teacher.py [--sample 3400] [--batch 20]
                                         [--model qwen3:8b] [--limit N]
"""

import argparse
import json
import random
import urllib.request

import numpy as np

from common import CHANNELS, LABELS_JSONL, curated_words, load_labels, load_vocab

OLLAMA = "http://localhost:11434/api/chat"

SYSTEM = """You label single English words for a word-magic game with four spell channels. For each word rate 0-10 how strongly the word evokes each channel, judged on meaning and connotation:
- damage: direct harm, destruction, attack, violence
- hex: curses, decay, poison, weakening, corruption, misfortune
- ward: protection, blocking, shielding, endurance
- heal: restoration, soothing, growth, renewal
Channels are independent — a word can score high on several, and most mundane words score low on all four. Calibration examples: inferno = damage 9, hex 1, ward 0, heal 0. mirror = damage 0, hex 1, ward 8, heal 0. balm = damage 0, hex 0, ward 1, heal 9. rot = damage 4, hex 8, ward 0, heal 0. chair = damage 0, hex 0, ward 1, heal 0. gravity = damage 5, hex 3, ward 2, heal 0."""

FORMAT = {
    "type": "object",
    "properties": {
        "labels": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "word": {"type": "string"},
                    **{c: {"type": "integer"} for c in CHANNELS},
                },
                "required": ["word", *CHANNELS],
            },
        }
    },
    "required": ["labels"],
}


def call_teacher(model: str, words: list[str]) -> dict[str, list[float]]:
    body = json.dumps(
        {
            "model": model,
            "stream": False,
            "think": False,
            "options": {"temperature": 0.1, "num_ctx": 4096},
            "format": FORMAT,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": "Label these words: " + ", ".join(words)},
            ],
        }
    ).encode()
    req = urllib.request.Request(OLLAMA, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        content = json.loads(resp.read())["message"]["content"]
    out = {}
    wanted = set(words)
    for row in json.loads(content).get("labels", []):
        w = str(row.get("word", "")).strip().lower()
        if w not in wanted:
            continue
        try:
            out[w] = [max(0.0, min(10.0, float(row[c]))) for c in CHANNELS]
        except (KeyError, TypeError, ValueError):
            continue
    return out


def pick_words(sample: int) -> list[str]:
    words, zipfs = load_vocab()
    in_vocab = set(words)
    chosen = [w for w in curated_words() if w in in_vocab]
    chosen_set = set(chosen)

    rng = random.Random(7)
    bands = [(5.0, 9.0, 0.15), (4.0, 5.0, 0.2), (3.0, 4.0, 0.25), (2.0, 3.0, 0.25), (0.0, 2.0, 0.15)]
    z = np.asarray(zipfs)
    for lo, hi, frac in bands:
        pool = [w for w, wz in zip(words, z) if lo <= wz < hi and w not in chosen_set]
        take = min(len(pool), round(sample * frac))
        chosen.extend(rng.sample(pool, take))
    return chosen


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=3400)
    ap.add_argument("--batch", type=int, default=20)
    ap.add_argument("--model", default="qwen3:8b")
    ap.add_argument("--limit", type=int, default=0, help="stop after N new labels (0 = all)")
    args = ap.parse_args()

    done = load_labels()
    todo = [w for w in pick_words(args.sample) if w not in done]
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(done)} already labeled, {len(todo)} to go, model={args.model}")

    labeled = 0
    with open(LABELS_JSONL, "a") as out:
        for i in range(0, len(todo), args.batch):
            batch = todo[i : i + args.batch]
            try:
                got = call_teacher(args.model, batch)
            except Exception as e:  # noqa: BLE001 — log and keep going; resume covers it
                print(f"  batch {i // args.batch}: ERROR {e}")
                continue
            missing = [w for w in batch if w not in got]
            # One retry for words the teacher dropped or mangled.
            if missing:
                try:
                    got.update(call_teacher(args.model, missing))
                except Exception as e:  # noqa: BLE001
                    print(f"  retry: ERROR {e}")
            for w in batch:
                if w in got:
                    d, x, wd, h = got[w]
                    out.write(
                        json.dumps(
                            {"word": w, "damage": d, "hex": x, "ward": wd, "heal": h, "model": args.model}
                        )
                        + "\n"
                    )
                    labeled += 1
            out.flush()
            if (i // args.batch) % 10 == 0:
                print(f"  {labeled}/{len(todo)} labeled")
    print(f"done: {labeled} new labels -> {LABELS_JSONL}")


if __name__ == "__main__":
    main()
